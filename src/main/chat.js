'use strict';

// Chat de texto do grupo: cliente PostgREST + "feed" que guarda até 200 mensagens em memória
// e sonda a cada 4 s só quando há grupo (logo, sessão) e a janela está focada.

const { createSupabaseRest, groupError, isUuid } = require('./group');
const { UserInputError } = require('./controller');

const BODY_MAX = 1000;
const BODY_RAW_MAX = 4000;
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const MAX_MESSAGES = 200;
const DEFAULT_PAGE = 50;
const POLL_MS = 4000;

const CHAT_MESSAGES = Object.freeze({
  unavailable_message: 'Essa mensagem não está disponível para alteração.',
  empty_body: 'Escreva uma mensagem.',
  long_body: `A mensagem pode ter no máximo ${BODY_MAX} caracteres.`,
  invalid_body: 'A mensagem tem caracteres não permitidos.',
});

function chatError(code) {
  const e = new UserInputError(CHAT_MESSAGES[code]);
  e.code = code;
  return e;
}

/** Valida o texto da mensagem: 1..1000 caracteres após trim, sem caracteres de controle (exceto \t \n \r). */
function validateBody(body) {
  if (typeof body !== 'string' || body.length > BODY_RAW_MAX) {
    return typeof body === 'string' ? { ok: false, code: 'long_body' } : { ok: false, code: 'empty_body' };
  }
  const value = body.trim();
  const len = [...value].length;
  if (len === 0) return { ok: false, code: 'empty_body' };
  if (len > BODY_MAX) return { ok: false, code: 'long_body' };
  if (CONTROL_RE.test(value)) return { ok: false, code: 'invalid_body' };
  return { ok: true, value };
}

function toMessage(row) {
  if (!row || typeof row !== 'object') return null;
  const id = row.id;
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  if (!isUuid(row.user_id) || typeof row.body !== 'string' || row.body.length > BODY_RAW_MAX) return null;
  const createdAt = typeof row.created_at === 'string' ? Date.parse(row.created_at) : NaN;
  return {
    id,
    userId: row.user_id.toLowerCase(),
    body: row.body,
    createdAt: Number.isFinite(createdAt) ? createdAt : null,
    ...(row.edited_at ? { editedAt: Date.parse(row.edited_at), revision: row.edited_at } : {}),
  };
}

