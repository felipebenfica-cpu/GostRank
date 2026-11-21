'use strict';
// Etapa 7 (LUMENEX) — frente MAIN: upload de 40 MB, detecção de animação, TUS, aparência do perfil,
// arrastar e soltar (só ADM), mudança de sala por ADM, tema na conta e marca.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const files = require('../../src/main/files');
const { createRest, TUS_CHUNK } = require('../../src/main/rest');
const { V } = require('../../src/main/api');
const { createUserCache, cleanCrop, selectProfiles } = require('../../src/main/users');
const { createSocialService } = require('../../src/main/social');
const { createServersService } = require('../../src/main/servers');
const { createPresenceService } = require('../../src/main/presence');
const { createPrefs } = require('../../src/main/prefs');
const { createAppServices } = require('../../src/main/services');
const { fakeRest, profile, token, manualTimers, flush, FakeWebSocket, ME, LUA, G1, C1, V1, CAT } = require('../etapa6/helpers');

const MB = 1024 * 1024;
const ROOT = path.join(__dirname, '..', '..');

// ---------- imagens sintéticas ----------
function png(size) {
  const b = new Uint8Array(size);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 64, 0, 0, 0, 64]);
  return b;
}
function jpeg(size) { const b = new Uint8Array(size); b.set([0xff, 0xd8, 0xff, 0xe0]); return b; }
/** GIF com `frames` quadros 1×1 (estrutura válida de blocos). */
function gif(frames, pad = 0) {
  const out = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255];
  out.push(0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0); // laço
  for (let i = 0; i < frames; i++) {
    out.push(0x21, 0xf9, 4, 0, 10, 0, 0, 0); // controle gráfico
    out.push(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x4c, 0x01, 0);
  }
  out.push(0x3b);
  const b = new Uint8Array(out.length + pad);
  b.set(out);
  return b;
}
function riff(chunks) {
  const body = [];
  for (const [tag, data] of chunks) {
    const len = data.length;
    body.push(...Buffer.from(tag), len & 255, (len >> 8) & 255, (len >> 16) & 255, (len >> 24) & 255, ...data);
    if (len & 1) body.push(0);
  }
  const total = 4 + body.length;
  return new Uint8Array([...Buffer.from('RIFF'), total & 255, (total >> 8) & 255, (total >> 16) & 255, (total >> 24) & 255, ...Buffer.from('WEBP'), ...body]);
}
const VP8X = (flags) => [flags, 0, 0, 0, 63, 0, 0, 63, 0, 0];
const WEBP_STATIC = riff([['VP8L', [0x2f, 0, 0, 0, 0]]]);
const WEBP_ANIM_FLAG = riff([['VP8X', VP8X(0x02)], ['ANIM', [0, 0, 0, 0, 0, 0]]]);
const WEBP_ANMF_ONLY = riff([['VP8X', VP8X(0x00)], ['ANMF', [1, 2, 3, 4]]]);
const APNG = (() => {
  const b = png(64);
  // IHDR (13 bytes) termina em 8+8+13+4 = 33; acTL logo depois
  b.set([0, 0, 0, 8, 0x61, 0x63, 0x54, 0x4c, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0], 33);
  return b;
})();
const THUMB = { mime: 'image/webp', data: WEBP_STATIC.buffer };

// ---------- 1. tamanhos e formatos ----------
test('40 MB: 2, 10, 25 e 40 MB exatos são aceitos; 40 MB + 1 byte é recusado (tela e main)', () => {
  for (const size of [2 * MB, 10 * MB, 25 * MB, 40 * MB]) {
    const data = png(size).buffer;
    assert.ok(V.profileMedia({ name: 'a.png', mime: 'image/png', data, thumb: THUMB }), `${size}`);
    const f = files.validateUpload({ name: 'a.png', mime: 'image/png', data }, 'profile');
    assert.equal(f.size, size);
  }
  assert.equal(files.PROFILE_MEDIA_MAX, 41943040);
  const big = png(40 * MB + 1).buffer;
  assert.equal(V.profileMedia({ name: 'a.png', mime: 'image/png', data: big, thumb: THUMB }), null);
  assert.throws(() => files.validateUpload({ name: 'a.png', mime: 'image/png', data: big }, 'profile'), (e) => e.code === 'profile_too_big' && /40 MB/.test(e.message));
});

