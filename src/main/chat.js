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
  };
}

function createChatClient({ fetchImpl, supabaseUrl, anonKey, getAccessToken, timeoutMs = 10000 } = {}) {
  const { identity, call, fail, ok } = createSupabaseRest({ fetchImpl, supabaseUrl, anonKey, getAccessToken, timeoutMs });
  const COLS = 'id,user_id,body,created_at';

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
    const { status, data } = await call(q, { token });
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
    const { status, data } = await call(`/rest/v1/messages?select=${COLS}`, {
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

  return { fetchSince, send };
}

/**
 * Feed em memória + sondagem. `setContext({groupId, members})` vem do serviço de grupo
 * (null ao sair da conta/grupo, o que para a sondagem); `setFocused` vem dos eventos da janela.
 */
function createChatFeed({
  client,
  intervalMs = POLL_MS,
  maxMessages = MAX_MESSAGES,
  pageSize = DEFAULT_PAGE,
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

  function lastId() {
    return messages.length > 0 ? messages[messages.length - 1].id : 0;
  }

  function merge(rows) {
    const seen = new Set(messages.map((m) => m.id));
    let added = 0;
    for (const r of rows) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        messages.push(r);
        added++;
      }
    }
    if (added > 0) {
      messages.sort((a, b) => a.id - b.id);
      if (messages.length > maxMessages) messages = messages.slice(messages.length - maxMessages);
    }
    return added;
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
        const rows = await client.fetchSince(groupId, lastId(), pageSize);
        if (gen !== generation) return false;
        const added = merge(rows);
        const changed = added > 0 || status !== 'idle';
        status = 'idle';
        if (changed) emit();
        return added > 0;
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

  return { setContext, setFocused, poll, send, getView, stop, isRunning };
}

module.exports = {
  createChatClient,
  createChatFeed,
  validateBody,
  BODY_MAX,
  MAX_MESSAGES,
  POLL_MS,
};
