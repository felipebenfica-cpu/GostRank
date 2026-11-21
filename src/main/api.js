'use strict';

// Etapa 6: ações novas da ponte `window.ghostRank` — canal IPC, validação estrita do que vem da tela
// e chamada ao serviço. Independente de Electron: o ipc.js põe a checagem de origem por cima e a
// versão web (onda 2) chama `buildApiCalls` direto.

const { UserInputError } = require('./controller');
const { MAX_AGES, MAX_USES } = require('./servers');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVITE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/;
const TARGET_RE = /^[cds]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MSG_TARGET_RE = /^[cd]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GENERIC_ERROR = 'Ocorreu um erro inesperado. Tente novamente.';
const INVALID_ERROR = 'Dados inválidos.';
const ATTACHMENT_MAX = 8 * 1024 * 1024;
const IMAGE_MAX = 2 * 1024 * 1024;
const MAX_ATTACHMENTS = 4;
// Etapa 7 (LUMENEX)
const PROFILE_MEDIA_MAX = 40 * 1024 * 1024; // 41943040 bytes: aceito; um a mais, não
const THUMB_MAX = 512 * 1024;
const FRAME_IDS = Object.freeze(['gold', 'fire', 'lightning', 'arcane', 'shadow', 'ice', 'red', 'particles']);
const EFFECT_IDS = Object.freeze(['burst', 'flames', 'sparks', 'magic', 'mist', 'crystal', 'waves', 'pulse']);
const MAX_LAYOUT = 500;

// ---------------- Ajudantes de validação ----------------
function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return (proto === Object.prototype || proto === null) && Object.getOwnPropertySymbols(v).length === 0;
}

/** Objeto simples só com as chaves permitidas (e todas as obrigatórias). */
function shape(p, required, optional = []) {
  if (!isPlainObject(p)) return false;
  const keys = Object.keys(p);
  const allowed = new Set([...required, ...optional]);
  return keys.every((k) => allowed.has(k)) && required.every((k) => keys.includes(k));
}

const str = (v, max) => typeof v === 'string' && v.length <= max;
const uuid = (v) => (typeof v === 'string' && UUID_RE.test(v) ? v.toLowerCase() : null);
const msgId = (v) => (Number.isSafeInteger(v) && v > 0 ? v : null);

function byteLength(data) {
  if (Object.prototype.toString.call(data) === '[object ArrayBuffer]') return data.byteLength;
  if (data && ArrayBuffer.isView(data)) return data.byteLength;
  return -1;
}

function uploadOk(f, max) {
  if (!shape(f, ['name', 'mime', 'data'])) return null;
  if (!str(f.name, 255) || !str(f.mime, 100)) return null;
  const n = byteLength(f.data);
  if (n <= 0 || n > max) return null;
  return { name: f.name, mime: f.mime, data: f.data };
}

