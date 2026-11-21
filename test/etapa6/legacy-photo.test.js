'use strict';
// Foto antiga (0003_social, data: URL JPEG) como reserva do avatar do Storage.
const test = require('node:test');
const assert = require('node:assert');
const { createUserCache, selectWithPhoto, legacyPhoto } = require('../../src/main/users');

const PHOTO = 'data:image/jpeg;base64,/9j/4AD/2Q==';
const ID = '00000000-0000-4000-8000-000000000001';

function fakeRest({ photoColumn = true } = {}) {
  const calls = [];
  return {
    calls,
    publicUrl: (bucket, p) => `https://x.supabase.co/storage/v1/object/public/${bucket}/${p}`,
    async select(q) {
      calls.push(q);
      if (!photoColumn && /photo/.test(q)) {
        const e = new Error('Atualize o banco');
        e.code = 'needs_migration';
        throw e;
      }
      return [{ id: ID, username: 'ana', display_name: 'Ana', avatar_color: 2, avatar_path: null, photo: PHOTO }];
    },
  };
}

test('legacyPhoto aceita só JPEG data: válido', () => {
  assert.strictEqual(legacyPhoto(PHOTO), PHOTO);
  for (const bad of [null, '', 'https://x/y.png', 'data:image/svg+xml;base64,AAAA', 'data:image/jpeg;base64,AAAA']) {
    assert.strictEqual(legacyPhoto(bad), null);
  }
});

test('avatar do Storage tem prioridade; sem ele, cai na foto antiga', () => {
  const cache = createUserCache({ rest: fakeRest() });
  const [semStorage] = cache.upsertRows([{ id: ID, username: 'ana', display_name: 'Ana', photo: PHOTO }]);
  assert.strictEqual(semStorage.avatarUrl, PHOTO);
  const [comStorage] = cache.upsertRows([{ id: ID, username: 'ana', display_name: 'Ana', avatar_path: `${ID}/a.png`, photo: PHOTO }]);
  assert.match(comStorage.avatarUrl, /\/avatars\//);
  const [nada] = cache.upsertRows([{ id: ID, username: 'ana', display_name: 'Ana', photo: 'data:image/png;base64,xx' }]);
  assert.strictEqual(nada.avatarUrl, null);
});

test('pede a coluna photo e, se ela não existir, lembra e pede sem ela', async () => {
  const rest = fakeRest({ photoColumn: false });
  const cache = createUserCache({ rest });
  await cache.ensure([ID]);
  assert.strictEqual(rest.calls.length, 2);
  assert.match(rest.calls[0], /,photo&/);
  assert.doesNotMatch(rest.calls[1], /photo/);
  await cache.ensure([ID], { force: true });
  assert.strictEqual(rest.calls.length, 3, 'não tenta photo de novo');
  assert.doesNotMatch(rest.calls[2], /photo/);
});

test('se faltar mais que a photo (sem 0006), o erro sobe e nada é lembrado', async () => {
  const rest = {
    calls: [],
    async select(q) { this.calls.push(q); const e = new Error('x'); e.code = 'needs_migration'; throw e; },
  };
  await assert.rejects(selectWithPhoto(rest, (c) => `/rest/v1/profiles?select=${c}`, 'id,username'), (e) => e.code === 'needs_migration');
  await assert.rejects(selectWithPhoto(rest, (c) => `/rest/v1/profiles?select=${c}`, 'id,username'));
  assert.match(rest.calls[2], /,photo$/, 'tentou photo de novo');
});