test('formatos: JPG, PNG, GIF e WebP aceitos pela assinatura real; assinatura falsa e outros tipos recusados', () => {
  for (const [data, mime] of [[jpeg(100), 'image/jpeg'], [png(100), 'image/png'], [gif(1), 'image/gif'], [WEBP_STATIC, 'image/webp']]) {
    assert.equal(files.validateUpload({ name: 'x', mime: 'image/png', data: data.buffer }, 'profile').mime, mime);
  }
  const fake = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  assert.throws(() => files.validateUpload({ name: 'x.png', mime: 'image/png', data: fake.buffer }, 'profile'), (e) => e.code === 'invalid_profile_image');
  // miniatura: só WebP e até 512 KB
  assert.throws(() => files.validateUpload({ name: 't', mime: 'image/webp', data: png(64).buffer }, 'thumb'), (e) => e.code === 'invalid_thumb');
  const bigThumb = new Uint8Array(512 * 1024 + 1); bigThumb.set(WEBP_STATIC);
  assert.throws(() => files.validateUpload({ name: 't', mime: 'image/webp', data: bigThumb.buffer }, 'thumb'), (e) => e.code === 'invalid_thumb');
  assert.equal(V.profileMedia({ name: 'a.png', mime: 'image/png', data: png(64).buffer, thumb: { mime: 'image/png', data: png(64).buffer } }), null);
  assert.equal(V.profileMedia({ name: 'a.png', mime: 'image/png', data: png(64).buffer }), null, 'sem miniatura');
});

test('animação pelos bytes: GIF com 2+ quadros, WebP animado (bandeira ou ANMF), APNG; estáticos não', () => {
  const anim = (b, mime) => files.isAnimatedImage(b, mime);
  assert.equal(files.gifFrameCount(gif(1)), 1);
  assert.equal(anim(gif(1), 'image/gif'), false);
  assert.equal(anim(gif(3), 'image/gif'), true);
  assert.equal(anim(WEBP_STATIC, 'image/webp'), false);
  assert.equal(anim(WEBP_ANIM_FLAG, 'image/webp'), true);
  assert.equal(anim(WEBP_ANMF_ONLY, 'image/webp'), true);
  assert.equal(anim(png(64), 'image/png'), false);
  assert.equal(anim(APNG, 'image/png'), true);
  assert.equal(anim(jpeg(64), 'image/jpeg'), false);
  assert.equal(files.validateUpload({ name: 'a.gif', mime: 'image/gif', data: gif(4).buffer }, 'profile').animated, true);
  assert.equal(files.validateUpload({ name: 'a.webp', mime: 'image/webp', data: WEBP_STATIC.buffer }, 'profile').animated, false);
});

// ---------- 2. upload resumível (TUS) ----------
function tusFetch({ failPatchOnce = false, createStatus = 201, location = 'https://proj.supabase.co/storage/v1/upload/resumable/abc' } = {}) {
  const log = [];
  let offset = 0;
  let failed = false;
  const res = (status, headers = {}, body = '') => ({
    status, text: async () => body, headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  });
  const fetchImpl = async (url, init) => {
    log.push([init.method, url, init.headers, init.body ? init.body.length : 0]);
    if (init.method === 'POST' && url.endsWith('/storage/v1/upload/resumable')) {
      return createStatus === 201 ? res(201, { location }) : res(createStatus, {}, JSON.stringify({ statusCode: String(createStatus) }));
    }
    if (init.method === 'HEAD') return res(200, { 'upload-offset': String(offset) });
    if (init.method === 'PATCH') {
      if (failPatchOnce && !failed && offset > 0) {
        failed = true;
        offset += 1024; // o servidor recebeu um pedaço antes da queda
        throw new TypeError('fetch failed');
      }
      assert.equal(Number(init.headers['Upload-Offset']), offset);
      offset += init.body.length;
      return res(204, { 'upload-offset': String(offset) });
    }
    return res(404);
  };
  return { fetchImpl, log, getOffset: () => offset };
}
function tusRest(fetchImpl) {
  return createRest({ fetchImpl, supabaseUrl: 'https://proj.supabase.co', anonKey: 'anon-key-123456', getAccessToken: async () => token(), retryDelayMs: 1 });
}

