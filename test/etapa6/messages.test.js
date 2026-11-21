'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { createUserCache } = require('../../src/main/users');
const { createMessagesService, extractMentions } = require('../../src/main/messages');
const { fakeRest, profile, manualTimers, ME, LUA, SOL, G1, C1, C2, DM1 } = require('./helpers');

function row(id, user, body, extra = {}) {
  return { id, user_id: user, body, created_at: new Date(1_800_000_000_000 + id * 1000).toISOString(), edited_at: null, reply_to: null, attachments: [], mentions: [], pinned: false, channel_id: C1, dm_id: null, group_id: G1, ...extra };
}

function env({ history = [row(1, LUA, 'oi'), row(2, ME, 'eae', { reply_to: 1 }), row(3, LUA, 'bora?', { reply_to: 99 })], unread = [], insertFail = false } = {}) {
  let nextId = 100;
  const rest = fakeRest({
    select(p) {
      if (p.startsWith('/rest/v1/messages?select=id,user_id,body&id=in.(99)')) return [{ id: 99, user_id: SOL, body: 'mensagem antiga' }];
      if (p.startsWith('/rest/v1/messages') && p.includes('pinned=is.true')) return [row(2, ME, 'eae', { pinned: true })];
      if (p.startsWith('/rest/v1/messages') && p.includes('id=lt.')) return [];
      if (p.startsWith('/rest/v1/messages')) return history.slice().reverse();
      if (p.startsWith('/rest/v1/message_reactions')) return [{ message_id: 1, user_id: ME, emoji: '👻' }, { message_id: 1, user_id: LUA, emoji: '👻' }];
      if (p.startsWith('/rest/v1/profiles')) return [profile(ME, 'fantasma'), profile(LUA, 'lua'), profile(SOL, 'sol')];
      return [];
    },
    rpc(name, args) {
      if (name === 'unread_summary') return unread;
      if (name === 'search_messages') return [row(1, LUA, 'oi'), row(7, LUA, 'de outro canal', { channel_id: C2 })];
      void args;
      return null;
    },
    insert(table, body) {
      if (table === 'messages') {
        if (insertFail) throw Object.assign(new Error('x'), { name: 'UserInputError', message: 'Sem conexão com o servidor. Verifique sua internet.' });
        return row(nextId++, ME, body.body, { reply_to: body.reply_to ?? null, attachments: body.attachments, mentions: body.mentions });
      }
      return null;
    },
    update: (p, body) => [row(2, ME, body.body, { edited_at: '2026-01-01T00:00:00Z' })],
  });
  const users = createUserCache({ rest });
  const timers = manualTimers();
  let focused = true;
  let now = 1_900_000_000_000;
  const svc = createMessagesService({ rest, users, timers, now: () => now, isFocused: () => focused });
  svc.setMe(ME);
  return { rest, users, svc, timers, setFocused: (v) => { focused = v; }, tick: (ms) => { now += ms; } };
}

const members = new Set([ME, LUA]);
const openOpts = { groupId: G1, resolveUsername: (u) => ({ lua: LUA, sol: SOL })[u] || null, isMentionable: (id) => members.has(id) };

test('mensagens: abre o canal com histórico, reações, respostas (inclusive fora da página) e "NOVAS"', async () => {
  const { svc } = env({ unread: [{ target: `c:${C1}`, last_message_id: 3, unread: 2, mentions: 0 }] });
  await svc.refreshUnread();
  svc.setMe(ME);
  await svc.open(`c:${C1}`, openOpts);
  const v = svc.getView();
  assert.equal(v.status, 'ready');
  assert.deepEqual(v.items.map((m) => m.id), [1, 2, 3]);
  assert.deepEqual(v.items[0].reactions, [{ emoji: '👻', count: 2, me: true }]);
  assert.deepEqual(v.items[1].replyTo, { id: 1, authorId: LUA, body: 'oi' });
  assert.deepEqual(v.items[2].replyTo, { id: 99, authorId: SOL, body: 'mensagem antiga' });
  assert.equal(v.firstUnreadId, 1); // 2 não lidas de LUA: ids 1 e 3 → primeira é 1
  assert.equal(v.hasMore, false);
  await assert.rejects(svc.open('x:1'), /Abra um canal/);
});

