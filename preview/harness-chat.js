/* Harness isolado do GhostChat (frente R2). Cenários: ?s=default|compact|light|picker|pinned|search|edit|reply|lightbox|dm|empty|loading|error|typing|older|menu */
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var s = params.get('s') || 'default';

  var ME = '11111111-1111-4111-8111-111111111111';
  var LUA = '22222222-2222-4222-8222-222222222222';
  var RATO = '33333333-3333-4333-8333-333333333333';
  var BIA = '44444444-4444-4444-8444-444444444444';
  var users = {};
  users[ME] = { id: ME, username: 'fantasma', displayName: 'Fantasma Noturno', avatarColor: 0, avatarUrl: null, customStatus: 'farmando' };
  users[LUA] = { id: LUA, username: 'lua.cheia', displayName: 'Lua Cheia', avatarColor: 1, avatarUrl: null, customStatus: null };
  users[RATO] = { id: RATO, username: 'rato_de_mid', displayName: 'Rato de Mid', avatarColor: 3, avatarUrl: null, customStatus: null };
  users[BIA] = { id: BIA, username: 'bia', displayName: 'Bia Suporte', avatarColor: 5, avatarUrl: null, customStatus: null };

  function svgImage(w, h, a, b, label) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="52%" font-family="sans-serif" font-size="' + Math.round(h / 8) + '" fill="white" text-anchor="middle">' + label + '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  var base = Date.now() - 26 * 3600 * 1000;
  var t = function (min) { return new Date(base + min * 60000).toISOString(); };
  var today = Date.now();
  var tt = function (minAgo) { return new Date(today - minAgo * 60000).toISOString(); };
  var nextId = 100;
  var msgs = [
    { id: 1, authorId: LUA, body: 'Bom dia, fantasmas! Quem topa umas ranqueadas hoje à noite?', createdAt: t(0) },
    { id: 2, authorId: LUA, body: 'Eu jogo de **suporte** ou _offlane_, tanto faz.', createdAt: t(2) },
    { id: 3, authorId: RATO, body: 'Eu topo! Mas só depois das 21h. ||vou perder de novo no mid||', createdAt: t(5), reactions: [{ emoji: '😂', count: 3, me: true }, { emoji: '👍', count: 1, me: false }] },
    { id: 4, authorId: ME, body: 'Fechado. Deixei o guia aqui: https://www.opendota.com/heroes', createdAt: t(9), pinned: true },
    { id: 5, authorId: BIA, body: 'Alguém viu o patch novo?\n> o Pudge ficou forte demais\nconcordo total', createdAt: tt(95) },
    { id: 6, authorId: RATO, body: 'Olha a build que estou testando:\n```\nItens: Bottle -> Blink -> Aghanim\nSkill: Q W Q E Q R\n```', createdAt: tt(90), editedAt: tt(88) },
    { id: 7, authorId: LUA, body: 'Ei <@' + ME + '>, você vai de Invoker de novo? 🔥', createdAt: tt(40), mentionsMe: true, mentions: [ME],
      replyTo: { id: 4, authorId: ME, body: 'Fechado. Deixei o guia aqui: https://www.opendota.com/heroes' } },
    { id: 8, authorId: ME, body: 'Claro! ~~Pudge~~ Invoker sempre 😎', createdAt: tt(38), reactions: [{ emoji: '🔥', count: 2, me: false }, { emoji: '👻', count: 4, me: true }, { emoji: '💯', count: 1, me: false }] },
    { id: 9, authorId: BIA, body: 'Print da última partida:', createdAt: tt(20),
      attachments: [{ url: svgImage(640, 360, '#1d4740', '#322c61', 'VITÓRIA 32-14'), name: 'vitoria.png', size: 182000, mime: 'image/png', width: 640, height: 360, isImage: true }] },
    { id: 10, authorId: BIA, body: '', createdAt: tt(19),
      attachments: [{ url: 'https://exemplo.supabase.co/storage/v1/object/sign/attachments/replay.dem', name: 'replay-7731.dem', size: 5400000, mime: 'application/octet-stream', isImage: false }] },
    { id: 11, authorId: RATO, body: '👻👻👻', createdAt: tt(5) },
    { id: 12, authorId: ME, body: 'Vou entrar na voz em 5 minutos, `ping` tá estranho aqui', createdAt: tt(2) }
  ];
  msgs.forEach(function (m) { m.reactions = m.reactions || []; m.attachments = m.attachments || []; m.pinned = !!m.pinned; m.mentionsMe = !!m.mentionsMe; m.mentions = m.mentions || []; m.editedAt = m.editedAt || null; m.replyTo = m.replyTo || null; });

  var view = {
    me: { id: ME, username: 'fantasma', displayName: 'Fantasma Noturno', avatarColor: 0, avatarUrl: null, about: '', customStatus: 'farmando', status: 'online' },
    users: users,
    selection: { mode: 'server', serverId: 'srv', channelId: 'chan-geral' },
    server: {
      id: 'srv', name: 'Os Assombrados', role: 'owner', ownerId: ME,
      channels: [{ id: 'chan-geral', kind: 'text', name: 'geral', topic: 'Papo geral do servidor.', categoryId: null, position: 0 }],
      members: [
        { id: ME, username: 'fantasma', displayName: 'Fantasma Noturno', avatarColor: 0, avatarUrl: null, role: 'owner', nickname: null },
        { id: LUA, username: 'lua.cheia', displayName: 'Lua Cheia', avatarColor: 1, avatarUrl: null, role: 'admin', nickname: 'Lua 🌙' },
        { id: RATO, username: 'rato_de_mid', displayName: 'Rato de Mid', avatarColor: 3, avatarUrl: null, role: 'member', nickname: null },
        { id: BIA, username: 'bia', displayName: 'Bia Suporte', avatarColor: 5, avatarUrl: null, role: 'member', nickname: null }
      ]
    },
    dms: [{ id: 'dm-lua', user: users[LUA], lastMessageAt: tt(3), unread: 0, mentions: 0, muted: false }],
    messages: { target: 'c:chan-geral', status: 'ready', error: null, hasMore: false, firstUnreadId: 7, typing: [], items: msgs }
  };

  if (s === 'dm') {
    view.selection = { mode: 'dm', dmId: 'dm-lua' };
    view.messages = { target: 'd:dm-lua', status: 'ready', error: null, hasMore: false, firstUnreadId: null, typing: [LUA],
      items: [
        { id: 201, authorId: LUA, body: 'oi! bora duo?', createdAt: tt(10) },
        { id: 202, authorId: ME, body: 'bora, só terminar essa', createdAt: tt(8) },
        { id: 203, authorId: LUA, body: 'blz, tô na fila 🎮', createdAt: tt(3) }
      ].map(function (m) { return Object.assign({ reactions: [], attachments: [], pinned: false, mentionsMe: false, mentions: [], editedAt: null, replyTo: null }, m); }) };
  }
  if (s === 'empty') { view.messages.items = []; view.messages.firstUnreadId = null; }
  if (s === 'loading') { view.messages = { target: 'c:chan-geral', status: 'loading', error: null, hasMore: false, firstUnreadId: null, typing: [], items: [] }; }
  if (s === 'error') { view.messages = { target: 'c:chan-geral', status: 'error', error: 'Sem conexão com o servidor. Verifique sua internet.', hasMore: false, firstUnreadId: null, typing: [], items: [] }; }
  if (s === 'typing') view.messages.typing = [LUA, RATO];
  if (s === 'older') view.messages.hasMore = true;
  if (s === 'pending') {
    msgs.push({ id: 'tmp-1', authorId: ME, body: 'mensagem saindo…', createdAt: tt(0), pending: true, reactions: [], attachments: [], replyTo: null });
    msgs.push({ id: 'tmp-2', authorId: ME, body: 'essa falhou', createdAt: tt(0), failed: true, reactions: [], attachments: [], replyTo: null });
  }
  if (s === 'compact') document.documentElement.dataset.compact = 'true';
  if (s === 'light') document.documentElement.dataset.theme = 'light';
  if (params.get('font')) document.documentElement.style.setProperty('--font-scale', params.get('font'));

  function emit() { window.GhostChat.update(view); }
  function ok(extra) { return Promise.resolve(Object.assign({ ok: true, view: view }, extra || {})); }
  function find(id) { return view.messages.items.filter(function (m) { return String(m.id) === String(id); })[0]; }

  var bridge = {
    sendMessage: function (p) {
      var body = typeof p === 'string' ? p : p.body;
      var m = { id: nextId++, authorId: ME, body: body, createdAt: new Date().toISOString(), editedAt: null, reactions: [], pinned: false, mentionsMe: false, mentions: [],
        replyTo: null, attachments: [] };
      if (p.replyTo != null) { var r = find(p.replyTo); m.replyTo = r ? { id: r.id, authorId: r.authorId, body: r.body.slice(0, 120) } : { id: p.replyTo, missing: true }; }
      if (p.attachments) m.attachments = p.attachments.map(function (a) { return { url: svgImage(400, 240, '#24335c', '#4c2430', a.name), name: a.name, size: a.data.byteLength, mime: a.mime, isImage: /^image\//.test(a.mime), width: 400, height: 240 }; });
      view.messages.items.push(m);
      emit();
      return ok();
    },
    editMessage: function (p) { var m = find(p.id); if (m) { m.body = p.body; m.editedAt = new Date().toISOString(); } emit(); return ok(); },
    deleteMessage: function (id) { view.messages.items = view.messages.items.filter(function (m) { return String(m.id) !== String(id); }); emit(); return ok(); },
    toggleReaction: function (p) {
      var m = find(p.id); if (!m) return ok();
      var r = m.reactions.filter(function (x) { return x.emoji === p.emoji; })[0];
      if (!r) m.reactions.push({ emoji: p.emoji, count: 1, me: true });
      else if (r.me) { r.count--; r.me = false; if (!r.count) m.reactions = m.reactions.filter(function (x) { return x !== r; }); }
      else { r.count++; r.me = true; }
      emit(); return ok();
    },
    pinMessage: function (p) { var m = find(p.id); if (m) m.pinned = p.pinned; emit(); return ok(); },
    listPinned: function () { return Promise.resolve({ ok: true, items: view.messages.items.filter(function (m) { return m.pinned; }) }); },
    searchMessages: function (q) {
      var low = q.toLowerCase();
      return Promise.resolve({ ok: true, items: view.messages.items.filter(function (m) { return (m.body || '').toLowerCase().indexOf(low) !== -1; }).slice().reverse() });
    },
    loadOlder: function () {
      return new Promise(function (res) {
        setTimeout(function () {
          var first = view.messages.items[0];
          var older = [];
          for (var i = 0; i < 6; i++) older.push({ id: -nextId++, authorId: [LUA, RATO, BIA][i % 3], body: 'Mensagem antiga ' + (i + 1), createdAt: new Date(new Date(first.createdAt).getTime() - (6 - i) * 600000).toISOString(), reactions: [], attachments: [], replyTo: null });
          view.messages.items = older.concat(view.messages.items);
          view.messages.hasMore = false;
          emit();
          res({ ok: true, view: view });
        }, 400);
      });
    },
    markRead: function () { window.__marked = (window.__marked || 0) + 1; return ok(); },
    setTyping: function () { return ok(); },
    openExternal: function (url) { window.__opened = url; return ok(); },
    select: function () { return ok(); }
  };

  window.GhostChat.init({
    bridge: bridge,
    root: document.getElementById('hc-chat'),
    getView: function () { return view; },
    openProfile: function (id) { window.__profile = id; }
  });

  document.getElementById('hc-pin').addEventListener('click', function (ev) { window.GhostChat.togglePinned(ev.currentTarget); });
  document.getElementById('hc-search').addEventListener('click', function () { window.GhostChat.openSearch(); });

  // Cenários que precisam de interação simulada
  setTimeout(function () {
    var q = function (sel) { return document.querySelector(sel); };
    if (s === 'picker') {
      var msg = document.querySelector('.gc-msg[data-id="8"]');
      msg.focus();
      msg.querySelector('.gc-actions .gc-icon-btn').click();
    } else if (s === 'pinned') {
      window.GhostChat.togglePinned(q('#hc-pin'));
    } else if (s === 'search') {
      window.GhostChat.openSearch('invoker');
    } else if (s === 'edit') {
      window.GhostChat.focusComposer();
      q('.gc-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    } else if (s === 'reply') {
      var m3 = document.querySelector('.gc-msg[data-id="11"]');
      m3.querySelectorAll('.gc-actions .gc-icon-btn')[1].click();
      var inp = q('.gc-input');
      inp.value = 'Olha esse @lu';
      inp.setSelectionRange(inp.value.length, inp.value.length);
      inp.dispatchEvent(new Event('input'));
    } else if (s === 'lightbox') {
      q('.gc-image').click();
    } else if (s === 'menu') {
      var m4 = document.querySelector('.gc-msg[data-id="8"]');
      var r = m4.getBoundingClientRect();
      m4.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 300, clientY: r.top + 10 }));
    } else if (s === 'emojiac') {
      var inp2 = q('.gc-input');
      inp2.value = 'gg :fog';
      inp2.focus();
      inp2.setSelectionRange(inp2.value.length, inp2.value.length);
      inp2.dispatchEvent(new Event('input'));
    }
  }, 150);
})();
