'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ipc = require('../../src/main/ipc');
const { createController } = require('../../src/main/controller');
const { createStore } = require('../../src/main/store');
const { createAuthClient } = require('../../src/main/auth');
const { createSessionManager } = require('../../src/main/session');
const { createProfileClient } = require('../../src/main/profile');
const { createAccountService } = require('../../src/main/account');
const { UID, URL_OK, KEY, tokenResponse, fakeFetch, spyConsole } = require('./helpers');

const TRUSTED = { senderFrame: { url: 'app://ghost-rank/index.html' } };
const UNTRUSTED = { senderFrame: { url: 'https://evil.example/' } };
const T = 1_800_000_000;
const PASS = 'Segredo!Forte9';

function build({ routes, configured = true }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-acc-'));
  const fetchImpl = fakeFetch(async (url, init) => {
    for (const [frag, resp] of routes) if (url.includes(frag)) return typeof resp === 'function' ? resp(url, init) : resp;
    return { status: 404, body: {} };
  });
  const sessionStore = createStore({ filePath: path.join(dir, 'ghost-rank-session.dat') });
  const trackerStore = createStore({ filePath: path.join(dir, 'ghost-rank.dat') });
  const common = { fetchImpl, supabaseUrl: URL_OK, anonKey: KEY };
  let account;
  let session = null;
  if (configured) {
    const auth = createAuthClient({ ...common, now: () => T * 1000 });
    session = createSessionManager({ store: sessionStore, auth, now: () => T * 1000 });
    const profile = createProfileClient({ ...common, getAccessToken: async () => (await session.get())?.accessToken ?? null });
    account = createAccountService({ config: { supabaseUrl: URL_OK, anonKey: KEY }, auth, session, profile });
  } else {
    account = createAccountService({});
  }
  const controller = createController({
    client: {}, store: trackerStore, getAuthView: () => account.getAuthView(), now: () => T * 1000,
  });
  const handlers = ipc.buildHandlers(controller, { account, session });
  return { fetchImpl, session, controller, account, sessionStore, trackerStore, dir, call: (ch, p, ev = TRUSTED) => handlers[ch](ev, p), handlers };
}

const loginOk = { status: 200, body: tokenResponse({ expiresIn: 3600 }) };
const profileRow = { status: 200, body: [{ display_name: 'Fantasma', mmr_visibility: 'friends', steam_account_id: null }] };

test('sem config: View.auth = unconfigured e canais de conta recusam sem quebrar', async () => {
  const e = build({ routes: [], configured: false });
  const v = await e.call(ipc.CHANNELS.getView);
  assert.equal(v.ok, true);
  assert.deepEqual(v.view.auth, { status: 'unconfigured', email: null, displayName: null, mmrVisibility: null, steamLinked: false });
  assert.equal(v.view.configured, false); // rastreador independente
  const r = await e.call(ipc.CHANNELS.signIn, { email: 'a@b.co', password: 'x' });
  assert.deepEqual(r, { ok: false, error: 'Contas indisponíveis neste computador.' });
});

test('controller sem getAuthView: auth unconfigured por padrão', () => {
  const c = createController({ client: {}, store: { load: () => null, save() {}, clear() {} } });
  assert.equal(c.getView().auth.status, 'unconfigured');
});

test('cadastro: valida, devolve view e resposta igual exista a conta ou não', async () => {
  const novo = build({ routes: [['/auth/v1/signup', { status: 200, body: { id: UID } }]] });
  const jaTem = build({ routes: [['/auth/v1/signup', { status: 422, body: { error_code: 'user_already_exists' } }]] });
  const a = await novo.call(ipc.CHANNELS.signUp, { email: 'Ana@Example.com', password: PASS });
  const b = await jaTem.call(ipc.CHANNELS.signUp, { email: 'Ana@Example.com', password: PASS });
  assert.equal(a.ok, true);
  assert.deepEqual(a, b);
  assert.equal(a.view.auth.status, 'signed_out');
  assert.equal(novo.fetchImpl.calls[0].body.email, 'ana@example.com');
  const weak = await novo.call(ipc.CHANNELS.signUp, { email: 'ana@example.com', password: 'curta' });
  assert.equal(weak.ok, false);
  assert.match(weak.error, /10 caracteres/);
  assert.equal((await novo.call(ipc.CHANNELS.signUp, { email: 'inválido', password: PASS })).ok, false);
});

