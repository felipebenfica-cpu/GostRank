'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../../src/core/credentials');

test('validateEmail normaliza e valida', () => {
  assert.deepEqual(c.validateEmail('  Ana@Example.COM '), { ok: true, value: 'ana@example.com' });
  for (const bad of ['', 'sem-arroba', 'a@b', 'a b@c.com', 'a@@c.com', 'a@c..com', '<x>@c.com', 'a@c.com.', 5, null, undefined]) {
    const r = c.validateEmail(bad);
    assert.equal(r.ok, false, String(bad));
    assert.equal(typeof r.error, 'string');
  }
  assert.equal(c.validateEmail('a'.repeat(250) + '@x.com').ok, false);
  assert.equal(c.validateEmail('a\u0000b@x.com').ok, false);
});

test('validatePassword: 10 a 72, repetição e senhas comuns', () => {
  assert.equal(c.validatePassword('Segredo!Forte9').ok, true);
  assert.equal(c.validatePassword('curta').ok, false);
  assert.match(c.validatePassword('curta').error, /10 caracteres/);
  assert.equal(c.validatePassword('a'.repeat(10)).ok, false);
  assert.equal(c.validatePassword('a'.repeat(72)).ok, false); // repetição
  assert.equal(c.validatePassword('ab'.repeat(36)).ok, true);
  assert.equal(c.validatePassword('ab'.repeat(37)).ok, false);
  assert.equal(c.validatePassword('1234567890').ok, false);
  assert.equal(c.validatePassword('PASSWORD123').ok, false);
  assert.equal(c.validatePassword(12345678901).ok, false);
});

test('validateDisplayName: 2 a 24, sem controle nem < >', () => {
  assert.deepEqual(c.validateDisplayName('  Fantasma '), { ok: true, value: 'Fantasma' });
  assert.equal(c.validateDisplayName('A').ok, false);
  assert.equal(c.validateDisplayName('a'.repeat(25)).ok, false);
  assert.equal(c.validateDisplayName('a'.repeat(24)).ok, true);
  assert.equal(c.validateDisplayName('<b>x</b>').ok, false);
  assert.equal(c.validateDisplayName('ab\ncd').ok, false);
  assert.equal(c.validateDisplayName('ab\u0007cd').ok, false);
  assert.equal(c.validateDisplayName(null).ok, false);
});

test('validateVisibility', () => {
  assert.deepEqual([...c.MMR_VISIBILITY], ['friends', 'group', 'nobody']);
  for (const v of c.MMR_VISIBILITY) assert.deepEqual(c.validateVisibility(v), { ok: true, value: v });
  assert.equal(c.validateVisibility('public').ok, false);
  assert.equal(c.validateVisibility(undefined).ok, false);
});
