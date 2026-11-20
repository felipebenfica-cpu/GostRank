'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createProfileClient } = require('../../src/main/profile');
const { AuthError } = require('../../src/main/auth');
const { UID, URL_OK, KEY, jwt, fakeFetch } = require('./helpers');

const TOKEN = jwt();
const mk = (f, getAccessToken = async () => TOKEN) => createProfileClient({ fetchImpl: f, supabaseUrl: URL_OK, anonKey: KEY, getAccessToken });
const row = { display_name: 'Fantasma', mmr_visibility: 'friends', steam_account_id: null };

test('get: GET com token do usuário e id vindo do token', async () => {
  const f = fakeFetch({ status: 200, body: [{ ...row, steam_account_id: 123456 }] });
  const p = await mk(f).get();
  assert.deepEqual(p, { displayName: 'Fantasma', mmrVisibility: 'friends', steamAccountId: 123456 });
  const c = f.calls[0];
  assert.equal(c.url, `${URL_OK}/rest/v1/profiles?select=display_name,mmr_visibility,steam_account_id&id=eq.${UID}`);
  assert.equal(c.init.method, 'GET');
  assert.equal(c.init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(c.init.headers.apikey, KEY);
});

test('get: perfil ausente/ruim, 401 e sem sessão', async () => {
  await assert.rejects(mk(fakeFetch({ status: 200, body: [] })).get(), (e) => e.code === 'bad_response');
  await assert.rejects(mk(fakeFetch({ status: 401, body: {} })).get(), (e) => e.code === 'unauthenticated');
  await assert.rejects(mk(fakeFetch({ status: 200, body: [row] }), async () => null).get(), (e) => e instanceof AuthError && e.code === 'unauthenticated');
  await assert.rejects(mk(fakeFetch({ status: 200, body: [row] }), async () => 'a.b.c').get(), (e) => e.code === 'unauthenticated');
});

test('get: visibilidade desconhecida vira friends; steam inválido vira null', async () => {
  const p = await mk(fakeFetch({ status: 200, body: [{ display_name: null, mmr_visibility: 'xx', steam_account_id: 'abc' }] })).get();
  assert.deepEqual(p, { displayName: null, mmrVisibility: 'friends', steamAccountId: null });
});

test('update: valida antes de enviar e envia PATCH só com colunas permitidas', async () => {
  const f = fakeFetch({ status: 200, body: [{ ...row, display_name: 'Novo Nome', mmr_visibility: 'nobody' }] });
  const p = await mk(f).update({ displayName: '  Novo Nome ', mmrVisibility: 'nobody' });
  assert.equal(p.displayName, 'Novo Nome');
  assert.equal(p.mmrVisibility, 'nobody');
  const c = f.calls[0];
  assert.equal(c.url, `${URL_OK}/rest/v1/profiles?id=eq.${UID}`);
  assert.equal(c.init.method, 'PATCH');
  assert.deepEqual(c.body, { display_name: 'Novo Nome', mmr_visibility: 'nobody' });
});

test('update: entrada inválida não chega à rede', async () => {
  const f = fakeFetch({ status: 200, body: [row] });
  const m = mk(f);
  for (const bad of [{ displayName: '<b>' }, { displayName: 'x' }, { mmrVisibility: 'public' }, {}, null, { steamAccountId: 5 }]) {
    await assert.rejects(m.update(bad), (e) => e.code === 'invalid' && typeof e.message === 'string', JSON.stringify(bad));
  }
  assert.equal(f.calls.length, 0);
  // `id` na tela é ignorado: o alvo é sempre o do token
  await m.update({ displayName: 'Ok Nome', id: 'outro' }).catch(() => {});
  assert.ok(f.calls[0].url.endsWith(`id=eq.${UID}`));
  assert.ok(!('id' in f.calls[0].body));
});

test('update: RLS que nega (lista vazia) vira erro', async () => {
  await assert.rejects(mk(fakeFetch({ status: 200, body: [] })).update({ displayName: 'Ok Nome' }), (e) => e.code === 'bad_response');
});

test('deleteAccount: POST /rest/v1/rpc/delete_my_account', async () => {
  const f = fakeFetch({ status: 204 });
  assert.deepEqual(await mk(f).deleteAccount(), { ok: true });
  assert.equal(f.calls[0].url, `${URL_OK}/rest/v1/rpc/delete_my_account`);
  assert.equal(f.calls[0].init.method, 'POST');
  assert.equal(f.calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  await assert.rejects(mk(fakeFetch({ status: 500, body: {} })).deleteAccount(), (e) => e.code === 'bad_response');
  await assert.rejects(mk(fakeFetch(new TypeError('x'))).deleteAccount(), (e) => e.code === 'network');
});

test('recusa URL não-supabase', () => {
  assert.throws(() => createProfileClient({ fetchImpl: fakeFetch({}), supabaseUrl: 'https://evil.com', anonKey: KEY, getAccessToken: async () => TOKEN }), (e) => e.code === 'unconfigured');
});
