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
const { createGroupClient, createGroupService } = require('../../src/main/group');
const { createChatClient, createChatFeed } = require('../../src/main/chat');
const { createVoiceClient } = require('../../src/main/voice');
const { createScreenPicker } = require('../../src/main/security');
const { UID, URL_OK, KEY, tokenResponse, fakeFetch, spyConsole } = require('../auth/helpers');

const TRUSTED = { senderFrame: { url: 'app://ghost-rank/index.html' } };
const UNTRUSTED = { senderFrame: { url: 'https://evil.example/' } };
const T = 1_800_000_000;
const PASS = 'Segredo!Forte9';
const GID = '11111111-2222-4333-8444-555555555555';
const U2 = '22222222-3333-4444-8555-666666666666';
const LK_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJh';

const NEW_CHANNELS = [
  'gr:group:create', 'gr:group:join', 'gr:group:leave', 'gr:group:invite', 'gr:group:remove', 'gr:group:refresh',
  'gr:chat:send', 'gr:voice:token', 'gr:voice:listSources', 'gr:voice:pickSource', 'gr:steam:link',
];

test('validação de payload dos canais novos', () => {
  // vazios
  for (const ok of [undefined, null, {}]) assert.deepEqual(ipc.validateNoArgsPayload(ok), {});
  for (const bad of [{ a: 1 }, [], 'x', 5, Object.create({ a: 1 })]) assert.equal(ipc.validateNoArgsPayload(bad), null);
  // nome do grupo
  assert.deepEqual(ipc.validateGroupNamePayload({ name: '  Os Fantasmas ' }), { name: 'Os Fantasmas' });
  for (const bad of [{ name: 'a' }, { name: ' a ' }, { name: 'x'.repeat(33) }, { name: 5 }, { name: 'Ok', x: 1 }, {}, null]) {
    assert.equal(ipc.validateGroupNamePayload(bad), null, JSON.stringify(bad));
  }
  // código de convite
  assert.deepEqual(ipc.validateJoinPayload({ code: ' abcdefgh23 ' }), { code: 'ABCDEFGH23' });
  for (const bad of ['ABCDEFGH2', 'ABCDEFGH234', 'ABCDEFGH0O', 'ABCDEFGHI1', 'ABCD-EFGH2', '', 'x'.repeat(65)]) {
    assert.equal(ipc.validateJoinPayload({ code: bad }), null, bad);
  }
  assert.equal(ipc.validateJoinPayload({ code: 12345 }), null);
  assert.equal(ipc.validateJoinPayload({ code: 'ABCDEFGH23', extra: 1 }), null);
  // uuid
  assert.deepEqual(ipc.validateUserIdPayload({ userId: U2.toUpperCase() }), { userId: U2 });
  for (const bad of ['nao-uuid', `${U2}x`, '', 5]) assert.equal(ipc.validateUserIdPayload({ userId: bad }), null, String(bad));
  // corpo do chat
  assert.deepEqual(ipc.validateChatPayload({ body: '  oi  ' }), { body: 'oi' });
  for (const bad of [{ body: '' }, { body: '    ' }, { body: 'x'.repeat(1001) }, { body: 'x'.repeat(5000) }, { body: 5 }, { body: 'oi', x: 1 }]) {
    assert.equal(ipc.validateChatPayload(bad), null, JSON.stringify(bad).slice(0, 30));
  }
  assert.deepEqual(ipc.validateChatPayload({ body: '😀'.repeat(1000) }), { body: '😀'.repeat(1000) });
  // sourceId
  assert.deepEqual(ipc.validatePickSourcePayload({ sourceId: 'screen:0:0' }), { sourceId: 'screen:0:0' });
  for (const bad of [{ sourceId: '' }, { sourceId: 'x'.repeat(201) }, { sourceId: 5 }, {}, { sourceId: 'a', b: 1 }]) {
    assert.equal(ipc.validatePickSourcePayload(bad), null, JSON.stringify(bad).slice(0, 30));
  }
  // sair do grupo exige confirm:true
  assert.deepEqual(ipc.validateResetPayload({ confirm: true }), { confirm: true });
  assert.equal(ipc.validateResetPayload({}), null);
  assert.equal(ipc.validateResetPayload({ confirm: 'true' }), null);
});

function capturer() {
  const img = { isEmpty: () => false, toJPEG: () => Buffer.from([1, 2, 3]) };
  return { getSources: async () => [{ id: 'screen:0:0', name: 'Tela', thumbnail: img }, { id: 'window:7:0', name: 'Dota', thumbnail: img }] };
}

