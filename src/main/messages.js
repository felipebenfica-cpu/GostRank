'use strict';

// Etapa 6: mensagens do alvo aberto (canal 'c:<id>' ou DM 'd:<id>'): histórico com paginação,
// tempo real (alimentado pelo serviço central a partir do Realtime), envio com anexos, edição,
// exclusão, respostas, reações, fixadas, busca, não lidas/menções e "digitando…".

const { appError, isUuid } = require('./rest');
const { validateUpload } = require('./files');

const COLS = 'id,user_id,body,created_at,edited_at,reply_to,attachments,mentions,pinned,channel_id,dm_id,group_id';
const PAGE = 50;
const LIVE_MAX = 200;
const PAGED_MAX = 500;
const BODY_MAX = 2000;
const BODY_RAW_MAX = 8000;
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const TARGET_RE = /^[cd]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MENTION_TOKEN_RE = /<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/gi;
const MENTION_NAME_RE = /(^|[^\w@.])@([a-z0-9_.]{2,32})/gi;
const TYPING_MS = 6000;
const MAX_ATTACHMENTS = 4;
const MAX_MENTIONS = 20;
const EMOJI_MAX = 32;

function uuid() { return globalThis.crypto.randomUUID(); }

function validateBody(body, { allowEmpty = false } = {}) {
  if (typeof body !== 'string' || body.length > BODY_RAW_MAX) throw appError(typeof body === 'string' ? 'long_body' : 'empty_body');
  const v = body.replace(/\r\n/g, '\n').trim();
  const len = [...v].length;
  if (len === 0 && !allowEmpty) throw appError('empty_body');
  if (len > BODY_MAX) throw appError('long_body');
  if (CONTROL_RE.test(v)) throw appError('invalid_body');
  return v;
}

function validateEmoji(e) {
  if (typeof e !== 'string') return null;
  const s = e.trim();
  if (!s || s.length > EMOJI_MAX * 2 || [...s].length > EMOJI_MAX || /[\s<>]/.test(s) || CONTROL_RE.test(s)) return null;
  return s;
}

/** Menções: `<@uuid>` e `@usuario` (resolvido por `resolveUsername`). Únicas, até 20. */
function extractMentions(body, resolveUsername = () => null) {
  const out = [];
  const add = (id) => { if (id && !out.includes(id) && out.length < MAX_MENTIONS) out.push(id); };
  for (const m of body.matchAll(MENTION_TOKEN_RE)) add(m[1].toLowerCase());
  for (const m of body.matchAll(MENTION_NAME_RE)) {
    const id = resolveUsername(m[2].toLowerCase());
    if (isUuid(id)) add(id.toLowerCase());
  }
  return out;
}

function ts(v) {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
}

/** Linha do banco → mensagem interna (ou null se estranha). */
function fromRow(row) {
  if (!row || typeof row !== 'object') return null;
  if (!Number.isSafeInteger(row.id) || row.id <= 0 || !isUuid(row.user_id)) return null;
  if (typeof row.body !== 'string' || row.body.length > BODY_RAW_MAX) return null;
  const channelId = isUuid(row.channel_id) ? row.channel_id.toLowerCase() : null;
  const dmId = isUuid(row.dm_id) ? row.dm_id.toLowerCase() : null;
  const groupId = isUuid(row.group_id) ? row.group_id.toLowerCase() : null;
  const attachments = (Array.isArray(row.attachments) ? row.attachments : []).slice(0, MAX_ATTACHMENTS).filter((a) => a
    && typeof a.path === 'string' && a.path.length <= 512 && !a.path.includes('..')
    && typeof a.name === 'string' && a.name.length <= 200).map((a) => ({
    path: a.path,
    name: a.name,
    size: Number.isSafeInteger(a.size) && a.size >= 0 ? a.size : 0,
    mime: typeof a.mime === 'string' && a.mime.length <= 100 ? a.mime : 'application/octet-stream',
    width: Number.isInteger(a.width) && a.width > 0 ? a.width : undefined,
    height: Number.isInteger(a.height) && a.height > 0 ? a.height : undefined,
  }));
  return {
    id: row.id,
    authorId: row.user_id.toLowerCase(),
    body: row.body,
    createdAt: ts(row.created_at),
    editedAt: ts(row.edited_at),
    replyToId: Number.isSafeInteger(row.reply_to) && row.reply_to > 0 ? row.reply_to : null,
    attachments,
    mentions: (Array.isArray(row.mentions) ? row.mentions : []).filter(isUuid).map((s) => s.toLowerCase()).slice(0, MAX_MENTIONS),
    pinned: row.pinned === true,
    channelId,
    dmId,
    groupId,
    target: channelId ? `c:${channelId}` : (dmId ? `d:${dmId}` : null),
  };
}

