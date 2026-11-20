'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateMmr, validateGain, validateGoal } = require('../../src/core/validate');

test('validateMmr aceita número e string numérica', () => {
  assert.deepEqual(validateMmr(5000), { ok: true, value: 5000 });
  assert.deepEqual(validateMmr('5000'), { ok: true, value: 5000 });
  assert.deepEqual(validateMmr(' 5000 '), { ok: true, value: 5000 });
  assert.deepEqual(validateMmr(0), { ok: true, value: 0 });
  assert.deepEqual(validateMmr(20000), { ok: true, value: 20000 });
});

test('validateMmr recusa fora do limite e formatos estranhos', () => {
  for (const v of [-1, 20001, '20001', '-1', 1.5, '1.5', '1e3', '0x10', '', ' ', 'abc', NaN, Infinity,
    null, undefined, {}, [], true, '5,5', '+5']) {
    const r = validateMmr(v);
    assert.equal(r.ok, false, String(v));
    assert.equal(typeof r.error, 'string');
    assert.equal(r.value, undefined);
  }
});

test('validateGain de 1 a 100', () => {
  assert.deepEqual(validateGain(25), { ok: true, value: 25 });
  assert.deepEqual(validateGain('1'), { ok: true, value: 1 });
  assert.deepEqual(validateGain(100), { ok: true, value: 100 });
  for (const v of [0, 101, '0', 25.5, 'x', NaN, null]) assert.equal(validateGain(v).ok, false);
});

test('validateGoal tem o mesmo formato de validateMmr', () => {
  assert.deepEqual(validateGoal('6000'), { ok: true, value: 6000 });
  assert.equal(validateGoal(20001).ok, false);
  assert.equal(validateGoal(-1).ok, false);
  assert.equal(validateGoal('1e3').ok, false);
});