test('login -> view signed_in com perfil; sessão cifrável salva; logout limpa', async () => {
  const e = build({ routes: [
    ['grant_type=password', loginOk], ['/rest/v1/profiles', profileRow], ['/auth/v1/logout', { status: 204 }],
  ] });
  const r = await e.call(ipc.CHANNELS.signIn, { email: 'ana@example.com', password: PASS });
  assert.equal(r.ok, true);
  assert.deepEqual(r.view.auth, { status: 'signed_in', email: 'ana@example.com', displayName: 'Fantasma', mmrVisibility: 'friends', steamLinked: false });
  assert.ok(fs.existsSync(path.join(e.dir, 'ghost-rank-session.dat')));
  const out = await e.call(ipc.CHANNELS.signOut);
  assert.equal(out.ok, true);
  assert.equal(out.view.auth.status, 'signed_out');
  assert.equal(fs.existsSync(path.join(e.dir, 'ghost-rank-session.dat')), false);
  assert.ok(e.fetchImpl.calls.some((c) => c.url.includes('/auth/v1/logout')));
});

test('login falho: mensagem em português, sem sessão; logout funciona mesmo com rede caída', async () => {
  const e = build({ routes: [['grant_type=password', { status: 400, body: { error_code: 'invalid_credentials' } }]] });
  const r = await e.call(ipc.CHANNELS.signIn, { email: 'ana@example.com', password: 'errada' });
  assert.deepEqual(r, { ok: false, error: 'E-mail ou senha incorretos.' });
  const e2 = build({ routes: [['grant_type=password', loginOk], ['/rest/v1/profiles', profileRow], ['/auth/v1/logout', () => { throw new TypeError('off'); }]] });
  await e2.call(ipc.CHANNELS.signIn, { email: 'ana@example.com', password: PASS });
  const out = await e2.call(ipc.CHANNELS.signOut);
  assert.equal(out.view.auth.status, 'signed_out');
});

test('recuperação: sempre ok para e-mail válido; formato inválido recusado', async () => {
  const e = build({ routes: [['/auth/v1/recover', { status: 404, body: {} }]] });
  assert.equal((await e.call(ipc.CHANNELS.recover, { email: 'naoexiste@example.com' })).ok, true);
  assert.equal((await e.call(ipc.CHANNELS.recover, { email: 'x' })).ok, false);
});

test('updateProfile exige sessão, valida e atualiza a View', async () => {
  const e = build({ routes: [
    ['grant_type=password', loginOk],
    ['/rest/v1/profiles', (url, init) => (init.method === 'PATCH'
      ? { status: 200, body: [{ display_name: 'Novo Nome', mmr_visibility: 'nobody', steam_account_id: null }] }
      : profileRow)],
  ] });
  const sem = await e.call(ipc.CHANNELS.updateProfile, { displayName: 'Novo Nome' });
  assert.equal(sem.ok, false);
  await e.call(ipc.CHANNELS.signIn, { email: 'ana@example.com', password: PASS });
  assert.equal((await e.call(ipc.CHANNELS.updateProfile, { displayName: '<x>' })).ok, false);
  const r = await e.call(ipc.CHANNELS.updateProfile, { displayName: 'Novo Nome', mmrVisibility: 'nobody' });
  assert.equal(r.ok, true);
  assert.equal(r.view.auth.displayName, 'Novo Nome');
  assert.equal(r.view.auth.mmrVisibility, 'nobody');
});

test('apagar conta: exige {confirm:true}; no sucesso limpa sessão e zera o rastreador', async () => {
  const e = build({ routes: [
    ['grant_type=password', loginOk], ['/rest/v1/profiles', profileRow], ['/rest/v1/rpc/delete_my_account', { status: 204 }],
  ] });
  await e.call(ipc.CHANNELS.signIn, { email: 'ana@example.com', password: PASS });
  e.trackerStore.save({ marcador: 1 });
  assert.equal((await e.call(ipc.CHANNELS.deleteAccount, {})).ok, false);
  assert.equal((await e.call(ipc.CHANNELS.deleteAccount, undefined)).ok, false);
  assert.equal((await e.call(ipc.CHANNELS.deleteAccount, { confirm: 'true' })).ok, false);
  assert.ok(!e.fetchImpl.calls.some((c) => c.url.includes('delete_my_account')));
  const r = await e.call(ipc.CHANNELS.deleteAccount, { confirm: true });
  assert.equal(r.ok, true);
  assert.equal(r.view.auth.status, 'signed_out');
  assert.equal(e.session.peek(), null);
  assert.equal(fs.existsSync(path.join(e.dir, 'ghost-rank-session.dat')), false);
  assert.equal(fs.existsSync(path.join(e.dir, 'ghost-rank.dat')), false); // controller.reset()
});

