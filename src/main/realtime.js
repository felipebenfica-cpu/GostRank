'use strict';

// Etapa 6: cliente mínimo do Supabase Realtime (protocolo Phoenix, serializador JSON vsn 1.0.0).
// Sem dependências: recebe o construtor de WebSocket (Node 22 / navegador) por injeção.
// Suporta postgres_changes, presence (track/state/diff) e broadcast; reconecta com espera crescente,
// renova o token em todos os canais e nunca registra token nem conteúdo em log.

const HEARTBEAT_MS = 25000;
const JOIN_TIMEOUT_MS = 10000;
const BACKOFF_MS = [1000, 2000, 5000, 10000, 20000, 30000];
const MAX_FRAME = 1024 * 1024;
const TOPIC_RE = /^[a-z0-9:_-]{1,120}$/i;

function realtimeUrl(supabaseUrl, anonKey) {
  const u = new URL(supabaseUrl);
  return `wss://${u.hostname}/realtime/v1/websocket?apikey=${encodeURIComponent(anonKey)}&vsn=1.0.0`;
}

/** Junta metas de presença: { key: [meta,...] }. */
function applyPresenceState(state, raw) {
  const next = {};
  for (const [key, val] of Object.entries(raw || {})) {
    const metas = val && Array.isArray(val.metas) ? val.metas : [];
    if (metas.length) next[key] = metas.map((m) => ({ ...m }));
  }
  void state;
  return next;
}

function applyPresenceDiff(state, diff) {
  const next = {};
  for (const [k, v] of Object.entries(state)) next[k] = v.slice();
  const leaves = diff && diff.leaves ? diff.leaves : {};
  const joins = diff && diff.joins ? diff.joins : {};
  for (const [key, val] of Object.entries(leaves)) {
    const refs = new Set((val && Array.isArray(val.metas) ? val.metas : []).map((m) => m && m.phx_ref));
    if (next[key]) {
      next[key] = next[key].filter((m) => !refs.has(m.phx_ref));
      if (next[key].length === 0) delete next[key];
    }
  }
  for (const [key, val] of Object.entries(joins)) {
    const metas = val && Array.isArray(val.metas) ? val.metas : [];
    const refs = new Set(metas.map((m) => m && m.phx_ref));
    next[key] = (next[key] || []).filter((m) => !refs.has(m.phx_ref)).concat(metas.map((m) => ({ ...m })));
  }
  return next;
}

