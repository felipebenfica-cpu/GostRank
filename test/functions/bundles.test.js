'use strict';
// Os bundle.ts (para colar no painel) precisam estar em dia com index.ts + _shared.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const FN_DIR = path.join(__dirname, '..', '..', 'supabase', 'functions');
const { buildBundle, FUNCTIONS } = require(path.join(FN_DIR, 'build-bundles.js'));

test('bundle.ts em dia (rode: node supabase/functions/build-bundles.js)', () => {
  for (const fn of FUNCTIONS) {
    const file = path.join(FN_DIR, fn, 'bundle.ts');
    assert.ok(fs.existsSync(file), `${fn}/bundle.ts nao existe`);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), buildBundle(fn), `${fn}/bundle.ts desatualizado`);
  }
});

test('bundle.ts nao importa nada (arquivo unico)', () => {
  for (const fn of FUNCTIONS) {
    const src = fs.readFileSync(path.join(FN_DIR, fn, 'bundle.ts'), 'utf8');
    assert.doesNotMatch(src, /^\s*import\s/m, fn);
    assert.doesNotMatch(src, /\bimport\(/, fn);
    assert.match(src, /Deno\.serve\(/, fn);
  }
});

test('_shared: ES modules sem dependencias externas', () => {
  for (const f of fs.readdirSync(path.join(FN_DIR, '_shared'))) {
    const src = fs.readFileSync(path.join(FN_DIR, '_shared', f), 'utf8');
    assert.doesNotMatch(src, /^\s*import\s/m, f);
    assert.doesNotMatch(src, /require\(|process\.|Deno\./, f);
    assert.match(src, /^export /m, f);
  }
});

test('index.ts: chave service_role so lida do ambiente e nunca registrada em log', () => {
  for (const fn of FUNCTIONS) {
    const src = fs.readFileSync(path.join(FN_DIR, fn, 'index.ts'), 'utf8');
    assert.doesNotMatch(src, /console\./, fn);
    assert.match(src, /getUserFromToken\(/, fn);
    assert.doesNotMatch(src, /atob\(|split\('\.'\)/, `${fn} nao decodifica JWT sem verificar`);
  }
  const http = fs.readFileSync(path.join(FN_DIR, '_shared', 'http.js'), 'utf8');
  assert.doesNotMatch(http, /console\./);
  assert.match(http, /\/auth\/v1\/user/);
  assert.match(http, /getEnv\('SUPABASE_SERVICE_ROLE_KEY'\)/);
});
