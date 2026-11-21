'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthClient, AuthError, userIdFromToken } = require('../../src/main/auth');
const { UID, URL_OK, KEY, jwt, tokenResponse, fakeFetch, spyConsole } = require('./helpers');

const NOW = 1_800_000_000_000;
const mk = (fetchImpl, extra = {}) => createAuthClient({ fetchImpl, supabaseUrl: URL_OK, anonKey: KEY, now: () => NOW, ...extra });
const rejectsCode = (p, code) => assert.rejects(p, (e) => e instanceof AuthError && e.code === code && /[a-zà-ú]/i.test(e.message));

test('cadastro: POST /auth/v1/signup com cabeçalhos públicos, resposta needsConfirmation', async () => {
  const f = fakeFetch({ status: 200, body: { id: UID, email: 'ana@example.com' } });
  const r = await mk(f).signUp({ email: 'ana@example.com', password: 'Segredo!Forte9' });
  assert.deepEqual(r, { needsConfirmation: true });
  const c = f.calls[0];
  assert.equal(c.url, `${URL_OK}/auth/v1/signup`);
  assert.equal(c.init.method, 'POST');
  assert.equal(c.init.headers.apikey, KEY);
  assert.equal(c.init.headers.Authorization, `Bearer ${KEY}`);
  assert.deepEqual(c.body, { email: 'ana@example.com', password: 'Segredo!Forte9' });
});

test('cadastro: conta já existente responde igual; senha fraca e 429 são tratados', async () => {
  const exists = fakeFetch({ status: 422, body: { error_code: 'user_already_exists', msg: 'x' } });
  assert.deepEqual(await mk(exists).signUp({ email: 'a@b.co', password: 'x' }), { needsConfirmation: true });
  await rejectsCode(mk(fakeFetch({ status: 422, body: { error_code: 'weak_password' } })).signUp({ email: 'a@b.co', password: 'x' }), 'weak_password');
  await rejectsCode(mk(fakeFetch({ status: 429, body: { error_code: 'over_email_send_rate_limit' } })).signUp({ email: 'a@b.co', password: 'x' }), 'rate_limited');
  await rejectsCode(mk(fakeFetch({ status: 500, body: 'oops' })).signUp({ email: 'a@b.co', password: 'x' }), 'bad_response');
});

test('login ok: sessão com id vindo do token (sub), não do corpo', async () => {
  const other = '11111111-2222-4333-8444-555555555555';
  const body = tokenResponse({ expiresAt: 1_800_003_600 });
  body.user.id = other; // corpo mente; vale o sub do token
  const f = fakeFetch({ status: 200, body });
  const s = await mk(f).signIn({ email: 'ana@example.com', password: 'Segredo!Forte9' });
  assert.equal(f.calls[0].url, `${URL_OK}/auth/v1/token?grant_type=password`);
  assert.equal(s.user.id, UID);
  assert.deepEqual(s.user, { id: UID, email: 'ana@example.com', emailConfirmed: true });
  assert.equal(s.expiresAt, 1_800_003_600);
  assert.equal(s.refreshToken, 'refresh-1');
  assert.equal(userIdFromToken(s.accessToken), UID);
});

test('login: expires_in vira expiresAt em segundos com o relógio injetado', async () => {
  const s = await mk(fakeFetch({ status: 200, body: tokenResponse({ expiresIn: 3600 }) })).signIn({ email: 'a@b.co', password: 'x' });
  assert.equal(s.expiresAt, NOW / 1000 + 3600);
});

test('login: e-mail não confirmado', async () => {
  const f = fakeFetch({ status: 400, body: { error_code: 'email_not_confirmed', msg: 'Email not confirmed' } });
  await rejectsCode(mk(f).signIn({ email: 'a@b.co', password: 'x' }), 'email_not_confirmed');
});

test('login: conta inexistente e senha errada têm a MESMA mensagem', async () => {
  const wrong = fakeFetch({ status: 400, body: { error_code: 'invalid_credentials', msg: 'Invalid login credentials' } });
  const none = fakeFetch({ status: 400, body: { error: 'invalid_grant', error_description: 'User not found' } });
  const msgs = [];
  for (const f of [wrong, none]) {
    try { await mk(f).signIn({ email: 'a@b.co', password: 'x' }); assert.fail('deveria falhar'); } catch (e) {
      assert.equal(e.code, 'invalid_credentials');
      msgs.push(e.message);
    }
  }
  assert.equal(msgs[0], msgs[1]);
  assert.match(msgs[0], /incorretos/);
});

