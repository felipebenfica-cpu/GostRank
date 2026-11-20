'use strict';
// Login pela Steam (OpenID 2.0): funcoes puras.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const modPath = path.join(__dirname, '..', '..', 'supabase', 'functions', '_shared', 'steam_openid.js');
const load = () => import(modPath);

const FN = 'https://abc.supabase.co/functions/v1/steam-link';
const STATE = 'A'.repeat(20) + '-_' + 'b'.repeat(21); // 43 caracteres
const STEAM64 = '76561198000000001';

function goodParams(overrides = {}) {
  const p = {
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
    'openid.claimed_id': `https://steamcommunity.com/openid/id/${STEAM64}`,
    'openid.identity': `https://steamcommunity.com/openid/id/${STEAM64}`,
    'openid.return_to': `${FN}/callback?state=${STATE}`,
    'openid.response_nonce': '2026-11-20T10:00:00Zabc',
    'openid.assoc_handle': '1234567890',
    'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
    'openid.sig': 'c2lnbmF0dXJl',
    state: STATE,
    ...overrides,
  };
  for (const k of Object.keys(p)) if (p[k] === undefined) delete p[k];
  return new URLSearchParams(p);
}

test('randomState: 43 caracteres base64url, diferente a cada chamada', async () => {
  const { randomState, STATE_RE } = await load();
  const a = randomState();
  assert.match(a, STATE_RE);
  assert.strictEqual(a.length, 43);
  assert.notStrictEqual(a, randomState());
});

test('buildSteamLoginUrl monta a URL de login correta', async () => {
  const { buildSteamLoginUrl } = await load();
  const url = new URL(buildSteamLoginUrl({ functionUrl: FN, state: STATE }));
  assert.strictEqual(url.origin + url.pathname, 'https://steamcommunity.com/openid/login');
  const q = Object.fromEntries(url.searchParams);
  assert.deepStrictEqual(q, {
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.return_to': `${FN}/callback?state=${STATE}`,
    'openid.realm': FN,
  });
});

test('buildSteamLoginUrl recusa functionUrl e state invalidos', async () => {
  const { buildSteamLoginUrl } = await load();
  assert.throws(() => buildSteamLoginUrl({ functionUrl: 'http://abc.supabase.co/x', state: STATE }), TypeError);
  assert.throws(() => buildSteamLoginUrl({ functionUrl: FN + '/', state: STATE }), TypeError);
  assert.throws(() => buildSteamLoginUrl({ functionUrl: FN, state: 'curto' }), TypeError);
  assert.throws(() => buildSteamLoginUrl({ functionUrl: FN, state: STATE.slice(0, 42) + '&' }), TypeError);
});

test('verifyAssertionParams aceita a resposta correta', async () => {
  const { verifyAssertionParams, callbackUrl } = await load();
  const r = verifyAssertionParams(goodParams(), { expectedReturnTo: callbackUrl(FN, STATE) });
  assert.deepStrictEqual(r, { ok: true, steamId64: STEAM64 });
  // Tambem aceita objeto simples.
  const r2 = verifyAssertionParams(Object.fromEntries(goodParams()), { expectedReturnTo: callbackUrl(FN, STATE) });
  assert.strictEqual(r2.ok, true);
});

