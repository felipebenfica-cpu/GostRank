'use strict';

// Etapa 6: toda a fiação dos serviços de conta, servidores, amigos, mensagens, presença, voz e
// preferências, SEM Electron. O main.js (Electron) e a versão web (onda 2) só injetam as
// dependências da plataforma: fetch, WebSocket, stores, notificação, abrir link, tempo ocioso, foco.
//
// Modo do banco: 'v3' (com a 0006_discord.sql) usa os serviços novos; 'legacy' (sem a 0006) usa o
// grupo único da Etapa 4 e as ações novas respondem "Atualize o banco (0006)".

const { createAuthClient } = require('./auth');
const { createSessionManager } = require('./session');
const { createProfileClient } = require('./profile');
const { createAccountService } = require('./account');
const { createGroupClient, createGroupService } = require('./group');
const { createChatClient, createChatFeed } = require('./chat');
const { createVoiceClient } = require('./voice');
const { createSteamClient } = require('./steam');
const { createRest, appError, isUuid } = require('./rest');
const { createRealtime } = require('./realtime');
const { createUserCache } = require('./users');
const { createSocialService } = require('./social');
const { createServersService } = require('./servers');
const { createMessagesService } = require('./messages');
const { createPresenceService } = require('./presence');
const { createPrefs } = require('./prefs');

const RETRY_DETECT_MS = 30000;
const TYPING_THROTTLE_MS = 3000;
const DEBOUNCE_MS = 300;
const MAX_URL = 2048;

function defaultTimers() {
  return {
    setTimeout: (...a) => setTimeout(...a),
    clearTimeout: (...a) => clearTimeout(...a),
    setInterval: (...a) => setInterval(...a),
    clearInterval: (...a) => clearInterval(...a),
  };
}

/** Link externo de mensagem: só http/https, sem usuário/senha, até 2048 caracteres. */
function isSafeExternalUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_URL) return false;
  let u;
  try { u = new URL(value); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (u.username || u.password || !u.hostname) return false;
  return true;
}

/** Texto curto para notificação: menções viram @nome, sem markdown pesado. */
function plainPreview(body, nameOf) {
  let s = String(body || '').replace(/<@([0-9a-f-]{36})>/gi, (_, id) => `@${nameOf(id.toLowerCase())}`);
  s = s.replace(/\|\|[\s\S]*?\|\|/g, '▒▒▒').replace(/```[\s\S]*?```/g, '[código]').replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim();
  return s.length > 140 ? `${s.slice(0, 139)}…` : s;
}

