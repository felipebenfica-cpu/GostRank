'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { createUserCache } = require('../../src/main/users');
const { createSocialService, normalizeUsername } = require('../../src/main/social');
const { createServersService, normalizeTextChannelName } = require('../../src/main/servers');
const { fakeRest, profile, ME, LUA, SOL, G1, C1, V1, CAT, DM1 } = require('./helpers');

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1]);

function socialEnv(extra = {}) {
  const rest = fakeRest({
    select(p) {
      if (p.startsWith('/rest/v1/profiles') && p.includes(`id=eq.${ME}`)) return [profile(ME, 'fantasma', { status: 'dnd', custom_status: 'jogando' })];
      if (p.startsWith('/rest/v1/profiles')) return [profile(LUA, 'lua'), profile(SOL, 'sol')];
      if (p.startsWith('/rest/v1/relationships')) return [
        { other_id: LUA, kind: 'friend', created_at: '2026-01-01T00:00:00Z' },
        { other_id: SOL, kind: 'pending_in', created_at: '2026-01-02T00:00:00Z' },
        { other_id: 'lixo', kind: 'friend' },
      ];
      if (p.startsWith('/rest/v1/dm_channels')) return [{ id: DM1, user_a: ME, user_b: LUA, last_message_at: '2026-02-01T00:00:00Z' }];
      return [];
    },
    rpc(name) {
      if (name === 'search_users') return [{ ...profile(SOL, 'sol'), relation: 'pending_in' }, { ...profile(ME, 'fantasma'), relation: 'none' }];
      if (name === 'send_friend_request') return 'accepted';
      if (name === 'open_dm') return DM1;
      return null;
    },
    update: (p, body) => [{ ...profile(ME, 'fantasma'), ...body }],
    ...extra,
  });
  const users = createUserCache({ rest });
  let changes = 0;
  const social = createSocialService({ rest, users, onChange: () => { changes++; } });
  return { rest, users, social, changes: () => changes };
}

test('social: carrega eu, amigos, pedidos e DMs; busca exclui você; nome de usuário normalizado', async () => {
  const { social, rest } = socialEnv();
  await social.refresh();
  const me = social.getMe();
  assert.equal(me.username, 'fantasma');
  assert.equal(me.status, 'dnd');
  assert.equal(me.customStatus, 'jogando');
  const fr = social.getFriendsView();
  assert.deepEqual(fr.map((f) => [f.username, f.relation]), [['lua', 'friend'], ['sol', 'pending_in']]);
  assert.deepEqual(social.friendIds(), [LUA]);
  assert.deepEqual(social.getDms().map((d) => d.userId), [LUA]);
  const found = await social.searchUsers('@so');
  assert.deepEqual(found.map((u) => [u.username, u.relation]), [['sol', 'pending_in']]);
  assert.deepEqual(rest.calls.find((c) => c[1] === 'search_users')[2], { p_query: 'so' });
  await assert.rejects(social.searchUsers('a'), /pelo menos 2/);
  assert.equal(normalizeUsername(' @Lua.Nova '), 'lua.nova');
  assert.equal(normalizeUsername('com espaço'), null);
});

test('social: pedido de amizade, aceitar, bloquear, abrir DM e perfil', async () => {
  const { social, rest } = socialEnv();
  await social.refresh();
  assert.equal(await social.sendFriendRequest('@Sol'), 'accepted');
  assert.deepEqual(rest.calls.find((c) => c[1] === 'send_friend_request')[2], { p_username: 'sol' });
  await assert.rejects(social.sendFriendRequest('fantasma'), /a si mesmo/);
  await assert.rejects(social.sendFriendRequest('x'), /nome de usuário/);
  await social.acceptFriend(SOL.toUpperCase());
  assert.deepEqual(rest.calls.find((c) => c[1] === 'accept_friend_request')[2], { p_user: SOL });
  await social.blockUser(SOL);
  await assert.rejects(social.removeFriend('nao-uuid'), /Pessoa inválida/);
  assert.equal(await social.openDm(LUA), DM1);
  await social.setStatus('idle');
  assert.deepEqual(rest.calls.filter((c) => c[0] === 'update').at(-1)[2], { status: 'idle' });
  await assert.rejects(social.setStatus('fantasma'), /Status inválido/);
  await social.setCustomStatus('  farmando  ');
  assert.deepEqual(rest.calls.filter((c) => c[0] === 'update').at(-1)[2], { custom_status: 'farmando' });
  await social.updateProfile({ username: 'Novo_Nome', about: 'oi', avatarColor: 3, displayName: 'Fanta' });
  assert.deepEqual(rest.calls.filter((c) => c[0] === 'update').at(-1)[2], { display_name: 'Fanta', username: 'novo_nome', about: 'oi', avatar_color: 3 });
  await assert.rejects(social.updateProfile({ about: 'x'.repeat(191) }), /190/);
  await assert.rejects(social.updateProfile({ displayName: '<b>' }), /nome de exibição/);
});

