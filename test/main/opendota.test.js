'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createOpenDotaClient, OpenDotaError } = require('../../src/main/opendota');

const resp = (status, body, { badJson = false } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => { if (badJson) throw new SyntaxError('x'); return body; },
});

function make(fetchImpl, extra = {}) {
  return createOpenDotaClient({ fetchImpl, minIntervalMs: 0, ...extra });
}
const code = (p) => p.then(() => assert.fail('deveria falhar'), (e) => { assert.ok(e instanceof OpenDotaError); return e.code; });

test('recusa baseUrl que não seja https', () => {
  assert.throws(() => createOpenDotaClient({ fetchImpl: async () => {}, baseUrl: 'http://api.opendota.com/api' }));
  assert.throws(() => createOpenDotaClient({ fetchImpl: async () => {}, baseUrl: 'lixo' }));
});

test('getPlayer: sucesso, sem perfil e 404', async () => {
  const urls = [];
  const c = make(async (u) => { urls.push(u); return resp(200, { profile: { personaname: 'Fulano' } }); });
  assert.deepEqual(await c.getPlayer(123), { personaName: 'Fulano', found: true });
  assert.equal(urls[0], 'https://api.opendota.com/api/players/123');
  assert.deepEqual(await make(async () => resp(200, {})).getPlayer(1), { personaName: null, found: false });
  assert.deepEqual(await make(async () => resp(404, {})).getPlayer(1), { personaName: null, found: false });
  assert.deepEqual(await make(async () => resp(200, { profile: {} })).getPlayer(1), { personaName: null, found: true });
});

test('getPlayer: formato inválido -> bad_response', async () => {
  assert.equal(await code(make(async () => resp(200, [])).getPlayer(1)), 'bad_response');
  assert.equal(await code(make(async () => resp(200, { profile: 'x' })).getPlayer(1)), 'bad_response');
});

test('accountId inválido é recusado antes de chamar a rede', async () => {
  let calls = 0;
  const c = make(async () => { calls++; return resp(200, {}); });
  for (const bad of ['1', 0, -1, 1.5, 4294967296, NaN]) {
    await assert.rejects(c.getPlayer(bad), TypeError);
  }
  assert.equal(calls, 0);
});

test('getRecentMatches: monta URL e valida array', async () => {
  const urls = [];
  const c = make(async (u) => { urls.push(u); return resp(200, [{ match_id: 1 }]); });
  assert.deepEqual(await c.getRecentMatches(5), [{ match_id: 1 }]);
  assert.equal(urls[0], 'https://api.opendota.com/api/players/5/matches?limit=20&lobby_type=7');
  assert.equal(await code(make(async () => resp(200, {})).getRecentMatches(5)), 'bad_response');
  assert.equal(await code(make(async () => resp(200, [1])).getRecentMatches(5)), 'bad_response');
  await assert.rejects(c.getRecentMatches(5, 0), TypeError);
});

test('getHeroes: mapeia id -> nome e valida', async () => {
  const c = make(async () => resp(200, { 1: { id: 1, localized_name: 'Anti-Mage' }, 2: { id: 2, localized_name: 'Axe' } }));
  assert.deepEqual(await c.getHeroes(), { 1: 'Anti-Mage', 2: 'Axe' });
  assert.equal(await code(make(async () => resp(200, { 1: { id: 'a' } })).getHeroes()), 'bad_response');
  assert.equal(await code(make(async () => resp(200, null)).getHeroes()), 'bad_response');
});

test('códigos de erro HTTP', async () => {
  assert.equal(await code(make(async () => resp(429, {})).getRecentMatches(5)), 'rate_limited');
  assert.equal(await code(make(async () => resp(404, {})).getRecentMatches(5)), 'not_found');
  assert.equal(await code(make(async () => resp(500, {})).getRecentMatches(5)), 'http_error');
  assert.equal(await code(make(async () => resp(200, null, { badJson: true })).getRecentMatches(5)), 'bad_response');
});

test('erro de rede e timeout', async () => {
  assert.equal(await code(make(async () => { throw new TypeError('fetch failed'); }).getRecentMatches(5)), 'network');
  const hang = (u, { signal }) => new Promise((_, rej) => {
    signal.addEventListener('abort', () => rej(Object.assign(new Error('abort'), { name: 'AbortError' })));
  });
  assert.equal(await code(make(hang, { timeoutMs: 20 }).getRecentMatches(5)), 'timeout');
});

test('fila respeita intervalo mínimo e serializa chamadas', async () => {
  let t = 1000;
  const sleeps = [];
  const sleep = async (ms) => { sleeps.push(ms); t += ms; };
  let active = 0; let maxActive = 0;
  const f = async () => {
    active++; maxActive = Math.max(maxActive, active);
    await new Promise((r) => setImmediate(r));
    active--;
    return resp(200, []);
  };
  const c = createOpenDotaClient({ fetchImpl: f, minIntervalMs: 1100, now: () => t, sleep });
  await Promise.all([c.getRecentMatches(1), c.getRecentMatches(1), c.getRecentMatches(1)]);
  assert.equal(maxActive, 1);
  assert.deepEqual(sleeps, [1100, 1100]);
});

test('uma falha não trava a fila', async () => {
  let n = 0;
  const c = make(async () => { n++; if (n === 1) throw new TypeError('x'); return resp(200, []); });
  const [a, b] = await Promise.allSettled([c.getRecentMatches(1), c.getRecentMatches(1)]);
  assert.equal(a.status, 'rejected');
  assert.equal(b.status, 'fulfilled');
});

test('mensagens de erro não vazam o accountId', async () => {
  const e = await make(async () => resp(500, {})).getRecentMatches(987654).catch((x) => x);
  assert.ok(!e.message.includes('987654'));
});
