'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  decidePermissionRequest, decidePermissionCheck, createScreenPicker, createDisplayMediaHandler, isAllowedExternalUrl,
} = require('../../src/main/security');

const APP = 'app://ghost-rank/index.html';

test('pedido de permissão: microfone só áudio e só do app; display-capture liberado; resto negado', () => {
  assert.equal(decidePermissionRequest('media', { requestingUrl: APP, mediaTypes: ['audio'] }), true);
  assert.equal(decidePermissionRequest('media', { requestingUrl: APP, mediaTypes: ['video'] }), false);
  assert.equal(decidePermissionRequest('media', { requestingUrl: APP, mediaTypes: ['audio', 'video'] }), false);
  assert.equal(decidePermissionRequest('media', { requestingUrl: APP, mediaTypes: [] }), false);
  assert.equal(decidePermissionRequest('media', { requestingUrl: APP }), false);
  assert.equal(decidePermissionRequest('display-capture', { requestingUrl: APP }), true);
  for (const p of ['geolocation', 'notifications', 'camera', 'clipboard-read', 'openExternal', 'midi', 'hid', 'usb']) {
    assert.equal(decidePermissionRequest(p, { requestingUrl: APP, mediaTypes: ['audio'] }), false, p);
  }
  for (const url of ['https://evil.com/', 'app://ghost-rank.evil/x', 'file:///x', undefined]) {
    assert.equal(decidePermissionRequest('media', { requestingUrl: url, mediaTypes: ['audio'] }), false, String(url));
    assert.equal(decidePermissionRequest('display-capture', { requestingUrl: url }), false, String(url));
  }
  assert.equal(decidePermissionRequest('media', null), false);
});

test('verificação de permissão coerente', () => {
  assert.equal(decidePermissionCheck('media', 'app://ghost-rank', { mediaType: 'audio' }), true);
  assert.equal(decidePermissionCheck('media', 'app://ghost-rank/', { mediaType: 'audio' }), true);
  assert.equal(decidePermissionCheck('media', 'app://ghost-rank', { mediaType: 'video' }), false);
  assert.equal(decidePermissionCheck('media', 'app://ghost-rank', {}), false);
  assert.equal(decidePermissionCheck('display-capture', 'app://ghost-rank', {}), true);
  assert.equal(decidePermissionCheck('media', 'https://evil.com', { mediaType: 'audio' }), false);
  assert.equal(decidePermissionCheck('geolocation', 'app://ghost-rank', {}), false);
  assert.equal(decidePermissionCheck('media', '', { securityOrigin: 'app://ghost-rank', mediaType: 'audio' }), true);
});

test('steamcommunity.com na allowlist de links externos', () => {
  assert.equal(isAllowedExternalUrl('https://steamcommunity.com/openid/login?a=1'), true);
});

function fakeCapturer() {
  const img = (bytes) => ({ isEmpty: () => bytes === 0, toJPEG: () => Buffer.alloc(bytes, 1) });
  const sources = [
    { id: 'screen:0:0', name: 'Tela 1', thumbnail: img(10) },
    { id: 'window:123:0', name: 'Dota 2', thumbnail: img(10) },
    { id: 'window:999:0', name: 'Vazia', thumbnail: img(0) },
  ];
  const c = { calls: [], sources };
  c.getSources = async (opts) => { c.calls.push(opts); return c.sources; };
  return c;
}

test('listSources: id, nome, tipo e miniatura jpeg (dataURL)', async () => {
  const cap = fakeCapturer();
  const picker = createScreenPicker({ desktopCapturer: cap });
  const list = await picker.listSources();
  assert.deepEqual(cap.calls[0].types, ['screen', 'window']);
  assert.ok(cap.calls[0].thumbnailSize.width <= 400);
  assert.deepEqual(list.map((s) => [s.id, s.name, s.kind]), [
    ['screen:0:0', 'Tela 1', 'screen'], ['window:123:0', 'Dota 2', 'window'], ['window:999:0', 'Vazia', 'window'],
  ]);
  assert.match(list[0].thumbnail, /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/);
  assert.equal(list[2].thumbnail, null);
});

test('pick: só ids da última lista; escolha expira em 10 s e vale uma vez', async () => {
  let t = 1000;
  const picker = createScreenPicker({ desktopCapturer: fakeCapturer(), now: () => t });
  assert.equal(picker.pick('screen:0:0'), false); // antes de listar
  await picker.listSources();
  assert.equal(picker.pick('screen:9:9'), false);
  assert.equal(picker.pick(5), false);
  assert.equal(picker.pick('screen:0:0'), true);
  assert.equal(picker.take(), 'screen:0:0');
  assert.equal(picker.take(), null);
  picker.pick('window:123:0');
  t += 10_001;
  assert.equal(picker.take(), null);
});

test('handler de display media: entrega a fonte escolhida; loopback só no Windows; sem escolha nega', async () => {
  const run = async (platform, { pick = 'window:123:0', origin = 'app://ghost-rank' } = {}) => {
    const cap = fakeCapturer();
    const picker = createScreenPicker({ desktopCapturer: cap });
    await picker.listSources();
    if (pick) picker.pick(pick);
    const handler = createDisplayMediaHandler({ picker, desktopCapturer: cap, platform });
    return new Promise((resolve) => handler({ securityOrigin: origin, frame: { url: origin + '/index.html' } }, resolve));
  };
  const win = await run('win32');
  assert.equal(win.video.id, 'window:123:0');
  assert.equal(win.audio, 'loopback');
  const mac = await run('darwin');
  assert.equal(mac.video.id, 'window:123:0');
  assert.equal('audio' in mac, false);
  const linux = await run('linux');
  assert.equal('audio' in linux, false);
  assert.deepEqual(await run('win32', { pick: null }), {});
  assert.deepEqual(await run('win32', { origin: 'https://evil.com' }), {});
});

test('handler de display media: fonte que sumiu ou erro do capturer nega', async () => {
  const cap = fakeCapturer();
  const picker = createScreenPicker({ desktopCapturer: cap });
  await picker.listSources();
  picker.pick('window:123:0');
  cap.sources = [];
  const h = createDisplayMediaHandler({ picker, desktopCapturer: cap, platform: 'win32' });
  assert.deepEqual(await new Promise((r) => h({ securityOrigin: 'app://ghost-rank' }, r)), {});
  const broken = { getSources: async () => { throw new Error('x'); } };
  const p2 = createScreenPicker({ desktopCapturer: cap });
  cap.sources = [{ id: 'screen:0:0', name: 'T', thumbnail: null }];
  await p2.listSources();
  p2.pick('screen:0:0');
  const h2 = createDisplayMediaHandler({ picker: p2, desktopCapturer: broken, platform: 'win32' });
  assert.deepEqual(await new Promise((r) => h2({ securityOrigin: 'app://ghost-rank' }, r)), {});
});
