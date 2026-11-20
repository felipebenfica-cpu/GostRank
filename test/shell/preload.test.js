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
    'correctMmr', 'createGroup', 'createInvite', 'deleteAccount', 'getView', 'joinGroup', 'leaveGroup',
    'linkSteam', 'listScreenSources', 'onUpdate', 'pickScreenSource', 'recover', 'refreshGroup', 'removeMember',
    'reset', 'sendMessage', 'setup', 'signIn', 'signOut', 'signUp', 'sync', 'updateProfile', 'updateSettings',
    'voiceToken',
  ]);
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