// ---------------- Validadores (devolvem payload limpo ou null) ----------------
const V = {
  none(p) {
    if (p === undefined || p === null) return {};
    return isPlainObject(p) && Object.keys(p).length === 0 ? {} : null;
  },
  select(p) {
    if (!isPlainObject(p) || !['home', 'server', 'dm'].includes(p.mode)) return null;
    if (p.mode === 'home') {
      if (!shape(p, ['mode'], ['tab'])) return null;
      if (p.tab !== undefined && !['friends', 'mmr'].includes(p.tab)) return null;
      return { mode: 'home', tab: p.tab || 'friends' };
    }
    if (p.mode === 'server') {
      if (!shape(p, ['mode', 'serverId'], ['channelId'])) return null;
      const serverId = uuid(p.serverId);
      if (!serverId) return null;
      if (p.channelId === undefined || p.channelId === null) return { mode: 'server', serverId };
      const channelId = uuid(p.channelId);
      return channelId ? { mode: 'server', serverId, channelId } : null;
    }
    if (!shape(p, ['mode', 'dmId'])) return null;
    const dmId = uuid(p.dmId);
    return dmId ? { mode: 'dm', dmId } : null;
  },
  query(p) {
    return shape(p, ['query']) && str(p.query, 100) ? { query: p.query } : null;
  },
  username(p) {
    return shape(p, ['username']) && str(p.username, 64) ? { username: p.username } : null;
  },
  userId(p) {
    if (!shape(p, ['userId'])) return null;
    const userId = uuid(p.userId);
    return userId ? { userId } : null;
  },
  status(p) {
    return shape(p, ['status']) && ['online', 'idle', 'dnd', 'invisible'].includes(p.status) ? { status: p.status } : null;
  },
  customStatus(p) {
    if (!shape(p, ['text'])) return null;
    if (p.text !== null && !str(p.text, 256)) return null;
    return { text: p.text };
  },
  image(p) { return uploadOk(p, IMAGE_MAX); },
  /** Avatar/banner: original até 40 MB + miniatura WebP até 512 KB + `animated` (o main confere pelos bytes). */
  profileMedia(p) {
    if (!shape(p, ['name', 'mime', 'data', 'thumb'], ['animated'])) return null;
    const f = uploadOk({ name: p.name, mime: p.mime, data: p.data }, PROFILE_MEDIA_MAX);
    if (!f) return null;
    if (!shape(p.thumb, ['mime', 'data']) || p.thumb.mime !== 'image/webp') return null;
    const tn = byteLength(p.thumb.data);
    if (tn <= 0 || tn > THUMB_MAX) return null;
    if (p.animated !== undefined && typeof p.animated !== 'boolean') return null;
    return { ...f, thumb: { mime: 'image/webp', data: p.thumb.data }, animated: p.animated === true };
  },
  look(p) {
    if (!shape(p, [], ['frame', 'effect', 'avatarCrop', 'bannerPos']) || Object.keys(p).length === 0) return null;
    const out = {};
    if (p.frame !== undefined) { if (p.frame !== null && !FRAME_IDS.includes(p.frame)) return null; out.frame = p.frame; }
    if (p.effect !== undefined) { if (p.effect !== null && !EFFECT_IDS.includes(p.effect)) return null; out.effect = p.effect; }
    if (p.avatarCrop !== undefined) {
      if (p.avatarCrop === null) out.avatarCrop = null;
      else {
        if (!shape(p.avatarCrop, ['x', 'y', 'zoom'])) return null;
        const { x, y, zoom } = p.avatarCrop;
        const num = (n, lo, hi) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
        if (!num(x, 0, 100) || !num(y, 0, 100) || !num(zoom, 1, 3)) return null;
        out.avatarCrop = { x, y, zoom };
      }
    }
    if (p.bannerPos !== undefined) {
      if (!(Number.isInteger(p.bannerPos) && p.bannerPos >= 0 && p.bannerPos <= 100)) return null;
      out.bannerPos = p.bannerPos;
    }
    return out;
  },
  reorder(p) {
    if (!shape(p, ['serverId', 'channels'], ['categories'])) return null;
    const serverId = uuid(p.serverId);
    if (!serverId || !Array.isArray(p.channels) || p.channels.length === 0 || p.channels.length > MAX_LAYOUT) return null;
    const pos = (n) => Number.isInteger(n) && n >= 0 && n <= 10000;
    const channels = [];
    for (const c of p.channels) {
      if (!shape(c, ['id', 'categoryId', 'position'])) return null;
      const id = uuid(c.id);
      const categoryId = c.categoryId === null ? null : uuid(c.categoryId);
      if (!id || (c.categoryId !== null && !categoryId) || !pos(c.position)) return null;
      channels.push({ id, categoryId, position: c.position });
    }
    if (new Set(channels.map((c) => c.id)).size !== channels.length) return null;
    const out = { serverId, channels };
    if (p.categories !== undefined && p.categories !== null) {
      if (!Array.isArray(p.categories) || p.categories.length > MAX_LAYOUT) return null;
      const categories = [];
      for (const c of p.categories) {
        if (!shape(c, ['id', 'position'])) return null;
        const id = uuid(c.id);
        if (!id || !pos(c.position)) return null;
        categories.push({ id, position: c.position });
      }
      if (new Set(categories.map((c) => c.id)).size !== categories.length) return null;
      out.categories = categories;
    }
    return out;
  },
  voiceMove(p) {
    if (!shape(p, ['serverId', 'userId', 'channelId'])) return null;
    const serverId = uuid(p.serverId);
    const userId = uuid(p.userId);
    const channelId = uuid(p.channelId);
    return serverId && userId && channelId ? { serverId, userId, channelId } : null;
  },
  serverCreate(p) {
    if (!shape(p, ['name'], ['iconColor']) || !str(p.name, 200)) return null;
    if (p.iconColor !== undefined && !(Number.isInteger(p.iconColor) && p.iconColor >= 0 && p.iconColor <= 7)) return null;
    return { name: p.name, iconColor: p.iconColor ?? 0 };
  },
  code(p) {
    if (!shape(p, ['code']) || !str(p.code, 64)) return null;
    const code = p.code.trim().toUpperCase();
    return INVITE_RE.test(code) ? { code } : null;
  },
  serverId(p) {
    if (!shape(p, ['serverId'])) return null;
    const serverId = uuid(p.serverId);
    return serverId ? { serverId } : null;
  },
  serverUpdate(p) {
    if (!shape(p, ['serverId'], ['name', 'iconColor'])) return null;
    const serverId = uuid(p.serverId);
    if (!serverId || (p.name === undefined && p.iconColor === undefined)) return null;
    const out = { serverId };
    if (p.name !== undefined) { if (!str(p.name, 200)) return null; out.name = p.name; }
    if (p.iconColor !== undefined) {
      if (!(Number.isInteger(p.iconColor) && p.iconColor >= 0 && p.iconColor <= 7)) return null;
      out.iconColor = p.iconColor;
    }
    return out;
  },
  serverIcon(p) {
    if (!isPlainObject(p)) return null;
    const { serverId, ...file } = p;
    const sid = uuid(serverId);
    const f = uploadOk(file, IMAGE_MAX);
    return sid && f ? { serverId: sid, ...f } : null;
  },
  inviteCreate(p) {
    if (!shape(p, ['serverId'], ['maxAgeSeconds', 'maxUses'])) return null;
    const serverId = uuid(p.serverId);
    const maxAgeSeconds = p.maxAgeSeconds === undefined ? null : p.maxAgeSeconds;
    const maxUses = p.maxUses === undefined ? null : p.maxUses;
    if (!serverId || !MAX_AGES.includes(maxAgeSeconds) || !MAX_USES.includes(maxUses)) return null;
    return { serverId, maxAgeSeconds, maxUses };
  },
  member(p) {
    if (!shape(p, ['serverId', 'userId'])) return null;
    const serverId = uuid(p.serverId);
    const userId = uuid(p.userId);
    return serverId && userId ? { serverId, userId } : null;
  },
  memberRole(p) {
    if (!shape(p, ['serverId', 'userId', 'role']) || !['admin', 'member'].includes(p.role)) return null;
    const serverId = uuid(p.serverId);
    const userId = uuid(p.userId);
    return serverId && userId ? { serverId, userId, role: p.role } : null;
  },
  nickname(p) {
    if (!shape(p, ['serverId', 'nickname'])) return null;
    const serverId = uuid(p.serverId);
    if (!serverId || (p.nickname !== null && !str(p.nickname, 64))) return null;
    return { serverId, nickname: p.nickname };
  },
  categoryCreate(p) {
    if (!shape(p, ['serverId', 'name']) || !str(p.name, 64)) return null;
    const serverId = uuid(p.serverId);
    return serverId ? { serverId, name: p.name } : null;
  },
  categoryUpdate(p) {
    if (!shape(p, ['categoryId'], ['name', 'position'])) return null;
    const categoryId = uuid(p.categoryId);
    if (!categoryId || (p.name === undefined && p.position === undefined)) return null;
    const out = { categoryId };
    if (p.name !== undefined) { if (!str(p.name, 64)) return null; out.name = p.name; }
    if (p.position !== undefined) { if (!(Number.isInteger(p.position) && p.position >= 0 && p.position <= 1000)) return null; out.position = p.position; }
    return out;
  },
  categoryId(p) {
    if (!shape(p, ['categoryId'])) return null;
    const categoryId = uuid(p.categoryId);
    return categoryId ? { categoryId } : null;
  },
  channelCreate(p) {
    if (!shape(p, ['serverId', 'kind', 'name'], ['categoryId'])) return null;
    const serverId = uuid(p.serverId);
    if (!serverId || !['text', 'voice'].includes(p.kind) || !str(p.name, 64)) return null;
    let categoryId = null;
    if (p.categoryId !== undefined && p.categoryId !== null) { categoryId = uuid(p.categoryId); if (!categoryId) return null; }
    return { serverId, kind: p.kind, name: p.name, categoryId };
  },
  channelUpdate(p) {
    if (!shape(p, ['channelId'], ['name', 'topic', 'categoryId', 'position'])) return null;
    const channelId = uuid(p.channelId);
    if (!channelId || Object.keys(p).length < 2) return null;
    const out = { channelId };
    if (p.name !== undefined) { if (!str(p.name, 64)) return null; out.name = p.name; }
    if (p.topic !== undefined) { if (p.topic !== null && !str(p.topic, 1100)) return null; out.topic = p.topic; }
    if (p.categoryId !== undefined) {
      if (p.categoryId === null) out.categoryId = null;
      else { const c = uuid(p.categoryId); if (!c) return null; out.categoryId = c; }
    }
    if (p.position !== undefined) { if (!(Number.isInteger(p.position) && p.position >= 0 && p.position <= 1000)) return null; out.position = p.position; }
    return out;
  },
  channelId(p) {
    if (!shape(p, ['channelId'])) return null;
    const channelId = uuid(p.channelId);
    return channelId ? { channelId } : null;
  },
  send(p) {
    if (!shape(p, [], ['body', 'replyTo', 'attachments'])) return null;
    const out = { body: '' };
    if (p.body !== undefined) { if (!str(p.body, 8000)) return null; out.body = p.body; }
    if (p.replyTo !== undefined && p.replyTo !== null) { const r = msgId(p.replyTo); if (!r) return null; out.replyTo = r; }
    if (p.attachments !== undefined) {
      if (!Array.isArray(p.attachments) || p.attachments.length > MAX_ATTACHMENTS) return null;
      const list = p.attachments.map((f) => uploadOk(f, ATTACHMENT_MAX));
      if (list.some((f) => !f)) return null;
      out.attachments = list;
    }
    if (!out.body.trim() && !(out.attachments && out.attachments.length)) return null;
    return out;
  },
  edit(p) {
    if (!shape(p, ['id', 'body']) || !msgId(p.id) || !str(p.body, 8000)) return null;
    return { id: p.id, body: p.body };
  },
  msgId(p) {
    return shape(p, ['id']) && msgId(p.id) ? { id: p.id } : null;
  },
  anyMsgId(p) {
    return shape(p, ['id']) && Number.isSafeInteger(p.id) && p.id !== 0 ? { id: p.id } : null;
  },
  /** Mensagem pendente/falha: id negativo (ou positivo, para apagar uma já enviada). */
  pendingId(p) {
    return shape(p, ['id']) && Number.isSafeInteger(p.id) && p.id < 0 ? { id: p.id } : null;
  },
  reaction(p) {
    if (!shape(p, ['id', 'emoji']) || !msgId(p.id) || !str(p.emoji, 64) || !p.emoji.trim()) return null;
    return { id: p.id, emoji: p.emoji };
  },
  pin(p) {
    if (!shape(p, ['id', 'pinned']) || !msgId(p.id) || typeof p.pinned !== 'boolean') return null;
    return { id: p.id, pinned: p.pinned };
  },
  url(p) {
    return shape(p, ['url']) && str(p.url, 2048) ? { url: p.url } : null;
  },
  prefs(p) {
    if (!isPlainObject(p) || Object.keys(p).length === 0) return null;
    const sections = ['notifications', 'muted', 'voice', 'appearance'];
    for (const [k, v] of Object.entries(p)) {
      if (!sections.includes(k)) return null;
      if (k === 'muted') {
        if (!Array.isArray(v) || v.length > 500 || !v.every((t) => str(t, 60))) return null;
      } else {
        if (!isPlainObject(v) || Object.keys(v).length > 20) return null;
        for (const x of Object.values(v)) {
          if (!(typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x)) || str(x, 200))) return null;
        }
      }
    }
    return JSON.parse(JSON.stringify(p));
  },
  mute(p) {
    if (!shape(p, ['target', 'muted']) || typeof p.muted !== 'boolean' || !str(p.target, 60) || !TARGET_RE.test(p.target)) return null;
    return { target: p.target.toLowerCase(), muted: p.muted };
  },
  target(p) {
    if (!shape(p, ['target']) || !str(p.target, 60) || !TARGET_RE.test(p.target)) return null;
    return { target: p.target.toLowerCase() };
  },
  voiceTarget(p) {
    if (shape(p, ['channelId'])) { const c = uuid(p.channelId); return c ? { channelId: c } : null; }
    if (shape(p, ['dmId'])) { const d = uuid(p.dmId); return d ? { dmId: d } : null; }
    return null;
  },
  voiceState(p) {
    if (!shape(p, [], ['channelId', 'dmId', 'muted', 'deafened', 'streaming', 'video'])) return null;
    const out = { channelId: null, dmId: null };
    for (const k of ['channelId', 'dmId']) {
      if (p[k] !== undefined && p[k] !== null) { const v = uuid(p[k]); if (!v) return null; out[k] = v; }
    }
    if (out.channelId && out.dmId) return null;
    for (const k of ['muted', 'deafened', 'streaming', 'video']) {
      if (p[k] !== undefined && typeof p[k] !== 'boolean') return null;
      out[k] = p[k] === true;
    }
    return out;
  },
};

