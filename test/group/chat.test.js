'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatClient, createChatFeed, validateBody } = require('../../src/main/chat');
const { URL_OK, KEY, UID, jwt, fakeFetch, spyConsole } = require('../auth/helpers');

const TOKEN = jwt();
const GID = '11111111-2222-4333-8444-555555555555';
const U2 = '22222222-3333-4444-8555-666666666666';

const mk = (f) => createChatClient({ fetchImpl: f, supabaseUrl: URL_OK, anonKey: KEY, getAccessToken: async () => TOKEN });
const row = (id, user = U2, body = `msg ${id}`) => ({ id, user_id: user, body, created_at: '2026-11-20T10:00:00Z' });

test('validateBody: 1..1000 após trim, sem controle', () => {
  assert.deepEqual(validateBody('  oi  '), { ok: true, value: 'oi' });
  assert.deepEqual(validateBody('linha 1\nlinha 2'), { ok: true, value: 'linha 1\nlinha 2' });
  assert.equal(validateBody('   ').code, 'empty_body');
  assert.equal(validateBody('').code, 'empty_body');
  assert.equal(validateBody(5).ok, false);
  assert.equal(validateBody('x'.repeat(1001)).code, 'long_body');
  assert.equal(validateBody('😀'.repeat(1000)).ok, true); // conta caracteres, não unidades UTF-16
  assert.equal(validateBody('a\u0000b').code, 'invalid_body');
});

