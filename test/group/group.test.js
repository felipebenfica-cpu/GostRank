'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createGroupClient, createGroupService, computeProgress, validateGroupName, normalizeInviteCode, MESSAGES,
} = require('../../src/main/group');
const { UID, URL_OK, KEY, jwt, fakeFetch, spyConsole } = require('../auth/helpers');

const TOKEN = jwt();
const GID = '11111111-2222-4333-8444-555555555555';
const U2 = '22222222-3333-4444-8555-666666666666';
const U3 = '33333333-4444-4555-8666-777777777777';

function router(routes) {
  return fakeFetch(async (url, init) => {
    for (const [frag, resp] of routes) {
      if (url.includes(frag)) return typeof resp === 'function' ? resp(url, init) : resp;
    }
    return { status: 404, body: {} };
  });
}

const mk = (f, getAccessToken = async () => TOKEN) => createGroupClient({
  fetchImpl: f, supabaseUrl: URL_OK, anonKey: KEY, getAccessToken,
});

function groupRoutes({ snapshots, members, profiles } = {}) {
  return [
    [`group_members?select=group_id,groups(id,name,owner_id)&user_id=eq.${UID}`, {
      status: 200, body: [{ group_id: GID, groups: { id: GID, name: 'Os Fantasmas', owner_id: U2 } }],
    }],
    [`group_members?select=user_id,joined_at&group_id=eq.${GID}`, {
      status: 200,
      body: members || [
        { user_id: U2, joined_at: '2026-01-01T00:00:00Z' },
        { user_id: UID, joined_at: '2026-01-02T00:00:00Z' },
        { user_id: U3, joined_at: '2026-01-03T00:00:00Z' },
      ],
    }],
    ['/rest/v1/profiles?select=id,display_name&id=in.', {
      status: 200,
      body: profiles || [{ id: U2, display_name: 'Dono' }, { id: UID, display_name: 'Eu Mesmo' }, { id: U3, display_name: null }],
    }],
    ['/rest/v1/mmr_snapshots?select=', {
      status: 200,
      body: snapshots || [
        { user_id: UID, current_mmr: 3500, goal_mmr: 4000, start_mmr: 3000, wins: 10, losses: 5, status: 'on_track', updated_at: '2026-11-01T00:00:00Z' },
        { user_id: U2, current_mmr: 5000, goal_mmr: 4500, start_mmr: 4000, wins: 20, losses: 2, status: 'goal_reached', updated_at: '2026-11-02T00:00:00Z' },
      ],
    }],
  ];
}

test('computeProgress: fração limitada e meta <= início', () => {
  assert.equal(computeProgress(3500, 3000, 4000), 0.5);
  assert.equal(computeProgress(2000, 3000, 4000), 0);
  assert.equal(computeProgress(9000, 3000, 4000), 1);
  assert.equal(computeProgress(3000, 3000, 3000), 1);
  assert.equal(computeProgress(2999, 3000, 3000), 0);
  assert.equal(computeProgress(2500, 3000, 2500), 1);
  assert.equal(computeProgress(2400, 3000, 2500), 0);
});

test('validações puras de nome e código', () => {
  assert.deepEqual(validateGroupName('  Os Fantasmas '), { ok: true, value: 'Os Fantasmas' });
  for (const bad of ['a', 'x'.repeat(33), '<b>', 'a\nb', 5, null]) assert.equal(validateGroupName(bad).ok, false, String(bad));
  assert.equal(normalizeInviteCode(' abcdefgh23 '), 'ABCDEFGH23');
  for (const bad of ['ABCDEFGH2', 'ABCDEFGH234', 'ABCDEFGH0O', 'ABCDEFGHI1', 'ABCDEFGHL2', 5]) {
    assert.equal(normalizeInviteCode(bad), null, String(bad));
  }
});

test('load: sem grupo → null, com uma só consulta e id vindo do token', async () => {
  const f = router([['group_members?select=group_id', { status: 200, body: [] }]]);
  assert.equal(await mk(f).load(), null);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, `${URL_OK}/rest/v1/group_members?select=group_id,groups(id,name,owner_id)&user_id=eq.${UID}`);
  assert.equal(f.calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(f.calls[0].init.redirect, 'error');
  assert.ok(f.calls[0].init.signal);
});

