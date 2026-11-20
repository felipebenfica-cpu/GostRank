'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  CSP, handleRequest, resolveVendorPath, vendorExists, LIVEKIT_VENDOR_PATH, LIVEKIT_VENDOR_FILE,
} = require('../../src/main/protocol');

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-proto-'));
  const root = path.join(dir, 'renderer');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html>');
  const vendorFile = path.join(dir, 'node_modules', 'livekit-client', 'dist', 'livekit-client.umd.js');
  return { dir, root, vendorFile, vendorFiles: { [LIVEKIT_VENDOR_PATH]: vendorFile } };
}

test('CSP nova: livekit em connect-src, media-src para blob/mediastream, resto fechado', () => {
  const parts = Object.fromEntries(CSP.split('; ').map((p) => { const [k, ...v] = p.split(' '); return [k, v.join(' ')]; }));
  assert.equal(parts['default-src'], "'none'");
  assert.equal(parts['script-src'], "'self'");
  assert.equal(parts['style-src'], "'self'");
  assert.equal(parts['img-src'], "'self' data:");
  assert.equal(parts['connect-src'], 'wss://*.livekit.cloud https://*.livekit.cloud');
  assert.equal(parts['media-src'], "'self' blob: mediastream:");
  assert.equal(parts['frame-ancestors'], "'none'");
  assert.equal(parts['base-uri'], "'none'");
  assert.doesNotMatch(CSP, /unsafe-inline|unsafe-eval|\*\s|https:\s|wss:\s/);
});

test('o caminho padrão do vendor aponta para node_modules/livekit-client/dist', () => {
  assert.ok(LIVEKIT_VENDOR_FILE.endsWith(path.join('node_modules', 'livekit-client', 'dist', 'livekit-client.umd.js')));
  assert.equal(LIVEKIT_VENDOR_PATH, '/vendor/livekit-client.umd.js');
});

test('rota vendor: 404 quando o arquivo não existe; 200 com CSP quando existe', async () => {
  const e = tmp();
  assert.equal(vendorExists(e.vendorFile), false);
  let r = await handleRequest('app://ghost-rank/vendor/livekit-client.umd.js', e.root, { vendorFiles: e.vendorFiles });
  assert.equal(r.status, 404);
  assert.equal(r.headers.get('Content-Security-Policy'), CSP);
  fs.mkdirSync(path.dirname(e.vendorFile), { recursive: true });
  fs.writeFileSync(e.vendorFile, 'window.LivekitClient={};');
  assert.equal(vendorExists(e.vendorFile), true);
  r = await handleRequest('app://ghost-rank/vendor/livekit-client.umd.js', e.root, { vendorFiles: e.vendorFiles });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'window.LivekitClient={};');
  assert.match(r.headers.get('Content-Type'), /text\/javascript/);
  assert.equal(r.headers.get('Content-Security-Policy'), CSP);
  assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
});

test('nenhum outro caminho de node_modules é servido (nem por traversal)', async () => {
  const e = tmp();
  fs.mkdirSync(path.dirname(e.vendorFile), { recursive: true });
  fs.writeFileSync(e.vendorFile, 'ok');
  fs.writeFileSync(path.join(path.dirname(e.vendorFile), 'livekit-client.esm.mjs'), 'segredo');
  fs.writeFileSync(path.join(e.dir, 'node_modules', 'livekit-client', 'package.json'), '{"x":1}');
  const bad = [
    'app://ghost-rank/vendor/livekit-client.esm.mjs',
    'app://ghost-rank/vendor/package.json',
    'app://ghost-rank/vendor/',
    'app://ghost-rank/vendor',
    'app://ghost-rank/vendor/../../node_modules/livekit-client/package.json',
    'app://ghost-rank/vendor/%2e%2e/%2e%2e/node_modules/livekit-client/package.json',
    'app://ghost-rank/vendor/..%2f..%2fnode_modules%2flivekit-client%2fpackage.json',
    'app://ghost-rank/vendor%2flivekit-client.umd.js',
    'app://ghost-rank/vendor/livekit-client.umd.js%00.js',
    'app://ghost-rank/vendor/LIVEKIT-CLIENT.UMD.JS',
    'app://ghost-rank/vendor/livekit-client.umd.js?x=1',
    'app://ghost-rank/node_modules/livekit-client/dist/livekit-client.umd.js',
    'app://ghost-rank/../node_modules/livekit-client/dist/livekit-client.umd.js',
    'app://ghost-rank/%2e%2e/node_modules/livekit-client/package.json',
  ];
  for (const u of bad) {
    const r = await handleRequest(u, e.root, { vendorFiles: e.vendorFiles });
    assert.notEqual(r.status, 200, u);
    const body = await r.text();
    assert.ok(!body.includes('segredo') && !body.includes('"x"'), u);
  }
});

test('resolveVendorPath só reconhece a rota exata', () => {
  const files = { [LIVEKIT_VENDOR_PATH]: '/x/livekit.js' };
  assert.deepEqual(resolveVendorPath('app://ghost-rank/vendor/livekit-client.umd.js', files), { ok: true, filePath: '/x/livekit.js', ext: '.js' });
  assert.equal(resolveVendorPath('app://ghost-rank/index.html', files), null);
  assert.deepEqual(resolveVendorPath('app://ghost-rank/vendor/outro.js', files), { ok: false, status: 404 });
  assert.equal(resolveVendorPath('app://outro/vendor/livekit-client.umd.js', files), null);
});

test('páginas normais continuam servidas com a CSP nova', async () => {
  const e = tmp();
  const r = await handleRequest('app://ghost-rank/', e.root, { vendorFiles: e.vendorFiles });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Content-Security-Policy'), CSP);
  const missing = await handleRequest('app://ghost-rank/nada.js', e.root, { vendorFiles: e.vendorFiles });
  assert.equal(missing.status, 404);
});