test('login: 429, rede, timeout, resposta ruim', async () => {
  await rejectsCode(mk(fakeFetch({ status: 429, body: {} })).signIn({ email: 'a@b.co', password: 'x' }), 'rate_limited');
  await rejectsCode(mk(fakeFetch(new TypeError('fetch failed'))).signIn({ email: 'a@b.co', password: 'x' }), 'network');
  await rejectsCode(mk(fakeFetch({ status: 200, body: { access_token: 'x' } })).signIn({ email: 'a@b.co', password: 'x' }), 'bad_response');
  await rejectsCode(mk(fakeFetch({ status: 200, body: tokenResponse({ sub: 'nao-e-uuid', expiresIn: 60 }) })).signIn({ email: 'a@b.co', password: 'x' }), 'bad_response');
  await rejectsCode(mk(fakeFetch({ status: 200, body: 'não é json' })).signIn({ email: 'a@b.co', password: 'x' }), 'bad_response');
  const hang = fakeFetch((url, init) => new Promise((_, rej) => {
    init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));
  await rejectsCode(mk(hang, { timeoutMs: 20 }).signIn({ email: 'a@b.co', password: 'x' }), 'timeout');
});

test('renovação de token', async () => {
  const f = fakeFetch({ status: 200, body: tokenResponse({ expiresIn: 3600, refresh: 'refresh-2' }) });
  const s = await mk(f).refresh('refresh-1');
  assert.equal(f.calls[0].url, `${URL_OK}/auth/v1/token?grant_type=refresh_token`);
  assert.deepEqual(f.calls[0].body, { refresh_token: 'refresh-1' });
  assert.equal(s.refreshToken, 'refresh-2');
  await rejectsCode(mk(fakeFetch({ status: 400, body: { error: 'invalid_grant' } })).refresh('velho'), 'invalid_credentials');
  await rejectsCode(mk(fakeFetch({ status: 200, body: {} })).refresh(''), 'invalid_credentials');
});

test('recuperação de senha: sempre sucesso (exceto sem conexão)', async () => {
  const f = fakeFetch({ status: 200, body: {} });
  assert.deepEqual(await mk(f).recover({ email: 'a@b.co' }), { ok: true });
  assert.equal(f.calls[0].url, `${URL_OK}/auth/v1/recover`);
  assert.deepEqual(await mk(fakeFetch({ status: 404, body: { msg: 'User not found' } })).recover({ email: 'x@y.co' }), { ok: true });
  assert.deepEqual(await mk(fakeFetch({ status: 429, body: {} })).recover({ email: 'x@y.co' }), { ok: true });
  assert.deepEqual(await mk(fakeFetch({ status: 500, body: 'x' })).recover({ email: 'x@y.co' }), { ok: true });
  await rejectsCode(mk(fakeFetch(new TypeError('x'))).recover({ email: 'x@y.co' }), 'network');
});

test('signOut usa o token do usuário e scope=local', async () => {
  const f = fakeFetch({ status: 204 });
  const tok = jwt();
  await mk(f).signOut(tok);
  assert.equal(f.calls[0].url, `${URL_OK}/auth/v1/logout?scope=local`);
  assert.equal(f.calls[0].init.headers.Authorization, `Bearer ${tok}`);
  assert.equal(f.calls[0].init.headers.apikey, KEY);
});

test('recusa URL não-supabase, http e chave inválida', () => {
  for (const url of ['https://evil.com', 'http://abc.supabase.co', 'https://abc.supabase.co.evil.com', '']) {
    assert.throws(() => createAuthClient({ fetchImpl: fakeFetch({ status: 200 }), supabaseUrl: url, anonKey: KEY }), (e) => e.code === 'unconfigured');
  }
  assert.throws(() => createAuthClient({ fetchImpl: fakeFetch({ status: 200 }), supabaseUrl: URL_OK, anonKey: 'tem espaço\r\nX: y' }), (e) => e.code === 'unconfigured');
  assert.throws(() => createAuthClient({ fetchImpl: fakeFetch({ status: 200 }), supabaseUrl: URL_OK, anonKey: '' }), (e) => e.code === 'unconfigured');
});

test('userIdFromToken: só aceita JWT com sub uuid', () => {
  assert.equal(userIdFromToken(jwt()), UID);
  assert.equal(userIdFromToken(jwt('x')), null);
  assert.equal(userIdFromToken('a.b'), null);
  assert.equal(userIdFromToken('a.!!!.c'), null);
  assert.equal(userIdFromToken(null), null);
});

test('nada sensível vai para o console, nem nos erros', async () => {
  const spy = spyConsole();
  try {
    const secret = { email: 'segredo@example.com', password: 'SenhaSuperSecreta!1' };
    const client = mk(fakeFetch({ status: 400, body: { error_code: 'invalid_credentials' } }));
    await client.signIn(secret).catch(() => {});
    await mk(fakeFetch(new Error(`falha ${secret.email} ${secret.password}`))).signIn(secret).catch((e) => {
      assert.ok(!e.message.includes('segredo@'));
      assert.ok(!e.message.includes('SenhaSuper'));
    });
    await mk(fakeFetch({ status: 200, body: tokenResponse({ expiresIn: 60 }) })).signIn(secret);
  } finally { spy.restore(); }
  assert.deepEqual(spy.out, []);
});

test('falhas administrativas e de configuração não acusam senha incorreta', async () => {
  for (const status of [400, 401, 403, 422]) {
    const client = mk(fakeFetch({ status, body: { message: 'Authentication service unavailable' } }));
    await rejectsCode(client.signIn({ email: 'ana@example.com', password: 'teste' }), 'bad_response');
  }
});
