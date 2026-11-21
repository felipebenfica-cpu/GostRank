'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { createAppServices, isSafeExternalUrl, plainPreview } = require('../../src/main/services');
const { createController } = require('../../src/main/controller');
const { buildHandlers, CHANNELS } = require('../../src/main/ipc');
const { API, V } = require('../../src/main/api');
const { token, profile, FakeWebSocket, manualTimers, flush, ME, LUA, G1, C1, V1, CAT, DM1 } = require('./helpers');

const URL = 'https://proj.supabase.co';
const TRUSTED = { senderFrame: { url: 'app://ghost-rank/index.html' } };
const UNTRUSTED = { senderFrame: { url: 'https://evil.example/' } };

function respond(status, body) {
  return { status, text: async () => (body === undefined ? '' : JSON.stringify(body)) };
}

/** PostgREST falso para o modo novo (v3) ou antigo (legacy). */
function fetchFor(mode, log = []) {
  return async (url, init) => {
    const u = url.slice(URL.length);
    log.push([init.method, u, init.body]);
    const missing = respond(404, { code: 'PGRST205', message: 'not found' });
    if (u.startsWith('/rest/v1/channels?select=id&limit=1')) return mode === 'v3' ? respond(200, []) : missing;
    if (mode !== 'v3' && (u.startsWith('/rest/v1/rpc/search_users') || u.startsWith('/rest/v1/channels'))) {
      return respond(404, { code: 'PGRST202', message: 'x' });
    }
    if (u.startsWith('/rest/v1/group_members?select=group_id,groups(id,name,owner_id)')) return respond(200, []);
    if (u.startsWith('/rest/v1/profiles?select=display_name')) return respond(200, [{ display_name: 'Fantasma', mmr_visibility: 'group', steam_account_id: null }]);
    if (u.startsWith(`/rest/v1/profiles?select=id,username`) && u.includes(`id=eq.${ME}`)) return respond(200, [profile(ME, 'fantasma')]);
    if (u.startsWith('/rest/v1/profiles?select=id,username')) return respond(200, [profile(ME, 'fantasma'), profile(LUA, 'lua')]);
    if (u.startsWith('/rest/v1/relationships')) return respond(200, [{ other_id: LUA, kind: 'friend', created_at: '2026-01-01T00:00:00Z' }]);
    if (u.startsWith('/rest/v1/dm_channels')) return respond(200, [{ id: DM1, user_a: ME, user_b: LUA, last_message_at: null, created_at: '2026-01-01T00:00:00Z' }]);
    if (u.startsWith('/rest/v1/group_members?select=group_id,role')) return respond(200, [{ group_id: G1, role: 'owner', groups: { id: G1, name: 'Os Fantasmas', owner_id: ME, icon_color: 1, icon_path: null } }]);
    if (u.startsWith('/rest/v1/group_members?select=user_id')) return respond(200, [{ user_id: ME, role: 'owner', nickname: null }, { user_id: LUA, role: 'member', nickname: null }]);
    if (u.startsWith('/rest/v1/channel_categories')) return respond(200, [{ id: CAT, name: 'Canais de texto', position: 0 }]);
    if (u.startsWith('/rest/v1/channels?select=id,group_id')) return respond(200, [{ id: C1, group_id: G1, kind: 'text', name: 'geral' }, { id: V1, group_id: G1, kind: 'voice', name: 'Geral' }]);
    if (u.startsWith('/rest/v1/channels?select=id,kind')) return respond(200, [{ id: C1, kind: 'text', name: 'geral', topic: null, category_id: CAT, position: 0 }, { id: V1, kind: 'voice', name: 'Geral', topic: null, category_id: null, position: 1 }]);
    if (u.startsWith('/rest/v1/mmr_snapshots?select')) return respond(200, []);
    if (u.startsWith('/rest/v1/messages?select=') && init.method === 'GET') return respond(200, [{ id: 1, user_id: LUA, body: 'oi', created_at: '2026-01-01T00:00:00Z', attachments: [], mentions: [], channel_id: C1, group_id: G1 }]);
    if (u.startsWith('/rest/v1/messages?select=') && init.method === 'POST') {
      const b = JSON.parse(init.body);
      return respond(201, [{ id: 2, user_id: ME, body: b.body, created_at: '2026-01-01T00:01:00Z', attachments: [], mentions: b.mentions, channel_id: b.channel_id, group_id: b.group_id }]);
    }
    if (u.startsWith('/rest/v1/message_reactions')) return respond(200, []);
    if (u.startsWith('/rest/v1/rpc/unread_summary')) return respond(200, [{ target: `c:${C1}`, last_message_id: 1, unread: 1, mentions: 1 }]);
    if (u.startsWith('/rest/v1/rpc/mark_read')) return respond(204);
    if (u.startsWith('/rest/v1/rpc/create_invite')) return respond(200, [{ code: 'ABCDEFGH23', expires_at: null, max_uses: null, uses: 0 }]);
    if (u.startsWith('/rest/v1/rpc/search_users')) return respond(200, [{ ...profile(LUA, 'lua'), relation: 'friend' }]);
    if (u.startsWith('/functions/v1/livekit-token')) return respond(200, { url: 'wss://x.livekit.cloud', token: 'a.b.c' });
    return respond(404, {});
  };
}

