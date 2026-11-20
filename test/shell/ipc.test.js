'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ipc = require('../../src/main/ipc');

const good = { senderFrame: { url: 'app://ghost-rank/index.html' } };
const bad = { senderFrame: { url: 'https://evil.com/' } };

test('validateSetupPayload', () => {
  const ok = { accountInput: '123', startMmr: '4000', goalMmr: 5000, gainPerMatch: 25 };
  assert.deepEqual(ipc.validateSetupPayload(ok), ok);
  assert.equal(ipc.validateSetupPayload({ ...ok, extra: 1 }), null);
  assert.equal(ipc.validateSetupPayload({ accountInput: '1' }), null);
  assert.equal(ipc.validateSetupPayload({ ...ok, accountInput: 5 }), null);
  assert.equal(ipc.validateSetupPayload({ ...ok, startMmr: {} }), null);
  assert.equal(ipc.validateSetupPayload({ ...ok, startMmr: NaN }), null);
  assert.equal(ipc.validateSetupPayload({ ...ok, accountInput: 'x'.repeat(201) }), null);
  assert.equal(ipc.validateSetupPayload(null), null);
  assert.equal(ipc.validateSetupPayload([]), null);
  assert.equal(ipc.validateSetupPayload('x'), null);
});

test('rejeita protótipos estranhos', () => {
  class Foo { constructor() { this.mmr = 1; } }
  assert.equal(ipc.validateCorrectPayload(new Foo()), null);
  const withProto = Object.create({ inherited: 1 });
  withProto.mmr = 5;
  assert.equal(ipc.validateCorrectPayload(withProto), null);
  assert.deepEqual(ipc.validateCorrectPayload(Object.create(null, { mmr: { value: 5, enumerable: true } })), { mmr: 5 });
  assert.equal(ipc.validateCorrectPayload(JSON.parse('{"__proto__":{"a":1},"mmr":1}')), null);
});

test('validateCorrectPayload', () => {
  assert.deepEqual(ipc.validateCorrectPayload({ mmr: 4100 }), { mmr: 4100 });
  assert.equal(ipc.validateCorrectPayload({ mmr: 1, x: 2 }), null);
  assert.equal(ipc.validateCorrectPayload({}), null);
});

test('validateSettingsPayload', () => {
  assert.deepEqual(ipc.validateSettingsPayload({ goalMmr: 5000 }), { goalMmr: 5000 });
  assert.deepEqual(ipc.validateSettingsPayload({ goalMmr: 5000, gainPerMatch: '30' }), { goalMmr: 5000, gainPerMatch: '30' });
  assert.equal(ipc.validateSettingsPayload({}), null);
  assert.equal(ipc.validateSettingsPayload({ goalMmr: 1, hack: 1 }), null);
});

test('validateResetPayload exige confirm true', () => {
  assert.deepEqual(ipc.validateResetPayload({ confirm: true }), { confirm: true });
  assert.equal(ipc.validateResetPayload({ confirm: 'true' }), null);
  assert.equal(ipc.validateResetPayload({}), null);
  assert.equal(ipc.validateResetPayload(undefined), null);
  assert.equal(ipc.validateResetPayload({ confirm: true, x: 1 }), null);
});

test('validateEmptyPayload', () => {
  assert.deepEqual(ipc.validateEmptyPayload(undefined), {});
  assert.equal(ipc.validateEmptyPayload({ a: 1 }), null);
});

test('wrapHandler: remetente', async () => {
  const h = ipc.wrapHandler(ipc.validateEmptyPayload, () => ({ v: 1 }));
  assert.deepEqual(await h(good), { ok: true, view: { v: 1 } });
  assert.equal((await h(bad)).ok, false);
  assert.equal((await h({})).ok, false);
  assert.equal((await h({ senderFrame: null })).ok, false);
});

test('wrapHandler: erros', async () => {
  class UserInputError extends Error { constructor(m) { super(m); this.name = 'UserInputError'; } }
  const h1 = ipc.wrapHandler(ipc.validateEmptyPayload, () => { throw new UserInputError('MMR inválido'); });
  assert.deepEqual(await h1(good), { ok: false, error: 'MMR inválido' });
  const origErr = console.error;
  console.error = () => {};
  try {
    const h2 = ipc.wrapHandler(ipc.validateEmptyPayload, () => { throw new Error('segredo C:\\x stack'); });
    const r = await h2(good);
    assert.equal(r.ok, false);
    assert.equal(r.error, ipc.GENERIC_ERROR);
    assert.ok(!JSON.stringify(r).includes('segredo'));
  } finally { console.error = origErr; }
});

test('buildHandlers cobre os canais e chama o controlador', async () => {
  const calls = [];
  const c = {
    getView: () => 'v', setup: (d) => { calls.push(['setup', d]); return 'v'; },
    sync: (o) => { calls.push(['sync', o]); return 'v'; },
    correctMmr: (d) => { calls.push(['c', d]); return 'v'; },
    updateSettings: (d) => { calls.push(['u', d]); return 'v'; },
    reset: () => { calls.push(['r']); return 'v'; },
  };
  const h = ipc.buildHandlers(c);
  assert.deepEqual(Object.keys(h).sort(), Object.values(ipc.CHANNELS).sort());
  await h['gr:sync'](good);
  assert.deepEqual(calls[0], ['sync', { manual: true }]);
  assert.equal((await h['gr:reset'](good, {})).ok, false);
  assert.equal((await h['gr:reset'](good, { confirm: true })).ok, true);
});
