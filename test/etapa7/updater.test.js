'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdater, isNewer } = require('../../src/main/updater');

const noTimers = { setTimeout: () => 1, setInterval: () => 2, clearTimeout() {}, clearInterval() {} };

test('compara versões', () => {
  assert.equal(isNewer('v0.2.10', '0.2.9'), true);
  assert.equal(isNewer('0.2.9', '0.2.9'), false);
  assert.equal(isNewer('0.1.99', '0.2.0'), false);
  assert.equal(isNewer('teste-etapa-2', '0.2.0'), false);
});

test('fora do .exe (npm start) fica desligado', async () => {
  const u = createUpdater({ mode: 'off', timers: noTimers });
  assert.equal(u.getView(), null);
  assert.equal(u.install(), false);
});

test('instalado: baixa, mostra progresso e só instala quando pronto', async () => {
  const au = new EventEmitter();
  let installed = null;
  au.checkForUpdates = async () => { au.emit('checking-for-update'); au.emit('update-available', { version: '0.2.41' }); };
  au.quitAndInstall = (silent, run) => { installed = [silent, run]; };
  let changes = 0;
  const u = createUpdater({ mode: 'installed', autoUpdater: au, currentVersion: '0.2.40', onChange: () => changes++, timers: noTimers });
  assert.equal(au.autoDownload, true);
  assert.equal(au.autoInstallOnAppQuit, true);
  await u.check();
  assert.equal(u.getView().status, 'downloading');
  assert.equal(u.install(), false);
  au.emit('download-progress', { percent: 50 });
  assert.equal(u.getView().progress, 0.5);
  au.emit('update-downloaded', { version: '0.2.41' });
  assert.deepEqual([u.getView().status, u.getView().version], ['ready', '0.2.41']);
  au.emit('error', new Error('rede'));
  assert.equal(u.getView().status, 'ready', 'erro depois de pronto não apaga a atualização');
  assert.equal(u.install(), true);
  assert.deepEqual(installed, [true, true]);
  assert.ok(changes > 0);
});

test('instalado: erro de rede volta a ocioso sem travar', async () => {
  const au = new EventEmitter();
  au.checkForUpdates = async () => { au.emit('error', new Error('offline')); throw new Error('offline'); };
  au.quitAndInstall = () => {};
  const u = createUpdater({ mode: 'installed', autoUpdater: au, currentVersion: '0.2.40', timers: noTimers });
  await u.check();
  assert.equal(u.getView().status, 'idle');
});

test('portátil: acha versão nova no GitHub e abre o instalador', async () => {
  let opened = null;
  const fetchImpl = async (url) => {
    assert.match(url, /^https:\/\/api\.github\.com\/repos\/felipebenfica-cpu\/GostRank\/releases\/latest$/);
    return { ok: true, json: async () => ({
      tag_name: 'v0.2.41',
      assets: [
        { name: 'GhostRank-0.2.41.exe', browser_download_url: 'https://github.com/x/GhostRank-0.2.41.exe' },
        { name: 'LUMENEX-Setup-0.2.41.exe', browser_download_url: 'https://github.com/felipebenfica-cpu/GostRank/releases/download/v0.2.41/LUMENEX-Setup-0.2.41.exe' },
      ],
    }) };
  };
  const u = createUpdater({ mode: 'portable', currentVersion: '0.2.40', fetchImpl, openExternal: (x) => { opened = x; }, timers: noTimers });
  await u.check();
  assert.deepEqual([u.getView().status, u.getView().version], ['available', '0.2.41']);
  assert.equal(u.install(), true);
  assert.match(opened, /LUMENEX-Setup-0\.2\.41\.exe$/);
});

test('portátil: mesma versão ou link estranho não engana', async () => {
  const same = createUpdater({ mode: 'portable', currentVersion: '0.2.41', timers: noTimers,
    fetchImpl: async () => ({ ok: true, json: async () => ({ tag_name: 'v0.2.41', assets: [] }) }) });
  await same.check();
  assert.equal(same.getView().status, 'idle');
  let opened = null;
  const odd = createUpdater({ mode: 'portable', currentVersion: '0.2.1', timers: noTimers, openExternal: (x) => { opened = x; },
    fetchImpl: async () => ({ ok: true, json: async () => ({ tag_name: 'v0.2.5', assets: [{ name: 'LUMENEX-Setup-0.2.5.exe', browser_download_url: 'https://evil.example/x.exe' }] }) }) });
  await odd.check();
  odd.install();
  assert.equal(opened, 'https://github.com/felipebenfica-cpu/GostRank/releases/latest');
});