function createChatClient({ fetchImpl, supabaseUrl, anonKey, getAccessToken, timeoutMs = 10000 } = {}) {
  const { identity, call, fail, ok } = createSupabaseRest({ fetchImpl, supabaseUrl, anonKey, getAccessToken, timeoutMs });
  const baseColumns = 'id,user_id,body,created_at';
  const COLS = baseColumns + ',edited_at';
  function lacksRevision(response) {
    return response.status === 400 && response.data?.code === '42703';
  }

  /**
   * Mensagens com id > afterId em ordem crescente. Sem afterId (0/null): as `limit` mais recentes.
   */
  async function fetchSince(groupId, afterId = 0, limit = DEFAULT_PAGE) {
    if (!isUuid(groupId)) throw groupError('not_in_group');
    const after = Number.isSafeInteger(afterId) && afterId > 0 ? afterId : 0;
    const n = Number.isInteger(limit) ? Math.min(MAX_MESSAGES, Math.max(1, limit)) : DEFAULT_PAGE;
    const { token } = await identity();
    const gid = groupId.toLowerCase();
    const q = after > 0
      ? `/rest/v1/messages?select=${COLS}&group_id=eq.${gid}&id=gt.${after}&order=id.asc&limit=${n}`
      : `/rest/v1/messages?select=${COLS}&group_id=eq.${gid}&order=id.desc&limit=${n}`;
    let response = await call(q, { token });
    if (lacksRevision(response)) response = await call(q.replace(COLS, baseColumns), { token });
    const { status, data } = response;
    if (!ok(status)) throw fail(status, data);
    if (!Array.isArray(data) || data.length > n) throw groupError('bad_response');
    const out = data.map(toMessage).filter(Boolean).filter((m) => m.id > after);
    out.sort((a, b) => a.id - b.id);
    return out;
  }

  async function send(groupId, body) {
    const v = validateBody(body);
    if (!v.ok) throw chatError(v.code);
    if (!isUuid(groupId)) throw groupError('not_in_group');
    const { token, id } = await identity();
    const { status, data } = await call(`/rest/v1/messages?select=${baseColumns}`, {
      method: 'POST',
      token,
      body: { group_id: groupId.toLowerCase(), user_id: id, body: v.value },
      headers: { Prefer: 'return=representation' },
    });
    if (!ok(status)) throw fail(status, data);
    const msg = toMessage(Array.isArray(data) ? data[0] : data);
    if (!msg) throw groupError('bad_response');
    return msg;
  }

  // Confere a janela inteira por id + revisão, e transfere texto só para as linhas alteradas.
  // Uma linha que desaparece do índice foi excluída ou saiu das últimas 200.
  async function fetchRecent(groupId, previous, limit = MAX_MESSAGES) {
    if (!isUuid(groupId)) throw groupError('not_in_group');
    const size = Math.max(1, Math.min(MAX_MESSAGES, limit));
    if (previous.length === 0) return fetchSince(groupId, 0, size);
    const { token } = await identity();
    const groupFilter = `group_id=eq.${groupId.toLowerCase()}`;
    const index = await call(`/rest/v1/messages?select=id,edited_at&${groupFilter}&order=id.desc&limit=${size}`, { token });
    if (lacksRevision(index)) return fetchSince(groupId, 0, size);
    if (!ok(index.status)) throw fail(index.status, index.data);
    if (!Array.isArray(index.data) || index.data.length > size) throw groupError('bad_response');
    const cached = new Map(previous.map((m) => [m.id, m]));
    const rows = [];
    const needed = new Set();
    for (const version of index.data) {
      if (!version || !Number.isSafeInteger(version.id) || version.id < 1) throw groupError('bad_response');
      const old = cached.get(version.id);
      if (old && (old.revision ?? null) === version.edited_at) rows.push(old);
      else needed.add(version.id);
    }
    if (needed.size) {
      const changed = await call(`/rest/v1/messages?select=${COLS}&${groupFilter}&id=in.(${[...needed].join(',')})`, { token });
      if (!ok(changed.status)) throw fail(changed.status, changed.data);
      if (!Array.isArray(changed.data) || changed.data.length > needed.size) throw groupError('bad_response');
      for (const row of changed.data) {
        const m = toMessage(row);
        if (!m || !needed.delete(m.id)) throw groupError('bad_response');
        rows.push(m);
      }
    }
    return rows.sort((a, b) => a.id - b.id);
  }

  async function changeOwn(groupId, messageId, method, body) {
    if (!isUuid(groupId)) throw groupError('not_in_group');
    if (!Number.isSafeInteger(messageId) || messageId < 1) throw chatError('unavailable_message');
    const { token, id } = await identity();
    const filters = `group_id=eq.${groupId.toLowerCase()}&id=eq.${messageId}&user_id=eq.${id}`;
    const { status, data } = await call(`/rest/v1/messages?select=${method === 'DELETE' ? baseColumns : COLS}&${filters}`, {
      method, token, body, headers: { Prefer: 'return=representation' },
    });
    if (method === 'PATCH' && lacksRevision({ status, data })) throw new UserInputError('A edição aguarda a atualização do banco do LUMENEX.');
    if (!ok(status)) throw fail(status, data);
    if (Array.isArray(data) && data.length === 0) throw chatError('unavailable_message');
    const message = Array.isArray(data) && data.length === 1 ? toMessage(data[0]) : null;
    if (!message || message.id !== messageId || message.userId !== id) throw groupError('bad_response');
    return message;
  }

  async function edit(groupId, id, body) {
    const v = validateBody(body);
    if (!v.ok) throw chatError(v.code);
    return changeOwn(groupId, id, 'PATCH', { body: v.value });
  }

  function remove(groupId, id) {
    return changeOwn(groupId, id, 'DELETE');
  }

  return { fetchSince, fetchRecent, send, edit, remove };
}

/**
 * Feed em memória + sondagem. `setContext({groupId, members})` vem do serviço de grupo
 * (null ao sair da conta/grupo, o que para a sondagem); `setFocused` vem dos eventos da janela.
 */
