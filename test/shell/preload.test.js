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
    'correctMmr', 'deleteAccount', 'getView', 'onUpdate', 'recover', 'reset', 'setup',
    'signIn', 'signOut', 'signUp', 'sync', 'updateProfile', 'updateSettings',
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