test('load: com grupo junta membros, apelidos e snapshots (progress calculado)', async () => {
  const f = router(groupRoutes());
  const g = await mk(f).load();
  assert.equal(g.id, GID);
  assert.equal(g.name, 'Os Fantasmas');
  assert.equal(g.isOwner, false);
  assert.deepEqual(g.members.map((m) => [m.userId, m.displayName, m.isMe, m.isOwner]), [
    [U2, 'Dono', false, true],
    [UID, 'Eu Mesmo', true, false],
    [U3, null, false, false],
  ]);
  assert.deepEqual(g.members[1].mmr, {
    current: 3500, goal: 4000, start: 3000, wins: 10, losses: 5, status: 'on_track', progress: 0.5,
    updatedAt: Date.parse('2026-11-01T00:00:00Z'),
  });
  assert.equal(g.members[0].mmr.progress, 1);
  assert.equal(g.members[2].mmr, null); // MMR escondido (RLS não devolveu)
  const urls = f.calls.map((c) => c.url);
  assert.ok(urls.some((u) => u.includes(`/rest/v1/profiles?select=id,display_name&id=in.(${U2},${UID},${U3})`)));
  assert.ok(urls.some((u) => u.includes(`/rest/v1/mmr_snapshots?select=user_id,current_mmr,goal_mmr,start_mmr,wins,losses,status,updated_at&user_id=in.(${U2},${UID},${U3})`)));
  assert.equal(f.calls.length, 4);
});

test('load: snapshot com valores fora do formato vira null; resposta ruim vira erro', async () => {
  const f = router(groupRoutes({ snapshots: [{ user_id: UID, current_mmr: 99999, goal_mmr: 1, start_mmr: 1, wins: 0, losses: 0, status: 'on_track' }] }));
  const g = await mk(f).load();
  assert.equal(g.members.find((m) => m.isMe).mmr, null);
  const bad = router([['group_members?select=group_id', { status: 200, body: [{ group_id: GID, groups: { id: 'x', name: 1 } }] }]]);
  await assert.rejects(mk(bad).load(), (e) => e.name === 'UserInputError' && e.code === 'bad_response');
  const badMember = router(groupRoutes({ members: [{ user_id: 'nao-uuid' }] }));
  await assert.rejects(mk(badMember).load(), (e) => e.code === 'bad_response');
});

