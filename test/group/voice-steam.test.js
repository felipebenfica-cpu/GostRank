'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createVoiceClient, isValidLiveKitUrl, isValidJwtShape } = require('../../src/main/voice');
const { createSteamClient, isValidSteamLoginUrl } = require('../../src/main/steam');
const { URL_OK, KEY, jwt, fakeFetch, spyConsole } = require('../auth/helpers');

const TOKEN = jwt();
const LK_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJh_-';
const voice = (f, extra = {}) => createVoiceClient({ fetchImpl: f, supabaseUrl: URL_OK, anonKey: KEY, getAccessToken: async () => TOKEN, ...extra });

test('isValidLiveKitUrl', () => {
  for (const u of ['wss://meu-projeto-abc123.livekit.cloud', 'wss://x.livekit.cloud/', 'wss://a.b.livekit.cloud:443']) {
    assert.equal(isValidLiveKitUrl(u), true, u);
  }
  for (const u of [
    'ws://x.livekit.cloud', 'https://x.livekit.cloud', 'wss://livekit.cloud', 'wss://.livekit.cloud',
    'wss://x.livekit.cloud.evil.com', 'wss://evil-livekit.cloud', 'wss://user:pw@x.livekit.cloud',
    'wss://x.livekit.cloud:8443', 'wss://x.livekit.cloud/?a=1', 'wss://evil.com', '', null, 5,
  ]) assert.equal(isValidLiveKitUrl(u), false, String(u));
  assert.equal(isValidLiveKitUrl('wss://voz.example.com', ['voz.example.com']), true);
});

test('isValidJwtShape', () => {
  assert.equal(isValidJwtShape(LK_TOKEN), true);
  for (const t of ['a.b', 'a.b.c.d', 'a.b.c=', 'a+b.c.d', '', null, 'x'.repeat(9000)]) assert.equal(isValidJwtShape(t), false, String(t).slice(0, 20));
});

test('getToken: POST na Edge Function com o token do usuário; devolve url e token', async () => {
  const f = fakeFetch({ status: 200, body: { url: 'wss://proj.livekit.cloud', token: LK_TOKEN } });
  assert.deepEqual(await voice(f).getToken(), { url: 'wss://proj.livekit.cloud', token: LK_TOKEN });
  assert.equal(f.calls[0].url, `${URL_OK}/functions/v1/livekit-token`);
  assert.equal(f.calls[0].init.method, 'POST');
  assert.equal(f.calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(f.calls[0].init.redirect, 'error');
});

test('getToken: url não-livekit e token malformado são recusados', async () => {
  for (const body of [
    { url: 'wss://evil.com', token: LK_TOKEN },
    { url: 'ws://proj.livekit.cloud', token: LK_TOKEN },
    { url: 'wss://proj.livekit.cloud', token: 'nao-e-jwt' },
    { url: 'wss://proj.livekit.cloud' },
  ]) {
    await assert.rejects(voice(fakeFetch({ status: 200, body })).getToken(), (e) => e.name === 'UserInputError' && e.code === 'bad_response');
  }
});

test('getToken: 503 voice_unconfigured, 403 not_in_group, 401 e sem sessão', async () => {
  await assert.rejects(voice(fakeFetch({ status: 503, body: { error: 'voice_unconfigured' } })).getToken(),
    (e) => e.name === 'UserInputError' && e.message === 'Voz ainda não configurada no servidor.');
  await assert.rejects(voice(fakeFetch({ status: 403, body: { error: 'not_in_group' } })).getToken(),
    (e) => /grupo/.test(e.message));
  await assert.rejects(voice(fakeFetch({ status: 401, body: {} })).getToken(), (e) => e.code === 'unauthenticated');
  const f = fakeFetch({ status: 200, body: {} });
  await assert.rejects(voice(f, { getAccessToken: async () => null }).getToken(), (e) => e.code === 'unauthenticated');
  assert.equal(f.calls.length, 0);
});

const STEAM_URL = 'https://steamcommunity.com/openid/login?openid.mode=checkid_setup&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0';

test('isValidSteamLoginUrl', () => {
  assert.equal(isValidSteamLoginUrl(STEAM_URL), true);
  for (const u of [
    'http://steamcommunity.com/openid/login?a=1',
    'https://steamcommunity.com/openid/login',
    'https://steamcommunity.com/openid/login?',
    'https://steamcommunity.com/openid/loginx?a=1',
    'https://steamcommunity.com.evil.com/openid/login?a=1',
    'https://evil.com/?https://steamcommunity.com/openid/login?a=1',
    'https://user@steamcommunity.com/openid/login?a=1',
    'https://steamcommunity.com:444/openid/login?a=1',
    'https://steamcommunity.com/openid/login?a=1#x',
    'javascript:alert(1)',
    null,
  ]) assert.equal(isValidSteamLoginUrl(u), false, String(u));
});

test('startLink: pede a URL, valida e só então abre o navegador', async () => {
  const opened = [];
  const openExternal = async (u) => { opened.push(u); };
  const f = fakeFetch({ status: 200, body: { url: STEAM_URL } });
  const s = createSteamClient({ fetchImpl: f, supabaseUrl: URL_OK, anonKey: KEY, getAccessToken: async () => TOKEN, openExternal });
  assert.equal(await s.startLink(), STEAM_URL);
  assert.deepEqual(opened, [STEAM_URL]);
  assert.equal(f.calls[0].url, `${URL_OK}/functions/v1/steam-link/start`);
  assert.equal(f.calls[0].init.method, 'POST');
  const evil = createSteamClient({
    fetchImpl: fakeFetch({ status: 200, body: { url: 'https://evil.com/openid/login?x=1' } }),
    supabaseUrl: URL_OK, anonKey: KEY, getAccessToken: async () => TOKEN, openExternal,
  });
  await assert.rejects(evil.startLink(), (e) => e.name === 'UserInputError' && /Steam/.test(e.message));
  assert.equal(opened.length, 1);
  const down = createSteamClient({
    fetchImpl: fakeFetch({ status: 500, body: {} }), supabaseUrl: URL_OK, anonKey: KEY, getAccessToken: async () => TOKEN, openExternal,
  });
  await assert.rejects(down.startLink(), (e) => e.name === 'UserInputError');
  assert.equal(opened.length, 1);
});

test('token de voz nunca vai para o console', async () => {
  const spy = spyConsole();
  try {
    await voice(fakeFetch({ status: 200, body: { url: 'wss://proj.livekit.cloud', token: LK_TOKEN } })).getToken();
    await voice(fakeFetch({ status: 200, body: { url: 'wss://evil.com', token: LK_TOKEN } })).getToken().catch(() => {});
  } finally { spy.restore(); }
  assert.ok(!spy.out.join('\n').includes(LK_TOKEN));
});