/**
 * Tabela das ações novas. `method` = nome no window.ghostRank; `view: true` devolve a View inteira;
 * caso contrário `raw(resultado)` vira `{ ok: true, ...objeto }`.
 */
const API = Object.freeze([
  { method: 'select', channel: 'gr:nav:select', validate: V.select, run: (a, d) => a.select(d), view: true },
  // Social
  { method: 'searchUsers', channel: 'gr:social:search', validate: V.query, run: (a, d) => a.searchUsers(d.query), raw: (users) => ({ users }) },
  { method: 'sendFriendRequest', channel: 'gr:social:request', validate: V.username, run: (a, d) => a.sendFriendRequest(d.username), raw: (result, view) => ({ result, view }) },
  { method: 'acceptFriend', channel: 'gr:social:accept', validate: V.userId, run: (a, d) => a.acceptFriend(d.userId), view: true },
  { method: 'declineFriend', channel: 'gr:social:decline', validate: V.userId, run: (a, d) => a.declineFriend(d.userId), view: true },
  { method: 'removeFriend', channel: 'gr:social:remove', validate: V.userId, run: (a, d) => a.removeFriend(d.userId), view: true },
  { method: 'blockUser', channel: 'gr:social:block', validate: V.userId, run: (a, d) => a.blockUser(d.userId), view: true },
  { method: 'unblockUser', channel: 'gr:social:unblock', validate: V.userId, run: (a, d) => a.unblockUser(d.userId), view: true },
  { method: 'openDm', channel: 'gr:social:openDm', validate: V.userId, run: (a, d) => a.openDm(d.userId), view: true },
  { method: 'setStatus', channel: 'gr:social:status', validate: V.status, run: (a, d) => a.setStatus(d.status), view: true },
  { method: 'setCustomStatus', channel: 'gr:social:customStatus', validate: V.customStatus, run: (a, d) => a.setCustomStatus(d.text), view: true },
  { method: 'uploadAvatar', channel: 'gr:social:avatar', validate: V.profileMedia, run: (a, d) => a.uploadAvatar(d), view: true },
  { method: 'removeAvatar', channel: 'gr:social:avatarRemove', validate: V.none, run: (a) => a.removeAvatar(), view: true },
  // Etapa 7: personalização do perfil
  { method: 'uploadBanner', channel: 'gr:look:banner', validate: V.profileMedia, run: (a, d) => a.uploadBanner(d), view: true },
  { method: 'removeBanner', channel: 'gr:look:bannerRemove', validate: V.none, run: (a) => a.removeBanner(), view: true },
  { method: 'updateProfileLook', channel: 'gr:look:update', validate: V.look, run: (a, d) => a.updateProfileLook(d), view: true },
  { method: 'resetProfileLook', channel: 'gr:look:reset', validate: V.none, run: (a) => a.resetProfileLook(), view: true },
  // Servidores
  { method: 'createServer', channel: 'gr:server:create', validate: V.serverCreate, run: (a, d) => a.createServer(d), view: true },
  { method: 'previewInvite', channel: 'gr:server:preview', validate: V.code, run: (a, d) => a.previewInvite(d.code), raw: (invite) => ({ invite }) },
  { method: 'joinServer', channel: 'gr:server:join', validate: V.code, run: (a, d) => a.joinServer(d.code), view: true },
  { method: 'leaveServer', channel: 'gr:server:leave', validate: V.serverId, run: (a, d) => a.leaveServer(d.serverId), view: true },
  { method: 'deleteServer', channel: 'gr:server:delete', validate: V.serverId, run: (a, d) => a.deleteServer(d.serverId), view: true },
  { method: 'updateServer', channel: 'gr:server:update', validate: V.serverUpdate, run: (a, d) => a.updateServer(d), view: true },
  { method: 'uploadServerIcon', channel: 'gr:server:icon', validate: V.serverIcon, run: (a, d) => a.uploadServerIcon(d), view: true },
  { method: 'createInvite', channel: 'gr:server:invite', validate: V.inviteCreate, run: (a, d) => a.createInvite(d), raw: (invite) => ({ invite }) },
  { method: 'listInvites', channel: 'gr:server:invites', validate: V.serverId, run: (a, d) => a.listInvites(d.serverId), raw: (invites) => ({ invites }) },
  { method: 'revokeInvite', channel: 'gr:server:revokeInvite', validate: V.code, run: (a, d) => a.revokeInvite(d.code), view: true },
  { method: 'setMemberRole', channel: 'gr:server:role', validate: V.memberRole, run: (a, d) => a.setMemberRole(d), view: true },
  { method: 'transferOwnership', channel: 'gr:server:transfer', validate: V.member, run: (a, d) => a.transferOwnership(d), view: true },
  { method: 'kickMember', channel: 'gr:server:kick', validate: V.member, run: (a, d) => a.kickMember(d), view: true },
  { method: 'banMember', channel: 'gr:server:ban', validate: V.member, run: (a, d) => a.banMember(d), view: true },
  { method: 'unbanMember', channel: 'gr:server:unban', validate: V.member, run: (a, d) => a.unbanMember(d), view: true },
  { method: 'listBans', channel: 'gr:server:bans', validate: V.serverId, run: (a, d) => a.listBans(d.serverId), raw: (bans) => ({ bans }) },
  { method: 'setNickname', channel: 'gr:server:nickname', validate: V.nickname, run: (a, d) => a.setNickname(d), view: true },
  // Canais
  { method: 'createCategory', channel: 'gr:channel:createCategory', validate: V.categoryCreate, run: (a, d) => a.createCategory(d), view: true },
  { method: 'updateCategory', channel: 'gr:channel:updateCategory', validate: V.categoryUpdate, run: (a, d) => a.updateCategory(d), view: true },
  { method: 'deleteCategory', channel: 'gr:channel:deleteCategory', validate: V.categoryId, run: (a, d) => a.deleteCategory(d.categoryId), view: true },
  { method: 'createChannel', channel: 'gr:channel:create', validate: V.channelCreate, run: (a, d) => a.createChannel(d), view: true },
  { method: 'updateChannel', channel: 'gr:channel:update', validate: V.channelUpdate, run: (a, d) => a.updateChannel(d), view: true },
  { method: 'reorderChannels', channel: 'gr:channel:reorder', validate: V.reorder, run: (a, d) => a.reorderChannels(d), view: true },
  { method: 'moveVoiceMember', channel: 'gr:voice:move', validate: V.voiceMove, run: (a, d) => a.moveVoiceMember(d), view: true },
  { method: 'deleteChannel', channel: 'gr:channel:delete', validate: V.channelId, run: (a, d) => a.deleteChannel(d.channelId), view: true },
  // Mensagens
  { method: 'sendMessageV2', channel: 'gr:msg:send', validate: V.send, run: (a, d) => a.sendMessage(d), view: true },
  { method: 'retryMessage', channel: 'gr:msg:retry', validate: V.pendingId, run: (a, d) => a.retryMessage(d.id), view: true },
  { method: 'editMessage', channel: 'gr:msg:edit', validate: V.edit, run: (a, d) => a.editMessage(d), view: true },
  { method: 'deleteMessage', channel: 'gr:msg:delete', validate: V.anyMsgId, run: (a, d) => a.deleteMessage(d.id), view: true },
  { method: 'toggleReaction', channel: 'gr:msg:react', validate: V.reaction, run: (a, d) => a.toggleReaction(d), view: true },
  { method: 'pinMessage', channel: 'gr:msg:pin', validate: V.pin, run: (a, d) => a.pinMessage(d), view: true },
  { method: 'listPinned', channel: 'gr:msg:pinned', validate: V.none, run: (a) => a.listPinned(), raw: (items) => ({ items }) },
  { method: 'loadOlder', channel: 'gr:msg:older', validate: V.none, run: (a) => a.loadOlder(), view: true },
  { method: 'markRead', channel: 'gr:msg:read', validate: V.none, run: (a) => a.markRead(), view: true },
  { method: 'markTargetRead', channel: 'gr:msg:readTarget', validate: V.target, run: (a, d) => a.markTargetRead(d.target), view: true },
  { method: 'searchMessages', channel: 'gr:msg:search', validate: V.query, run: (a, d) => a.searchMessages(d.query), raw: (items) => ({ items }) },
  { method: 'setTyping', channel: 'gr:msg:typing', validate: V.none, run: (a) => a.setTyping(), raw: () => ({}) },
  { method: 'openExternal', channel: 'gr:app:openExternal', validate: V.url, run: (a, d) => a.openExternal(d.url), raw: () => ({}) },
  // Preferências
  { method: 'updatePrefs', channel: 'gr:prefs:update', validate: V.prefs, run: (a, d) => a.updatePrefs(d), view: true },
  { method: 'muteTarget', channel: 'gr:prefs:mute', validate: V.mute, run: (a, d) => a.muteTarget(d), view: true },
  // Voz
  { method: 'voiceTokenFor', channel: 'gr:voice:tokenFor', validate: V.voiceTarget, run: (a, d) => a.voiceToken(d), raw: (r) => ({ url: r.url, token: r.token }) },
  { method: 'setVoiceState', channel: 'gr:voice:state', validate: V.voiceState, run: (a, d) => a.setVoiceState(d), raw: () => ({}) },
]);