test('verifyAssertionParams recusa respostas adulteradas', async () => {
  const { verifyAssertionParams, callbackUrl } = await load();
  const exp = callbackUrl(FN, STATE);
  const cases = {
    bad_mode: { 'openid.mode': 'cancel' },
    bad_mode2: { 'openid.mode': 'check_authentication' },
    bad_ns: { 'openid.ns': 'http://specs.openid.net/auth/1.1' },
    bad_op_endpoint: { 'openid.op_endpoint': 'https://evil.example/openid/login' },
    bad_op_endpoint2: { 'openid.op_endpoint': 'https://steamcommunity.com/openid/login/' },
    bad_return_to: { 'openid.return_to': `https://evil.example/callback?state=${STATE}` },
    bad_return_to_state: { 'openid.return_to': `${FN}/callback?state=${'Z'.repeat(43)}` },
    bad_claimed_id: { 'openid.claimed_id': 'https://evil.example/openid/id/76561198000000001', 'openid.identity': 'https://evil.example/openid/id/76561198000000001' },
    bad_claimed_id_http: { 'openid.claimed_id': `http://steamcommunity.com/openid/id/${STEAM64}`, 'openid.identity': `http://steamcommunity.com/openid/id/${STEAM64}` },
    bad_claimed_id_short: { 'openid.claimed_id': 'https://steamcommunity.com/openid/id/7656119800000', 'openid.identity': 'https://steamcommunity.com/openid/id/7656119800000' },
    bad_claimed_id_extra: { 'openid.claimed_id': `https://steamcommunity.com/openid/id/${STEAM64}/x`, 'openid.identity': `https://steamcommunity.com/openid/id/${STEAM64}/x` },
    bad_identity: { 'openid.identity': 'https://steamcommunity.com/openid/id/76561198000000002' },
    missing_sig: { 'openid.sig': undefined },
    unsigned_return_to: { 'openid.signed': 'signed,op_endpoint,claimed_id,identity,response_nonce,assoc_handle' },
  };
  for (const [name, ov] of Object.entries(cases)) {
    const r = verifyAssertionParams(goodParams(ov), { expectedReturnTo: exp });
    assert.strictEqual(r.ok, false, name);
    assert.ok(r.reason, name);
  }
  // return_to correto, mas esperado era outro state.
  const other = verifyAssertionParams(goodParams(), { expectedReturnTo: callbackUrl(FN, 'Q'.repeat(43)) });
  assert.deepStrictEqual(other, { ok: false, reason: 'bad_return_to' });
  assert.strictEqual(verifyAssertionParams(goodParams(), {}).ok, false);
});

test('steamId64ToAccountId converte e valida', async () => {
  const { steamId64ToAccountId } = await load();
  assert.strictEqual(steamId64ToAccountId('76561197960265729'), 1);
  assert.strictEqual(steamId64ToAccountId('76561198000000001'), 39734273);
  assert.strictEqual(steamId64ToAccountId('76561198012345678'), 52079950);
  assert.throws(() => steamId64ToAccountId('76561197960265728'), RangeError);
  for (const bad of ['123', 76561198000000001, '7656119800000000a', '86561198000000001', '']) {
    assert.throws(() => steamId64ToAccountId(bad), TypeError, String(bad));
  }
});

test('parseCheckAuthResponse so aceita is_valid:true', async () => {
  const { parseCheckAuthResponse } = await load();
  assert.strictEqual(parseCheckAuthResponse('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n'), true);
  assert.strictEqual(parseCheckAuthResponse('ns:http://specs.openid.net/auth/2.0\r\nis_valid:true\r\n'), true);
  assert.strictEqual(parseCheckAuthResponse('ns:http://specs.openid.net/auth/2.0\nis_valid:false\n'), false);
  assert.strictEqual(parseCheckAuthResponse('ns:http://outro\nis_valid:true\n'), false);
  assert.strictEqual(parseCheckAuthResponse('is_valid:truex'), false);
  assert.strictEqual(parseCheckAuthResponse('<html>is_valid:true</html>'), false);
  assert.strictEqual(parseCheckAuthResponse(''), false);
  assert.strictEqual(parseCheckAuthResponse(null), false);
});

test('buildCheckAuthBody copia so openid.* e troca o mode', async () => {
  const { buildCheckAuthBody } = await load();
  const body = buildCheckAuthBody(goodParams());
  assert.strictEqual(body.get('openid.mode'), 'check_authentication');
  assert.strictEqual(body.get('openid.sig'), 'c2lnbmF0dXJl');
  assert.strictEqual(body.get('state'), null);
  assert.strictEqual(body.getAll('openid.mode').length, 1);
});

test('checkAuthentication faz POST para a Steam e interpreta a resposta', async () => {
  const { checkAuthentication } = await load();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n', { status: 200 });
  };
  assert.strictEqual(await checkAuthentication(goodParams(), { fetchImpl }), true);
  assert.strictEqual(calls[0].url, 'https://steamcommunity.com/openid/login');
  assert.strictEqual(calls[0].init.method, 'POST');
  assert.strictEqual(calls[0].init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.strictEqual(new URLSearchParams(calls[0].init.body).get('openid.mode'), 'check_authentication');
  const no = async () => new Response('is_valid:false', { status: 200 });
  assert.strictEqual(await checkAuthentication(goodParams(), { fetchImpl: no }), false);
  const err = async () => new Response('x', { status: 500 });
  assert.strictEqual(await checkAuthentication(goodParams(), { fetchImpl: err }), false);
  const boom = async () => { throw new Error('rede'); };
  assert.strictEqual(await checkAuthentication(goodParams(), { fetchImpl: boom }), false);
});
