'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

function loadPreload() {
  const exposed = {};
  const invoked = [];
  const ipcRenderer = {
    invoke: (...a) => { invoked.push(a); return Promise.resolve({ ok: true }); },
    on() {}, removeListener() {},
  };
  const fakeElectron = {
    contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api; } },
    ipcRenderer,
  };
  const orig = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'electron') return fakeElectron;
    return orig.call(this, request, ...rest);
  };
  const file = path.join(__dirname, '..', '..', 'src', 'preload', 'preload.js');
  delete require.cache[file];
  try { require(file); } finally { Module._load = orig; delete require.cache[file]; }
  return { exposed, invoked };
}

test('preload expõe exatamente os métodos esperados e nada de ipcRenderer', () => {
  const { exposed } = loadPreload();
  assert.deepEqual(Object.keys(exposed), ['ghostRank']);
  assert.deepEqual(Object.keys(exposed.ghostRank).sort(), [
    'acceptFriend', 'banMember', 'blockUser', 'checkForUpdate', 'installUpdate', 'correctMmr', 'createCategory', 'createChannel', 'createGroup',
    'createInvite', 'createServer', 'declineFriend', 'deleteAccount', 'deleteCategory', 'deleteChannel',
    'deleteMessage', 'deleteServer', 'editMessage', 'getView', 'joinGroup', 'joinServer', 'kickMember',
    'leaveGroup', 'leaveServer', 'linkSteam', 'listBans', 'listInvites', 'listPinned', 'listScreenSources',
    'loadOlder', 'markRead', 'markTargetRead', 'muteTarget', 'onNotificationClick', 'onUpdate', 'openDm',
    'openExternal', 'pickScreenSource', 'pinMessage', 'previewInvite', 'recover', 'refreshGroup', 'removeAvatar',
    'uploadBanner', 'removeBanner', 'updateProfileLook', 'resetProfileLook', 'reorderChannels', 'moveVoiceMember',
    'removeFriend', 'removeMember', 'reset', 'retryMessage', 'revokeInvite', 'searchMessages', 'searchUsers',
    'select', 'sendFriendRequest', 'sendMessage', 'setCustomStatus', 'setMemberRole', 'setNickname', 'setStatus',
    'setTyping', 'setVoiceState', 'setup', 'signIn', 'signOut', 'signUp', 'sync', 'toggleReaction',
    'transferOwnership', 'unbanMember', 'unblockUser', 'updateCategory', 'updateChannel', 'updatePrefs',
    'updateProfile', 'updateServer', 'updateSettings', 'uploadAvatar', 'uploadServerIcon', 'voiceToken',
  ].sort());
  for (const v of Object.values(exposed.ghostRank)) assert.equal(typeof v, 'function');
});

test('métodos de conta chamam os canais certos; deleteAccount sempre envia confirm:true', async () => {
  const { exposed, invoked } = loadPreload();
  const g = exposed.ghostRank;
  await g.signUp({ email: 'a', password: 'b' });
  await g.signIn({ email: 'a', password: 'b' });
  await g.signOut();
  await g.recover({ email: 'a' });
  await g.updateProfile({ displayName: 'Ab' });
  await g.deleteAccount('ignorado');
  assert.deepEqual(invoked.map((i) => i[0]), [
    'gr:auth:signUp', 'gr:auth:signIn', 'gr:auth:signOut', 'gr:auth:recover', 'gr:profile:update', 'gr:account:delete',
  ]);
  assert.deepEqual(invoked[5][1], { confirm: true });
});