test('social: avatar vai para avatars/<meu id>/<uuid>.png e só imagem real', async () => {
  const { social, rest } = socialEnv();
  await social.refresh();
  await social.uploadAvatar({ name: 'eu.png', mime: 'image/png', data: PNG.buffer });
  const up = rest.calls.find((c) => c[0] === 'upload');
  assert.equal(up[1], 'avatars');
  assert.match(up[2], new RegExp(`^${ME}/[0-9a-f-]{36}\\.png$`));
  assert.equal(rest.calls.filter((c) => c[0] === 'update').at(-1)[2].avatar_path, up[2]);
  await assert.rejects(social.uploadAvatar({ name: 'x.png', mime: 'image/png', data: new Uint8Array([1, 2]) }), /Tipo de arquivo/);
});

function serversEnv() {
  const rest = fakeRest({
    select(p) {
      if (p.startsWith('/rest/v1/group_members?select=group_id')) return [{ group_id: G1, role: 'admin', groups: { id: G1, name: 'Os Fantasmas', owner_id: LUA, icon_color: 2, icon_path: null } }];
      if (p.startsWith('/rest/v1/channel_categories')) return [{ id: CAT, name: 'Canais de texto', position: 0 }];
      if (p.startsWith('/rest/v1/channels')) return [
        { id: V1, kind: 'voice', name: 'Geral', topic: null, category_id: null, position: 0 },
        { id: C1, kind: 'text', name: 'geral', topic: 'bem-vindos', category_id: CAT, position: 0 },
      ];
      if (p.startsWith('/rest/v1/group_members?select=user_id')) return [{ user_id: LUA, role: 'owner', nickname: null }, { user_id: ME, role: 'admin', nickname: ' Fanta ' }];
      if (p.startsWith('/rest/v1/profiles')) return [profile(LUA, 'lua'), profile(ME, 'fantasma')];
      if (p.startsWith('/rest/v1/mmr_snapshots')) return [{ user_id: LUA, current_mmr: 3200, goal_mmr: 3500, start_mmr: 3000, wins: 5, losses: 2, status: 'on_track', updated_at: '2026-01-01T00:00:00Z' }];
      return [];
    },
    rpc(name) {
      if (name === 'create_group' || name === 'join_group') return G1;
      if (name === 'create_invite') return [{ code: 'ABCDEFGH23', expires_at: null, max_uses: null, uses: 3 }];
      if (name === 'preview_invite') return [{ group_id: G1, name: 'Os Fantasmas', icon_color: 2, icon_path: null, member_count: 7, already_member: false }];
      if (name === 'list_bans') return [{ user_id: SOL, username: 'sol', display_name: 'Sol', avatar_color: 1, avatar_path: null, banned_at: '2026-03-01T00:00:00Z' }];
      if (name === 'create_channel') return C1;
      return null;
    },
  });
  const users = createUserCache({ rest });
  const servers = createServersService({ rest, users });
  return { rest, users, servers };
}