function sessionStore() {
  let s = { version: 1, accessToken: token(), refreshToken: 'r', expiresAt: 4_000_000_000, user: { id: ME, email: 'eu@x.com', emailConfirmed: true } };
  return { load: () => s, save: (o) => { s = o; }, clear: () => { s = null; } };
}

async function boot(mode, extra = {}) {
  FakeWebSocket.instances = [];
  const log = [];
  const notes = [];
  const timers = manualTimers();
  let focused = true;
  const svc = createAppServices({
    config: { supabaseUrl: URL, anonKey: 'anon-key-123456' },
    fetchImpl: fetchFor(mode, log),
    WebSocketImpl: FakeWebSocket,
    sessionStore: sessionStore(),
    prefsStore: null,
    notify: (n) => notes.push(n),
    openExternal: async () => {},
    isFocused: () => focused,
    timers,
    ...extra,
  });
  const controller = createController({
    client: { getPlayer: async () => ({}), getRecentMatches: async () => [], getHeroes: async () => ({}) },
    store: { load: () => null, save() {}, clear() {} },
    getAuthView: () => svc.account.getAuthView(),
    getGroupView: () => svc.group.getView(),
    getChatView: () => svc.chatFeed.getView(),
    getExtraView: () => svc.getExtraView(),
  });
  const h = buildHandlers(controller, {
    account: svc.account, session: svc.session, group: svc.group, chatFeed: svc.chatFeed, voice: svc.voice,
    app: svc.app, getMode: () => svc.getMode(),
  });
  svc.start();
  for (let i = 0; i < 30; i++) await flush();
  const call = (ch, p, ev = TRUSTED) => h[ch](ev, p);
  return { svc, controller, h, call, log, notes, timers, setFocused: (v) => { focused = v; } };
}