test('métodos de grupo, chat, voz e Steam chamam os canais do plano com o payload certo', async () => {
  const { exposed, invoked } = loadPreload();
  const g = exposed.ghostRank;
  await g.createGroup('Os Fantasmas');
  await g.joinGroup('ABCDEFGH23');
  await g.leaveGroup('ignorado');
  await g.createInvite('ignorado');
  await g.removeMember('0b8f1c52-3a4d-4e6f-9a1b-2c3d4e5f6a7b');
  await g.refreshGroup('ignorado');
  await g.sendMessage('oi');
  await g.voiceToken('ignorado');
  await g.listScreenSources('ignorado');
  await g.pickScreenSource('screen:0:0');
  await g.linkSteam('ignorado');
  assert.deepEqual(invoked, [
    ['gr:group:create', { name: 'Os Fantasmas' }],
    ['gr:group:join', { code: 'ABCDEFGH23' }],
    ['gr:group:leave', { confirm: true }],
    ['gr:group:invite', {}],
    ['gr:group:remove', { userId: '0b8f1c52-3a4d-4e6f-9a1b-2c3d4e5f6a7b' }],
    ['gr:group:refresh', {}],
    ['gr:chat:send', { body: 'oi' }],
    ['gr:voice:token', {}],
    ['gr:voice:listSources', {}],
    ['gr:voice:pickSource', { sourceId: 'screen:0:0' }],
    ['gr:steam:link', {}],
  ]);
});

test('todo canal usado pelo preload existe no ipc.js', () => {
  const { exposed, invoked } = loadPreload();
  const { CHANNELS } = require('../../src/main/ipc');
  for (const fn of Object.keys(exposed.ghostRank)) {
    if (fn !== 'onUpdate') exposed.ghostRank[fn]('x');
  }
  const known = new Set(Object.values(CHANNELS));
  for (const [ch] of invoked) assert.ok(known.has(ch), ch);
});

test('Etapa 6: todo canal usado pelo preload existe no main (CHANNELS) e os métodos duplos escolhem o canal certo', async () => {
  const { exposed, invoked } = loadPreload();
  const ipc = require('../../src/main/ipc');
  const g = exposed.ghostRank;
  const U = '0b8f1c52-3a4d-4e6f-9a1b-2c3d4e5f6a7b';
  const calls = [
    () => g.select({ mode: 'home' }), () => g.searchUsers('fan'), () => g.sendFriendRequest('fantasma'),
    () => g.acceptFriend(U), () => g.declineFriend(U), () => g.removeFriend(U), () => g.blockUser(U), () => g.unblockUser(U),
    () => g.openDm(U), () => g.setStatus('dnd'), () => g.setCustomStatus(), () => g.uploadAvatar({ name: 'a.png', mime: 'image/png', data: new ArrayBuffer(4) }),
    () => g.removeAvatar(), () => g.createServer({ name: 'Os Fantasmas' }), () => g.previewInvite('ABCDEFGH23'), () => g.joinServer('ABCDEFGH23'),
    () => g.leaveServer(U), () => g.deleteServer(U), () => g.updateServer({ serverId: U, name: 'X' }), () => g.uploadServerIcon({ serverId: U }),
    () => g.createInvite({ serverId: U }), () => g.listInvites(U), () => g.revokeInvite('ABCDEFGH23'), () => g.setMemberRole({}),
    () => g.transferOwnership({}), () => g.kickMember({}), () => g.banMember({}), () => g.unbanMember({}), () => g.listBans(U),
    () => g.setNickname({}), () => g.createCategory({}), () => g.updateCategory({}), () => g.deleteCategory(U), () => g.createChannel({}),
    () => g.updateChannel({}), () => g.deleteChannel(U), () => g.sendMessage({ body: 'oi' }), () => g.retryMessage(-1), () => g.editMessage({}),
    () => g.deleteMessage(1), () => g.toggleReaction({}), () => g.pinMessage({}), () => g.listPinned(), () => g.loadOlder(), () => g.markRead(),
    () => g.markTargetRead('c:' + U), () => g.searchMessages('x'), () => g.setTyping(), () => g.openExternal('https://a.b'),
    () => g.updatePrefs({}), () => g.muteTarget({}), () => g.voiceToken({ channelId: U }), () => g.setVoiceState({}),
  ];
  for (const c of calls) await c();
  const known = new Set(Object.values(ipc.CHANNELS));
  for (const [ch] of invoked) assert.ok(known.has(ch), ch);
  assert.deepEqual(invoked.find((i) => i[0] === 'gr:social:customStatus')[1], { text: null });
  invoked.length = 0;
  await g.sendMessage('oi');
  await g.createInvite();
  await g.voiceToken();
  await g.voiceToken({ dmId: U });
  assert.deepEqual(invoked.map((i) => i[0]), ['gr:chat:send', 'gr:group:invite', 'gr:voice:token', 'gr:voice:tokenFor']);
});