function build({ routes = [], configured = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-grp-'));
  const fetchImpl = fakeFetch(async (url, init) => {
    for (const [frag, resp] of routes) if (url.includes(frag)) return typeof resp === 'function' ? resp(url, init) : resp;
    return { status: 404, body: {} };
  });
  const common = { fetchImpl, supabaseUrl: URL_OK, anonKey: KEY };
  const sessionStore = createStore({ filePath: path.join(dir, 's.dat') });
  const trackerStore = createStore({ filePath: path.join(dir, 't.dat') });
  let account = createAccountService({});
  let session = null;
  let group = createGroupService({});
  let chatFeed = null;
  let voice = null;
  const picker = createScreenPicker({ desktopCapturer: capturer() });
  const steamCalls = [];
  const steam = { startLink: async () => { steamCalls.push(1); } };
  let controller;
  if (configured) {
    const auth = createAuthClient({ ...common, now: () => T * 1000 });
    session = createSessionManager({ store: sessionStore, auth, now: () => T * 1000 });
    const getAccessToken = async () => (await session.get())?.accessToken ?? null;
    const c2 = { ...common, getAccessToken };
    chatFeed = createChatFeed({
      client: createChatClient(c2),
      timers: { setInterval: () => 1, clearInterval: () => {} },
    });
    group = createGroupService({
      client: createGroupClient(c2), isSignedIn: () => Boolean(session.peek()), chatFeed,
      getSummary: () => controller.getSummary(),
    });
    voice = createVoiceClient(c2);
    account = createAccountService({
      config: {}, auth, session, profile: createProfileClient(c2),
      onSessionChange: (s) => (s ? group.refresh({ quiet: true }) : group.clear()),
    });
  }
  controller = createController({
    client: {}, store: trackerStore, now: () => T * 1000,
    getAuthView: () => account.getAuthView(),
    getGroupView: () => group.getView(),
    getChatView: () => (chatFeed ? chatFeed.getView() : null),
    getVoiceView: () => ({ available: account.isSignedIn() && group.hasGroup() }),
    publishSnapshot: (s) => group.publishSnapshot(s),
  });
  const handlers = ipc.buildHandlers(controller, { account, session, group, chatFeed, voice, picker, steam });
  return {
    fetchImpl, session, group, chatFeed, controller, steamCalls,
    call: (ch, p, ev = TRUSTED) => handlers[ch](ev, p), handlers,
  };
}

const loginOk = { status: 200, body: tokenResponse({ expiresIn: 3600 }) };
const profileRow = { status: 200, body: [{ display_name: 'Eu Mesmo', mmr_visibility: 'group', steam_account_id: null }] };

function groupState() {
  const s = { inGroup: false, messages: [] };
  const routes = [
    ['grant_type=password', loginOk],
    ['/auth/v1/logout', { status: 204 }],
    ['/rest/v1/profiles?select=display_name', profileRow],
    ['/rest/v1/rpc/create_group', () => { s.inGroup = true; return { status: 200, body: JSON.stringify(GID) }; }],
    ['/rest/v1/rpc/join_group', (url, init) => {
      const code = JSON.parse(init.body).p_code;
      if (code !== 'ABCDEFGH23') return { status: 400, body: { code: 'P0001', message: 'invalid_invite' } };
      s.inGroup = true;
      return { status: 200, body: JSON.stringify(GID) };
    }],
    ['/rest/v1/rpc/leave_group', () => { s.inGroup = false; return { status: 204 }; }],
    ['/rest/v1/rpc/remove_member', { status: 400, body: { code: 'P0001', message: 'not_owner' } }],
    ['/rest/v1/rpc/create_invite', { status: 200, body: [{ code: 'ABCDEFGH23', expires_at: '2026-11-27T00:00:00Z' }] }],
    ['group_members?select=group_id', () => ({
      status: 200, body: s.inGroup ? [{ group_id: GID, groups: { id: GID, name: 'Os Fantasmas', owner_id: UID } }] : [],
    })],
    ['group_members?select=user_id', { status: 200, body: [{ user_id: UID }, { user_id: U2 }] }],
    ['/rest/v1/profiles?select=id,display_name', { status: 200, body: [{ id: UID, display_name: 'Eu Mesmo' }, { id: U2, display_name: 'Colega' }] }],
    ['/rest/v1/mmr_snapshots?select=', { status: 200, body: [] }],
    ['/rest/v1/mmr_snapshots?on_conflict', { status: 201 }],
    ['/rest/v1/messages?select=id,user_id,body,created_at&group_id', { status: 200, body: s.messages }],
    ['/rest/v1/messages?select=id,user_id,body,created_at', (url, init) => {
      const b = JSON.parse(init.body);
      const row = { id: s.messages.length + 1, user_id: b.user_id, body: b.body, created_at: '2026-11-20T10:00:00Z' };
      s.messages.push(row);
      return { status: 201, body: [row] };
    }],
    ['/functions/v1/livekit-token', { status: 200, body: { url: 'wss://proj.livekit.cloud', token: LK_TOKEN } }],
  ];
  return { s, routes };
}

test('sem conta: canais novos recusam com mensagem e View tem group null, chat vazio, voz indisponível', async () => {
  const e = build({ configured: false });
  const v = (await e.call(ipc.CHANNELS.getView)).view;
  assert.equal(v.group, null);
  assert.deepEqual(v.chat, { messages: [], status: 'idle' });
  assert.deepEqual(v.voice, { available: false });
  assert.equal(v.auth.steamLinked, false);
  for (const [ch, p] of [
    ['gr:group:create', { name: 'Grupo' }], ['gr:group:join', { code: 'ABCDEFGH23' }], ['gr:group:invite', {}],
    ['gr:voice:token', {}], ['gr:steam:link', {}], ['gr:chat:send', { body: 'oi' }],
  ]) {
    const r = await e.call(ch, p);
    assert.equal(r.ok, false, ch);
    assert.equal(typeof r.error, 'string');
  }
  assert.equal(e.steamCalls.length, 0);
});

test('conta sem login: "Entre na sua conta primeiro."', async () => {
  const { routes } = groupState();
  const e = build({ routes });
  const r = await e.call('gr:group:create', { name: 'Grupo' });
  assert.deepEqual(r, { ok: false, error: 'Entre na sua conta primeiro.' });
  assert.equal(e.fetchImpl.calls.length, 0);
});

test('fluxo: login → criar → convite → chat → voz → sair; erros do banco viram português', async () => {
  const { s, routes } = groupState();
  const e = build({ routes });
  await e.call(ipc.CHANNELS.signIn, { email: 'ana@example.com', password: PASS });
  await new Promise((r) => setImmediate(r));
  let r = await e.call('gr:group:refresh', {});
  assert.equal(r.ok, true);
  assert.equal(r.view.group, null);
  // voz sem grupo
  assert.equal((await e.call('gr:voice:token', {})).ok, false);
  r = await e.call('gr:group:join', { code: 'zzzzzzzzzz' });
  assert.deepEqual(r, { ok: false, error: 'Este código não corresponde a um grupo. Confira as 10 letras e números.' });
  r = await e.call('gr:group:create', { name: '  Os Fantasmas ' });
  assert.equal(r.ok, true);
  assert.equal(r.view.group.name, 'Os Fantasmas');
  assert.equal(r.view.group.isOwner, true);
  assert.deepEqual(r.view.group.members.map((m) => [m.displayName, m.isMe, m.isOwner]), [['Eu Mesmo', true, true], ['Colega', false, false]]);
  assert.deepEqual(r.view.voice, { available: true });
  r = await e.call('gr:group:invite', {});
  assert.deepEqual(r, { ok: true, code: 'ABCDEFGH23', expiresAt: Date.parse('2026-11-27T00:00:00Z') });
  r = await e.call('gr:group:remove', { userId: U2 });
  assert.deepEqual(r, { ok: false, error: 'Só o dono do grupo pode fazer isso.' });
  r = await e.call('gr:chat:send', { body: '  bora jogar  ' });
  assert.equal(r.ok, true);
  assert.equal(s.messages[0].body, 'bora jogar');
  assert.equal(s.messages[0].user_id, UID);
  assert.deepEqual(r.view.chat.messages.map((m) => [m.body, m.mine, m.displayName]), [['bora jogar', true, 'Eu Mesmo']]);
  r = await e.call('gr:voice:token', {});
  assert.deepEqual(r, { ok: true, url: 'wss://proj.livekit.cloud', token: LK_TOKEN });
  r = await e.call('gr:voice:listSources', {});
  assert.equal(r.ok, true);
  assert.deepEqual(r.sources.map((x) => [x.id, x.kind]), [['screen:0:0', 'screen'], ['window:7:0', 'window']]);
  assert.match(r.sources[0].thumbnail, /^data:image\/jpeg;base64,/);
  assert.deepEqual(await e.call('gr:voice:pickSource', { sourceId: 'window:7:0' }), { ok: true });
  assert.deepEqual(await e.call('gr:voice:pickSource', { sourceId: 'window:8:0' }), { ok: false, error: 'Escolha uma tela ou janela da lista.' });
  assert.equal((await e.call('gr:group:leave', {})).ok, false);
  r = await e.call('gr:group:leave', { confirm: true });
  assert.equal(r.ok, true);
  assert.equal(r.view.group, null);
  assert.deepEqual(r.view.chat, { messages: [], status: 'idle' });
  assert.deepEqual(r.view.voice, { available: false });
});

test('sair da conta limpa grupo e chat', async () => {
  const { routes } = groupState();
  const e = build({ routes });
  await e.call(ipc.CHANNELS.signIn, { email: 'ana@example.com', password: PASS });
  await e.call('gr:group:create', { name: 'Os Fantasmas' });
  await e.call('gr:chat:send', { body: 'oi' });
  const r = await e.call(ipc.CHANNELS.signOut);
  assert.equal(r.view.group, null);
  assert.deepEqual(r.view.chat.messages, []);
  assert.equal(e.chatFeed.isRunning(), false);
});

test('steam: exige login e chama startLink', async () => {
  const { routes } = groupState();
  const e = build({ routes });
  assert.equal((await e.call('gr:steam:link', {})).ok, false);
  await e.call(ipc.CHANNELS.signIn, { email: 'ana@example.com', password: PASS });
  assert.deepEqual(await e.call('gr:steam:link', {}), { ok: true });
  assert.equal((await e.call('gr:steam:link', { url: 'https://evil.com' })).ok, false);
  assert.equal(e.steamCalls.length, 1);
});

test('payload inválido não chega à rede; remetente não confiável é recusado em todos os canais novos', async () => {
  const { routes } = groupState();
  const e = build({ routes });
  await e.call(ipc.CHANNELS.signIn, { email: 'ana@example.com', password: PASS });
  const before = e.fetchImpl.calls.length;
  for (const [ch, p] of [
    ['gr:group:create', { name: 'x' }], ['gr:group:join', { code: 'ABC' }], ['gr:group:remove', { userId: 'x' }],
    ['gr:chat:send', { body: '' }], ['gr:chat:send', { body: 'x'.repeat(1001) }], ['gr:group:invite', { a: 1 }],
    ['gr:voice:token', { a: 1 }], ['gr:voice:pickSource', { sourceId: 'x'.repeat(201) }],
  ]) {
    assert.deepEqual(await e.call(ch, p), { ok: false, error: 'Dados inválidos.' }, ch);
  }
  for (const ch of NEW_CHANNELS) {
    assert.ok(Object.values(ipc.CHANNELS).includes(ch), ch);
    const r = await e.call(ch, { name: 'Grupo', code: 'ABCDEFGH23', confirm: true, userId: U2, body: 'oi', sourceId: 'screen:0:0' }, UNTRUSTED);
    assert.deepEqual(r, { ok: false, error: 'Origem não autorizada.' }, ch);
  }
  assert.equal(e.fetchImpl.calls.length, before);
  assert.equal(e.steamCalls.length, 0);
});

test('nenhum token, código de convite ou texto de chat no console', async () => {
  const spy = spyConsole();
  try {
    const { routes } = groupState();
    const e = build({ routes });
    await e.call(ipc.CHANNELS.signIn, { email: 'ana@example.com', password: PASS });
    await e.call('gr:group:join', { code: 'ABCDEFGH23' });
    await e.call('gr:group:invite', {});
    await e.call('gr:chat:send', { body: 'mensagem secreta' });
    await e.call('gr:voice:token', {});
    await new Promise((r) => setImmediate(r));
  } finally { spy.restore(); }
  const all = spy.out.join('\n');
  for (const s of ['ABCDEFGH23', 'mensagem secreta', LK_TOKEN, 'eyJ']) assert.ok(!all.includes(s), s);
});

test('canal social valida argumentos antes de chamar o serviço e só aceita a janela do app', async () => {
  const calls = [];
  const controller = { getView: () => ({}) };
  const handlers = ipc.buildHandlers(controller, {
    account: { available: true, isSignedIn: () => true },
    social: async (action, value) => { calls.push([action, value]); return { rows: [] }; },
  });
  const run = handlers['gr:social'];
  assert.equal(typeof run, 'function');
  assert.equal((await run(UNTRUSTED, { action: 'list' })).ok, false);
  for (const payload of [
    { action: 'send', value: 'invalid-id' },
    { action: 'accept', value: U2, extra: 'x' },
    { action: 'profilePhoto', value: 'data:image/svg+xml;base64,AAAA' },
    { action: 'groupPhoto', value: 'data:image/jpeg;base64,' + 'A'.repeat(65536) },
    { action: 'privacy', value: 'true' },
    { action: 'unknown' },
  ]) assert.equal((await run(TRUSTED, payload)).ok, false);
  assert.equal(calls.length, 0);
  const r = await run(TRUSTED, { action: 'search', value: '  Felipe  ' });
  assert.deepEqual(r, { ok: true, rows: [] });
  assert.deepEqual(calls, [['search', 'Felipe']]);
});