test('services v3: entra, carrega amigos/DMs/servidores, abre o último canal, envia e marca lido', async () => {
  const e = await boot('v3');
  assert.equal(e.svc.getMode(), 'v3');
  let r = await e.call(CHANNELS.select, { mode: 'server', serverId: G1 });
  assert.equal(r.ok, true, r.error);
  const v = r.view;
  assert.equal(v.schema, 'v3');
  assert.equal(v.me.username, 'fantasma');
  assert.equal(v.friends[0].username, 'lua');
  assert.equal(v.dms[0].user.username, 'lua');
  assert.deepEqual(v.servers.map((s) => s.name), ['Os Fantasmas']);
  assert.deepEqual(v.selection, { mode: 'server', serverId: G1, channelId: C1 });
  assert.equal(v.server.channels.length, 2);
  assert.equal(v.messages.target, `c:${C1}`);
  assert.equal(v.messages.items[0].body, 'oi');
  assert.ok(v.users[LUA] && v.users[ME]);
  assert.equal(v.group.name, 'Os Fantasmas'); // formato antigo continua
  // canal de voz selecionado: sem mensagens
  r = await e.call(CHANNELS.select, { mode: 'server', serverId: G1, channelId: V1 });
  assert.equal(r.view.messages, null);
  await e.call(CHANNELS.select, { mode: 'server', serverId: G1, channelId: C1 });
  r = await e.call(CHANNELS.sendMessage, { body: `oi <@${LUA}>` });
  assert.equal(r.ok, true, r.error);
  const post = e.log.find((x) => x[0] === 'POST' && x[1].startsWith('/rest/v1/messages'));
  assert.deepEqual(JSON.parse(post[2]).mentions, [LUA]);
  assert.equal(r.view.messages.items.at(-1).body, `oi <@${LUA}>`);
  // a ponte antiga (sendMessage com texto) cai no mesmo alvo
  r = await e.call(CHANNELS.chatSend, { body: 'pelo canal antigo' });
  assert.equal(r.ok, true, r.error);
  // convite antigo = convite permanente do servidor selecionado
  r = await e.call(CHANNELS.groupInvite, {});
  assert.deepEqual([r.ok, r.code, r.expiresAt], [true, 'ABCDEFGH23', null]);
  // busca de pessoas
  r = await e.call(CHANNELS.searchUsers, { query: 'lu' });
  assert.equal(r.users[0].username, 'lua');
  // voz por canal
  r = await e.call(CHANNELS.voiceTokenFor, { channelId: V1 });
  assert.deepEqual([r.ok, r.url], [true, 'wss://x.livekit.cloud']);
  const tokCall = e.log.find((x) => x[1].startsWith('/functions/v1/livekit-token'));
  assert.deepEqual(JSON.parse(tokCall[2]), { channelId: V1 });
  r = await e.call(CHANNELS.setVoiceState, { channelId: V1, muted: true });
  assert.equal(r.ok, true, r.error);
  // preferências locais
  r = await e.call(CHANNELS.updatePrefs, { appearance: { theme: 'midnight' } });
  assert.equal(r.view.prefs.appearance.theme, 'midnight');
  r = await e.call(CHANNELS.updatePrefs, { appearance: { theme: 'arco-íris' } });
  assert.deepEqual(r, { ok: false, error: 'Preferência inválida.' });
  e.svc.stop();
});

test('services v3: mensagem pelo tempo real com janela sem foco vira notificação (e não com foco)', async () => {
  const e = await boot('v3');
  const ws = FakeWebSocket.instances[0];
  ws.open();
  ws.ackJoins();
  const dbJoin = ws.sent.find((m) => m.topic === `realtime:db:${ME}`);
  assert.ok(dbJoin.payload.config.postgres_changes.some((p) => p.table === 'messages'));
  assert.ok(ws.sent.some((m) => m.topic === `realtime:server:${G1}` && m.payload.config.private === true));
  e.setFocused(false);
  ws.server({ topic: `realtime:db:${ME}`, event: 'postgres_changes', payload: { data: { type: 'INSERT', table: 'messages', record: { id: 9, user_id: LUA, body: `ei <@${ME}>`, created_at: '2026-01-01T00:00:00Z', attachments: [], mentions: [ME], channel_id: C1, group_id: G1 } } } });
  for (let i = 0; i < 10; i++) await flush();
  assert.equal(e.notes.length, 1);
  assert.equal(e.notes[0].title, 'Lua (#geral, Os Fantasmas)');
  assert.equal(e.notes[0].body, 'ei @Fantasma');
  assert.deepEqual(e.notes[0].target, { mode: 'server', serverId: G1, channelId: C1 });
  e.setFocused(true);
  ws.server({ topic: `realtime:db:${ME}`, event: 'postgres_changes', payload: { data: { type: 'INSERT', table: 'messages', record: { id: 10, user_id: LUA, body: 'oi', created_at: '2026-01-01T00:00:00Z', attachments: [], mentions: [], dm_id: DM1 } } } });
  for (let i = 0; i < 10; i++) await flush();
  assert.equal(e.notes.length, 1);
  // badge: menções não silenciadas + pedidos
  assert.ok(e.svc.badgeCount() >= 1);
  e.svc.stop();
});