test('TUS: 13 MB em blocos de 6 MB, metadados do Storage, progresso crescente até 100%', async () => {
  const t = tusFetch();
  const rest = tusRest(t.fetchImpl);
  const progress = [];
  const bytes = png(13 * MB);
  await rest.uploadResumable('avatars', `${ME}/avatar/x.png`, bytes, 'image/png', { onProgress: (p) => progress.push(p) });
  const create = t.log[0];
  assert.equal(create[2]['Upload-Length'], String(13 * MB));
  assert.equal(create[2]['Tus-Resumable'], '1.0.0');
  const meta = Object.fromEntries(create[2]['Upload-Metadata'].split(',').map((kv) => { const [k, v] = kv.split(' '); return [k, Buffer.from(v, 'base64').toString()]; }));
  assert.deepEqual(meta, { bucketName: 'avatars', objectName: `${ME}/avatar/x.png`, contentType: 'image/png', cacheControl: '3600' });
  const patches = t.log.filter((l) => l[0] === 'PATCH').map((l) => l[3]);
  assert.deepEqual(patches, [TUS_CHUNK, TUS_CHUNK, 13 * MB - 2 * TUS_CHUNK]);
  assert.equal(progress[0], 0);
  assert.equal(progress.at(-1), 1);
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i] >= progress[i - 1]);
});

test('TUS: queda de conexão no meio retoma do offset confirmado pelo servidor (HEAD)', async () => {
  const t = tusFetch({ failPatchOnce: true });
  const rest = tusRest(t.fetchImpl);
  const bytes = png(13 * MB);
  await rest.uploadResumable('avatars', `${ME}/avatar/x.png`, bytes, 'image/png');
  assert.ok(t.log.some((l) => l[0] === 'HEAD'), 'perguntou o offset');
  assert.equal(t.getOffset(), 13 * MB, 'terminou sem duplicar nem perder bytes');
});

test('TUS: 413 na criação vira erro de tamanho; Location de outro servidor é recusado', async () => {
  await assert.rejects(tusRest(tusFetch({ createStatus: 413 }).fetchImpl).uploadResumable('avatars', 'a/b', png(64), 'image/png'), (e) => e.code === 'attachment_too_big');
  await assert.rejects(tusRest(tusFetch({ location: 'https://evil.example/x' }).fetchImpl).uploadResumable('avatars', 'a/b', png(64), 'image/png'), (e) => e.code === 'upload_failed');
});

// ---------- 3. perfil: aparência e imagens ----------
function lookEnv(extra = {}) {
  const rest = fakeRest({
    select(p) {
      if (p.startsWith('/rest/v1/profiles') && p.includes(`id=eq.${ME}`)) {
        return [profile(ME, 'eu', {
          avatar_path: `${ME}/avatar/old.gif`, avatar_thumb_path: `${ME}/avatar/old.thumb.webp`, avatar_animated: true,
          banner_path: `${ME}/banner/b1.webp`, banner_animated: true, avatar_crop: { x: 40, y: 60, zoom: 1.5 }, banner_pos: 30,
          avatar_frame: 'fire', profile_effect: 'sparks', appearance_theme: 'midnight',
        })];
      }
      return [];
    },
    ...extra,
  });
  const users = createUserCache({ rest });
  const social = createSocialService({ rest, users });
  return { rest, users, social };
}

