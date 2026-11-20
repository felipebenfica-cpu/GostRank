'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSessionManager } = require('../../src/main/session');
const { createStore } = require('../../src/main/store');
const { AuthError } = require('../../src/main/auth');
const { UID, jwt } = require('./helpers');

const T = 1_800_000_000;
const fakeEnc = () => ({
  isAvailable: () => true,
  encrypt: (s) => Buffer.from(s, 'utf8').reverse(),
  decrypt: (b) => Buffer.from(b).reverse().toString('utf8'),
});
const mkSession = (over = {}) => ({
  accessToken: jwt(), refreshToken: 'r1', expiresAt: T + 3600,
  user: { id: UID, email: 'ana@example.com', emailConfirmed: true }, ...over,
});
function env(auth, over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-sess-'));
  const file = path.join(dir, 'ghost-rank-session.dat');
  const store = createStore({ filePath: file, encryptor: fakeEnc() });
  const clock = { t: T * 1000 };
  const mgr = () => createSessionManager({ store, auth, now: () => clock.t, ...over });
  return { dir, file, store, clock, mgr };
}

test('sessão é gravada cifrada (GR1E) e nada legível no disco', () => {
  const { file, mgr } = env({});
  mgr().set(mkSession({ refreshToken: 'refresh-super-secreto' }));
  const raw = fs.readFileSync(file);
  assert.ok(raw.subarray(0, 4).equals(Buffer.from('GR1E')));
  const txt = raw.toString('utf8');
  assert.ok(!txt.includes('refresh-super-secreto'));
  assert.ok(!txt.includes('ana@example.com'));
});

test('persiste entre instâncias; get devolve sem renovar quando falta mais de 60 s', async () => {
  let calls = 0;
  const e = env({ refresh: async () => { calls++; } });
  e.mgr().set(mkSession());
  const s = await e.mgr().get();
  assert.equal(s.user.email, 'ana@example.com');
  assert.equal(calls, 0);
});

test('renova sozinho quando faltam menos de 60 s e grava a nova sessão', async () => {
  const next = mkSession({ refreshToken: 'r2', expiresAt: T + 7200 });
  let calls = 0;
  const e = env({ refresh: async (rt) => { calls++; assert.equal(rt, 'r1'); return next; } });
  const m = e.mgr();
  m.set(mkSession({ expiresAt: T + 30 }));
  const [a, b] = await Promise.all([m.get(), m.get()]);
  assert.equal(calls, 1); // renovação única
  assert.equal(a.refreshToken, 'r2');
  assert.equal(b.refreshToken, 'r2');
  assert.equal(e.mgr().peek().refreshToken, 'r2');
});

test('falha de renovação por rede/timeout/limite mantém a sessão', async () => {
  for (const code of ['network', 'timeout', 'rate_limited', 'bad_response']) {
    const e = env({ refresh: async () => { throw new AuthError(code); } });
    const m = e.mgr();
    m.set(mkSession({ expiresAt: T + 10 }));
    const s = await m.get();
    assert.equal(s.refreshToken, 'r1', code);
    assert.ok(fs.existsSync(e.file), code);
  }
});

test('recusa na renovação apaga a sessão', async () => {
  const e = env({ refresh: async () => { throw new AuthError('invalid_credentials'); } });
  const m = e.mgr();
  m.set(mkSession({ expiresAt: T - 5 }));
  assert.equal(await m.get(), null);
  assert.equal(m.peek(), null);
  assert.equal(fs.existsSync(e.file), false);
});

test('clear apaga arquivo; arquivo corrompido ou inválido -> null', async () => {
  const e = env({});
  const m = e.mgr();
  m.set(mkSession());
  m.clear();
  assert.equal(fs.existsSync(e.file), false);
  assert.equal(await m.get(), null);
  e.store.save({ version: 1, accessToken: 5 });
  assert.equal(e.mgr().peek(), null);
  fs.writeFileSync(e.file, 'lixo');
  assert.equal(e.mgr().peek(), null);
});

test('erro ao gravar não derruba: sessão fica em memória', async () => {
  const store = { load: () => null, save: () => { throw new Error('sem cifra'); }, clear: () => {} };
  const m = createSessionManager({ store, auth: {}, now: () => T * 1000 });
  m.set(mkSession());
  assert.equal((await m.get()).user.id, UID);
});