test('apagar conta com falha no servidor mantém sessão e dados', async () => {
  const e = build({ routes: [
    ['grant_type=password', loginOk], ['/rest/v1/profiles', profileRow], ['/rest/v1/rpc/delete_my_account', { status: 500, body: {} }],
  ] });
  await e.call(ipc.CHANNELS.signIn, { email: 'ana@example.com', password: PASS });
  e.trackerStore.save({ marcador: 1 });
  const r = await e.call(ipc.CHANNELS.deleteAccount, { confirm: true });
  assert.equal(r.ok, false);
  assert.ok(e.session.peek());
  assert.ok(fs.existsSync(path.join(e.dir, 'ghost-rank.dat')));
});

test('validação de payload dos canais novos', () => {
  const ok = { email: 'a@b.co', password: 'x' };
  assert.deepEqual(ipc.validateCredentialsPayload(ok), ok);
  assert.equal(ipc.validateCredentialsPayload({ ...ok, extra: 1 }), null);
  assert.equal(ipc.validateCredentialsPayload({ email: 'a@b.co' }), null);
  assert.equal(ipc.validateCredentialsPayload({ email: 5, password: 'x' }), null);
  assert.equal(ipc.validateCredentialsPayload({ email: 'a@b.co', password: 5 }), null);
  assert.equal(ipc.validateCredentialsPayload({ email: 'a'.repeat(255), password: 'x' }), null);
  assert.equal(ipc.validateCredentialsPayload({ email: 'a@b.co', password: 'x'.repeat(129) }), null);
  assert.equal(ipc.validateCredentialsPayload(JSON.parse('{"__proto__":{"a":1},"email":"a","password":"b"}')), null);
  assert.equal(ipc.validateCredentialsPayload([]), null);
  assert.deepEqual(ipc.validateRecoverPayload({ email: 'a@b.co' }), { email: 'a@b.co' });
  assert.equal(ipc.validateRecoverPayload({ email: 'a@b.co', x: 1 }), null);
  assert.deepEqual(ipc.validateProfilePayload({ displayName: 'Ab' }), { displayName: 'Ab' });
  assert.deepEqual(ipc.validateProfilePayload({ mmrVisibility: 'group' }), { mmrVisibility: 'group' });
  assert.equal(ipc.validateProfilePayload({}), null);
  assert.equal(ipc.validateProfilePayload({ displayName: 5 }), null);
  assert.equal(ipc.validateProfilePayload({ displayName: 'x'.repeat(201) }), null);
  assert.equal(ipc.validateProfilePayload({ displayName: 'Ab', id: 'x' }), null);
});

test('remetente não confiável é recusado nos canais de conta e nada vai à rede', async () => {
  const e = build({ routes: [['/', loginOk]] });
  for (const ch of ['gr:auth:signUp', 'gr:auth:signIn', 'gr:auth:signOut', 'gr:auth:recover', 'gr:profile:update', 'gr:account:delete']) {
    assert.ok(Object.values(ipc.CHANNELS).includes(ch), ch);
    const r = await e.call(ch, { email: 'a@b.co', password: PASS, confirm: true, displayName: 'Ab' }, UNTRUSTED);
    assert.equal(r.ok, false, ch);
  }
  assert.equal(e.fetchImpl.calls.length, 0);
});

test('console.error nunca recebe e-mail, senha ou token durante os fluxos', async () => {
  const spy = spyConsole();
  try {
    const e = build({ routes: [
      ['grant_type=password', loginOk], ['/rest/v1/profiles', profileRow],
      ['/auth/v1/signup', () => { throw new Error('falha ana@example.com Segredo!Forte9'); }],
      ['/auth/v1/recover', { status: 500, body: {} }],
    ] });
    await e.call(ipc.CHANNELS.signUp, { email: 'ana@example.com', password: PASS });
    await e.call(ipc.CHANNELS.signIn, { email: 'ana@example.com', password: PASS });
    await e.call(ipc.CHANNELS.recover, { email: 'ana@example.com' });
    await e.call(ipc.CHANNELS.updateProfile, { displayName: 'x' });
    // erro inesperado de verdade também não vaza
    const h = ipc.wrapHandler(ipc.validateEmptyPayload, () => { throw new Error('ana@example.com Segredo!Forte9 token'); });
    await h(TRUSTED);
  } finally { spy.restore(); }
  const all = spy.out.join('\n');
  assert.ok(!all.includes('ana@example.com'));
  assert.ok(!all.includes('Segredo'));
  assert.ok(!all.includes('eyJ'));
});