test('perfil: campos da 0007 viram a view (miniatura estática nas listas, banner, moldura, efeito, recorte)', async () => {
  const { social, rest } = lookEnv();
  await social.refresh();
  const me = social.getMe();
  assert.match(me.avatarUrl, /\/avatars\/.*\/avatar\/old\.gif$/);
  assert.match(me.avatarThumbUrl, /old\.thumb\.webp$/);
  assert.equal(me.animatedAvatar, true);
  assert.match(me.bannerUrl, /banner\/b1\.webp$/);
  assert.match(me.bannerThumbUrl, /banner\/b1\.thumb\.webp$/);
  assert.deepEqual(me.avatarCrop, { x: 40, y: 60, zoom: 1.5 });
  assert.equal(me.bannerPos, 30);
  assert.equal(me.frame, 'fire');
  assert.equal(me.effect, 'sparks');
  assert.equal(me.appearanceTheme, 'midnight');
  assert.match(rest.calls.find((c) => c[0] === 'select')[1], /avatar_frame,profile_effect/);
  // caminho de outro usuário, moldura/efeito desconhecidos e recorte fora da faixa são descartados
  const users = createUserCache({ rest: fakeRest() });
  const [u] = users.upsertRows([profile(LUA, 'lua', { banner_path: `${ME}/banner/x.png`, avatar_frame: 'neon', profile_effect: '<b>', avatar_crop: { x: 120, y: 1, zoom: 9 } })]);
  assert.equal(u.bannerUrl, null);
  assert.equal(u.frame, null);
  assert.equal(u.effect, null);
  assert.equal(u.avatarCrop, null);
  assert.equal(cleanCrop({ x: 50, y: 50, zoom: 1 }).zoom, 1);
});

test('perfil: sem a 0007, pede só as colunas antigas e o app continua', async () => {
  const calls = [];
  const rest = {
    async select(q) {
      calls.push(q);
      if (q.includes('avatar_frame')) { const e = new Error('x'); e.code = 'needs_migration'; throw e; }
      return [profile(ME, 'eu')];
    },
  };
  const rows = await selectProfiles(rest, (c) => `/rest/v1/profiles?select=${c}`);
  assert.equal(rows.length, 1);
  assert.ok(calls.some((q) => !q.includes('avatar_frame')));
  const n = calls.length;
  await selectProfiles(rest, (c) => `/rest/v1/profiles?select=${c}`);
  assert.equal(calls.length - n, 1, 'lembra que falta a 0007 (sem pedir de novo na hora)');
});

test('perfil: updateProfileLook junta com o atual e valida; reset; sem 0007 a mensagem pede o 0007', async () => {
  const { social, rest } = lookEnv();
  await social.refresh();
  await social.updateLook({ frame: 'ice' });
  assert.deepEqual(rest.calls.filter((c) => c[1] === 'update_profile_look').at(-1)[2],
    { p_frame: 'ice', p_effect: 'sparks', p_avatar_crop: { x: 40, y: 60, zoom: 1.5 }, p_banner_pos: 30 });
  await social.updateLook({ effect: null, avatarCrop: { x: 10, y: 20, zoom: 2 }, bannerPos: 75 });
  assert.deepEqual(rest.calls.filter((c) => c[1] === 'update_profile_look').at(-1)[2],
    { p_frame: 'fire', p_effect: null, p_avatar_crop: { x: 10, y: 20, zoom: 2 }, p_banner_pos: 75 });
  await assert.rejects(social.updateLook({ frame: 'neon' }), (e) => e.code === 'invalid_look');
  await assert.rejects(social.updateLook({ bannerPos: 101 }), (e) => e.code === 'invalid_look');
  await social.resetLook();
  assert.ok(rest.calls.some((c) => c[1] === 'reset_profile_look'));
  const old = lookEnv({ rpc() { const e = new Error('x'); e.code = 'needs_migration'; throw e; } });
  await old.social.refresh();
  await assert.rejects(old.social.updateLook({ frame: 'gold' }), (e) => e.code === 'needs_migration_0007' && /0007/.test(e.message));
  assert.equal(V.look({ frame: 'gold', effect: 'pulse', avatarCrop: { x: 1, y: 2, zoom: 3 }, bannerPos: 0 }) !== null, true);
  assert.equal(V.look({}), null);
  assert.equal(V.look({ frame: 'x' }), null);
  assert.equal(V.look({ avatarCrop: { x: 1, y: 2, zoom: 4 } }), null);
});

