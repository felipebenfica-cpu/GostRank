'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveRequestPath, CSP, SECURITY_HEADERS } = require('../../src/main/protocol');

const root = path.resolve('/tmp/renderer');

test('raiz serve index.html', () => {
  const r = resolveRequestPath('app://ghost-rank/', root);
  assert.equal(r.ok, true);
  assert.equal(r.filePath, path.join(root, 'index.html'));
});

test('arquivos permitidos', () => {
  for (const u of ['app://ghost-rank/app.js', 'app://ghost-rank/css/style.css', 'app://ghost-rank/img/a.svg']) {
    assert.equal(resolveRequestPath(u, root).ok, true, u);
  }
});

test('bloqueia path traversal', () => {
  const bad = [
    'app://ghost-rank/../package.json',
    'app://ghost-rank/%2e%2e/package.json',
    'app://ghost-rank/..%2fpackage.json',
    'app://ghost-rank/a/%2e%2e/%2e%2e/x.js',
    'app://ghost-rank/..%5cpackage.json',
    'app://ghost-rank/a%00.js',
    'app://ghost-rank/a\\..\\b.js',
    'app://ghost-rank//etc/passwd.js',
  ];
  for (const u of bad) {
    const r = resolveRequestPath(u, root);
    if (r.ok) assert.ok(r.filePath.startsWith(root + path.sep), u);
    else assert.ok([400, 403].includes(r.status), u);
  }
  assert.equal(resolveRequestPath('app://ghost-rank/..%2fpackage.json', root).ok, false);
  // O parser de URL normaliza %2e%2e para dentro da raiz; o resultado nunca escapa.
});

test('bloqueia extensões fora da lista', () => {
  for (const f of ['x.exe', 'x.node', 'x.php', 'x', 'x.html.bak', '.env']) {
    assert.equal(resolveRequestPath('app://ghost-rank/' + f, root).ok, false, f);
  }
});

test('bloqueia host e esquema errados', () => {
  assert.equal(resolveRequestPath('app://outro/index.html', root).ok, false);
  assert.equal(resolveRequestPath('https://ghost-rank/index.html', root).ok, false);
  assert.equal(resolveRequestPath('lixo', root).ok, false);
  assert.equal(resolveRequestPath(null, root).ok, false);
});

test('CSP e cabeçalhos', () => {
  assert.match(CSP, /default-src 'none'/);
  assert.match(CSP, /connect-src 'none'/);
  assert.match(CSP, /frame-ancestors 'none'/);
  assert.equal(SECURITY_HEADERS['X-Content-Type-Options'], 'nosniff');
  assert.equal(SECURITY_HEADERS['Referrer-Policy'], 'no-referrer');
});
