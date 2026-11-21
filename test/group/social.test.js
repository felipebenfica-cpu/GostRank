'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSocialClient } = require('../../src/main/social');
const { UID, URL_OK, KEY, jwt, fakeFetch } = require('../auth/helpers');

const client = (fetchImpl) => createSocialClient({
  fetchImpl, supabaseUrl: URL_OK, anonKey: KEY, getAccessToken: async () => jwt(),
});

test('lista recupera todos os amigos usando o último id como cursor', async () => {
  const rows = Array.from({ length: 13 }, (_, idx) => ({
    id: '00000000-0000-0000-0000-' + String(idx + 1).padStart(12, '0'),
    name: 'Pessoa ' + idx, state: 'friend', photo: null, discoverable: null,
  }));
  const fetch = fakeFetch((_url, { body }) => ({
    status: 200, body: JSON.parse(body).p_after ? rows.slice(12) : rows.slice(0, 12),
  }));
  assert.deepEqual(await client(fetch)('list'), { rows });
  assert.deepEqual(fetch.calls.map(c => c.body), [
    { p_query: null, p_after: null }, { p_query: null, p_after: rows[11].id },
  ]);
});

test('busca só encaminha o texto e ações usam alvo explícito', async () => {
  const fetch = fakeFetch({ status: 200, body: [] });
  const social = client(fetch);
  assert.deepEqual(await social('search', '  Felipe  '), { rows: [] });
  for (const action of ['send', 'accept', 'remove']) await social(action, UID);
  assert.deepEqual(fetch.calls.map(c => c.body), [
    { p_query: 'Felipe', p_after: null },
    ...['send','accept','remove'].map(action => ({ p_action: action, p_target: UID })),
  ]);
});

test('entradas inválidas são recusadas sem chamar a rede', async () => {
  const fetch = fakeFetch({ status: 200, body: [] });
  const social = client(fetch);
  for (const [action, value] of [
    ['profilePhoto', 'https://example.com/foto.jpg'], ['groupPhoto', 'data:image/jpeg;base64,AAAA'],
    ['privacy', 'false'], ['send', 'x'], ['search', ' x '],
  ]) await assert.rejects(social(action, value));
  assert.equal(fetch.calls.length, 0);
});