test('banner: GIF animado sobe com animated=true, apaga os arquivos antigos; erro de envio limpa o que subiu', async () => {
  const { social, rest } = lookEnv();
  await social.refresh();
  await social.uploadBanner({ name: 'b.gif', mime: 'image/gif', data: gif(3).buffer, thumb: THUMB });
  const rpc = rest.calls.find((c) => c[1] === 'set_profile_media');
  assert.equal(rpc[2].p_kind, 'banner');
  assert.equal(rpc[2].p_animated, true);
  assert.match(rpc[2].p_path, new RegExp(`^${ME}/banner/[0-9a-f-]{36}\\.gif$`));
  const removed = rest.calls.filter((c) => c[0] === 'removeObjects').flatMap((c) => c[2]);
  assert.ok(removed.includes(`${ME}/banner/b1.webp`) && removed.includes(`${ME}/banner/b1.thumb.webp`));
  // falha de conexão no original: apaga a miniatura e mostra erro com "tente de novo"
  const bad = lookEnv({ uploadResumable() { const { appError } = require('../../src/main/rest'); throw appError('upload_interrupted'); } });
  await bad.social.refresh();
  await assert.rejects(bad.social.uploadAvatar({ name: 'a.png', mime: 'image/png', data: png(100).buffer, thumb: THUMB }), (e) => e.code === 'upload_interrupted');
  assert.equal(bad.social.getUploads().avatar.status, 'error');
  assert.match(bad.social.getUploads().avatar.error, /tente de novo/);
  assert.ok(bad.rest.calls.some((c) => c[0] === 'removeObjects' && c[2].some((p) => p.endsWith('.thumb.webp'))));
  // bucket ainda com 2 MB (sem a 0007): 413 vira pedido de atualizar o banco
  const tooSmall = lookEnv({ uploadResumable() { const { appError } = require('../../src/main/rest'); throw appError('attachment_too_big'); } });
  await tooSmall.social.refresh();
  await assert.rejects(tooSmall.social.uploadBanner({ name: 'a.png', mime: 'image/png', data: png(3 * MB).buffer, thumb: THUMB }), (e) => e.code === 'media_needs_0007');
});

// ---------- 4. arrastar e soltar: só ADM ----------
function serversEnv(role, rpc = () => null) {
  const rest = fakeRest({
    select(p) {
      if (p.startsWith('/rest/v1/group_members?select=group_id')) return [{ group_id: G1, role, groups: { id: G1, name: 'S', owner_id: LUA, icon_color: 2, icon_path: null } }];
      if (p.startsWith('/rest/v1/channel_categories')) return [{ id: CAT, name: 'Voz', position: 0 }];
      if (p.startsWith('/rest/v1/channels')) return [
        { id: C1, kind: 'text', name: 'geral', topic: null, category_id: null, position: 0 },
        { id: V1, kind: 'voice', name: 'Geral', topic: null, category_id: CAT, position: 0 },
      ];
      if (p.startsWith('/rest/v1/group_members?select=user_id')) return [{ user_id: ME, role }, { user_id: LUA, role: 'owner' }];
      return [];
    },
    rpc,
  });
  const users = createUserCache({ rest });
  let changes = 0;
  const servers = createServersService({ rest, users, onChange: () => { changes++; } });
  return { rest, servers, changes: () => changes };
}

