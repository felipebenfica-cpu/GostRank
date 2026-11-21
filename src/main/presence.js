'use strict';

// Etapa 6: presença (online/ausente/não perturbe/offline), quem está em cada canal de voz e
// "digitando…", pelos canais privados do Realtime: server:<id>, user:<id> e dm:<id>, além dos avisos
// privados me:<eu> (amizades/servidores mudaram) e do aviso "members" em server:<id>.
//
// Aviso: presence e broadcast são só visuais. O Realtime não amarra a chave do presence ao JWT, então
// um membro pode tentar se anunciar como outro. Mitigação aqui: a identidade é sempre a CHAVE do track
// (nunca um userId declarado no conteúdo), entradas cujo userId declarado não bate com a chave são
// descartadas, e em server:/dm: só contam pessoas que são membros/participantes daquele alvo
// (isMember). O status em user:<id> só pode ser escrito pelo dono (política do banco) e tem prioridade.

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
  isMember = () => true, onPrivateEvent = () => {},
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
      const [kind, id] = topic.split(':');
      if (event === 'typing' && payload && typeof payload === 'object') {
        const uid = typeof payload.userId === 'string' ? payload.userId.toLowerCase() : '';
        if (!isUuid(uid) || uid === meId || !memberOk(kind, id, uid)) return;
        if (!typingTargetOk(kind, id, payload.target)) return;
        try { onTyping({ target: payload.target, userId: uid }); } catch { /* ignora */ }
      } else if (kind === 'server' && event === 'members') {
        try { onPrivateEvent({ kind: 'members', serverId: id }); } catch { /* ignora */ }
      }
    });
    ch.on('status', (s) => { if (s === 'joined') trackFor(topic, ch); });
    subs.set(topic, ch);
    trackFor(topic, ch);
  }

  function memberOk(kind, id, uid) {
    if (kind !== 'server' && kind !== 'dm') return true;
    try { return isMember(kind, id, uid) !== false; } catch { return false; }
  }

  /** "digitando" num tópico só vale para um alvo daquele tópico (canal do servidor ou a própria DM). */
  function typingTargetOk(kind, id, target) {
    if (typeof target !== 'string') return false;
    const [tk, tid] = target.split(':');
    if (kind === 'dm') return tk === 'd' && tid === id;
    if (kind === 'server') return tk === 'c' && isUuid(tid);
    return false;
  }

  /** Metas confiáveis de uma chave: descarta quem declara outro userId no conteúdo. */
  function trustedMetas(key, metas) {
    return (Array.isArray(metas) ? metas : []).filter((m) => m && typeof m === 'object'
      && (m.userId === undefined || String(m.userId).toLowerCase() === key));
  }

  /** Avisos privados do banco (me:<eu>): amizades e servidores mudaram. */
  let meChannel = null;
  function openMeChannel() {
    if (meChannel || !meId || !realtime || !realtime.available) return;
    meChannel = realtime.channel(`me:${meId}`, { private: true });
    meChannel.on('broadcast', ({ event, payload }) => {
      if (event === 'relationships') {
        try { onPrivateEvent({ kind: 'relationships' }); } catch { /* ignora */ }
      } else if (event === 'servers') {
        const gid = payload && typeof payload.group_id === 'string' && isUuid(payload.group_id)
          ? payload.group_id.toLowerCase() : null;
        try { onPrivateEvent({ kind: 'servers', serverId: gid }); } catch { /* ignora */ }
      }
    });
  }
  function closeMeChannel() {
    if (!meChannel) return;
    try { meChannel.unsubscribe(); } catch { /* ignora */ }
    meChannel = null;
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
    openMeChannel();
    emit();
  }

  function setMe(id) {
    if (id === meId) return;
    for (const t of [...subs.keys()]) unsubscribe(t);
    closeMeChannel();
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
    // 1º user:<id> (só o dono escreve, confiável); depois server:, só para quem não tem tópico próprio.
    const fromOwner = new Set();
    for (const [topic, ch] of subs) {
      const [kind, owner] = topic.split(':');
      if (kind !== 'user') continue;
      for (const [key, metas] of Object.entries(ch.presence || {})) {
        if (key !== owner) continue; // só o dono do tópico
        fromOwner.add(key);
        for (const m of trustedMetas(key, metas)) put(key, cleanStatus(m.status));
      }
    }
    for (const [topic, ch] of subs) {
      const [kind, id] = topic.split(':');
      if (kind !== 'server') continue;
      for (const [key, metas] of Object.entries(ch.presence || {})) {
        if (fromOwner.has(key) || !memberOk(kind, id, key)) continue;
        for (const m of trustedMetas(key, metas)) put(key, cleanStatus(m.status));
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
        if (!isUuid(key) || !memberOk(kind, id, key)) continue;
        const m = trustedMetas(key, metas).find((x) => x && (kind === 'dm' ? x.voice === true : isUuid(x.voice)));
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
    closeMeChannel();
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