test('load: sem sessão, 401, rede e timeout viram mensagens em português', async () => {
  await assert.rejects(mk(router([]), async () => null).load(), (e) => e.name === 'UserInputError' && e.message === MESSAGES.unauthenticated);
  await assert.rejects(mk(fakeFetch({ status: 401, body: {} })).load(), (e) => e.code === 'unauthenticated');
  await assert.rejects(mk(fakeFetch(new TypeError('off'))).load(), (e) => e.code === 'network' && /internet/.test(e.message));
  await assert.rejects(mk(fakeFetch({ status: 429, body: {} })).load(), (e) => e.code === 'rate_limited');
  const slow = createGroupClient({
    fetchImpl: (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' })))),
    supabaseUrl: URL_OK, anonKey: KEY, getAccessToken: async () => TOKEN, timeoutMs: 20,
  });
  await assert.rejects(slow.load(), (e) => e.code === 'timeout');
});

test('create: valida nome antes da rede e chama rpc/create_group', async () => {
  const f = fakeFetch({ status: 200, body: JSON.stringify(GID) });
  const c = mk(f);
  await assert.rejects(c.create('x'), (e) => e.code === 'invalid_name' && /2 a 32/.test(e.message));
  await assert.rejects(c.create('<script>'), (e) => e.code === 'invalid_name');
  assert.equal(f.calls.length, 0);
  assert.equal(await c.create('  Os Fantasmas  '), GID);
  assert.equal(f.calls[0].url, `${URL_OK}/rest/v1/rpc/create_group`);
  assert.equal(f.calls[0].init.method, 'POST');
  assert.deepEqual(f.calls[0].body, { p_name: 'Os Fantasmas' });
  const dup = mk(fakeFetch({ status: 400, body: { code: 'P0001', message: 'already_in_group' } }));
  await assert.rejects(dup.create('Outro Grupo'), (e) => e.code === 'already_in_group' && e.message === MESSAGES.already_in_group);
});

test('invite: devolve código e validade (ms); só dono', async () => {
  const f = fakeFetch({ status: 200, body: [{ code: 'ABCDEFGH23', expires_at: '2026-11-27T00:00:00Z' }] });
  assert.deepEqual(await mk(f).invite(), { code: 'ABCDEFGH23', expiresAt: Date.parse('2026-11-27T00:00:00Z') });
  assert.equal(f.calls[0].url, `${URL_OK}/rest/v1/rpc/create_invite`);
  await assert.rejects(mk(fakeFetch({ status: 400, body: { message: 'not_owner' } })).invite(), (e) => e.message === MESSAGES.not_owner);
  await assert.rejects(mk(fakeFetch({ status: 200, body: [{ code: 'lixo', expires_at: 'x' }] })).invite(), (e) => e.code === 'bad_response');
});

test('join: normaliza código, mapeia todos os erros do banco', async () => {
  const f = fakeFetch({ status: 200, body: JSON.stringify(GID) });
  assert.equal(await mk(f).join(' abcdefgh23 '), GID);
  assert.deepEqual(f.calls[0].body, { p_code: 'ABCDEFGH23' });
  assert.equal(f.calls[0].url, `${URL_OK}/rest/v1/rpc/join_group`);
  const none = fakeFetch({ status: 200, body: JSON.stringify(GID) });
  await assert.rejects(mk(none).join('curto'), (e) => e.code === 'invalid_invite');
  assert.equal(none.calls.length, 0);
  for (const code of ['already_in_group', 'invalid_invite', 'group_full', 'not_in_group', 'not_owner', 'invalid_name', 'rate_limited']) {
    const c = mk(fakeFetch({ status: 400, body: { code: 'P0001', message: code, details: null, hint: null } }));
    await assert.rejects(c.join('ABCDEFGH23'), (e) => e.name === 'UserInputError' && e.code === code && e.message === MESSAGES[code], code);
  }
  // mensagem desconhecida do servidor nunca chega à tela
  await assert.rejects(mk(fakeFetch({ status: 400, body: { message: 'texto interno do banco' } })).join('ABCDEFGH23'),
    (e) => e.code === 'bad_response' && !e.message.includes('interno'));
});

test('leave e remove', async () => {
  const f = fakeFetch({ status: 204 });
  assert.deepEqual(await mk(f).leave(), { ok: true });
  assert.equal(f.calls[0].url, `${URL_OK}/rest/v1/rpc/leave_group`);
  assert.deepEqual(f.calls[0].body, {});
  const r = fakeFetch({ status: 204 });
  assert.deepEqual(await mk(r).remove(U2.toUpperCase()), { ok: true });
  assert.equal(r.calls[0].url, `${URL_OK}/rest/v1/rpc/remove_member`);
  assert.deepEqual(r.calls[0].body, { p_user_id: U2 });
  await assert.rejects(mk(r).remove('nao-uuid'), (e) => e.code === 'invalid_user');
  assert.equal(r.calls.length, 1);
  await assert.rejects(mk(fakeFetch({ status: 400, body: { message: 'not_owner' } })).remove(U2), (e) => e.code === 'not_owner');
});

test('publishSnapshot: upsert com merge-duplicates e user_id do token', async () => {
  const f = fakeFetch({ status: 201 });
  const summary = {
    startMmr: 3000, currentMmr: 3125, goalMmr: 4000, status: 'on_track',
    matches: [{ win: true }, { win: true }, { win: false }],
  };
  assert.deepEqual(await mk(f).publishSnapshot(summary), { ok: true });
  const c = f.calls[0];
  assert.equal(c.url, `${URL_OK}/rest/v1/mmr_snapshots?on_conflict=user_id`);
  assert.equal(c.init.method, 'POST');
  assert.match(c.init.headers.Prefer, /resolution=merge-duplicates/);
  assert.deepEqual(c.body, {
    user_id: UID, current_mmr: 3125, goal_mmr: 4000, start_mmr: 3000, wins: 2, losses: 1, status: 'on_track',
  });
  assert.ok(!('updated_at' in c.body) && !('created_at' in c.body)); // o servidor preenche
  // MMR fora do limite do banco é limitado; status inválido nem sai
  const g = fakeFetch({ status: 201 });
  await mk(g).publishSnapshot({ ...summary, currentMmr: -50 });
  assert.equal(g.calls[0].body.current_mmr, 0);
  await assert.rejects(mk(g).publishSnapshot({ ...summary, status: 'x' }), (e) => e.code === 'bad_response');
  await assert.rejects(mk(fakeFetch({ status: 403, body: {} })).publishSnapshot(summary), (e) => e.code === 'forbidden');
});

test('serviço: sem sessão não chama a rede; carrega, cria e sai do grupo; chat recebe contexto', async () => {
  let signed = false;
  const contexts = [];
  const published = [];
  const changes = [];
  let loaded = null;
  const client = {
    load: async () => loaded,
    create: async () => { loaded = { id: GID, name: 'G', isOwner: true, members: [{ userId: UID, displayName: 'Eu', isMe: true, isOwner: true, mmr: null }] }; return GID; },
    join: async () => GID,
    leave: async () => ({ ok: true }),
    remove: async () => ({ ok: true }),
    invite: async () => ({ code: 'ABCDEFGH23', expiresAt: 1 }),
    publishSnapshot: async (s) => { published.push(s); return { ok: true }; },
  };
  const svc = createGroupService({
    client,
    isSignedIn: () => signed,
    chatFeed: { setContext: (c) => contexts.push(c) },
    getSummary: () => ({ currentMmr: 1 }),
    onChange: () => changes.push(1),
  });
  await assert.rejects(svc.create('Grupo'), (e) => e.message === 'Entre na sua conta primeiro.');
  assert.equal(await svc.refresh({ quiet: true }), null);
  assert.equal(await svc.publishSnapshot({}), false);
  signed = true;
  assert.equal(await svc.refresh(), null);
  await assert.rejects(svc.invite(), (e) => e.code === 'not_in_group');
  const v = await svc.create('Grupo');
  assert.equal(v.id, GID);
  assert.equal(svc.hasGroup(), true);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(published, [{ currentMmr: 1 }]); // publica ao criar
  assert.deepEqual(contexts.at(-1), { groupId: GID, members: v.members });
  assert.deepEqual(await svc.invite(), { code: 'ABCDEFGH23', expiresAt: 1 });
  signed = false;
  assert.equal(svc.getView(), null); // sem sessão o grupo some da View
  signed = true;
  await svc.leave();
  assert.equal(svc.getView(), null);
  assert.equal(contexts.at(-1), null);
  assert.ok(changes.length > 0);
});

test('serviço: clear durante load em andamento não ressuscita o grupo', async () => {
  let release;
  const client = { load: () => new Promise((r) => { release = r; }) };
  const svc = createGroupService({ client, isSignedIn: () => true });
  const p = svc.refresh();
  svc.clear();
  release({ id: GID, name: 'G', isOwner: false, members: [] });
  await p;
  assert.equal(svc.getView(), null);
});

test('serviço: sessão expirada no load limpa o grupo; refresh silencioso não lança', async () => {
  const err = Object.assign(new Error('x'), { name: 'UserInputError', code: 'unauthenticated' });
  let fail = false;
  const client = { load: async () => { if (fail) throw err; return { id: GID, name: 'G', isOwner: false, members: [] }; } };
  const svc = createGroupService({ client, isSignedIn: () => true });
  await svc.refresh();
  assert.ok(svc.getView());
  fail = true;
  assert.equal(await svc.refresh({ quiet: true }), null);
  assert.equal(svc.getView(), null);
});

test('nada de token ou código de convite no console', async () => {
  const spy = spyConsole();
  try {
    await mk(fakeFetch({ status: 200, body: [{ code: 'ABCDEFGH23', expires_at: '2026-11-27T00:00:00Z' }] })).invite();
    await mk(fakeFetch(new Error(`falha ${TOKEN}`))).join('ABCDEFGH23').catch(() => {});
    await mk(fakeFetch({ status: 400, body: { message: 'invalid_invite' } })).join('ABCDEFGH23').catch(() => {});
  } finally { spy.restore(); }
  const all = spy.out.join('\n');
  assert.ok(!all.includes('ABCDEFGH23'));
  assert.ok(!all.includes(TOKEN));
});