function createChatFeed({
  client,
  intervalMs = POLL_MS,
  maxMessages = MAX_MESSAGES,
  onChange = () => {},
  timers = { setInterval: (...a) => setInterval(...a), clearInterval: (...a) => clearInterval(...a) },
} = {}) {
  let ctx = null; // { groupId, names: Map, me }
  let messages = [];
  let status = 'idle';
  let focused = false;
  let timer = null;
  let inflight = null;
  let queued = null;
  let generation = 0;

  function emit() {
    try { onChange(); } catch { /* o consumidor não pode quebrar o feed */ }
  }

  function isRunning() {
    return timer !== null;
  }

  function reschedule() {
    const shouldRun = Boolean(ctx) && focused;
    if (shouldRun && !timer) {
      timer = timers.setInterval(() => { poll().catch(() => {}); }, intervalMs);
      if (timer && typeof timer.unref === 'function') timer.unref();
    } else if (!shouldRun && timer) {
      timers.clearInterval(timer);
      timer = null;
    }
  }

  /** Uma busca por vez; pedido durante uma busca agenda exatamente mais uma em seguida. */
  function poll() {
    if (!ctx) return Promise.resolve(false);
    if (inflight) {
      if (!queued) queued = inflight.then(() => { queued = null; return poll(); });
      return queued;
    }
    const gen = generation;
    const groupId = ctx.groupId;
    inflight = (async () => {
      try {
        const rows = await client.fetchRecent(groupId, messages, maxMessages);
        if (gen !== generation) return false;
        const changed = rows.length !== messages.length || rows.some((m, i) => {
          const old = messages[i];
          return m.id !== old.id || m.body !== old.body || m.revision !== old.revision;
        });
        const notify = changed || status !== 'idle';
        messages = rows;
        status = 'idle';
        if (notify) emit();
        return changed;
      } catch {
        if (gen === generation && status !== 'error') {
          status = 'error';
          emit();
        }
        return false;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  function setContext(next) {
    const groupId = next && isUuid(next.groupId) ? next.groupId.toLowerCase() : null;
    if (!groupId) {
      const had = ctx !== null || messages.length > 0;
      generation++;
      ctx = null;
      messages = [];
      status = 'idle';
      reschedule();
      if (had) emit();
      return;
    }
    const names = new Map();
    let me = null;
    for (const m of Array.isArray(next.members) ? next.members : []) {
      if (m && isUuid(m.userId)) {
        names.set(m.userId, typeof m.displayName === 'string' ? m.displayName : null);
        if (m.isMe) me = m.userId;
      }
    }
    const changedGroup = !ctx || ctx.groupId !== groupId;
    if (changedGroup) {
      generation++;
      messages = [];
      status = 'idle';
    }
    ctx = { groupId, names, me };
    reschedule();
    if (changedGroup && focused) poll().catch(() => {});
  }

  function setFocused(value) {
    const was = focused;
    focused = Boolean(value);
    reschedule();
    if (focused && !was && ctx) poll().catch(() => {});
  }

  /** Envia e busca de novo (o id novo nunca pula mensagens alheias ainda não lidas). */
  async function send(body) {
    if (!ctx) throw groupError('not_in_group');
    await client.send(ctx.groupId, body);
    await poll();
  }

  function ownMessage(id) {
    if (!ctx) throw groupError('not_in_group');
    if (!ctx.me || !messages.some((m) => m.id === id && m.userId === ctx.me)) {
      throw chatError('unavailable_message');
    }
    return ctx.groupId;
  }

  async function edit(id, body) {
    const groupId = ownMessage(id);
    const owner = ctx.me;
    const updated = await client.edit(groupId, id, body);
    if (ctx?.groupId !== groupId || ctx.me !== owner) return;
    generation++;
    messages = messages.map((m) => m.id === id ? updated : m);
    emit();
    await poll();
  }

  async function remove(id) {
    const groupId = ownMessage(id);
    const owner = ctx.me;
    await client.remove(groupId, id);
    if (ctx?.groupId !== groupId || ctx.me !== owner) return;
    generation++;
    messages = messages.filter((m) => m.id !== id);
    emit();
    await poll();
  }

  function getView() {
    const names = ctx ? ctx.names : new Map();
    const me = ctx ? ctx.me : null;
    return {
      messages: messages.map((m) => ({
        id: m.id,
        userId: m.userId,
        displayName: names.get(m.userId) ?? null,
        body: m.body,
        createdAt: m.createdAt,
        editedAt: m.editedAt ?? null,
        mine: me !== null && m.userId === me,
      })),
      status,
    };
  }

  function stop() {
    setContext(null);
    focused = false;
    reschedule();
  }

  return { setContext, setFocused, poll, send, edit, remove, getView, stop, isRunning };
}

module.exports = {
  createChatClient,
  createChatFeed,
  validateBody,
  BODY_MAX,
  MAX_MESSAGES,
  POLL_MS,
};