test('reordenar: membro comum é recusado antes de chamar o banco; ADM reordena com otimismo', async () => {
  const m = serversEnv('member');
  await m.servers.refreshList();
  await m.servers.select(G1);
  await assert.rejects(m.servers.reorderChannels({ serverId: G1, channels: [{ id: V1, categoryId: null, position: 1 }] }), (e) => e.code === 'not_admin');
  await assert.rejects(m.servers.moveVoiceMember({ serverId: G1, userId: LUA, channelId: V1 }), (e) => e.code === 'not_admin');
  assert.equal(m.rest.calls.filter((c) => c[0] === 'rpc').length, 0);

  const a = serversEnv('admin');
  await a.servers.refreshList();
  await a.servers.select(G1);
  await a.servers.reorderChannels({ serverId: G1, channels: [{ id: V1, categoryId: null, position: 1 }, { id: C1, categoryId: CAT, position: 0 }], categories: [{ id: CAT, position: 3 }] });
  const call = a.rest.calls.find((c) => c[1] === 'reorder_channels');
  assert.deepEqual(call[2], {
    p_group: G1,
    p_channels: [{ id: V1, categoryId: null, position: 1 }, { id: C1, categoryId: CAT, position: 0 }],
    p_categories: [{ id: CAT, position: 3 }],
  });
  const sel = a.servers.getSelected();
  assert.equal(sel.channels.find((c) => c.id === V1).categoryId, null);
  assert.equal(sel.channels.find((c) => c.id === C1).categoryId, CAT);
  // canal de outro servidor → recusado
  await assert.rejects(a.servers.reorderChannels({ serverId: G1, channels: [{ id: LUA, categoryId: null, position: 0 }] }), (e) => e.code === 'invalid_layout');
});

test('reordenar: se o banco recusar, a ordem volta como estava; sem 0007 pede o 0007', async () => {
  const { appError } = require('../../src/main/rest');
  const a = serversEnv('owner', (n) => { if (n === 'reorder_channels') throw appError('not_admin'); return null; });
  await a.servers.refreshList();
  await a.servers.select(G1);
  const before = JSON.stringify(a.servers.getSelected().channels);
  await assert.rejects(a.servers.reorderChannels({ serverId: G1, channels: [{ id: V1, categoryId: null, position: 9 }] }), (e) => e.code === 'not_admin');
  assert.equal(JSON.stringify(a.servers.getSelected().channels), before);
  const old = serversEnv('owner', () => { const e = new Error('x'); e.code = 'needs_migration'; throw e; });
  await old.servers.refreshList();
  await old.servers.select(G1);
  await assert.rejects(old.servers.reorderChannels({ serverId: G1, channels: [{ id: V1, categoryId: null, position: 1 }] }), (e) => e.code === 'needs_migration_0007');
});

test('mover participante: só para sala de voz do servidor; validação da ponte', async () => {
  const a = serversEnv('admin');
  await a.servers.refreshList();
  await a.servers.select(G1);
  await assert.rejects(a.servers.moveVoiceMember({ serverId: G1, userId: LUA, channelId: C1 }), (e) => e.code === 'invalid_channel');
  await a.servers.moveVoiceMember({ serverId: G1, userId: LUA, channelId: V1 });
  assert.deepEqual(a.rest.calls.find((c) => c[1] === 'move_voice_member')[2], { p_group: G1, p_user: LUA, p_channel: V1 });
  assert.equal(V.voiceMove({ serverId: G1, userId: LUA, channelId: 'x' }), null);
  assert.equal(V.reorder({ serverId: G1, channels: [] }), null);
  assert.equal(V.reorder({ serverId: G1, channels: [{ id: V1, categoryId: null, position: -1 }] }), null);
  assert.equal(V.reorder({ serverId: G1, channels: [{ id: V1, categoryId: null, position: 1 }, { id: V1, categoryId: null, position: 2 }] }), null, 'repetido');
  assert.ok(V.reorder({ serverId: G1, channels: [{ id: V1, categoryId: CAT, position: 1 }], categories: [{ id: CAT, position: 0 }] }));
});