function createRealtime({
  supabaseUrl, anonKey, WebSocketImpl, getAccessToken,
  timers = { setTimeout: (...a) => setTimeout(...a), clearTimeout: (...a) => clearTimeout(...a), setInterval: (...a) => setInterval(...a), clearInterval: (...a) => clearInterval(...a) },
  onStatus = () => {},
} = {}) {
  const WS = WebSocketImpl || (typeof WebSocket === 'function' ? WebSocket : null);
  let url = null;
  try { url = realtimeUrl(supabaseUrl, anonKey); } catch { url = null; }
  const available = Boolean(url && WS);

  let ws = null;
  let ref = 0;
  let heartbeat = null;
  let reconnectTimer = null;
  let attempts = 0;
  let wanted = false;
  let token = null;
  let status = 'closed';
  const channels = new Map(); // topic -> channel
  const pendingReplies = new Map(); // ref -> fn

  const nextRef = () => String(++ref);

  function setStatus(s) {
    if (s === status) return;
    status = s;
    try { onStatus(s); } catch { /* ignora */ }
  }

  function send(msg) {
    if (!ws || ws.readyState !== 1) return false;
    try { ws.send(JSON.stringify(msg)); return true; } catch { return false; }
  }

  function push(topic, event, payload, onReply) {
    const r = nextRef();
    const ch = channels.get(topic);
    const msg = { topic: `realtime:${topic}`, event, payload, ref: r, join_ref: ch ? ch.joinRef : null };
    if (onReply) {
      pendingReplies.set(r, onReply);
      const t = timers.setTimeout(() => {
        if (pendingReplies.has(r)) { pendingReplies.delete(r); onReply({ status: 'timeout', response: {} }); }
      }, JOIN_TIMEOUT_MS);
      if (t && typeof t.unref === 'function') t.unref();
    }
    if (!send(msg) && onReply) {
      pendingReplies.delete(r);
      onReply({ status: 'error', response: {} });
    }
    return r;
  }

  async function refreshToken() {
    try {
      const t = typeof getAccessToken === 'function' ? await getAccessToken() : null;
      token = typeof t === 'string' && t ? t : null;
    } catch { token = null; }
    return token;
  }

  function joinChannel(ch) {
    if (!ws || ws.readyState !== 1) return;
    ch.joinRef = nextRef();
    ch.state = 'joining';
    const payload = {
      config: {
        broadcast: { self: false, ack: false },
        presence: { key: ch.opts.presenceKey || '' },
        postgres_changes: ch.opts.postgres || [],
        private: Boolean(ch.opts.private),
      },
    };
    if (token) payload.access_token = token;
    const r = ch.joinRef;
    pendingReplies.set(r, (reply) => {
      if (reply.status === 'ok') {
        ch.state = 'joined';
        const pc = reply.response && Array.isArray(reply.response.postgres_changes) ? reply.response.postgres_changes : [];
        ch.pcIds = new Map(pc.map((p) => [p.id, p]));
        if (ch.tracked) push(ch.topic, 'presence', { type: 'presence', event: 'track', payload: ch.tracked });
        ch.emit('status', 'joined');
      } else {
        ch.state = 'errored';
        ch.emit('status', 'error');
      }
    });
    const t = timers.setTimeout(() => {
      if (pendingReplies.has(r)) { pendingReplies.delete(r); ch.state = 'errored'; ch.emit('status', 'error'); }
    }, JOIN_TIMEOUT_MS);
    if (t && typeof t.unref === 'function') t.unref();
    send({ topic: `realtime:${ch.topic}`, event: 'phx_join', payload, ref: r, join_ref: r });
  }

  function onMessage(ev) {
    const raw = ev && typeof ev.data === 'string' ? ev.data : '';
    if (!raw || raw.length > MAX_FRAME) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.event === 'phx_reply' && msg.ref && pendingReplies.has(msg.ref)) {
      const fn = pendingReplies.get(msg.ref);
      pendingReplies.delete(msg.ref);
      const p = msg.payload || {};
      try { fn({ status: p.status, response: p.response || {} }); } catch { /* ignora */ }
      return;
    }
    const topic = typeof msg.topic === 'string' && msg.topic.startsWith('realtime:') ? msg.topic.slice(9) : null;
    const ch = topic ? channels.get(topic) : null;
    if (!ch) return;
    const payload = msg.payload || {};
    switch (msg.event) {
      case 'postgres_changes': {
        const data = payload.data || {};
        ch.emit('postgres', {
          type: data.type, table: data.table, schema: data.schema,
          record: data.record || null, old: data.old_record || null,
        });
        break;
      }
      case 'presence_state':
        ch.presence = applyPresenceState(ch.presence, payload);
        ch.emit('presence', ch.presence);
        break;
      case 'presence_diff':
        ch.presence = applyPresenceDiff(ch.presence, payload);
        ch.emit('presence', ch.presence);
        break;
      case 'broadcast':
        if (payload && typeof payload.event === 'string') ch.emit('broadcast', { event: payload.event, payload: payload.payload || {} });
        break;
      case 'phx_error':
      case 'phx_close':
        if (ch.state !== 'closed') {
          ch.state = 'errored';
          ch.emit('status', 'error');
        }
        break;
      case 'system':
        if (payload && payload.status === 'error') ch.emit('status', 'error');
        break;
      default:
        break;
    }
  }

  function scheduleReconnect() {
    if (!wanted || reconnectTimer) return;
    const delay = BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)];
    attempts++;
    reconnectTimer = timers.setTimeout(() => { reconnectTimer = null; open(); }, delay);
    if (reconnectTimer && typeof reconnectTimer.unref === 'function') reconnectTimer.unref();
  }

  function cleanupSocket() {
    if (heartbeat) { timers.clearInterval(heartbeat); heartbeat = null; }
    for (const [r, fn] of pendingReplies) { pendingReplies.delete(r); try { fn({ status: 'error', response: {} }); } catch { /* ignora */ } }
    for (const ch of channels.values()) { ch.state = 'closed'; ch.presence = {}; ch.emit('presence', ch.presence); }
    ws = null;
  }

  async function open() {
    if (!available || !wanted || ws) return;
    await refreshToken();
    if (!wanted || ws) return;
    let sock;
    try { sock = new WS(url); } catch { scheduleReconnect(); return; }
    ws = sock;
    setStatus('connecting');
    sock.onopen = () => {
      if (ws !== sock) return;
      attempts = 0;
      setStatus('open');
      heartbeat = timers.setInterval(() => {
        send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: nextRef() });
      }, HEARTBEAT_MS);
      if (heartbeat && typeof heartbeat.unref === 'function') heartbeat.unref();
      for (const ch of channels.values()) joinChannel(ch);
    };
    sock.onmessage = (ev) => { if (ws === sock) onMessage(ev); };
    sock.onerror = () => { /* onclose cuida */ };
    sock.onclose = () => {
      if (ws !== sock) return;
      cleanupSocket();
      setStatus('closed');
      scheduleReconnect();
    };
  }

  function connect() {
    wanted = true;
    open();
  }

  function disconnect() {
    wanted = false;
    if (reconnectTimer) { timers.clearTimeout(reconnectTimer); reconnectTimer = null; }
    const s = ws;
    cleanupSocket();
    if (s) { try { s.close(); } catch { /* ignora */ } }
    setStatus('closed');
  }

  /** Token novo (renovação de sessão): avisa todos os canais. */
  async function updateToken() {
    await refreshToken();
    if (!token) return;
    for (const ch of channels.values()) {
      if (ch.state === 'joined') push(ch.topic, 'access_token', { access_token: token });
    }
  }

  /**
   * Canal: `opts` = { private, presenceKey, postgres: [{event, schema, table, filter?}] }.
   * Mesmo tópico de novo devolve o mesmo canal.
   */
  function channel(topic, opts = {}) {
    if (!TOPIC_RE.test(topic)) throw new Error('tópico inválido');
    if (channels.has(topic)) return channels.get(topic);
    const listeners = { postgres: [], presence: [], broadcast: [], status: [] };
    const ch = {
      topic, opts, state: 'closed', joinRef: null, presence: {}, tracked: null, pcIds: new Map(),
      on(kind, fn) { if (listeners[kind]) listeners[kind].push(fn); return ch; },
      emit(kind, data) { for (const fn of listeners[kind] || []) { try { fn(data); } catch { /* ignora */ } } },
      track(meta) {
        ch.tracked = meta && typeof meta === 'object' ? { ...meta } : null;
        if (ch.state === 'joined' && ch.tracked) push(topic, 'presence', { type: 'presence', event: 'track', payload: ch.tracked });
      },
      untrack() {
        ch.tracked = null;
        if (ch.state === 'joined') push(topic, 'presence', { type: 'presence', event: 'untrack' });
      },
      broadcast(event, payload) {
        if (ch.state !== 'joined') return false;
        push(topic, 'broadcast', { type: 'broadcast', event, payload });
        return true;
      },
      unsubscribe() {
        if (ch.state === 'joined' || ch.state === 'joining') push(topic, 'phx_leave', {});
        ch.state = 'closed';
        channels.delete(topic);
        for (const k of Object.keys(listeners)) listeners[k] = [];
      },
    };
    channels.set(topic, ch);
    if (ws && ws.readyState === 1) joinChannel(ch);
    return ch;
  }

  function topics() {
    return [...channels.keys()];
  }

  return { available, connect, disconnect, channel, updateToken, topics, getStatus: () => status };
}

module.exports = { createRealtime, realtimeUrl, applyPresenceState, applyPresenceDiff, HEARTBEAT_MS };
