'use strict';

// Recuperação de senha de ponta a ponta na camada de conta, com o servidor de contas falso.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthClient } = require('../../src/main/auth');
const { createAccountService } = require('../../src/main/account');
const { createSessionManager } = require('../../src/main/session');

const UID = '11111111-1111-4111-8111-111111111111';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `${b64({ alg: 'HS256' })}.${b64({ sub: UID })}.assinatura`;
const ANON = `${b64({ alg: 'HS256' })}.${b64({ role: 'anon' })}.sig`;
const STRONG = 'frase-longa-de-teste-92';

function setup(routes = {}, { signedIn = false } = {}) {
  const calls = [];
  let clock = 1_000_000;
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const key = `${init.method} ${u.pathname}`;
    calls.push({ key, search: u.search, body: init.body ? JSON.parse(init.body) : null, auth: init.headers.Authorization });
    const [status, body] = routes[key] ? routes[key]() : [404, {}];
    return new Response(status === 204 ? null : JSON.stringify(body ?? {}), { status });
  };
  const auth = createAuthClient({
    fetchImpl, supabaseUrl: 'https://abc.supabase.co', anonKey: ANON, recoveryRedirectUrl: 'https://lumenex.netlify.app/',
  });
  let stored = signedIn
    ? { version: 1, accessToken: 'a', refreshToken: 'r', expiresAt: 9e9, user: { id: UID, email: 'eu@x.com' } } : null;
  const session = createSessionManager({ auth, store: { load: () => stored, save: (v) => { stored = v; }, clear: () => { stored = null; } } });
  const changes = [];
  const account = createAccountService({
    config: {}, auth, session, profile: {}, onSessionChange: (v) => changes.push(v), now: () => clock,
  });
  return { account, calls, changes, stored: () => stored, advance: (ms) => { clock += ms; } };
}

const OK = {
  'GET /auth/v1/user': () => [200, { email: 'eu@x.com' }],
  'PUT /auth/v1/user': () => [200, {}],
  'POST /auth/v1/logout': () => [204],
};

test('pedido: leva redirect_to, responde igual para qualquer e-mail e tem intervalo de 60 s', async () => {
  for (const status of [200, 400, 429, 500]) {
    const env = setup({ 'POST /auth/v1/recover': () => [status, {}] });
    assert.deepEqual(await env.account.recover({ email: 'Alguem@X.com' }), { ok: true });
    assert.equal(env.calls[0].search, '?redirect_to=https%3A%2F%2Flumenex.netlify.app%2F');
    await assert.rejects(env.account.recover({ email: 'alguem@x.com' }), /Aguarde 60 s/);
    env.advance(60_000);
    await env.account.recover({ email: 'alguem@x.com' });
    assert.equal(env.calls.length, 2);
  }
});

test('link válido: troca a senha, encerra todas as sessões e sai deste navegador', async () => {
  const env = setup(OK, { signedIn: true });
  await env.account.beginRecovery({ accessToken: JWT });
  assert.deepEqual(env.account.getAuthView().recovery, { status: 'ready', email: 'eu@x.com', sessionsRevoked: false });
  assert.ok(!JSON.stringify(env.account.getAuthView()).includes(JWT), 'o token nunca vai para a tela');
  await env.account.resetPassword({ password: STRONG });
  assert.deepEqual(env.calls.map((c) => c.key), ['GET /auth/v1/user', 'PUT /auth/v1/user', 'POST /auth/v1/logout']);
  assert.equal(env.calls[1].auth, `Bearer ${JWT}`);
  assert.equal(env.calls[2].search, '?scope=global');
  assert.equal(env.stored(), null);
  assert.deepEqual(env.changes, [false]);
  assert.equal(env.account.getAuthView().recovery.status, 'done');
  await assert.rejects(env.account.resetPassword({ password: STRONG }), /não vale mais/);
});

