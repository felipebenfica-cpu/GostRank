'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { createRest, errorCodeFrom } = require('../../src/main/rest');
const { validateUpload, safeFileName, sniffImage } = require('../../src/main/files');
const { createPrefs, mergePrefs, defaults } = require('../../src/main/prefs');
const { token } = require('./helpers');

const URL = 'https://proj.supabase.co';
const KEY = 'anon-key-123456';

function fetchStub(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    for (const [prefix, h] of routes) {
      if (url.startsWith(URL + prefix)) {
        const r = typeof h === 'function' ? h(url, init) : h;
        return { status: r.status, text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)) };
      }
    }
    return { status: 404, text: async () => '' };
  };
  fn.calls = calls;
  return fn;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0, 0, 0, 0, 200, 8, 2, 0, 0, 0]);

test('rest: RPC com erro do banco vira mensagem em português; função inexistente vira "Atualize o banco (0006)"', async () => {
  const f = fetchStub([
    ['/rest/v1/rpc/send_friend_request', { status: 400, body: { code: 'P0001', message: 'user_not_found' } }],
    ['/rest/v1/rpc/search_users', { status: 404, body: { code: 'PGRST202', message: 'Could not find the function' } }],
    ['/rest/v1/rpc/estranha', { status: 400, body: { code: 'P0001', message: '<script>texto do servidor</script>' } }],
  ]);
  const rest = createRest({ fetchImpl: f, supabaseUrl: URL, anonKey: KEY, getAccessToken: async () => token() });
  await assert.rejects(rest.rpc('send_friend_request', { p_username: 'x' }), /Não encontramos ninguém/);
  await assert.rejects(rest.rpc('search_users', {}), (e) => e.code === 'needs_migration' && /0006/.test(e.message));
  await assert.rejects(rest.rpc('estranha', {}), (e) => e.code === 'bad_response' && !/script/.test(e.message));
  assert.equal(f.calls[0].init.redirect, 'error');
  assert.match(f.calls[0].init.headers.Authorization, /^Bearer /);
});

test('rest: sem sessão não vai à rede', async () => {
  const f = fetchStub([]);
  const rest = createRest({ fetchImpl: f, supabaseUrl: URL, anonKey: KEY, getAccessToken: async () => null });
  await assert.rejects(rest.select('/rest/v1/x'), (e) => e.code === 'unauthenticated');
  assert.equal(f.calls.length, 0);
});

test('rest: upload manda bytes crus com o tipo; sign devolve URL absoluta só do próprio projeto', async () => {
  const f = fetchStub([
    ['/storage/v1/object/attachments/', { status: 200, body: { Key: 'x' } }],
    ['/storage/v1/object/sign/attachments', { status: 200, body: [
      { path: 'a/b.png', signedURL: '/object/sign/attachments/a/b.png?token=1' },
      { path: 'c.png', signedURL: 'https://evil.example/x' },
      { path: 'd.png', error: 'not found', signedURL: null },
    ] }],
  ]);
  const rest = createRest({ fetchImpl: f, supabaseUrl: URL, anonKey: KEY, getAccessToken: async () => token() });
  await rest.upload('attachments', 'g_1/c_1/u/foto ação.png', PNG, 'image/png');
  assert.equal(f.calls[0].init.headers['Content-Type'], 'image/png');
  assert.ok(f.calls[0].url.includes('foto%20a%C3%A7%C3%A3o.png'));
  assert.equal(f.calls[0].init.body, PNG);
  const m = await rest.sign('attachments', ['a/b.png', 'c.png', 'd.png']);
  assert.deepEqual([...m.keys()], ['a/b.png']);
  assert.equal(m.get('a/b.png'), `${URL}/storage/v1/object/sign/attachments/a/b.png?token=1`);
  assert.equal(rest.publicUrl('avatars', '../x'), null);
});

test('rest: hasSchemaV3 distingue banco novo, antigo e sem rede', async () => {
  const mk = (r) => createRest({ fetchImpl: fetchStub([['/rest/v1/channels', r]]), supabaseUrl: URL, anonKey: KEY, getAccessToken: async () => token() });
  assert.equal(await mk({ status: 200, body: [] }).hasSchemaV3(), true);
  assert.equal(await mk({ status: 404, body: { code: 'PGRST205' } }).hasSchemaV3(), false);
  assert.equal(await mk({ status: 500, body: {} }).hasSchemaV3(), null);
  assert.equal(errorCodeFrom(409, { code: '23505', message: 'duplicate key value violates unique constraint "profiles_username_key"' }), 'username_taken');
});

test('files: imagem vale pela assinatura; diz ser imagem mas não é → recusado; tamanho e nome limpos', () => {
  const ok = validateUpload({ name: '../../foto.png', mime: 'image/jpeg', data: PNG.buffer }, 'attachment');
  assert.equal(ok.mime, 'image/png');
  assert.equal(ok.isImage, true);
  assert.equal(ok.name, 'foto.png');
  assert.deepEqual([ok.width, ok.height], [256, 200]);
  assert.throws(() => validateUpload({ name: 'x.png', mime: 'image/png', data: new Uint8Array([1, 2, 3]) }), /Tipo de arquivo/);
  const txt = validateUpload({ name: 'notas.txt', mime: 'text/plain', data: new TextEncoder().encode('oi') });
  assert.equal(txt.mime, 'text/plain');
  const exe = validateUpload({ name: 'a.exe', mime: 'application/x-msdownload', data: new Uint8Array([77, 90]) });
  assert.equal(exe.mime, 'application/octet-stream');
  assert.throws(() => validateUpload({ name: 'a', mime: 'text/plain', data: new Uint8Array(8 * 1024 * 1024 + 1) }), /8 MB/);
  assert.throws(() => validateUpload({ name: 'a.txt', mime: 'text/plain', data: 'texto' }), /Tipo de arquivo/);
  assert.throws(() => validateUpload({ name: 'a.txt', mime: 'text/plain', data: new Uint8Array(10) }, 'image'), /Tipo de arquivo/);
  assert.equal(safeFileName('a<b>|c".txt'), 'a_b__c_.txt');
  assert.equal(safeFileName('...'), 'arquivo');
  assert.equal(sniffImage(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), 'image/gif');
});

test('prefs: padrões, mescla validada, silenciar e arquivo estranho não quebra', () => {
  let saved = null;
  const store = { load: () => ({ appearance: { theme: 'neon', fontScale: 110 }, muted: ['x'], _nav: { mode: 'home' } }), save: (o) => { saved = o; } };
  const p = createPrefs({ store });
  assert.equal(p.get().appearance.theme, 'frostivus');
  assert.equal(p.get().appearance.fontScale, 110);
  assert.deepEqual(p.get().muted, []);
  assert.deepEqual(p.getNav(), { mode: 'home' });
  p.update({ voice: { mode: 'ptt', pttKey: 'KeyB' }, appearance: { theme: 'light' } });
  assert.equal(p.get().voice.mode, 'ptt');
  assert.equal(saved.appearance.theme, 'light');
  assert.throws(() => p.update({ voice: { mode: 'grito' } }), /Preferência inválida/);
  assert.throws(() => p.update({ outra: {} }), /Preferência inválida/);
  assert.throws(() => p.update({ appearance: { fontScale: 300 } }), /Preferência inválida/);
  const t = 'c:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  p.setMuted(t, true);
  assert.equal(p.isMuted(t), true);
  p.setMuted(t, false);
  assert.equal(p.isMuted(t), false);
  assert.throws(() => p.setMuted('c:x', true));
  assert.deepEqual(mergePrefs(defaults(), {}), defaults());
});