test('mensagens: menções no formato <@id> (e @usuario), só gente do alvo, sem você', () => {
  const ids = extractMentions(`oi <@${LUA}> e <@${SOL.toUpperCase()}> e @lua de novo e <@${LUA}>`, (u) => (u === 'lua' ? LUA : null));
  assert.deepEqual(ids, [LUA, SOL]);
});

test('mensagens: enviar com resposta, menção e anexo (caminho no prefixo do canal), depois tempo real não duplica', async () => {
  const { svc, rest } = env();
  await svc.open(`c:${C1}`, openOpts);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 3]);
  const id = await svc.send({ body: ` oi <@${LUA}> e <@${SOL}> e <@${ME}> `, replyTo: 1, attachments: [{ name: 'print.png', mime: 'image/png', data: png.buffer }] });
  const up = rest.calls.find((c) => c[0] === 'upload');
  assert.equal(up[1], 'attachments');
  assert.match(up[2], new RegExp(`^g_${G1}/${C1}/[0-9a-f-]{36}/print\\.png$`));
  const ins = rest.calls.find((c) => c[0] === 'insert' && c[1] === 'messages')[2];
  assert.equal(ins.body, `oi <@${LUA}> e <@${SOL}> e <@${ME}>`);
  assert.deepEqual(ins.mentions, [LUA]); // SOL não é membro; você mesmo não conta
  assert.equal(ins.reply_to, 1);
  assert.equal(ins.channel_id, C1);
  assert.equal(ins.group_id, G1);
  assert.deepEqual(ins.attachments[0].width, 2);
  const v = svc.getView();
  const mine = v.items.find((m) => m.id === id);
  assert.equal(mine.attachments[0].isImage, true);
  assert.match(mine.attachments[0].url, /^https:\/\/proj\.supabase\.co\/storage\/v1\/object\/sign\/attachments\//);
  assert.equal(v.items.filter((m) => m.pending).length, 0);
  // o mesmo id chegando pelo tempo real não duplica
  await svc.applyInsert(row(id, ME, ins.body, { attachments: ins.attachments, mentions: ins.mentions }));
  assert.equal(svc.getView().items.filter((m) => m.id === id).length, 1);
  await assert.rejects(svc.send({ body: '   ' }), /Escreva uma mensagem/);
  await assert.rejects(svc.send({ body: 'x'.repeat(2001) }), /2000/);
});

test('mensagens: envio que falha fica "failed" e retryMessage reenvia', async () => {
  const e = env({ insertFail: true });
  await e.svc.open(`c:${C1}`, openOpts);
  await assert.rejects(e.svc.send({ body: 'vai falhar' }), /Sem conexão/);
  const failed = e.svc.getView().items.find((m) => m.failed);
  assert.ok(failed && failed.id < 0);
  await assert.rejects(e.svc.retry(failed.id), /Sem conexão/);
  assert.equal(e.svc.getView().items.filter((m) => m.failed).length, 1);
  await assert.rejects(e.svc.retry(-999), /não existe/);
});