test('services legacy (sem 0003): app antigo segue; ações novas pedem "Atualize o banco (0003)"', async () => {
  const e = await boot('legacy');
  assert.equal(e.svc.getMode(), 'legacy');
  const r = await e.call(CHANNELS.searchUsers, { query: 'lua' });
  assert.equal(r.ok, false);
  assert.match(r.error, /Atualize o banco \(0003\)/);
  const r2 = await e.call(CHANNELS.updateProfile, { username: 'novo' });
  assert.match(r2.error, /0003/);
  const v = (await e.call(CHANNELS.getView)).view;
  assert.equal(v.schema, 'legacy');
  assert.deepEqual(v.servers, []);
  assert.equal(v.messages, null);
  // preferências funcionam em qualquer modo
  const r3 = await e.call(CHANNELS.muteTarget, { target: `c:${C1}`, muted: true });
  assert.deepEqual(r3.view.prefs.muted, [`c:${C1}`]);
  e.svc.stop();
});

test('api: todo canal novo recusa remetente de fora e payload inválido sem ir à rede', async () => {
  const e = await boot('v3');
  const before = e.log.length;
  for (const entry of API) {
    const r = await e.h[entry.channel](UNTRUSTED, {});
    assert.equal(r.ok, false, entry.channel);
    assert.equal(r.error, 'Origem não autorizada.');
  }
  for (const [ch, p] of [
    [CHANNELS.select, { mode: 'server', serverId: 'x' }],
    [CHANNELS.select, { mode: 'home', extra: 1 }],
    [CHANNELS.sendFriendRequest, { username: 'x'.repeat(65) }],
    [CHANNELS.createInvite, { serverId: G1, maxAgeSeconds: 5 }],
    [CHANNELS.createInvite, { serverId: G1, maxUses: 1000 }],
    [CHANNELS.sendMessageV2, { body: '' }],
    [CHANNELS.sendMessageV2, { body: 'oi', attachments: [{ name: 'a', mime: 'x', data: 'não é binário' }] }],
    [CHANNELS.sendMessageV2, { body: 'oi', attachments: new Array(5).fill({ name: 'a', mime: 'x', data: new ArrayBuffer(1) }) }],
    [CHANNELS.uploadAvatar, { name: 'a.png', mime: 'image/png', data: new ArrayBuffer(2 * 1024 * 1024 + 1) }],
    [CHANNELS.toggleReaction, { id: -1, emoji: '👻' }],
    [CHANNELS.muteTarget, { target: 'x:1', muted: true }],
    [CHANNELS.voiceTokenFor, { channelId: V1, dmId: DM1 }],
    [CHANNELS.setVoiceState, { channelId: V1, dmId: DM1 }],
    [CHANNELS.updatePrefs, { voice: { mode: { $gt: 1 } } }],
    [CHANNELS.openExternal, { url: 5 }],
  ]) {
    const r = await e.call(ch, p);
    assert.deepEqual(r, { ok: false, error: 'Dados inválidos.' }, `${ch} ${JSON.stringify(p)}`);
  }
  assert.equal(e.log.length, before);
  const bad = await e.call(CHANNELS.openExternal, { url: 'javascript:alert(1)' });
  assert.equal(bad.ok, false);
  e.svc.stop();
});

test('api/services: validadores e utilitários', () => {
  assert.deepEqual(V.select({ mode: 'home' }), { mode: 'home', tab: 'friends' });
  assert.deepEqual(V.select({ mode: 'dm', dmId: DM1.toUpperCase() }), { mode: 'dm', dmId: DM1 });
  assert.deepEqual(V.inviteCreate({ serverId: G1 }), { serverId: G1, maxAgeSeconds: null, maxUses: null });
  assert.deepEqual(V.code({ code: ' abcdefgh23 ' }), { code: 'ABCDEFGH23' });
  assert.deepEqual(V.voiceState({ channelId: V1 }), { channelId: V1, dmId: null, muted: false, deafened: false, streaming: false, video: false });
  assert.equal(isSafeExternalUrl('https://dota2.com/x'), true);
  assert.equal(isSafeExternalUrl('http://a.b'), true);
  assert.equal(isSafeExternalUrl('https://user:pw@a.b'), false);
  assert.equal(isSafeExternalUrl('file:///etc/passwd'), false);
  assert.equal(plainPreview(`**oi** <@${LUA}> ||segredo||`, () => 'Lua'), 'oi @Lua ▒▒▒');
});