function targetFilter(target) {
  const [kind, id] = target.split(':');
  return kind === 'c' ? `channel_id=eq.${id}` : `dm_id=eq.${id}`;
}

function attachmentPrefix(target, groupId) {
  const [kind, id] = target.split(':');
  return kind === 'c' ? `g_${groupId}/${id}/` : `d_${id}/`;
}

function createMessagesService({
  rest, users, onChange = () => {}, now = () => Date.now(), isFocused = () => true,
  timers = { setTimeout: (...a) => setTimeout(...a), clearTimeout: (...a) => clearTimeout(...a) },
} = {}) {
  let meId = null;
  let target = null;
  let ctx = { groupId: null, resolveUsername: () => null, isMentionable: () => true };
  let items = []; // internas, antiga → nova
  let status = 'idle';
  let errorText = null;
  let hasMore = false;
  let firstUnreadId = null;
  let generation = 0;
  let pendingSeq = 0;
  let paged = false;
  const reactions = new Map(); // id -> Map(emoji -> Set(userId))
  const replies = new Map(); // id -> {authorId, body} | {missing:true}
  const urls = new Map(); // path -> url assinada
  const unread = new Map(); // target -> {lastId, unread, mentions}
  const typing = new Map(); // target -> Map(userId -> expira)
  let typingTimer = null;
  let readTimer = null;
  let lastReadSent = new Map(); // target -> id

  function emit() { try { onChange(); } catch { /* ignora */ } }

  function setMe(id) { meId = id; }

  // ---------------- Carregamento ----------------
  async function hydrate(list, forTarget) {
    // Reações
    const ids = list.filter((m) => m.id > 0).map((m) => m.id);
    for (let i = 0; i < ids.length; i += PAGE) {
      const part = ids.slice(i, i + PAGE);
      try {
        const rows = await rest.select(`/rest/v1/message_reactions?select=message_id,user_id,emoji&message_id=in.(${part.join(',')})&limit=2000`);
        for (const id of part) reactions.set(id, new Map());
        for (const r of rows) addReaction(r.message_id, r.user_id, r.emoji);
      } catch { /* reações são opcionais */ }
    }
    // Respostas que não estão na lista
    const have = new Set(items.map((m) => m.id).concat(list.map((m) => m.id)));
    const need = [...new Set(list.map((m) => m.replyToId).filter((id) => id && !have.has(id) && !replies.has(id)))];
    if (need.length) {
      try {
        const rows = await rest.select(`/rest/v1/messages?select=id,user_id,body&id=in.(${need.join(',')})`);
        for (const id of need) replies.set(id, { missing: true });
        for (const r of rows) {
          if (r && Number.isSafeInteger(r.id) && isUuid(r.user_id) && typeof r.body === 'string') {
            replies.set(r.id, { authorId: r.user_id.toLowerCase(), body: r.body.slice(0, 120) });
          }
        }
      } catch { /* resposta sem prévia */ }
    }
    // Autores e citados
    const people = new Set();
    for (const m of list) { people.add(m.authorId); for (const x of m.mentions) people.add(x); }
    for (const r of replies.values()) if (r.authorId) people.add(r.authorId);
    await users.ensure([...people]);
    // Anexos
    const prefix = attachmentPrefix(forTarget, ctx.groupId);
    const paths = [];
    for (const m of list) for (const a of m.attachments) if (a.path.startsWith(prefix) && !urls.has(a.path)) paths.push(a.path);
    if (paths.length) {
      const signed = await rest.sign('attachments', paths);
      for (const [p, u] of signed) urls.set(p, u);
    }
  }

  function addReaction(messageId, userId, emoji) {
    if (!Number.isSafeInteger(messageId) || !isUuid(userId) || !validateEmoji(emoji)) return false;
    if (!reactions.has(messageId)) reactions.set(messageId, new Map());
    const m = reactions.get(messageId);
    if (!m.has(emoji)) m.set(emoji, new Set());
    const set = m.get(emoji);
    const uid = userId.toLowerCase();
    if (set.has(uid)) return false;
    set.add(uid);
    return true;
  }

  function removeReaction(messageId, userId, emoji) {
    const m = reactions.get(messageId);
    if (!m || !m.has(emoji)) return false;
    const set = m.get(emoji);
    const ok = set.delete(String(userId).toLowerCase());
    if (set.size === 0) m.delete(emoji);
    return ok;
  }

  /** Abre um alvo. `opts`: { groupId, resolveUsername }. */
  async function open(nextTarget, opts = {}) {
    if (nextTarget !== null && !TARGET_RE.test(nextTarget)) throw appError('no_target');
    const gen = ++generation;
    target = nextTarget;
    ctx = {
      groupId: opts.groupId || null,
      resolveUsername: typeof opts.resolveUsername === 'function' ? opts.resolveUsername : () => null,
      isMentionable: typeof opts.isMentionable === 'function' ? opts.isMentionable : () => true,
    };
    items = [];
    reactions.clear();
    replies.clear();
    hasMore = false;
    paged = false;
    firstUnreadId = null;
    errorText = null;
    if (!target) { status = 'idle'; emit(); return; }
    status = 'loading';
    emit();
    try {
      if (!meId) meId = (await rest.identity()).id;
      const rows = await rest.select(`/rest/v1/messages?select=${COLS}&${targetFilter(target)}&order=id.desc&limit=${PAGE}`);
      if (gen !== generation) return;
      const list = rows.map(fromRow).filter((m) => m && m.target === target).sort((a, b) => a.id - b.id);
      await hydrate(list, target);
      if (gen !== generation) return;
      // Mensagens que chegaram pelo tempo real enquanto carregava ficam também.
      const seen = new Set(list.map((m) => m.id));
      items = list.concat(items.filter((m) => !seen.has(m.id))).sort((a, b) => sortKey(a) - sortKey(b));
      hasMore = rows.length >= PAGE;
      const u = unread.get(target);
      if (u && u.unread > 0) {
        const real = items.filter((m) => m.id > 0 && m.authorId !== meId);
        const idx = real.length - u.unread;
        firstUnreadId = idx >= 0 && idx < real.length ? real[idx].id : (real.length ? real[0].id : null);
      }
      status = 'ready';
      emit();
      scheduleMarkRead();
    } catch (err) {
      if (gen !== generation) return;
      status = 'error';
      errorText = err && err.name === 'UserInputError' ? err.message : 'Não foi possível carregar as mensagens.';
      emit();
    }
  }

  function sortKey(m) {
    return m.id > 0 ? m.id : Number.MAX_SAFE_INTEGER - 1e6 + (-m.id);
  }

  async function loadOlder() {
    if (!target || !hasMore || status !== 'ready') return;
    const oldest = items.find((m) => m.id > 0);
    if (!oldest) return;
    const gen = generation;
    const forTarget = target;
    const rows = await rest.select(`/rest/v1/messages?select=${COLS}&${targetFilter(forTarget)}&id=lt.${oldest.id}&order=id.desc&limit=${PAGE}`);
    if (gen !== generation) return;
    const list = rows.map(fromRow).filter((m) => m && m.target === forTarget).sort((a, b) => a.id - b.id);
    await hydrate(list, forTarget);
    if (gen !== generation) return;
    const seen = new Set(items.map((m) => m.id));
    items = list.filter((m) => !seen.has(m.id)).concat(items);
    paged = true;
    if (items.length > PAGED_MAX) items = items.slice(0, PAGED_MAX); // ao subir, as mais novas saem
    hasMore = rows.length >= PAGE;
    emit();
  }

  // ---------------- Envio ----------------
  /** Menções válidas: `<@uuid>` (formato do compositor) ou @usuario, só gente do alvo, sem você. */
  function mentionsFor(body) {
    return extractMentions(body, ctx.resolveUsername).filter((id) => id !== meId && ctx.isMentionable(id));
  }

  /** Reenvia uma mensagem que falhou (id negativo da lista). */
  async function retry(id) {
    const m = findItem(id);
    if (!m || m.id >= 0 || !m.failed || !m.retry) throw appError('message_not_found');
    items = items.filter((x) => x !== m);
    emit();
    return send({ body: m.retry.body, replyTo: m.retry.replyTo, prechecked: m.retry.files });
  }

  async function send(input) {
    if (!target) throw appError('no_target');
    const obj = typeof input === 'string' ? { body: input } : (input || {});
    const files = Array.isArray(obj.attachments) ? obj.attachments : [];
    if (files.length > MAX_ATTACHMENTS) throw appError('too_many_attachments');
    const checked = Array.isArray(obj.prechecked) ? obj.prechecked : files.map((f) => validateUpload(f, 'attachment'));
    const body = validateBody(obj.body === undefined ? '' : obj.body, { allowEmpty: checked.length > 0 });
    let replyTo = null;
    if (obj.replyTo !== undefined && obj.replyTo !== null) {
      if (!Number.isSafeInteger(obj.replyTo) || obj.replyTo <= 0) throw appError('invalid');
      replyTo = obj.replyTo;
    }
    const forTarget = target;
    const gen = generation;
    const groupId = ctx.groupId;
    if (forTarget.startsWith('c:') && !isUuid(groupId)) throw appError('not_member');
    if (!meId) meId = (await rest.identity()).id;
    const mentions = mentionsFor(body);
    const tmp = {
      id: -(++pendingSeq), authorId: meId, body, createdAt: now(), editedAt: null, replyToId: replyTo,
      attachments: checked.map((f) => ({ path: '', name: f.name, size: f.size, mime: f.mime, width: f.width, height: f.height })),
      mentions, pinned: false, target: forTarget, pending: true,
      retry: { body, replyTo, files: checked },
    };
    items.push(tmp);
    emit();
    try {
      const prefix = attachmentPrefix(forTarget, groupId);
      const meta = [];
      for (const f of checked) {
        const path = `${prefix}${uuid()}/${f.name}`;
        await rest.upload('attachments', path, f.bytes, f.mime);
        const a = { path, name: f.name, size: f.size, mime: f.mime };
        if (f.width) { a.width = f.width; a.height = f.height; }
        meta.push(a);
      }
      const [kind, id] = forTarget.split(':');
      const row = {
        body, user_id: meId, attachments: meta, mentions,
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(kind === 'c' ? { channel_id: id, group_id: groupId } : { dm_id: id }),
      };
      const saved = fromRow(await rest.insert('messages', row, { returning: COLS }));
      if (!saved) throw appError('bad_response');
      if (gen === generation) {
        items = items.filter((m) => m !== tmp && m.id !== saved.id);
        await hydrate([saved], forTarget).catch(() => {});
        if (gen === generation) { items.push(saved); items.sort((a, b) => sortKey(a) - sortKey(b)); trimLive(); }
        markReadNow(saved.id);
        emit();
      }
      return saved.id;
    } catch (err) {
      if (gen === generation) { tmp.pending = false; tmp.failed = true; emit(); }
      else tmp.retry = null;
      throw err;
    }
  }

  function trimLive() {
    const limit = paged ? PAGED_MAX : LIVE_MAX;
    if (items.length > limit) {
      items = items.slice(items.length - limit);
      hasMore = true;
    }
  }

  function findItem(id) {
    return items.find((m) => m.id === id) || null;
  }

  async function edit({ id, body }) {
    if (!Number.isSafeInteger(id) || id <= 0) throw appError('invalid');
    const m = findItem(id);
    if (m && m.authorId !== meId) throw appError('forbidden');
    const v = validateBody(body, { allowEmpty: Boolean(m && m.attachments.length) });
    const mentions = mentionsFor(v);
    const rows = await rest.update(`/rest/v1/messages?id=eq.${id}&select=${COLS}`, { body: v, mentions }, { returning: true });
    const saved = fromRow(rows[0]);
    if (!saved) throw appError('message_not_found');
    applyUpdate(saved);
  }

  async function remove(id) {
    if (!Number.isSafeInteger(id)) throw appError('invalid');
    if (id < 0) { items = items.filter((m) => m.id !== id); emit(); return; }
    const m = findItem(id);
    await rest.remove(`/rest/v1/messages?id=eq.${id}`);
    if (m && m.authorId === meId && m.attachments.length) {
      rest.removeObjects('attachments', m.attachments.map((a) => a.path)).catch(() => {});
    }
    applyDelete(id);
  }

  async function toggleReaction({ id, emoji }) {
    if (!Number.isSafeInteger(id) || id <= 0) throw appError('invalid');
    const e = validateEmoji(emoji);
    if (!e) throw appError('invalid');
    if (!meId) meId = (await rest.identity()).id;
    const mine = reactions.get(id) && reactions.get(id).get(e) && reactions.get(id).get(e).has(meId);
    if (mine) {
      removeReaction(id, meId, e);
      emit();
      try {
        await rest.remove(`/rest/v1/message_reactions?message_id=eq.${id}&user_id=eq.${meId}&emoji=eq.${encodeURIComponent(e)}`);
      } catch (err) { addReaction(id, meId, e); emit(); throw err; }
    } else {
      const m = reactions.get(id);
      if (m && m.size >= 20 && !m.has(e)) throw appError('too_many_reactions');
      addReaction(id, meId, e);
      emit();
      try {
        await rest.insert('message_reactions', { message_id: id, user_id: meId, emoji: e });
      } catch (err) {
        if (err && err.code === 'request_exists') return; // já existia (corrida): fica marcado
        removeReaction(id, meId, e); emit(); throw err;
      }
    }
  }

  async function pin({ id, pinned }) {
    if (!Number.isSafeInteger(id) || id <= 0 || typeof pinned !== 'boolean') throw appError('invalid');
    await rest.rpc('pin_message', { p_id: id, p_pinned: pinned });
    const m = findItem(id);
    if (m) { m.pinned = pinned; emit(); }
  }

  async function formatList(rows, forTarget) {
    const list = rows.map(fromRow).filter((m) => m && m.target === forTarget);
    await hydrate(list, forTarget);
    return list.map(toViewItem);
  }

  async function listPinned() {
    if (!target) throw appError('no_target');
    const forTarget = target;
    const rows = await rest.select(`/rest/v1/messages?select=${COLS}&${targetFilter(forTarget)}&pinned=is.true&order=id.desc&limit=50`);
    return formatList(rows, forTarget);
  }

  async function search(query) {
    if (!target) throw appError('no_target');
    if (typeof query !== 'string') throw appError('invalid_query');
    const q = query.trim();
    if ([...q].length < 2 || q.length > 100 || CONTROL_RE.test(q)) throw appError('invalid_query');
    const forTarget = target;
    const rows = await rest.rpc('search_messages', { p_target: forTarget, p_query: q });
    if (!Array.isArray(rows)) throw appError('bad_response');
    return formatList(rows.slice(0, 25), forTarget);
  }

  // ---------------- Tempo real ----------------
  /**
   * Mensagem nova de qualquer alvo visível. Devolve informação para notificação:
   * { target, message, mentionsMe, isCurrent } ou null.
   */
  async function applyInsert(row) {
    const m = fromRow(row);
    if (!m || !m.target) return null;
    const isMine = meId && m.authorId === meId;
    const mentionsMe = Boolean(meId && m.mentions.includes(meId));
    const isCurrent = m.target === target;
    if (isCurrent) {
      if (!findItem(m.id)) {
        const gen = generation;
        await hydrate([m], target).catch(() => {});
        if (gen !== generation || findItem(m.id)) return { target: m.target, message: m, mentionsMe, isCurrent, isMine };
        if (isMine) items = items.filter((x) => !(x.pending && x.body === m.body)); // o envio já vai trocar
        items.push(m);
        items.sort((a, b) => sortKey(a) - sortKey(b));
        trimLive();
        clearTyping(m.target, m.authorId);
        if (isFocused()) scheduleMarkRead(); else bumpUnread(m, mentionsMe, isMine);
        emit();
      }
    } else if (!isMine) {
      bumpUnread(m, mentionsMe, isMine);
      clearTyping(m.target, m.authorId);
      emit();
    }
    return { target: m.target, message: m, mentionsMe, isCurrent, isMine };
  }

  function bumpUnread(m, mentionsMe, isMine) {
    if (isMine) return;
    const u = unread.get(m.target) || { lastId: 0, unread: 0, mentions: 0 };
    u.lastId = Math.max(u.lastId, m.id);
    u.unread = Math.min(99, u.unread + 1);
    if (mentionsMe || m.target.startsWith('d:')) u.mentions = Math.min(99, u.mentions + 1);
    unread.set(m.target, u);
  }

  function applyUpdate(rowOrMsg) {
    const m = rowOrMsg && rowOrMsg.target !== undefined ? rowOrMsg : fromRow(rowOrMsg);
    if (!m) return false;
    const i = items.findIndex((x) => x.id === m.id);
    if (i < 0) return false;
    items[i] = { ...items[i], ...m };
    if (replies.has(m.id)) replies.set(m.id, { authorId: m.authorId, body: m.body.slice(0, 120) });
    emit();
    return true;
  }

  function applyDelete(id) {
    if (!Number.isSafeInteger(id)) return false;
    const before = items.length;
    items = items.filter((m) => m.id !== id);
    reactions.delete(id);
    if (replies.has(id)) replies.set(id, { missing: true });
    if (items.length !== before) { emit(); return true; }
    return false;
  }

  function applyReaction(type, row) {
    if (!row || !Number.isSafeInteger(row.message_id) || !findItem(row.message_id)) return false;
    if (row.user_id && meId && String(row.user_id).toLowerCase() === meId) {
      // a nossa já foi aplicada de forma otimista
      const has = reactions.get(row.message_id) && reactions.get(row.message_id).get(row.emoji) && reactions.get(row.message_id).get(row.emoji).has(meId);
      if ((type === 'INSERT' && has) || (type === 'DELETE' && !has)) return false;
    }
    const changed = type === 'DELETE' ? removeReaction(row.message_id, row.user_id, row.emoji) : addReaction(row.message_id, row.user_id, row.emoji);
    if (changed) emit();
    return changed;
  }

  // ---------------- Digitando ----------------
  function receiveTyping({ target: t, userId }) {
    if (!TARGET_RE.test(String(t)) || !isUuid(userId) || userId.toLowerCase() === meId) return;
    if (!typing.has(t)) typing.set(t, new Map());
    typing.get(t).set(userId.toLowerCase(), now() + TYPING_MS);
    scheduleTypingSweep();
    if (t === target) emit();
  }

  function clearTyping(t, userId) {
    const m = typing.get(t);
    if (m && m.delete(userId) && t === target) emit();
  }

  function scheduleTypingSweep() {
    if (typingTimer) return;
    typingTimer = timers.setTimeout(() => {
      typingTimer = null;
      const n = now();
      let changed = false;
      let left = false;
      for (const [t, m] of typing) {
        for (const [u, exp] of m) {
          if (exp <= n) { m.delete(u); if (t === target) changed = true; } else left = true;
        }
        if (m.size === 0) typing.delete(t);
      }
      if (changed) emit();
      if (left) scheduleTypingSweep();
    }, 1000);
    if (typingTimer && typeof typingTimer.unref === 'function') typingTimer.unref();
  }

  function typingNow(t) {
    const m = typing.get(t);
    if (!m) return [];
    const n = now();
    return [...m.entries()].filter(([, exp]) => exp > n).map(([u]) => u);
  }

  // ---------------- Lidas ----------------
  async function refreshUnread() {
    const rows = await rest.rpc('unread_summary', {});
    if (!Array.isArray(rows)) return;
    unread.clear();
    for (const r of rows) {
      if (!r || !TARGET_RE.test(String(r.target))) continue;
      unread.set(r.target, {
        lastId: Number.isSafeInteger(r.last_message_id) ? r.last_message_id : 0,
        unread: Number.isInteger(r.unread) ? Math.max(0, Math.min(99, r.unread)) : 0,
        mentions: Number.isInteger(r.mentions) ? Math.max(0, Math.min(99, r.mentions)) : 0,
      });
    }
    if (target && isFocused()) { const u = unread.get(target); if (u) { u.unread = 0; u.mentions = 0; } }
    emit();
  }

  function lastRealId() {
    for (let i = items.length - 1; i >= 0; i--) if (items[i].id > 0) return items[i].id;
    return 0;
  }

  function markReadNow(id = lastRealId()) {
    if (!target) return Promise.resolve();
    const t = target;
    const u = unread.get(t);
    const had = u && (u.unread > 0 || u.mentions > 0);
    unread.set(t, { lastId: Math.max(u ? u.lastId : 0, id), unread: 0, mentions: 0 });
    if (had) emit();
    if (!id || (lastReadSent.get(t) || 0) >= id) return Promise.resolve();
    lastReadSent.set(t, id);
    return rest.rpc('mark_read', { p_target: t, p_last_id: id }).catch(() => { lastReadSent.delete(t); });
  }

  function scheduleMarkRead() {
    if (readTimer) return;
    readTimer = timers.setTimeout(() => { readTimer = null; if (isFocused()) markReadNow(); }, 1500);
    if (readTimer && typeof readTimer.unref === 'function') readTimer.unref();
  }

  async function markRead() {
    firstUnreadId = null;
    await markReadNow();
    emit();
  }

  /** Marca um alvo qualquer como lido (menu "Marcar como lido" do canal/servidor). */
  async function markTargetRead(t) {
    if (!TARGET_RE.test(String(t))) return;
    const u = unread.get(t);
    if (!u || (!u.unread && !u.mentions)) return;
    unread.set(t, { ...u, unread: 0, mentions: 0 });
    emit();
    if (u.lastId) await rest.rpc('mark_read', { p_target: t, p_last_id: u.lastId }).catch(() => {});
  }

  function unreadOf(t) {
    const u = unread.get(t);
    return u ? { unread: u.unread, mentions: u.mentions } : { unread: 0, mentions: 0 };
  }

  // ---------------- View ----------------
  function toViewItem(m) {
    const rmap = reactions.get(m.id);
    let replyTo = null;
    if (m.replyToId) {
      const local = items.find((x) => x.id === m.replyToId);
      const r = local ? { authorId: local.authorId, body: local.body.slice(0, 120) } : replies.get(m.replyToId);
      replyTo = r && !r.missing ? { id: m.replyToId, authorId: r.authorId, body: r.body } : { id: m.replyToId, authorId: null, body: '', missing: true };
    }
    const item = {
      id: m.id,
      authorId: m.authorId,
      body: m.body,
      createdAt: m.createdAt,
      editedAt: m.editedAt,
      replyTo,
      attachments: m.attachments.map((a) => ({
        url: a.path ? urls.get(a.path) || null : null,
        name: a.name, size: a.size, mime: a.mime,
        ...(a.width ? { width: a.width, height: a.height } : {}),
        isImage: /^image\/(png|jpeg|gif|webp)$/.test(a.mime),
      })),
      reactions: rmap ? [...rmap.entries()].map(([emoji, set]) => ({ emoji, count: set.size, me: Boolean(meId && set.has(meId)) })) : [],
      pinned: m.pinned,
      mentionsMe: Boolean(meId && m.mentions.includes(meId)),
      mentions: m.mentions.slice(),
    };
    if (m.pending) item.pending = true;
    if (m.failed) item.failed = true;
    return item;
  }

  function getView() {
    if (!target) return null;
    return {
      target,
      status: status === 'idle' ? 'loading' : status,
      error: errorText,
      hasMore,
      firstUnreadId,
      typing: typingNow(target),
      items: items.map(toViewItem),
    };
  }

  /** Autores e citados da lista atual (para view.users). */
  function peopleInView() {
    const s = new Set();
    for (const m of items) { s.add(m.authorId); for (const x of m.mentions) s.add(x); }
    for (const r of replies.values()) if (r.authorId) s.add(r.authorId);
    for (const u of typingNow(target)) s.add(u);
    return [...s];
  }

  /** Formato antigo de view.chat (para a tela/testes da Etapa 4) quando o alvo é canal. */
  function getLegacyView() {
    if (!target || !target.startsWith('c:')) return { messages: [], status: 'idle' };
    return {
      messages: items.filter((m) => m.id > 0).map((m) => ({
        id: m.id, userId: m.authorId, displayName: users.lite(m.authorId).displayName, body: m.body,
        createdAt: m.createdAt, mine: m.authorId === meId,
      })),
      status: status === 'error' ? 'error' : 'idle',
    };
  }

  function clear() {
    generation++;
    target = null;
    items = [];
    reactions.clear();
    replies.clear();
    urls.clear();
    unread.clear();
    typing.clear();
    lastReadSent = new Map();
    meId = null;
    status = 'idle';
    emit();
  }

  return {
    setMe, open, loadOlder, send, retry, edit, remove, toggleReaction, pin, listPinned, search,
    applyInsert, applyUpdate, applyDelete, applyReaction, receiveTyping, refreshUnread, markRead, markTargetRead,
    unreadOf, getView, peopleInView, getLegacyView, clear, getTarget: () => target, findItem,
    unreadEntries: () => [...unread.entries()],
  };
}

module.exports = { createMessagesService, extractMentions, validateBody, validateEmoji, fromRow, COLS, TARGET_RE };