const API_CHANNELS = Object.freeze(Object.fromEntries(API.map((e) => [e.method, e.channel])));

function errorMessage(err) {
  if (err && err.name === 'UserInputError' && typeof err.message === 'string') return err.message;
  return GENERIC_ERROR;
}

/** Chamada segura: valida, executa e devolve { ok, ... } sem vazar erro interno. */
function wrapCall(entry, app, getView) {
  return async (payload) => {
    const clean = entry.validate(payload);
    if (clean === null) return { ok: false, error: INVALID_ERROR };
    try {
      if (!app) throw new UserInputError('Contas indisponíveis neste computador.');
      const result = await entry.run(app, clean);
      if (entry.view) return { ok: true, view: getView() };
      const out = entry.raw(result, getView());
      return { ...(isPlainObject(out) ? out : {}), ok: true };
    } catch (err) {
      if (!(err && err.name === 'UserInputError')) {
        console.error('[api] erro inesperado:', err && err.name ? err.name : 'Error');
      }
      return { ok: false, error: errorMessage(err) };
    }
  };
}

/** { canal: async (payload) => resultado } para todas as ações novas. */
function buildApiCalls(app, getView) {
  const out = {};
  for (const e of API) out[e.channel] = wrapCall(e, app, getView);
  return out;
}

module.exports = { API, API_CHANNELS, V, buildApiCalls, wrapCall, isPlainObject, INVALID_ERROR, GENERIC_ERROR };
