'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('../../scripts/build-preview');

const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const PREVIEW = path.join(ROOT, 'preview');

function stripComments(js) {
  return js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const SCRIPTS = [
  path.join(RENDERER, 'app.js'),
  path.join(RENDERER, 'voice.js'),
  path.join(PREVIEW, 'mock-bridge.js'),
  path.join(PREVIEW, 'fake-livekit.js'),
];

test('preview/index.html está em dia com src/renderer/index.html', () => {
  const current = fs.readFileSync(path.join(PREVIEW, 'index.html'), 'utf8');
  assert.equal(current, build(), 'rode: node scripts/build-preview.js');
});

test('a tela não usa estilo inline, handlers inline nem innerHTML', () => {
  const html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /<style[\s>]/i);
  for (const file of SCRIPTS) {
    const js = stripComments(fs.readFileSync(file, 'utf8'));
    assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/, path.basename(file));
    assert.doesNotMatch(js, /setAttribute\(\s*['"](style|on[a-z]+)['"]/i, path.basename(file));
  }
});

test('a tela carrega o LiveKit local, a voz e o app nessa ordem', () => {
  const html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
  const vendor = html.indexOf('<script src="vendor/livekit-client.umd.js"></script>');
  const voice = html.indexOf('<script src="voice.js"></script>');
  const app = html.indexOf('<script src="app.js"></script>');
  assert.ok(vendor > 0 && vendor < voice && voice < app);
  assert.doesNotMatch(html, /<script[^>]+src="https?:/i, 'nada de CDN');
});

test('a prévia troca o LiveKit pelo falso local e não usa rede nem fontes externas', () => {
  const html = build();
  assert.match(html, /<script src="fake-livekit\.js"><\/script>/);
  assert.match(html, /<script src="\.\.\/src\/renderer\/voice\.js"><\/script>/);
  assert.doesNotMatch(html, /vendor\/livekit/);
  assert.match(html, /connect-src 'none'/);
  for (const file of [path.join(PREVIEW, 'mock-bridge.js'), path.join(PREVIEW, 'fake-livekit.js')]) {
    const js = stripComments(fs.readFileSync(file, 'utf8'));
    assert.doesNotMatch(js, /\bfetch\(|XMLHttpRequest|new WebSocket|EventSource|sendBeacon|importScripts/, path.basename(file));
  }
  const css = fs.readFileSync(path.join(RENDERER, 'styles.css'), 'utf8');
  assert.doesNotMatch(css, /@import|url\(\s*['"]?https?:/i);
});

test('miniaturas de tela só entram se forem data:image/', () => {
  const js = stripComments(fs.readFileSync(path.join(RENDERER, 'voice.js'), 'utf8'));
  assert.match(js, /indexOf\('data:image\/'\) === 0/);
  const assigns = js.match(/\.src\s*=/g) || [];
  assert.equal(assigns.length, 1, 'só um lugar define src (a miniatura validada)');
});