test('aviso voice_move no tópico me:<eu> vira evento confiável; payload ruim é ignorado', () => {
  const chans = new Map();
  const rt = {
    available: true,
    channel(topic, opts) {
      const ls = {};
      const ch = { topic, opts, on(k, fn) { (ls[k] = ls[k] || []).push(fn); return ch; }, fire(k, d) { for (const fn of ls[k] || []) fn(d); }, track() {}, untrack() {}, broadcast() { return true; }, unsubscribe() {} };
      chans.set(topic, ch);
      return ch;
    },
  };
  const events = [];
  const p = createPresenceService({ realtime: rt, timers: manualTimers(), onPrivateEvent: (e) => events.push(e) });
  p.setMe(ME);
  p.sync({ serverIds: [G1], friendIds: [], dmIds: [] });
  const me = chans.get(`me:${ME}`);
  me.fire('broadcast', { event: 'voice_move', payload: { serverId: G1.toUpperCase(), channelId: V1, by: LUA } });
  me.fire('broadcast', { event: 'voice_move', payload: { serverId: 'x', channelId: V1 } });
  assert.deepEqual(events, [{ kind: 'voice_move', serverId: G1, channelId: V1, by: LUA }]);
});

// ---------- 5. serviços: view.voiceMove, uploads e tema na conta ----------
function respond(status, body) {
  return { status, text: async () => (body === undefined ? '' : JSON.stringify(body)), headers: { get: () => null } };
}
function fetchV3(log, { accountTheme = 'light' } = {}) {
  const URL = 'https://proj.supabase.co';
  return async (url, init) => {
    const u = url.slice(URL.length);
    log.push([init.method, u, init.body]);
    if (u.startsWith('/rest/v1/channels?select=id&limit=1')) return respond(200, []);
    if (u.startsWith('/rest/v1/profiles?select=display_name')) return respond(200, [{ display_name: 'Eu', mmr_visibility: 'group', steam_account_id: null }]);
    if (u.startsWith('/rest/v1/profiles?select=id,username')) return respond(200, [profile(ME, 'eu', { appearance_theme: accountTheme })]);
    if (u.startsWith('/rest/v1/group_members?select=group_id,role')) return respond(200, [{ group_id: G1, role: 'member', groups: { id: G1, name: 'S', owner_id: LUA, icon_color: 1, icon_path: null } }]);
    if (u.startsWith('/rest/v1/channels?select=id,group_id')) return respond(200, [{ id: C1, group_id: G1, kind: 'text', name: 'geral' }, { id: V1, group_id: G1, kind: 'voice', name: 'Geral' }]);
    if (u.startsWith('/rest/v1/rpc/unread_summary')) return respond(200, []);
    if (u.startsWith('/rest/v1/rpc/set_appearance_theme')) return respond(204);
    if (u.startsWith('/rest/v1/relationships') || u.startsWith('/rest/v1/dm_channels')) return respond(200, []);
    return respond(200, []);
  };
}
async function bootV3(opts = {}) {
  FakeWebSocket.instances = [];
  const log = [];
  let saved = opts.saved || null;
  const svc = createAppServices({
    config: { supabaseUrl: 'https://proj.supabase.co', anonKey: 'anon-key-123456' },
    fetchImpl: fetchV3(log, opts),
    WebSocketImpl: FakeWebSocket,
    sessionStore: { load: () => ({ version: 1, accessToken: token(), refreshToken: 'r', expiresAt: 4_000_000_000, user: { id: ME, email: 'e@x.com', emailConfirmed: true } }), save() {}, clear() {} },
    prefsStore: { load: () => saved, save: (o) => { saved = o; } },
    timers: manualTimers(),
  });
  svc.start();
  for (let i = 0; i < 30; i++) await flush();
  return { svc, log, saved: () => saved };
}

