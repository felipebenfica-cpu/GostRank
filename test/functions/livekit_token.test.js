'use strict';
// Token do LiveKit: confere a assinatura HS256 recalculando com node:crypto.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const path = require('node:path');

const modPath = path.join(__dirname, '..', '..', 'supabase', 'functions', '_shared', 'livekit_token.js');
const load = () => import(modPath);

const b64urlDecode = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
const base = {
  apiKey: 'APIabc123',
  apiSecret: 'segredo-super-longo-de-teste-0123456789',
  identity: '11111111-1111-1111-1111-111111111111',
  name: 'Ana',
  room: 'grupo-22222222-2222-2222-2222-222222222222',
  now: 1_700_000_000_500,
};

test('JWT HS256 verificavel com header, payload, grants, nbf e exp', async () => {
  const { createLiveKitToken } = await load();
  const jwt = await createLiveKitToken(base);
  const parts = jwt.split('.');
  assert.strictEqual(parts.length, 3);
  for (const p of parts) assert.match(p, /^[A-Za-z0-9_-]+$/);
  const expected = crypto.createHmac('sha256', base.apiSecret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  assert.strictEqual(parts[2], expected);
  assert.deepStrictEqual(b64urlDecode(parts[0]), { alg: 'HS256', typ: 'JWT' });
  const payload = b64urlDecode(parts[1]);
  assert.deepStrictEqual(payload, {
    iss: 'APIabc123',
    sub: base.identity,
    nbf: 1_700_000_000 - 60,
    exp: 1_700_003_600,
    name: 'Ana',
    video: {
      room: base.room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
    },
  });
});

test('assinatura com outro segredo nao confere', async () => {
  const { createLiveKitToken } = await load();
  const jwt = await createLiveKitToken(base);
  const [h, p, s] = jwt.split('.');
  const wrong = crypto.createHmac('sha256', 'outro').update(`${h}.${p}`).digest('base64url');
  assert.notStrictEqual(s, wrong);
});

test('ttl personalizado e nome opcional; caracteres nao ASCII no nome', async () => {
  const { createLiveKitToken } = await load();
  const jwt = await createLiveKitToken({ ...base, name: 'João ção', ttlSeconds: 600 });
  const payload = b64urlDecode(jwt.split('.')[1]);
  assert.strictEqual(payload.exp - payload.nbf, 660);
  assert.strictEqual(payload.name, 'João ção');
  const semNome = b64urlDecode((await createLiveKitToken({ ...base, name: undefined })).split('.')[1]);
  assert.ok(!('name' in semNome));
});

test('entradas invalidas sao recusadas', async () => {
  const { createLiveKitToken } = await load();
  for (const bad of [
    { apiKey: '' }, { apiSecret: undefined }, { identity: 5 }, { room: '' },
    { ttlSeconds: 10 }, { ttlSeconds: 1.5 }, { ttlSeconds: 999999 }, { now: NaN }, { name: 'x'.repeat(200) },
  ]) {
    await assert.rejects(createLiveKitToken({ ...base, ...bad }), TypeError, JSON.stringify(bad));
  }
});

test('roomForGroup usa o prefixo grupo-', async () => {
  const { roomForGroup } = await load();
  assert.strictEqual(roomForGroup('abc'), 'grupo-abc');
});
