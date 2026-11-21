'use strict';

// Etapa 6: presença (online/ausente/não perturbe/offline), quem está em cada canal de voz e
// "digitando…", pelos canais privados do Realtime: server:<id>, user:<id> e dm:<id>.

const { isUuid } = require('./rest');

const IDLE_AFTER_S = 600;
const IDLE_POLL_MS = 30000;
const MAX_TOPICS = 200;
const STATUS_RANK = { dnd: 3, online: 2, idle: 1, offline: 0 };

function cleanStatus(s) {
  return ['online', 'idle', 'dnd', 'offline'].includes(s) ? s : 'offline';
}

function cleanVoice(meta) {
  return {
    muted: meta.muted === true,
    deafened: meta.deafened === true,
    streaming: meta.streaming === true,
    video: meta.video === true,
  };
}

function createPresenceService({
  realtime, onChange = () => {}, onTyping = () => {}, getIdleSeconds = null,
  timers = { setInterval: (...a) => setInterval(...a), clearInterval: (...a) => clearInterval(...a) },
} = {}) {
  let meId = null;
  let preferred = 'online';
  let idle = false;
  let voice = { channelId: null, serverId: null, dmId: null, muted: false, deafened: false, streaming: false, video: false };
  const subs = new Map(); // topic -> channel
  let idleTimer = null;

  function emit() { try { onChange(); } catch { /* ignora */ } }

  function effective() {
    if (preferred === 'invisible') return 'offline';
    if (preferred === 'online' && idle) return 'idle';
    return preferred;
  }

  function trackFor(topic, ch) {
    if (!meId) return;
    const [kind, id] = topic.split(':');
    const st = effective();
    if (kind === 'user') {
      if (id !== meId) return;
      if (st === 'offline') ch.untrack(); else ch.track({ status: st });
    } else if (kind === 'server') {
      const inHere = voice.channelId && voice.serverId === id;
      ch.track({ status: st, voice: inHere ? voice.channelId : null, ...cleanVoice(voice) });
    } else if (kind === 'dm') {
      if (voice.dmId === id) ch.track({ status: st, voice: true, ...cleanVoice(voice) });
      else ch.untrack();
    }
  }

  function retrackAll() {
    for (const [topic, ch] of subs) trackFor(topic, ch);
  }

  function subscribe(topic) {
    if (subs.has(topic) || !realtime || !realtime.available || subs.size >= MAX_TOPICS) return;
    const ch = realtime.channel(topic, { private: true, presenceKey: meId || '' });
    ch.on('presence', () => emit());
    ch.on('broadcast', ({ event, payload }) => {
      if (event === 'typing' && payload && typeof payload === 'object') {
        try { onTyping({ target: payload.target, userId: payload.userId }); } catch { /* ignora */ }
      }
    });
    ch.on('status', (s) => { if (s === 'joined') trackFor(topic, ch); });
    subs.set(topic, ch);
    trackFor(topic, ch);
  }

  function unsubscribe(topic) {
    const ch = subs.get(topic);
    if (!ch) return;
    subs.delete(topic);
    try { ch.unsubscribe(); } catch { /* ignora */ }
  }

  /** Mantém só os tópicos necessários. */
  function sync({ serverIds = [], friendIds = [], dmIds = [] } = {}) {
    if (!meId) return;
    const want = new Set([`user:${meId}`]);
    for (const id of serverIds) if (isUuid(id)) want.add(`server:${id}`);
    for (const id of friendIds) if (isUuid(id)) want.add(`user:${id}`);
    for (const id of dmIds.slice(0, 50)) if (isUuid(id)) want.add(`dm:${id}`);
    for (const t of [...subs.keys()]) if (!want.has(t)) unsubscribe(t);
    for (const t of want) subscribe(t);
    emit();
  }

  function setMe(id) {
    if (id === meId) return;
    for (const t of [...subs.keys()]) unsubscribe(t);
    meId = id;
    if (id && !idleTimer && typeof getIdleSeconds === 'function') {
      idleTimer = timers.setInterval(checkIdle, IDLE_POLL_MS);
      if (idleTimer && typeof idleTimer.unref === 'function') idleTimer.unref();
    }
  }

  function checkIdle() {
    let secs = 0;
    try { secs = Number(getIdleSeconds()) || 0; } catch { secs = 0; }
    const next = secs >= IDLE_AFTER_S;
    if (next !== idle) { idle = next; retrackAll(); emit(); }
  }

  function setPreferred(status) {
    const s = ['online', 'idle', 'dnd', 'invisible'].includes(status) ? status : 'online';
    if (s === preferred) return;
    preferred = s;
    retrackAll();
    emit();
  }

  function setVoiceState(next) {
    voice = {
      channelId: isUuid(next.channelId) ? next.channelId.toLowerCase() : null,
      serverId: isUuid(next.serverId) ? next.serverId.toLowerCase() : null,
      dmId: isUuid(next.dmId) ? next.dmId.toLowerCase() : null,
      ...cleanVoice(next),
    };
    if (!voice.channelId) voice.serverId = null;
    retrackAll();
    emit();
  }

  function getVoiceSelf() { return { ...voice }; }

  /** Avisa "digitando" no tópico do servidor (canal) ou da DM. */
  function sendTyping(target, groupId) {
    if (!meId || typeof target !== 'string') return false;
    const [kind, id] = target.split(':');
    const topic = kind === 'c' ? (isUuid(groupId) ? `server:${groupId}` : null) : (kind === 'd' ? `dm:${id}` : null);
    const ch = topic ? subs.get(topic) : null;
    return ch ? ch.broadcast('typing', { target, userId: meId }) : false;
  }

  function getPresence() {
    const out = {};
    const put = (uid, st) => {
      if (!isUuid(uid)) return;
      if (!(uid in out) || STATUS_RANK[st] > STATUS_RANK[out[uid]]) out[uid] = st;
    };
    for (const [topic, ch] of subs) {
      const [kind, owner] = topic.split(':');
      if (kind === 'dm') continue;
      for (const [key, metas] of Object.entries(ch.presence || {})) {
        if (kind === 'user' && key !== owner) continue; // só o dono do tópico
        for (const m of metas) put(key, cleanStatus(m && m.status));
      }
    }
    if (meId) out[meId] = effective();
    return out;
  }

  function getVoiceStates() {
    const out = {};
    const seen = new Set();
    for (const [topic, ch] of subs) {
      const [kind, id] = topic.split(':');
      if (kind !== 'server' && kind !== 'dm') continue;
      for (const [key, metas] of Object.entries(ch.presence || {})) {
        if (!isUuid(key)) continue;
        const m = (metas || []).find((x) => x && (kind === 'dm' ? x.voice === true : isUuid(x.voice)));
        if (!m) continue;
        const slot = kind === 'dm' ? `dm:${id}` : String(m.voice).toLowerCase();
        const dedupe = `${slot}|${key}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        (out[slot] = out[slot] || []).push({ userId: key, ...cleanVoice(m) });
      }
    }
    return out;
  }

  function clear() {
    for (const t of [...subs.keys()]) unsubscribe(t);
    if (idleTimer) { timers.clearInterval(idleTimer); idleTimer = null; }
    meId = null;
    preferred = 'online';
    idle = false;
    voice = { channelId: null, serverId: null, dmId: null, muted: false, deafened: false, streaming: false, video: false };
  }

  return {
    setMe, sync, setPreferred, setVoiceState, getVoiceSelf, sendTyping, getPresence, getVoiceStates, clear, checkIdle,
    effective, topics: () => [...subs.keys()],
  };
}

module.exports = { createPresenceService, IDLE_AFTER_S };
