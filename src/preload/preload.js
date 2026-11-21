'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const inv = (channel, payload) => ipcRenderer.invoke(channel, payload);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function listen(channel, cb) {
  if (typeof cb !== 'function') return () => {};
  const listener = (_event, data) => cb(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('ghostRank', {
  // Rastreador de MMR
  getView: () => inv('gr:getView'),
  setup: (data) => inv('gr:setup', data),
  sync: () => inv('gr:sync'),
  correctMmr: (mmr) => inv('gr:correctMmr', { mmr }),
  updateSettings: (data) => inv('gr:updateSettings', data),
  reset: () => inv('gr:reset', { confirm: true }),
  // Conta e perfil
  signUp: (data) => inv('gr:auth:signUp', data),
  signIn: (data) => inv('gr:auth:signIn', data),
  signOut: () => inv('gr:auth:signOut'),
  recover: (data) => inv('gr:auth:recover', data),
  updateProfile: (data) => inv('gr:profile:update', data),
  deleteAccount: () => inv('gr:account:delete', { confirm: true }),
  // Grupo antigo (aliases: no banco novo agem no servidor selecionado)
  createGroup: (name) => inv('gr:group:create', { name }),
  joinGroup: (code) => inv('gr:group:join', { code }),
  leaveGroup: () => inv('gr:group:leave', { confirm: true }),
  createInvite: (opts) => (isObj(opts) ? inv('gr:server:invite', opts) : inv('gr:group:invite', {})),
  removeMember: (userId) => inv('gr:group:remove', { userId }),
  refreshGroup: () => inv('gr:group:refresh', {}),
  sendMessage: (arg) => (isObj(arg) ? inv('gr:msg:send', arg) : inv('gr:chat:send', { body: arg })),
  // Navegação
  select: (sel) => inv('gr:nav:select', sel),
  // Amigos, DMs e perfil
  searchUsers: (query) => inv('gr:social:search', { query }),
  sendFriendRequest: (username) => inv('gr:social:request', { username }),
  acceptFriend: (userId) => inv('gr:social:accept', { userId }),
  declineFriend: (userId) => inv('gr:social:decline', { userId }),
  removeFriend: (userId) => inv('gr:social:remove', { userId }),
  blockUser: (userId) => inv('gr:social:block', { userId }),
  unblockUser: (userId) => inv('gr:social:unblock', { userId }),
  openDm: (userId) => inv('gr:social:openDm', { userId }),
  setStatus: (status) => inv('gr:social:status', { status }),
  setCustomStatus: (text) => inv('gr:social:customStatus', { text: text === undefined ? null : text }),
  uploadAvatar: (file) => inv('gr:social:avatar', file),
  removeAvatar: () => inv('gr:social:avatarRemove', {}),
  // Personalização do perfil (LUMENEX)
  uploadBanner: (file) => inv('gr:look:banner', file),
  removeBanner: () => inv('gr:look:bannerRemove', {}),
  updateProfileLook: (patch) => inv('gr:look:update', patch),
  resetProfileLook: () => inv('gr:look:reset', {}),
  // Servidores
  createServer: (data) => inv('gr:server:create', data),
  previewInvite: (code) => inv('gr:server:preview', { code }),
  joinServer: (code) => inv('gr:server:join', { code }),
  leaveServer: (serverId) => inv('gr:server:leave', { serverId }),
  deleteServer: (serverId) => inv('gr:server:delete', { serverId }),
  updateServer: (data) => inv('gr:server:update', data),
  uploadServerIcon: (data) => inv('gr:server:icon', data),
  listInvites: (serverId) => inv('gr:server:invites', { serverId }),
  revokeInvite: (code) => inv('gr:server:revokeInvite', { code }),
  setMemberRole: (data) => inv('gr:server:role', data),
  transferOwnership: (data) => inv('gr:server:transfer', data),
  kickMember: (data) => inv('gr:server:kick', data),
  banMember: (data) => inv('gr:server:ban', data),
  unbanMember: (data) => inv('gr:server:unban', data),
  listBans: (serverId) => inv('gr:server:bans', { serverId }),
  setNickname: (data) => inv('gr:server:nickname', data),
  // Canais
  createCategory: (data) => inv('gr:channel:createCategory', data),
  updateCategory: (data) => inv('gr:channel:updateCategory', data),
  deleteCategory: (categoryId) => inv('gr:channel:deleteCategory', { categoryId }),
  createChannel: (data) => inv('gr:channel:create', data),
  updateChannel: (data) => inv('gr:channel:update', data),
  deleteChannel: (channelId) => inv('gr:channel:delete', { channelId }),
  reorderChannels: (data) => inv('gr:channel:reorder', data),
  moveVoiceMember: (data) => inv('gr:voice:move', data),
  // Mensagens
  retryMessage: (id) => inv('gr:msg:retry', { id }),
  editMessage: (data) => inv('gr:msg:edit', data),
  deleteMessage: (id) => inv('gr:msg:delete', { id }),
  toggleReaction: (data) => inv('gr:msg:react', data),
  pinMessage: (data) => inv('gr:msg:pin', data),
  listPinned: () => inv('gr:msg:pinned', {}),
  loadOlder: () => inv('gr:msg:older', {}),
  markRead: () => inv('gr:msg:read', {}),
  markTargetRead: (target) => inv('gr:msg:readTarget', { target }),
  searchMessages: (query) => inv('gr:msg:search', { query }),
  setTyping: () => inv('gr:msg:typing', {}),
  openExternal: (url) => inv('gr:app:openExternal', { url }),
  // Preferências locais
  updatePrefs: (partial) => inv('gr:prefs:update', partial),
  muteTarget: (data) => inv('gr:prefs:mute', data),
  // Voz
  voiceToken: (target) => (isObj(target) && (target.channelId || target.dmId)
    ? inv('gr:voice:tokenFor', target) : inv('gr:voice:token', {})),
  setVoiceState: (state) => inv('gr:voice:state', state),
  listScreenSources: () => inv('gr:voice:listSources', {}),
  pickScreenSource: (sourceId) => inv('gr:voice:pickSource', { sourceId }),
  // Steam
  linkSteam: () => inv('gr:steam:link', {}),
  // Atualização do app (.exe)
  checkForUpdate: () => inv('gr:appUpdate:check', {}),
  installUpdate: () => inv('gr:appUpdate:install', {}),
  // Eventos
  onUpdate: (cb) => listen('gr:update', cb),
  onNotificationClick: (cb) => listen('gr:notificationClick', cb),
});
