'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(js|json|html|css)$/.test(ent.name)) out.push(p);
  }
  return out;
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

test('a chave service_role não aparece no código do app (fora de comentário/teste)', () => {
  const files = [...walk(path.join(ROOT, 'src')), path.join(ROOT, 'config.example.json')];
  assert.ok(files.length > 5);
  for (const f of files) {
    const code = stripComments(fs.readFileSync(f, 'utf8'));
    assert.ok(!/service_role/i.test(code), `service_role em ${path.relative(ROOT, f)}`);
  }
});

test('o processo principal nunca grava e-mail/senha/token em log (sem console.* nos módulos de conta)', () => {
  for (const f of ['core/credentials.js', 'main/config.js', 'main/auth.js', 'main/session.js', 'main/profile.js', 'main/account.js']) {
    const code = stripComments(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'));
    assert.ok(!/console\./.test(code), `console em ${f}`);
  }
});

test('stripComments realmente remove comentários (sanidade do teste)', () => {
  assert.ok(!/service_role/.test(stripComments('// service_role\nconst a = 1; /* service_role */')));
  assert.ok(/service_role/.test(stripComments("const k = 'service_role';")));
});