test('token_hash: só é consumido no envio; senha recusada permite tentar de novo sem reconsumir', async () => {
  let puts = 0;
  const env = setup({
    'POST /auth/v1/verify': () => [200, { access_token: JWT, refresh_token: 'r', expires_in: 3600, user: { email: 'eu@x.com' } }],
    'PUT /auth/v1/user': () => (++puts === 1 ? [422, { error_code: 'same_password' }] : [200, {}]),
    'POST /auth/v1/logout': () => [204],
  });
  await env.account.beginRecovery({ tokenHash: 'pkce_abcdef123456' });
  assert.equal(env.calls.length, 0);
  await assert.rejects(env.account.resetPassword({ password: STRONG }), /diferente da atual/);
  assert.equal(env.account.getAuthView().recovery.status, 'ready');
  await env.account.resetPassword({ password: STRONG });
  assert.equal(env.calls.filter((c) => c.key === 'POST /auth/v1/verify').length, 1);
  assert.equal(env.account.getAuthView().recovery.status, 'done');
});

test('link expirado, usado, com erro ou malformado vira estado inválido', async () => {
  const a = setup({ 'GET /auth/v1/user': () => [403, { error_code: 'bad_jwt' }] });
  await a.account.beginRecovery({ accessToken: JWT });
  assert.equal(a.account.getAuthView().recovery.status, 'invalid');

  const b = setup({ 'POST /auth/v1/verify': () => [403, { error_code: 'otp_expired' }] });
  await b.account.beginRecovery({ tokenHash: 'abcdef123456' });
  await assert.rejects(b.account.resetPassword({ password: STRONG }), /inválido/);
  assert.equal(b.account.getAuthView().recovery.status, 'invalid');

  for (const link of [{ error: true }, {}, { accessToken: 'x y<script>' }]) {
    const c = setup();
    await c.account.beginRecovery(link);
    assert.equal(c.account.getAuthView().recovery.status, 'invalid');
    assert.equal(c.calls.length, 0);
  }
});

test('senha fraca é recusada antes de ir ao servidor; fechar descarta o link', async () => {
  const env = setup(OK);
  await env.account.beginRecovery({ accessToken: JWT });
  await assert.rejects(env.account.resetPassword({ password: 'curta' }), /pelo menos 10/);
  assert.equal(env.calls.length, 1);
  await env.account.dismissRecovery();
  assert.equal(env.account.getAuthView().recovery, undefined);
});

test('link de outra conta não derruba a sessão aberta neste navegador', async () => {
  const other = `${b64({ alg: 'HS256' })}.${b64({ sub: '22222222-2222-4222-8222-222222222222' })}.sig`;
  const env = setup(OK, { signedIn: true });
  await env.account.beginRecovery({ accessToken: other });
  await env.account.resetPassword({ password: STRONG });
  assert.ok(env.stored());
  assert.deepEqual(env.changes, []);
});

test('fechar a tela durante o envio não a reabre', async () => {
  const env = setup(OK);
  await env.account.beginRecovery({ accessToken: JWT });
  const pending = env.account.resetPassword({ password: STRONG });
  await env.account.dismissRecovery();
  await pending;
  assert.equal(env.account.getAuthView().recovery, undefined);
});

test('renovação recusada numa aba antiga não apaga o login mais novo salvo por outra', async () => {
  const mk = (r) => ({ version: 1, accessToken: 'a', refreshToken: r, expiresAt: 1, user: { id: UID, email: 'e@x.com' } });
  let stored = mk('velho');
  const auth = { refresh: async () => { stored = { ...mk('novo'), expiresAt: 9e9 }; throw Object.assign(new Error('x'), { code: 'invalid_credentials' }); } };
  const s = createSessionManager({ auth, store: { load: () => stored, save: () => {}, clear: () => { stored = null; } } });
  assert.equal((await s.get()).refreshToken, 'novo');
  assert.ok(stored);
});