test('mensagens: tempo real em outro canal conta não lida/menção; DM conta como menção; marcar lido zera', async () => {
  const { svc, rest } = env();
  await svc.open(`c:${C1}`, openOpts);
  const info = await svc.applyInsert(row(50, LUA, `ei <@${ME}>`, { channel_id: C2, mentions: [ME] }));
  assert.equal(info.isCurrent, false);
  assert.equal(info.mentionsMe, true);
  assert.deepEqual(svc.unreadOf(`c:${C2}`), { unread: 1, mentions: 1 });
  await svc.applyInsert(row(51, LUA, 'oi', { channel_id: null, group_id: null, dm_id: DM1 }));
  assert.deepEqual(svc.unreadOf(`d:${DM1}`), { unread: 1, mentions: 1 });
  await svc.markTargetRead(`c:${C2}`);
  assert.deepEqual(svc.unreadOf(`c:${C2}`), { unread: 0, mentions: 0 });
  assert.deepEqual(rest.calls.find((c) => c[1] === 'mark_read')[2], { p_target: `c:${C2}`, p_last_id: 50 });
  // mensagem nova no canal aberto entra na lista
  await svc.applyInsert(row(52, LUA, 'no canal aberto'));
  assert.equal(svc.getView().items.at(-1).id, 52);
  // edição e exclusão pelo tempo real
  svc.applyUpdate(row(52, LUA, 'editada', { edited_at: '2026-01-01T00:00:00Z' }));
  assert.equal(svc.getView().items.at(-1).body, 'editada');
  assert.ok(svc.getView().items.at(-1).editedAt);
  svc.applyDelete(52);
  assert.equal(svc.findItem(52), null);
});

test('mensagens: reações otimistas, editar, apagar, fixar, fixadas e busca só do alvo', async () => {
  const { svc, rest } = env();
  await svc.open(`c:${C1}`, openOpts);
  await svc.toggleReaction({ id: 1, emoji: '👻' }); // já tinha a minha → remove
  assert.deepEqual(svc.getView().items[0].reactions, [{ emoji: '👻', count: 1, me: false }]);
  assert.match(rest.calls.find((c) => c[0] === 'remove')[1], /message_reactions\?message_id=eq\.1&user_id=eq\.[0-9a-f-]+&emoji=eq\./);
  await svc.toggleReaction({ id: 1, emoji: '🔥' });
  assert.ok(svc.getView().items[0].reactions.some((r) => r.emoji === '🔥' && r.me));
  // a reação de outra pessoa pelo tempo real
  svc.applyReaction('INSERT', { message_id: 1, user_id: SOL, emoji: '🔥' });
  assert.equal(svc.getView().items[0].reactions.find((r) => r.emoji === '🔥').count, 2);
  await assert.rejects(svc.toggleReaction({ id: 1, emoji: 'com espaço' }), /inválid/);
  await svc.edit({ id: 2, body: 'eae editado' });
  assert.equal(svc.getView().items[1].body, 'eae editado');
  await assert.rejects(svc.edit({ id: 1, body: 'não é minha' }), /permissão/);
  await svc.pin({ id: 2, pinned: true });
  assert.equal(svc.getView().items[1].pinned, true);
  const pinned = await svc.listPinned();
  assert.equal(pinned[0].id, 2);
  const found = await svc.search('oi');
  assert.deepEqual(found.map((m) => m.id), [1]); // a de outro canal fica de fora
  await svc.remove(2);
  assert.equal(svc.findItem(2), null);
});

test('mensagens: digitando aparece e some depois de 6 s; você não aparece', async () => {
  const e = env();
  await e.svc.open(`c:${C1}`, openOpts);
  e.svc.receiveTyping({ target: `c:${C1}`, userId: LUA });
  e.svc.receiveTyping({ target: `c:${C1}`, userId: ME });
  assert.deepEqual(e.svc.getView().typing, [LUA]);
  e.tick(7000);
  e.timers.runTimeouts();
  assert.deepEqual(e.svc.getView().typing, []);
});

test('mensagens: formato antigo de view.chat para o canal aberto', async () => {
  const { svc } = env();
  await svc.open(`c:${C1}`, openOpts);
  const legacy = svc.getLegacyView();
  assert.equal(legacy.messages.length, 3);
  assert.deepEqual(Object.keys(legacy.messages[0]).sort(), ['body', 'createdAt', 'displayName', 'id', 'mine', 'userId']);
  assert.equal(legacy.messages[1].mine, true);
});