test('serviços: tema da conta vale num aparelho novo; trocar o tema salva na conta; aparelho que já escolheu manda', async () => {
  const fresh = await bootV3({ accountTheme: 'midnight' });
  assert.equal(fresh.svc.getExtraView().prefs.appearance.theme, 'midnight');
  await fresh.svc.app.updatePrefs({ appearance: { theme: 'light' } });
  await flush();
  const call = fresh.log.find((l) => l[1].startsWith('/rest/v1/rpc/set_appearance_theme'));
  assert.deepEqual(JSON.parse(call[2]), { p_theme: 'light' });
  assert.equal(fresh.saved()._themeHere, true);

  const chosen = await bootV3({ accountTheme: 'midnight', saved: { appearance: { theme: 'dark' }, _themeHere: true } });
  assert.equal(chosen.svc.getExtraView().prefs.appearance.theme, 'dark');
  assert.ok(createPrefs({ store: null }).themeChosenHere() === false);
});

test('serviços: ADM move você → view.voiceMove com nonce novo; canal de outro servidor é ignorado', async () => {
  const { svc } = await bootV3();
  const view = svc.getExtraView();
  assert.equal(view.voiceMove, null);
  assert.deepEqual(view.uploads, { avatar: null, banner: null });
  const ws = FakeWebSocket.instances[0];
  ws.open();
  ws.ackJoins();
  const send = (payload) => ws.server({ topic: `realtime:me:${ME}`, event: 'broadcast', payload: { type: 'broadcast', event: 'voice_move', payload } });
  send({ serverId: G1, channelId: V1, by: LUA });
  const first = svc.getExtraView().voiceMove;
  assert.deepEqual({ ...first, nonce: undefined }, { nonce: undefined, serverId: G1, channelId: V1, by: LUA });
  send({ serverId: G1, channelId: C1, by: LUA }); // canal de texto: ignora
  assert.equal(svc.getExtraView().voiceMove.nonce, first.nonce);
  send({ serverId: G1, channelId: V1, by: LUA });
  assert.equal(svc.getExtraView().voiceMove.nonce, first.nonce + 1);
});

// ---------- 6. marca ----------
test('marca: janela e produto LUMENEX, pasta de dados e nome do .exe antigos preservados, ícone provisório', () => {
  const main = fs.readFileSync(path.join(ROOT, 'src/main/main.js'), 'utf8');
  assert.match(main, /title: 'LUMENEX'/);
  const setPath = main.indexOf("app.setPath('userData'");
  assert.ok(setPath > 0 && setPath < main.indexOf('requestSingleInstanceLock'), 'pasta de dados antes do bloqueio de instância');
  assert.match(main, /LEGACY_USER_DATA_DIR = 'Ghost Rank'/);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.build.productName, 'LUMENEX');
  assert.equal(pkg.name, 'ghost-rank');
  assert.equal(pkg.build.appId, 'com.ghostrank.app');
  assert.equal(pkg.build.portable.artifactName, 'GhostRank-${version}.exe');
  assert.equal(pkg.build.nsis.artifactName, 'LUMENEX-Setup-${version}.exe');
  assert.ok(pkg.build.win.target.includes('nsis') && pkg.build.win.target.includes('portable'));
  const icon = fs.readFileSync(path.join(ROOT, 'build/icon.png'));
  assert.equal(icon.readUInt32BE(16), 512);
  for (const f of ['main.js', 'chat.js', 'group.js', 'rest.js', 'services.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'src/main', f), 'utf8').replace(/LEGACY_USER_DATA_DIR = 'Ghost Rank'|continua a antiga \("Ghost Rank"\)/g, '');
    assert.doesNotMatch(src, /Ghost ?Rank|GostRank|GOSTHRANK/, f);
  }
});