test('fetchSince sem afterId: as mais recentes, devolvidas em ordem crescente', async () => {
  const f = fakeFetch({ status: 200, body: [row(5), row(4), row(3)] });
  const out = await mk(f).fetchSince(GID, 0);
  assert.deepEqual(out.map((m) => m.id), [3, 4, 5]);
  assert.deepEqual(out[0], { id: 3, userId: U2, body: 'msg 3', createdAt: Date.parse('2026-11-20T10:00:00Z') });
  assert.equal(f.calls[0].url, `${URL_OK}/rest/v1/messages?select=id,user_id,body,created_at,edited_at&group_id=eq.${GID}&order=id.desc&limit=50`);
  assert.equal(f.calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
});

test('fetchSince com afterId: id=gt e ordem crescente; limite até 200; descarta linhas ruins', async () => {
  const f = fakeFetch({ status: 200, body: [row(11), { id: 'x' }, row(12, 'nao-uuid'), row(13)] });
  const out = await mk(f).fetchSince(GID, 10, 500);
  assert.deepEqual(out.map((m) => m.id), [11, 13]);
  assert.equal(f.calls[0].url, `${URL_OK}/rest/v1/messages?select=id,user_id,body,created_at,edited_at&group_id=eq.${GID}&id=gt.10&order=id.asc&limit=200`);
  await assert.rejects(mk(f).fetchSince('lixo', 0), (e) => e.code === 'not_in_group');
  await assert.rejects(mk(fakeFetch({ status: 200, body: {} })).fetchSince(GID, 0), (e) => e.code === 'bad_response');
});

test('send: valida antes da rede, envia group_id/user_id do token e body aparado', async () => {
  const f = fakeFetch({ status: 201, body: [row(7, UID, 'olá')] });
  const c = mk(f);
  for (const bad of ['', '   ', 'x'.repeat(1001), null]) {
    await assert.rejects(c.send(GID, bad), (e) => e.name === 'UserInputError', String(bad));
  }
  assert.equal(f.calls.length, 0);
  const m = await c.send(GID, '  olá  ');
  assert.equal(m.id, 7);
  assert.equal(f.calls[0].url, `${URL_OK}/rest/v1/messages?select=id,user_id,body,created_at`);
  assert.equal(f.calls[0].init.method, 'POST');
  assert.deepEqual(f.calls[0].body, { group_id: GID, user_id: UID, body: 'olá' });
  assert.match(f.calls[0].init.headers.Prefer, /return=representation/);
  await assert.rejects(mk(fakeFetch({ status: 400, body: { code: 'P0001', message: 'rate_limited' } })).send(GID, 'oi'),
    (e) => e.code === 'rate_limited' && /Aguarde/.test(e.message));
});

function fakeTimers() {
  const t = { active: new Map(), next: 1 };
  t.setInterval = (fn, ms) => { const id = t.next++; t.active.set(id, { fn, ms }); return id; };
  t.clearInterval = (id) => { t.active.delete(id); };
  t.tick = async () => { for (const { fn } of [...t.active.values()]) fn(); await new Promise((r) => setImmediate(r)); };
  return t;
}

function fakeChatClient() {
  const c = { all: [], calls: [], fail: false };
  c.fetchSince = async (groupId, afterId, limit) => {
    c.calls.push({ groupId, afterId, limit });
    if (c.fail) throw new Error('rede');
    const newer = c.all.filter((m) => m.id > afterId);
    return afterId > 0 ? newer.slice(0, limit) : newer.slice(-limit);
  };
  c.fetchRecent = async (groupId, previous, limit) => {
    c.calls.push({ groupId, previous, limit });
    if (c.fail) throw new Error('rede');
    return c.all.slice(-limit).map(m => ({ ...m }));
  };
  c.send = async (groupId, body) => {
    const m = { id: (c.all.at(-1)?.id ?? 0) + 1, userId: UID, body, createdAt: 1 };
    c.all.push(m);
    return m;
  };
  c.add = (n, user = U2) => {
    for (let i = 0; i < n; i++) c.all.push({ id: (c.all.at(-1)?.id ?? 0) + 1, userId: user, body: 'x', createdAt: 1 });
  };
  return c;
}

const members = [{ userId: UID, displayName: 'Eu', isMe: true }, { userId: U2, displayName: 'Colega', isMe: false }];

test('feed: só sonda com grupo E janela focada, a cada 4 s; para ao sair do grupo', async () => {
  const timers = fakeTimers();
  const client = fakeChatClient();
  let changes = 0;
  const feed = createChatFeed({ client, timers, onChange: () => { changes++; } });
  feed.setFocused(true);
  assert.equal(timers.active.size, 0); // sem grupo
  feed.setContext({ groupId: GID, members });
  assert.equal(timers.active.size, 1);
  assert.equal([...timers.active.values()][0].ms, 4000);
  feed.setFocused(false);
  assert.equal(timers.active.size, 0); // sem foco
  client.add(2);
  feed.setFocused(true);
  await new Promise((r) => setImmediate(r));
  assert.equal(feed.getView().messages.length, 2);
  assert.ok(changes > 0);
  client.add(1);
  await timers.tick();
  const v = feed.getView();
  assert.deepEqual(v.messages.map((m) => m.id), [1, 2, 3]);
  assert.equal(v.messages[0].displayName, 'Colega');
  assert.equal(v.messages[0].mine, false);
  assert.deepEqual(client.calls.at(-1).previous.map(m => m.id), [1, 2]);
  feed.setContext(null); // saiu do grupo / da conta
  assert.equal(timers.active.size, 0);
  assert.deepEqual(feed.getView(), { messages: [], status: 'idle' });
});

test('feed: guarda no máximo 200 mensagens e send busca de novo (sem pular alheias)', async () => {
  const timers = fakeTimers();
  const client = fakeChatClient();
  const feed = createChatFeed({ client, timers });
  feed.setContext({ groupId: GID, members });
  client.add(150);
  await feed.poll();
  client.add(150);
  await feed.poll(); // 50 por vez
  await feed.poll();
  await feed.poll();
  const ids = feed.getView().messages.map((m) => m.id);
  assert.equal(ids.length, 200);
  assert.equal(ids[0], 101);
  assert.equal(ids.at(-1), 300);
  client.add(1); // mensagem alheia ainda não lida
  await feed.send('oi');
  const v = feed.getView();
  assert.equal(v.messages.at(-2).id, 301);
  assert.equal(v.messages.at(-1).mine, true);
  assert.equal(v.messages.length, 200);
});

test('feed: erro de rede vira status error e se recupera; troca de grupo zera mensagens', async () => {
  const client = fakeChatClient();
  const feed = createChatFeed({ client, timers: fakeTimers() });
  feed.setContext({ groupId: GID, members });
  client.add(3);
  await feed.poll();
  client.fail = true;
  await feed.poll();
  assert.equal(feed.getView().status, 'error');
  assert.equal(feed.getView().messages.length, 3);
  client.fail = false;
  await feed.poll();
  assert.equal(feed.getView().status, 'idle');
  feed.setContext({ groupId: '99999999-2222-4333-8444-555555555555', members });
  assert.equal(feed.getView().messages.length, 0);
  await assert.rejects(createChatFeed({ client }).send('oi'), (e) => e.code === 'not_in_group');
});

test('texto de chat e token nunca vão para o console', async () => {
  const spy = spyConsole();
  try {
    await mk(fakeFetch({ status: 201, body: [row(1, UID, 'segredo do chat')] })).send(GID, 'segredo do chat');
    await mk(fakeFetch(new Error('segredo do chat'))).send(GID, 'segredo do chat').catch(() => {});
    const client = fakeChatClient();
    client.fail = true;
    const feed = createChatFeed({ client, timers: fakeTimers() });
    feed.setContext({ groupId: GID, members });
    await feed.poll();
  } finally { spy.restore(); }
  const all = spy.out.join('\n');
  assert.ok(!all.includes('segredo do chat'));
  assert.ok(!all.includes(TOKEN));
});

test('cliente edita e exclui só id, grupo e usuário da sessão, detectando alteração sem linha', async () => {
  const f = fakeFetch({ status: 200, body: [{ ...row(12, UID, 'revista'), edited_at: '2026-11-21T12:00:00Z' }] });
  const client = mk(f);
  await client.edit(GID, 12, ' revista ');
  await client.remove(GID, 12);
  const [edit, remove] = f.calls;
  assert.equal(edit.init.method, 'PATCH');
  assert.deepEqual(edit.body, { body: 'revista' });
  assert.equal(remove.init.method, 'DELETE');
  for (const call of f.calls) {
    const query = new URL(call.url).searchParams;
    assert.equal(query.get('id'), 'eq.12');
    assert.equal(query.get('group_id'), 'eq.' + GID);
    assert.equal(query.get('user_id'), 'eq.' + UID);
    assert.equal(call.init.headers.Authorization, 'Bearer ' + TOKEN);
    assert.match(call.init.headers.Prefer, /return=representation/);
  }
  const denied = mk(fakeFetch({ status: 200, body: [] }));
  await assert.rejects(denied.edit(GID, 12, 'tentativa'));
  await assert.rejects(denied.remove(GID, 12));
});

test('feed reconhece edição e exclusão remotas mesmo sem mudar o último ID', async () => {
  const client = fakeChatClient();
  const feed = createChatFeed({ client, timers: fakeTimers() });
  feed.setContext({ groupId: GID, members });
  client.add(3);
  await feed.poll();
  client.all[1] = { ...client.all[1], body: 'corrigida', editedAt: Date.now() };
  await feed.poll();
  const second = feed.getView().messages[1];
  assert.equal(second.body, 'corrigida');
  assert.equal(second.editedAt, client.all[1].editedAt);
  client.all.splice(1,1);
  await feed.poll();
  assert.deepEqual(feed.getView().messages.map(m => m.id), [1,3]);
});