function createAppServices({
  config = null,
  fetchImpl = null,
  WebSocketImpl = null,
  sessionStore = null,
  prefsStore = null,
  notify = null,
  openExternal = null,
  getIdleSeconds = null,
  isFocused = () => true,
  getSummary = () => null,
  onChange = () => {},
  timers = defaultTimers(),
  now = () => Date.now(),
} = {}) {
  const prefs = createPrefs({ store: prefsStore });
  const emit = () => { try { onChange(); } catch { /* ignora */ } };

  // ---------------- Sem configuração: só o rastreador ----------------
  let account = createAccountService({});
  let session = null;
  let voice = null;
  let steam = null;
  let legacyGroup = createGroupService({});
  let legacyChat = null;
  let legacyGroupClient = null;
  let rest = null;
  let realtime = null;
  let users = null;
  let social = null;
  let servers = null;
  let messages = null;
  let presence = null;

  let mode = null; // null (deslogado) | 'unknown' | 'legacy' | 'v3'
  let meId = null;
  let selection = { mode: 'home', tab: 'friends' };
  const lastChannelOf = new Map(); // serverId -> channelId
  let channelIndex = new Map(); // channelId -> {groupId, name, kind}
  let dbChannel = null;
  let detectTimer = null;
  let tokenTimer = null;
  let lastTypingAt = 0;
  let lastTypingTarget = null;
  let startGen = 0;
  const debounced = new Map();

  function debounce(key, fn) {
    if (debounced.has(key)) return;
    const t = timers.setTimeout(() => {
      debounced.delete(key);
      Promise.resolve().then(fn).catch(() => {});
    }, DEBOUNCE_MS);
    if (t && typeof t.unref === 'function') t.unref();
    debounced.set(key, t);
  }

  if (config) {
    try {
      const auth = createAuthClient({ fetchImpl: fetchImpl || undefined, supabaseUrl: config.supabaseUrl, anonKey: config.anonKey });
      session = createSessionManager({ store: sessionStore || { load: () => null, save: () => {}, clear: () => {} }, auth });
      const getAccessToken = async () => {
        const s = await session.get();
        return s ? s.accessToken : null;
      };
      const common = { fetchImpl: fetchImpl || undefined, supabaseUrl: config.supabaseUrl, anonKey: config.anonKey, getAccessToken };
      const profile = createProfileClient(common);
      legacyChat = createChatFeed({ client: createChatClient(common), onChange: emit });
      legacyGroupClient = createGroupClient(common);
      legacyGroup = createGroupService({
        client: legacyGroupClient,
        isSignedIn: () => Boolean(session.peek()),
        chatFeed: legacyChat,
        getSummary: () => { try { return getSummary(); } catch { return null; } },
        onChange: emit,
      });
      voice = createVoiceClient(common);
      steam = createSteamClient({ ...common, openExternal: (url) => (openExternal ? openExternal(url) : Promise.reject(new Error('sem navegador'))) });
      rest = createRest(common);
      realtime = createRealtime({ supabaseUrl: config.supabaseUrl, anonKey: config.anonKey, WebSocketImpl, getAccessToken, timers });
      users = createUserCache({ rest });
      social = createSocialService({ rest, users, onChange: () => { syncPresenceSoon(); emit(); } });
      servers = createServersService({ rest, users, onChange: emit });
      messages = createMessagesService({ rest, users, onChange: emit, now, isFocused: () => safeFocused(), timers });
      presence = createPresenceService({
        realtime, getIdleSeconds, timers, onChange: emit,
        onTyping: (p) => messages.receiveTyping(p),
      });
      account = createAccountService({
        config, auth, session, profile, onChange: emit,
        onSessionChange: (signedIn) => (signedIn ? startSignedIn() : stopSignedIn()),
      });
    } catch {
      account = createAccountService({});
      legacyGroup = createGroupService({});
      if (legacyChat) legacyChat.stop();
      legacyChat = null;
      session = null; voice = null; steam = null; rest = null; realtime = null;
      users = null; social = null; servers = null; messages = null; presence = null;
    }
  }

  const available = Boolean(rest);

  function safeFocused() {
    try { return Boolean(isFocused()); } catch { return false; }
  }

  function signedIn() {
    return Boolean(account && account.isSignedIn());
  }

  // ---------------- Início / fim da sessão ----------------
  async function detectMode() {
    if (!rest) return null;
    const r = await rest.hasSchemaV3();
    if (r === true) return 'v3';
    if (r === false) return 'legacy';
    return 'unknown';
  }

  async function startSignedIn() {
    if (!available || !signedIn()) return;
    const gen = ++startGen;
    if (detectTimer) { timers.clearTimeout(detectTimer); detectTimer = null; }
    const m = await detectMode();
    if (gen !== startGen || !signedIn()) return;
    mode = m;
    if (m === 'v3') {
      await startV3(gen);
    } else {
      if (m === 'legacy') await legacyGroup.refresh({ quiet: true }).catch(() => {});
      if (m === 'unknown') {
        detectTimer = timers.setTimeout(() => { detectTimer = null; if (mode === 'unknown') startSignedIn(); }, RETRY_DETECT_MS);
        if (detectTimer && typeof detectTimer.unref === 'function') detectTimer.unref();
      }
    }
    emit();
  }

  async function startV3(gen) {
    try { meId = (await rest.identity()).id; } catch { return; }
    legacyGroup.clear(); // o chat antigo (sondagem por grupo) não roda no modo novo
    messages.setMe(meId);
    presence.setMe(meId);
    if (realtime && realtime.available) {
      realtime.connect();
      openDbChannel();
      if (!tokenTimer) {
        // a sessão renova o token sozinha; o Realtime precisa receber o novo
        tokenTimer = timers.setInterval(() => { realtime.updateToken().catch(() => {}); }, 10 * 60 * 1000);
        if (tokenTimer && typeof tokenTimer.unref === 'function') tokenTimer.unref();
      }
    }
    await Promise.allSettled([social.refresh(), servers.refreshList(), messages.refreshUnread(), refreshChannelIndex()]);
    if (gen !== startGen) return;
    const me = social.getMe();
    if (me) presence.setPreferred(me.status);
    syncPresence();
    const nav = prefs.getNav();
    try {
      await select(nav && nav.mode ? nav : { mode: 'home', tab: 'friends' }, { save: false });
    } catch {
      await select({ mode: 'home', tab: 'friends' }, { save: false }).catch(() => {});
    }
  }

  function stopSignedIn() {
    startGen++;
    mode = null;
    meId = null;
    selection = { mode: 'home', tab: 'friends' };
    lastChannelOf.clear();
    channelIndex = new Map();
    if (detectTimer) { timers.clearTimeout(detectTimer); detectTimer = null; }
    if (tokenTimer) { timers.clearInterval(tokenTimer); tokenTimer = null; }
    for (const t of debounced.values()) timers.clearTimeout(t);
    debounced.clear();
    if (dbChannel) { try { dbChannel.unsubscribe(); } catch { /* ignora */ } dbChannel = null; }
    if (presence) presence.clear();
    if (realtime) realtime.disconnect();
    if (messages) messages.clear();
    if (social) social.clear();
    if (servers) servers.clear();
    if (users) users.clear();
    legacyGroup.clear();
    emit();
    return null;
  }

  async function refreshChannelIndex() {
    const rows = await rest.select('/rest/v1/channels?select=id,group_id,kind,name&limit=5000');
    const next = new Map();
    for (const r of rows) {
      if (r && isUuid(r.id) && isUuid(r.group_id)) {
        next.set(r.id.toLowerCase(), { groupId: r.group_id.toLowerCase(), kind: r.kind === 'voice' ? 'voice' : 'text', name: String(r.name || '').slice(0, 32) });
      }
    }
    channelIndex = next;
  }

  // ---------------- Tempo real do banco ----------------
  function openDbChannel() {
    if (dbChannel || !meId) return;
    dbChannel = realtime.channel(`db:${meId}`, {
      postgres: [
        { event: '*', schema: 'public', table: 'messages' },
        { event: '*', schema: 'public', table: 'message_reactions' },
        { event: '*', schema: 'public', table: 'relationships', filter: `user_id=eq.${meId}` },
        { event: '*', schema: 'public', table: 'dm_channels' },
        { event: '*', schema: 'public', table: 'group_members' },
        { event: '*', schema: 'public', table: 'channels' },
        { event: '*', schema: 'public', table: 'channel_categories' },
        { event: '*', schema: 'public', table: 'groups' },
        { event: 'UPDATE', schema: 'public', table: 'profiles' },
      ],
    });
    dbChannel.on('postgres', (ev) => { handleDbEvent(ev).catch(() => {}); });
    dbChannel.on('status', (s) => {
      // Voltou a conexão: recarrega o que pode ter mudado enquanto estava fora.
      if (s === 'joined' && mode === 'v3') debounce('resync', resyncAll);
    });
  }

  async function resyncAll() {
    if (mode !== 'v3') return;
    await Promise.allSettled([social.refresh(), servers.refreshList(), servers.reloadSelected(), messages.refreshUnread(), refreshChannelIndex()]);
    syncPresence();
  }

  async function handleDbEvent(ev) {
    if (!ev || mode !== 'v3') return;
    const rec = ev.record || {};
    const old = ev.old || {};
    switch (ev.table) {
      case 'messages': {
        if (ev.type === 'INSERT') {
          if (rec.channel_id && isUuid(rec.channel_id) && isUuid(rec.group_id) && !channelIndex.has(rec.channel_id)) {
            debounce('chanidx', refreshChannelIndex);
          }
          const info = await messages.applyInsert(rec);
          if (info && info.target && info.target.startsWith('d:')) {
            const dmId = info.target.slice(2);
            if (!social.touchDm(dmId, info.message.createdAt)) debounce('dms', () => social.refreshDms());
            else emit();
          }
          if (info && !info.isMine) maybeNotify(info);
        } else if (ev.type === 'UPDATE') {
          messages.applyUpdate(rec);
        } else if (ev.type === 'DELETE') {
          messages.applyDelete(Number(old.id));
        }
        break;
      }
      case 'message_reactions':
        messages.applyReaction(ev.type, ev.type === 'DELETE' ? old : rec);
        break;
      case 'relationships':
        debounce('rels', () => social.refreshRelationships());
        break;
      case 'dm_channels':
        if (ev.type !== 'UPDATE') debounce('dms', () => social.refreshDms());
        break;
      case 'group_members': {
        const uid = String(rec.user_id || old.user_id || '').toLowerCase();
        const gid = String(rec.group_id || old.group_id || '').toLowerCase();
        if (uid === meId || !uid) {
          debounce('list', async () => {
            await servers.refreshList();
            await refreshChannelIndex().catch(() => {});
            if (selection.mode === 'server' && !servers.has(selection.serverId)) await select({ mode: 'home' }).catch(() => {});
            syncPresence();
          });
        }
        if (!gid || gid === servers.getSelectedId()) debounce('selected', () => servers.reloadSelected());
        break;
      }
      case 'channels':
      case 'channel_categories': {
        const gid = String(rec.group_id || old.group_id || '').toLowerCase();
        debounce('chanidx', refreshChannelIndex);
        if (!gid || gid === servers.getSelectedId()) {
          debounce('selected', async () => {
            await servers.reloadSelected();
            // canal aberto foi apagado → volta para o padrão do servidor
            if (selection.mode === 'server' && selection.channelId && !servers.findChannel(selection.channelId)) {
              await select({ mode: 'server', serverId: selection.serverId }).catch(() => {});
            }
          });
        }
        break;
      }
      case 'groups':
        debounce('list', () => servers.refreshList());
        break;
      case 'profiles':
        if (rec && isUuid(rec.id)) {
          users.upsertRows([rec]);
          if (rec.id.toLowerCase() === meId && typeof rec.status === 'string') presence.setPreferred(rec.status);
          emit();
        }
        break;
      default:
        break;
    }
  }

  function syncPresence() {
    if (!presence || mode !== 'v3') return;
    presence.sync({
      serverIds: servers.getList().map((s) => s.id),
      friendIds: social.friendIds(),
      dmIds: social.getDms().map((d) => d.id),
    });
  }

  function syncPresenceSoon() {
    if (mode === 'v3') debounce('presence', syncPresence);
  }

  // ---------------- Notificações ----------------
  function targetSelection(target) {
    const [kind, id] = String(target).split(':');
    if (kind === 'd') return { mode: 'dm', dmId: id };
    const ch = channelIndex.get(id);
    return ch ? { mode: 'server', serverId: ch.groupId, channelId: id } : { mode: 'home', tab: 'friends' };
  }

  function maybeNotify(info) {
    if (typeof notify !== 'function') return;
    const p = prefs.get();
    if (!p.notifications.desktop) return;
    if (presence && presence.effective() === 'dnd') return;
    if (safeFocused()) return; // com a janela em foco o Discord só mostra o badge
    const t = info.target;
    const isDm = t.startsWith('d:');
    if (prefs.isMuted(t)) return;
    let serverName = null;
    let channelName = null;
    if (!isDm) {
      const ch = channelIndex.get(t.slice(2));
      if (ch && prefs.isMuted(`s:${ch.groupId}`) && !info.mentionsMe) return;
      if (p.notifications.mentionsOnly && !info.mentionsMe) return;
      if (ch) {
        channelName = ch.name;
        const s = servers.getList().find((x) => x.id === ch.groupId);
        serverName = s ? s.name : null;
      }
    }
    const author = users.lite(info.message.authorId).displayName;
    const nameOf = (id) => users.lite(id).displayName;
    let body = plainPreview(info.message.body, nameOf);
    if (!body && info.message.attachments.length) body = '📎 Anexo';
    const title = isDm ? author : `${author}${channelName ? ` (#${channelName}${serverName ? `, ${serverName}` : ''})` : ''}`;
    try {
      notify({ title, body, target: targetSelection(t), silent: !p.notifications.sounds, mention: info.mentionsMe || isDm });
    } catch { /* notificação é opcional */ }
  }

  // ---------------- Seleção ----------------
  function resolverForServer() {
    const sel = servers.getSelected();
    const members = sel ? sel.members : [];
    return (username) => {
      for (const m of members) {
        const u = users.get(m.id);
        if (u && u.username === username) return m.id;
      }
      return null;
    };
  }

  function resolverForDm(partnerId) {
    return (username) => {
      const u = users.get(partnerId);
      if (u && u.username === username) return partnerId;
      const me = meId ? users.get(meId) : null;
      return me && me.username === username ? meId : null;
    };
  }

  async function select(sel, { save = true } = {}) {
    needV3Sync();
    if (!sel || typeof sel !== 'object') throw appError('invalid');
    if (sel.mode === 'home') {
      selection = { mode: 'home', tab: sel.tab === 'mmr' ? 'mmr' : 'friends' };
      await messages.open(null);
      await servers.select(null);
    } else if (sel.mode === 'server') {
      const gid = String(sel.serverId || '').toLowerCase();
      if (!servers.has(gid)) throw appError('not_member');
      selection = { mode: 'server', serverId: gid, channelId: null };
      emit();
      await servers.select(gid);
      let cid = null;
      const want = sel.channelId ? String(sel.channelId).toLowerCase() : lastChannelOf.get(gid);
      if (want && servers.findChannel(want)) cid = want;
      if (!cid) cid = servers.defaultTextChannel();
      selection = { mode: 'server', serverId: gid, channelId: cid };
      if (cid) lastChannelOf.set(gid, cid);
      const ch = cid ? servers.findChannel(cid) : null;
      if (ch && ch.kind === 'text') {
        const memberSet = new Set((servers.getSelected() || { members: [] }).members.map((m) => m.id));
        await messages.open(`c:${cid}`, { groupId: gid, resolveUsername: resolverForServer(), isMentionable: (id) => memberSet.has(id) });
      }
      else await messages.open(null);
    } else if (sel.mode === 'dm') {
      const dmId = String(sel.dmId || '').toLowerCase();
      let dm = social.getDms().find((d) => d.id === dmId);
      if (!dm) { await social.refreshDms(); dm = social.getDms().find((d) => d.id === dmId); }
      if (!dm) throw appError('dm_not_allowed');
      selection = { mode: 'dm', dmId };
      await servers.select(null);
      await messages.open(`d:${dmId}`, { resolveUsername: resolverForDm(dm.userId), isMentionable: (id) => id === dm.userId || id === meId });
    } else {
      throw appError('invalid');
    }
    if (save) prefs.setNav(selection);
    emit();
    return selection;
  }

  function needSignedInSync() {
    if (!available) throw appError('unconfigured');
    if (!signedIn()) throw appError('signed_out');
  }

  function needV3Sync() {
    needSignedInSync();
    if (mode === 'legacy') throw appError('needs_migration');
    if (mode !== 'v3') throw appError('network');
  }

  /** Garante o modo novo (tenta detectar de novo se ainda não sabe). */
  async function needV3() {
    needSignedInSync();
    if (mode === 'unknown' || mode === null) await startSignedIn();
    needV3Sync();
  }

  function currentGroupIdForTarget() {
    const t = messages.getTarget();
    if (!t || !t.startsWith('c:')) return null;
    const ch = channelIndex.get(t.slice(2));
    return ch ? ch.groupId : servers.getSelectedId();
  }

  // ---------------- Proxies para a API antiga (grupo único / chat da Etapa 4) ----------------
  const groupProxy = {
    getView() {
      if (mode !== 'v3') return legacyGroup.getView();
      if (!signedIn()) return null;
      const sel = servers.getSelected();
      if (sel) {
        return {
          id: sel.id, name: sel.name, isOwner: sel.role === 'owner',
          members: sel.members.map((m) => ({
            userId: m.id, displayName: m.nickname || users.lite(m.id).displayName, isMe: m.id === meId,
            isOwner: m.role === 'owner', mmr: m.mmr ? { ...m.mmr } : null,
          })),
        };
      }
      const first = servers.getList()[0];
      return first ? { id: first.id, name: first.name, isOwner: first.role === 'owner', members: [] } : null;
    },
    hasGroup() {
      if (mode !== 'v3') return legacyGroup.hasGroup();
      return signedIn() && (servers.getList().length > 0 || social.getDms().length > 0);
    },
    async refresh(opts = {}) {
      if (mode === 'legacy') return legacyGroup.refresh(opts);
      if (mode !== 'v3') {
        if (!opts.quiet && signedIn()) await startSignedIn();
        return groupProxy.getView();
      }
      try {
        await Promise.all([servers.refreshList(), servers.reloadSelected(), social.refreshDms(), messages.refreshUnread()]);
        syncPresence();
      } catch (err) { if (!opts.quiet) throw err; }
      return groupProxy.getView();
    },
    async create(name) {
      if (mode !== 'v3') return legacyGroup.create(name);
      const id = await servers.create({ name });
      await select({ mode: 'server', serverId: id });
      syncPresence();
      return groupProxy.getView();
    },
    async join(code) {
      if (mode !== 'v3') return legacyGroup.join(code);
      const id = await servers.join(code);
      await refreshChannelIndex().catch(() => {});
      await select({ mode: 'server', serverId: id });
      syncPresence();
      return groupProxy.getView();
    },
    async leave() {
      if (mode !== 'v3') return legacyGroup.leave();
      const gid = servers.getSelectedId() || (servers.getList()[0] || {}).id;
      if (!gid) throw appError('not_in_group');
      await servers.leave(gid);
      await select({ mode: 'home' }).catch(() => {});
      syncPresence();
      return null;
    },
    async remove(userId) {
      if (mode !== 'v3') return legacyGroup.remove(userId);
      const gid = servers.getSelectedId();
      if (!gid) throw appError('not_in_group');
      await servers.kickMember({ serverId: gid, userId });
      return groupProxy.getView();
    },
    async invite() {
      if (mode !== 'v3') return legacyGroup.invite();
      const gid = servers.getSelectedId() || (servers.getList()[0] || {}).id;
      if (!gid) throw appError('not_in_group');
      const inv = await servers.createInvite({ serverId: gid, maxAgeSeconds: null, maxUses: null });
      return { code: inv.code, expiresAt: inv.expiresAt };
    },
    async publishSnapshot(summary) {
      if (mode !== 'v3') return legacyGroup.publishSnapshot(summary);
      if (!signedIn() || !legacyGroupClient) return false;
      await legacyGroupClient.publishSnapshot(summary);
      return true;
    },
    clear() {
      legacyGroup.clear();
    },
  };

  const chatProxy = {
    setFocused(v) {
      if (legacyChat) legacyChat.setFocused(v);
      if (v && mode === 'v3') {
        messages.markRead().catch(() => {});
        debounce('unread', () => messages.refreshUnread());
      }
    },
    async send(body) {
      if (mode !== 'v3') {
        if (!legacyChat) throw appError('unconfigured');
        return legacyChat.send(body);
      }
      await messages.send({ body });
      return undefined;
    },
    getView() {
      if (mode !== 'v3') return legacyChat ? legacyChat.getView() : { messages: [], status: 'idle' };
      return messages.getLegacyView();
    },
    stop() {
      if (legacyChat) legacyChat.stop();
    },
    poll() {
      return legacyChat ? legacyChat.poll() : Promise.resolve(false);
    },
    isRunning() {
      return legacyChat ? legacyChat.isRunning() : false;
    },
  };

  // ---------------- Ações novas (usadas pelo api.js) ----------------
  const after = async (fn) => { await needV3(); const r = await fn(); emit(); return r; };

  const app = {
    select: (sel) => after(() => select(sel)),
    // Social
    searchUsers: (q) => after(() => social.searchUsers(q)),
    sendFriendRequest: (u) => after(async () => { const r = await social.sendFriendRequest(u); syncPresence(); return r; }),
    acceptFriend: (id) => after(async () => { await social.acceptFriend(id); syncPresence(); }),
    declineFriend: (id) => after(() => social.declineFriend(id)),
    removeFriend: (id) => after(async () => { await social.removeFriend(id); syncPresence(); }),
    blockUser: (id) => after(() => social.blockUser(id)),
    unblockUser: (id) => after(() => social.unblockUser(id)),
    openDm: (id) => after(async () => {
      const dmId = await social.openDm(id);
      syncPresence();
      await select({ mode: 'dm', dmId });
      return dmId;
    }),
    setStatus: (s) => after(async () => { await social.setStatus(s); presence.setPreferred(s); }),
    setCustomStatus: (t) => after(() => social.setCustomStatus(t)),
    updateProfile: (patch) => after(async () => {
      await social.updateProfile(patch);
      await account.refreshProfile().catch(() => {});
    }),
    uploadAvatar: (f) => after(() => social.uploadAvatar(f)),
    removeAvatar: () => after(() => social.removeAvatar()),
    // Servidores
    createServer: (d) => after(async () => {
      const id = await servers.create(d);
      await refreshChannelIndex().catch(() => {});
      await select({ mode: 'server', serverId: id });
      syncPresence();
      return id;
    }),
    previewInvite: (code) => after(() => servers.previewInvite(code)),
    joinServer: (code) => after(async () => {
      const id = await servers.join(code);
      await refreshChannelIndex().catch(() => {});
      await select({ mode: 'server', serverId: id });
      syncPresence();
      return id;
    }),
    leaveServer: (id) => after(async () => {
      await servers.leave(id);
      if (selection.mode === 'server' && selection.serverId === String(id).toLowerCase()) await select({ mode: 'home' });
      syncPresence();
    }),
    deleteServer: (id) => after(async () => {
      await servers.remove(id);
      if (selection.mode === 'server' && selection.serverId === String(id).toLowerCase()) await select({ mode: 'home' });
      syncPresence();
    }),
    updateServer: (d) => after(() => servers.update(d)),
    uploadServerIcon: (d) => after(() => servers.uploadIcon(d)),
    createInvite: (d) => after(() => servers.createInvite(d)),
    listInvites: (id) => after(() => servers.listInvites(id)),
    revokeInvite: (code) => after(() => servers.revokeInvite(code)),
    setMemberRole: (d) => after(() => servers.setMemberRole(d)),
    transferOwnership: (d) => after(() => servers.transferOwnership(d)),
    kickMember: (d) => after(() => servers.kickMember(d)),
    banMember: (d) => after(() => servers.banMember(d)),
    unbanMember: (d) => after(() => servers.unbanMember(d)),
    listBans: (id) => after(() => servers.listBans(id)),
    setNickname: (d) => after(() => servers.setNickname(d)),
    // Canais
    createCategory: (d) => after(() => servers.createCategory(d)),
    updateCategory: (d) => after(() => servers.updateCategory(d)),
    deleteCategory: (id) => after(() => servers.deleteCategory(id)),
    createChannel: (d) => after(async () => {
      const id = await servers.createChannel(d);
      await refreshChannelIndex().catch(() => {});
      if (id && d.kind === 'text') await select({ mode: 'server', serverId: d.serverId, channelId: id });
      return id;
    }),
    updateChannel: (d) => after(() => servers.updateChannel(d)),
    deleteChannel: (id) => after(async () => {
      await servers.deleteChannel(id);
      await refreshChannelIndex().catch(() => {});
      if (selection.mode === 'server' && selection.channelId === String(id).toLowerCase()) {
        await select({ mode: 'server', serverId: selection.serverId });
      }
    }),
    // Mensagens
    sendMessage: (d) => after(async () => {
      const id = await messages.send(d);
      const t = messages.getTarget();
      if (t && t.startsWith('d:')) social.touchDm(t.slice(2), now());
      return id;
    }),
    retryMessage: (id) => after(() => messages.retry(id)),
    editMessage: (d) => after(() => messages.edit(d)),
    deleteMessage: (id) => after(() => messages.remove(id)),
    toggleReaction: (d) => after(() => messages.toggleReaction(d)),
    pinMessage: (d) => after(() => messages.pin(d)),
    listPinned: () => after(() => messages.listPinned()),
    loadOlder: () => after(() => messages.loadOlder()),
    markRead: () => after(() => messages.markRead()),
    markTargetRead: (target) => after(async () => {
      if (/^s:/.test(target)) {
        const gid = target.slice(2);
        for (const [cid, ch] of channelIndex) if (ch.groupId === gid) await messages.markTargetRead(`c:${cid}`);
      } else {
        await messages.markTargetRead(target);
      }
    }),
    searchMessages: (q) => after(() => messages.search(q)),
    setTyping: async () => {
      await needV3();
      const t = messages.getTarget();
      if (!t) return false;
      if (t === lastTypingTarget && now() - lastTypingAt < TYPING_THROTTLE_MS) return false;
      lastTypingAt = now();
      lastTypingTarget = t;
      return presence.sendTyping(t, currentGroupIdForTarget());
    },
    openExternal: async (url) => {
      if (!isSafeExternalUrl(url)) throw appError('invalid');
      if (typeof openExternal !== 'function') throw appError('invalid');
      await openExternal(url);
    },
    // Preferências (funcionam sem conta)
    updatePrefs: async (patch) => { prefs.update(patch); emit(); },
    muteTarget: async ({ target, muted }) => { prefs.setMuted(target, muted); emit(); },
    // Voz
    voiceToken: async (target) => {
      needSignedInSync();
      if (!voice) throw appError('unconfigured');
      if (target && (target.channelId || target.dmId)) await needV3();
      return voice.getToken(target || {});
    },
    setVoiceState: async (st) => {
      await needV3();
      let serverId = null;
      if (st.channelId) {
        const ch = channelIndex.get(st.channelId);
        serverId = ch ? ch.groupId : servers.serverOfChannel(st.channelId);
        if (!serverId) throw appError('not_member');
      }
      presence.setVoiceState({ ...st, serverId });
    },
  };

  // ---------------- View ----------------
  function emptyExtra() {
    return {
      schema: mode,
      me: null,
      prefs: prefs.get(),
      presence: {},
      friends: [],
      dms: [],
      servers: [],
      selection: { mode: 'home', tab: 'friends' },
      server: null,
      voiceStates: {},
      messages: null,
      users: {},
    };
  }

  function getExtraView() {
    if (mode !== 'v3' || !signedIn() || !social) return emptyExtra();
    const p = prefs.get();
    const muted = new Set(p.muted);
    const ids = new Set();
    const me = social.getMe();
    if (me) ids.add(me.id);

    const friends = social.getFriendsView();
    for (const f of friends) ids.add(f.id);

    const dms = social.getDms().map((d) => {
      ids.add(d.userId);
      const u = messages.unreadOf(`d:${d.id}`);
      return { id: d.id, user: users.lite(d.userId), lastMessageAt: d.lastMessageAt, unread: u.unread, mentions: u.mentions, muted: muted.has(`d:${d.id}`) };
    });

    // agregados por servidor a partir do índice de canais
    const agg = new Map();
    for (const [cid, ch] of channelIndex) {
      if (ch.kind !== 'text') continue;
      const u = messages.unreadOf(`c:${cid}`);
      if (!u.unread && !u.mentions) continue;
      const a = agg.get(ch.groupId) || { unread: false, mentions: 0 };
      if (u.unread && !muted.has(`c:${cid}`)) a.unread = true;
      a.mentions += u.mentions;
      agg.set(ch.groupId, a);
    }
    const serverList = servers.getList().map((s) => {
      const a = agg.get(s.id) || { unread: false, mentions: 0 };
      const sMuted = muted.has(`s:${s.id}`);
      return {
        id: s.id, name: s.name, iconColor: s.iconColor, iconUrl: s.iconUrl, role: s.role,
        unread: a.unread && !sMuted, mentions: Math.min(99, a.mentions), muted: sMuted,
      };
    });

    let server = null;
    const sel = servers.getSelected();
    if (sel) {
      server = {
        id: sel.id, name: sel.name, iconColor: sel.iconColor, iconUrl: sel.iconUrl, role: sel.role, ownerId: sel.ownerId,
        loaded: sel.loaded,
        categories: sel.categories,
        channels: sel.channels.map((c) => {
          const u = c.kind === 'text' ? messages.unreadOf(`c:${c.id}`) : { unread: 0, mentions: 0 };
          return { ...c, unread: u.unread > 0, mentions: u.mentions, muted: muted.has(`c:${c.id}`) };
        }),
        members: sel.members.map((m) => {
          ids.add(m.id);
          const u = users.get(m.id);
          return { ...users.lite(m.id), role: m.role, nickname: m.nickname, mmr: m.mmr, customStatus: u ? u.customStatus : null };
        }),
      };
    }

    const voiceStates = presence.getVoiceStates();
    for (const list of Object.values(voiceStates)) for (const v of list) ids.add(v.userId);
    const msgView = messages.getView();
    for (const id of messages.peopleInView()) ids.add(id);
    ids.delete(undefined);

    return {
      schema: mode,
      me,
      prefs: p,
      presence: presence.getPresence(),
      friends,
      dms,
      servers: serverList,
      selection: { ...selection },
      server,
      voiceStates,
      messages: msgView,
      users: users.viewMap([...ids]),
    };
  }

  /** Total para o badge do app: menções + DMs não lidas + pedidos de amizade recebidos. */
  function badgeCount() {
    if (mode !== 'v3' || !messages) return 0;
    let n = 0;
    for (const [t, u] of messages.unreadEntries()) if (!prefs.isMuted(t)) n += u.mentions;
    n += social.getFriendsView().filter((f) => f.relation === 'pending_in').length;
    return Math.min(n, 999);
  }

  function voiceAvailable() {
    return signedIn() && groupProxy.hasGroup();
  }

  /** Primeiro carregamento (sessão salva no disco). */
  function start() {
    if (signedIn()) startSignedIn().catch(() => {});
  }

  function stop() {
    if (legacyChat) legacyChat.stop();
    stopSignedIn();
  }

  /** Clique na notificação: seleciona o alvo. */
  async function openTarget(sel) {
    try { await select(sel); } catch { /* alvo sumiu */ }
  }

  return {
    available,
    account,
    session,
    group: groupProxy,
    chatFeed: chatProxy,
    voice,
    steam,
    prefs,
    app,
    getExtraView,
    badgeCount,
    voiceAvailable,
    start,
    stop,
    openTarget,
    getMode: () => mode,
    updateRealtimeToken: () => (realtime ? realtime.updateToken() : Promise.resolve()),
  };
}

module.exports = { createAppServices, isSafeExternalUrl, plainPreview };