test('servidores: lista, detalhes (categorias, canais, membros com MMR) e canal padrão', async () => {
  const { servers } = serversEnv();
  await servers.refreshList();
  assert.deepEqual(servers.getList().map((s) => [s.name, s.role, s.iconColor]), [['Os Fantasmas', 'admin', 2]]);
  await assert.rejects(servers.select('99999999-9999-4999-8999-999999999999'), /não faz parte/);
  await servers.select(G1);
  const sel = servers.getSelected();
  assert.equal(sel.channels.length, 2);
  assert.equal(sel.members.find((m) => m.id === ME).nickname, 'Fanta');
  assert.equal(sel.members.find((m) => m.id === LUA).mmr.current, 3200);
  // sem categoria vem primeiro, mas o padrão é o primeiro canal de TEXTO
  assert.equal(servers.defaultTextChannel(), C1);
  assert.equal(servers.serverOfChannel(V1), G1);
});

test('servidores: convite ilimitado por padrão, opções do Discord, prévia, banimentos e canais', async () => {
  const { servers, rest } = serversEnv();
  await servers.refreshList();
  await servers.select(G1);
  const inv = await servers.createInvite({ serverId: G1 });
  assert.deepEqual(inv, { code: 'ABCDEFGH23', expiresAt: null, maxUses: null, uses: 3, createdBy: null });
  assert.deepEqual(rest.calls.find((c) => c[1] === 'create_invite')[2], { p_group: G1, p_max_age_seconds: null, p_max_uses: null });
  await servers.createInvite({ serverId: G1, maxAgeSeconds: 86400, maxUses: 10 });
  await assert.rejects(servers.createInvite({ serverId: G1, maxAgeSeconds: 99 }), /inválid/);
  const pv = await servers.previewInvite(' abcdefgh23 ');
  assert.equal(pv.memberCount, 7);
  await assert.rejects(servers.previewInvite('curto'), /convite não vale/);
  const bans = await servers.listBans(G1);
  assert.equal(bans[0].username, 'sol');
  assert.equal(bans[0].bannedAt, Date.parse('2026-03-01T00:00:00Z'));
  await servers.createChannel({ serverId: G1, kind: 'text', name: '  Meu Canal  Novo ' });
  assert.deepEqual(rest.calls.find((c) => c[1] === 'create_channel')[2], { p_group: G1, p_kind: 'text', p_name: 'meu-canal-novo', p_category: null });
  await servers.updateChannel({ channelId: C1, categoryId: null, topic: null });
  assert.deepEqual(rest.calls.find((c) => c[1] === 'update_channel')[2], {
    p_id: C1, p_name: 'geral', p_topic: '', p_category: null, p_position: 0, p_clear_category: true,
  });
  await assert.rejects(servers.updateChannel({ channelId: C1, topic: '<script>' }), /inválid/);
  await assert.rejects(servers.setMemberRole({ serverId: G1, userId: LUA, role: 'owner' }), /inválid/);
  await servers.kickMember({ serverId: G1, userId: SOL });
  assert.deepEqual(rest.calls.find((c) => c[1] === 'kick_member')[2], { p_group: G1, p_user: SOL });
  assert.equal(normalizeTextChannelName('Ação Rápida'), 'ação-rápida');
  assert.equal(normalizeTextChannelName('a/b'), null);
});

test('social: pedido enviado/bloqueado sem perfil legível usa relationship_people (só o básico)', async () => {
  const OUTRO = '99999999-9999-4999-8999-999999999999';
  const { social, rest } = socialEnv({
    select(p) {
      if (p.startsWith('/rest/v1/profiles') && p.includes(`id=eq.${ME}`)) return [profile(ME, 'fantasma')];
      if (p.startsWith('/rest/v1/profiles')) return [profile(LUA, 'lua')]; // RLS esconde OUTRO
      if (p.startsWith('/rest/v1/relationships')) return [
        { other_id: LUA, kind: 'friend', created_at: '2026-01-01T00:00:00Z' },
        { other_id: OUTRO, kind: 'pending_out', created_at: '2026-01-02T00:00:00Z' },
      ];
      return [];
    },
    rpc(name) {
      if (name === 'relationship_people') return [{ ...profile(OUTRO, 'outro'), kind: 'pending_out' }, { ...profile(SOL, 'sol'), kind: 'blocked' }];
      return null;
    },
  });
  await social.refresh();
  assert.deepEqual(social.getFriendsView().map((f) => [f.username, f.relation]), [['lua', 'friend'], ['outro', 'pending_out']]);
  assert.equal(rest.calls.filter((c) => c[1] === 'relationship_people').length, 1);
});
