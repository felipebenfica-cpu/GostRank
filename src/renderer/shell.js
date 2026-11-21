/* Ghost Rank - casca no modelo de uso do Discord: trilho de servidores, barras laterais (Home e servidor),
   página de amigos, DMs, cabeçalho, lista de membros, cartão de perfil, menus de contexto, menu de status,
   busca rápida (Ctrl+K), atalhos e diálogos de servidor/convite/canal.
   Mostra sempre o que vem em `view` (window.ghostRank). Só guarda estado efêmero de interface.
   Monta GhostChat (chat.js), GhostSettings (settings.js) e GhostVoice (voice.js) se existirem.
   Sem innerHTML: tudo com createElement/textContent. */
(function () {
  'use strict';

  var U = window.GhostUI;
  var el = U.el;
  var icon = U.icon;
  function $(id) { return document.getElementById(id); }

  var opts = null;
  var bridge = null;
  var view = null;
  var app = $('app');

  var ui = {
    friendsTab: 'online',
    friendsFilter: '',
    addQuery: '',
    addResults: [],
    addSeq: 0,
    serverPage: null,          // 'ranking' (página local dentro do servidor)
    serverPageFor: null,
    collapsed: loadCollapsed(),
    sidebarOpen: false,
    membersOpen: false,        // sobreposta (< 1100px)
    membersHidden: false,      // escondida pelo usuário (>= 1100px)
    legacySel: null,
    voiceState: null,
    lastMentionTotal: null,
    pendingDmCall: null
  };

  var mods = { chat: false, settings: false, voice: false };
  var mqWide = window.matchMedia ? window.matchMedia('(min-width: 1100px)') : null;
  var mqNarrow = window.matchMedia ? window.matchMedia('(max-width: 699.98px)') : null;
  function isWide() { return mqWide ? mqWide.matches : true; }
  function isNarrow() { return mqNarrow ? mqNarrow.matches : false; }

  function loadCollapsed() {
    try {
      var raw = window.localStorage ? window.localStorage.getItem('gr.collapsed') : null;
      var obj = raw ? JSON.parse(raw) : {};
      return obj && typeof obj === 'object' ? obj : {};
    } catch (e) { return {}; }
  }
  function saveCollapsed() {
    try { if (window.localStorage) window.localStorage.setItem('gr.collapsed', JSON.stringify(ui.collapsed)); } catch (e) { /* opcional */ }
  }

  /* ---------- dados da view ---------- */

  function signedIn() { var a = view && view.auth; return !!(a && a.status === 'signed_in'); }
  function me() { return (view && view.me) || null; }
  function myId() { var m = me(); return m ? m.id : null; }
  function sel() { return (view && view.selection) || { mode: 'home', tab: 'mmr' }; }
  function list(x) { return Array.isArray(x) ? x : []; }

  function userById(id) {
    if (!id || !view) return null;
    var u = view.users && view.users[id];
    if (u) return u;
    var m = me();
    if (m && m.id === id) return m;
    var f = list(view.friends).filter(function (x) { return x.id === id; })[0];
    if (f) return f;
    var mem = view.server ? list(view.server.members).filter(function (x) { return x.id === id; })[0] : null;
    if (mem) return mem;
    var d = list(view.dms).filter(function (x) { return x.user && x.user.id === id; })[0];
    return d ? d.user : null;
  }

  function memberOf(id) {
    if (!view || !view.server) return null;
    return list(view.server.members).filter(function (x) { return x.id === id; })[0] || null;
  }

  function relationOf(id) {
    var f = list(view && view.friends).filter(function (x) { return x.id === id; })[0];
    return f ? f.relation : 'none';
  }

  function presenceOf(id) {
    var m = me();
    if (m && id === m.id) return m.status === 'invisible' ? 'offline' : (m.status || 'online');
    var p = view && view.presence && view.presence[id];
    return U.STATUS_TEXT[p] ? p : 'offline';
  }

  function displayName(id, inServer) {
    var u = userById(id);
    var mem = inServer ? memberOf(id) : null;
    return U.nameOf(u, mem && mem.nickname);
  }

  function myRole() { return view && view.server ? view.server.role : null; }
  function isAdmin() { var r = myRole(); return r === 'owner' || r === 'admin'; }
  function isOwner() { return myRole() === 'owner'; }
  function isMuted(target) { return list(view && view.prefs && view.prefs.muted).indexOf(target) >= 0; }

  function channelById(id) {
    if (!view || !view.server) return null;
    return list(view.server.channels).filter(function (c) { return c.id === id; })[0] || null;
  }
  function dmById(id) { return list(view && view.dms).filter(function (d) { return d.id === id; })[0] || null; }
  function serverById(id) { return list(view && view.servers).filter(function (s) { return s.id === id; })[0] || null; }

  function sortedChannels() {
    if (!view || !view.server) return [];
    return list(view.server.channels).slice().sort(function (a, b) { return (a.position || 0) - (b.position || 0); });
  }
  function sortedCategories() {
    if (!view || !view.server) return [];
    return list(view.server.categories).slice().sort(function (a, b) { return (a.position || 0) - (b.position || 0); });
  }
  // Ordem exibida: sem categoria primeiro, depois cada categoria
  function displayOrder() {
    var chs = sortedChannels();
    var out = chs.filter(function (c) { return !c.categoryId; });
    sortedCategories().forEach(function (cat) {
      out = out.concat(chs.filter(function (c) { return c.categoryId === cat.id; }));
    });
    return out;
  }

  function voiceIn(key) { return list(view && view.voiceStates && view.voiceStates[key]); }
  function speakingSet() {
    var s = ui.voiceState && Array.isArray(ui.voiceState.speaking) ? ui.voiceState.speaking : [];
    var o = {};
    s.forEach(function (id) { o[id] = true; });
    return o;
  }

  /* ---------- compatibilidade com a view antiga (um grupo só) ---------- */

  function normalize(v) {
    if (!v || typeof v !== 'object' || (Array.isArray(v.servers) && !v.legacy)) return v;
    var g = v.group;
    var a = v.auth || {};
    var signed = a.status === 'signed_in';
    v.legacy = true;
    v.friends = list(v.friends);
    v.dms = list(v.dms);
    v.presence = v.presence || {};
    v.voiceStates = v.voiceStates || {};
    var mine = g ? list(g.members).filter(function (m) { return m.isMe; })[0] : null;
    v.me = v.me || (signed ? {
      id: mine ? mine.userId : 'eu', username: '', displayName: a.displayName || a.email || 'Você',
      avatarColor: null, avatarUrl: null, about: '', customStatus: null, status: 'online'
    } : null);
    v.users = v.users || {};
    v.servers = g ? [{ id: g.id, name: g.name, iconColor: U.toneFor(g.id), iconUrl: null, role: g.isOwner ? 'owner' : 'member', unread: false, mentions: 0, muted: false }] : [];
    var s = ui.legacySel || (g && signed ? { mode: 'server', serverId: g.id, channelId: 'legado-texto' } : { mode: 'home', tab: signed ? 'friends' : 'mmr' });
    if (s.mode === 'server' && !g) s = { mode: 'home', tab: 'mmr' };
    v.selection = s;
    if (g) {
      var owner = list(g.members).filter(function (m) { return m.isOwner; })[0];
      v.server = {
        id: g.id, name: g.name, iconColor: U.toneFor(g.id), iconUrl: null, role: g.isOwner ? 'owner' : 'member', ownerId: owner ? owner.userId : null,
        categories: [{ id: 'legado-cat-texto', name: 'Canais de texto', position: 0 }, { id: 'legado-cat-voz', name: 'Canais de voz', position: 1 }],
        channels: [
          { id: 'legado-texto', kind: 'text', name: 'chat', topic: null, categoryId: 'legado-cat-texto', position: 0, unread: false, mentions: 0, muted: false },
          { id: 'legado-voz', kind: 'voice', name: 'Sala de voz', topic: null, categoryId: 'legado-cat-voz', position: 1, unread: false, mentions: 0, muted: false }
        ],
        members: list(g.members).map(function (m) {
          var u = { id: m.userId, username: '', displayName: m.displayName, avatarColor: null, avatarUrl: null, role: m.isOwner ? 'owner' : 'member', nickname: null, mmr: m.mmr || null, customStatus: null };
          v.users[m.userId] = u;
          v.presence[m.userId] = v.presence[m.userId] || 'online';
          return u;
        })
      };
    } else {
      v.server = null;
    }
    var chat = v.chat || {};
    v.messages = s.mode === 'server' && s.channelId === 'legado-texto' ? {
      target: 'c:legado-texto', status: chat.status === 'error' ? 'error' : 'ready', error: null, hasMore: false, firstUnreadId: null, typing: [],
      items: list(chat.messages).map(function (m) {
        return { id: m.id, authorId: m.userId, body: m.body, createdAt: m.createdAt, editedAt: null, replyTo: null, attachments: [], reactions: [], pinned: false, mentionsMe: false, mentions: [] };
      })
    } : null;
    return v;
  }

  /* ---------- chamadas à ponte ---------- */

  function hasApi(name) { return !!(bridge && typeof bridge[name] === 'function'); }

  // Ação que devolve view nova. Resolve com o texto do erro ou null.
  function act(name, arg, quiet) {
    if (!hasApi(name)) {
      var msg = 'Isso ainda não está disponível nesta versão do Ghost Rank.';
      if (!quiet) U.toast(msg, 'error');
      return Promise.resolve(msg);
    }
    return opts.call(function () { return arg === undefined ? bridge[name]() : bridge[name](arg); }).then(function (res) {
      var err = opts.applyResult(res);
      if (err && !quiet) U.toast(err, 'error');
      return err;
    });
  }

  // Consulta que devolve dados (sem view). Resolve com o resultado bruto.
  function ask(name, arg) {
    if (!hasApi(name)) return Promise.resolve({ ok: false, error: 'Isso ainda não está disponível nesta versão do Ghost Rank.' });
    return opts.call(function () { return bridge[name](arg); }).then(function (res) {
      if (res && res.ok && res.view) opts.applyResult({ ok: true, view: res.view });
      return res || { ok: false, error: 'Algo deu errado. Tente de novo.' };
    });
  }

  function select(s) {
    if (s.mode !== 'server' || s.channelId) ui.serverPage = null;
    if (isNarrow()) setSidebarOpen(false, false);
    if (view && view.legacy || !hasApi('select')) {
      ui.legacySel = s;
      opts.rerender();
      return Promise.resolve(null);
    }
    return act('select', s);
  }

  function openDm(userId) {
    if (view && view.legacy) { U.toast('Mensagens diretas chegam com a atualização do servidor.', 'error'); return Promise.resolve('x'); }
    return act('openDm', userId).then(function (err) {
      if (!err) focusComposerSoon();
      return err;
    });
  }

  function focusComposerSoon() {
    setTimeout(function () {
      if (mods.chat && typeof window.GhostChat.focusComposer === 'function') {
        try { window.GhostChat.focusComposer(); } catch (e) { /* ignora */ }
      }
    }, 60);
  }

  /* ---------- página atual ---------- */

  function currentPage() {
    var s = sel();
    if (!signedIn()) return 'mmr';
    if (s.mode === 'dm') return dmById(s.dmId) ? 'dm' : 'friends';
    if (s.mode === 'server') {
      if (!view.server) return 'empty';
      if (ui.serverPage === 'ranking' && ui.serverPageFor === view.server.id) return 'ranking';
      var ch = channelById(s.channelId);
      if (!ch) return 'empty';
      return ch.kind === 'voice' ? 'voice' : 'chat';
    }
    return s.tab === 'mmr' ? 'mmr' : 'friends';
  }

  function dmCallActive(dmId) {
    var st = ui.voiceState;
    return !!(st && st.dmId === dmId && st.status && st.status !== 'idle');
  }

  /* ---------- aparência ---------- */

  function applyAppearance() {
    var ap = (view && view.prefs && view.prefs.appearance) || {};
    var theme = { dark: 1, midnight: 1, light: 1 }[ap.theme] ? ap.theme : 'dark';
    var root = document.documentElement;
    if (root.dataset.theme !== theme) root.dataset.theme = theme;
    var scale = typeof ap.fontScale === 'number' && ap.fontScale >= 80 && ap.fontScale <= 130 ? ap.fontScale : 100;
    root.style.setProperty('--font-scale', String(scale));
    root.dataset.compact = ap.compact ? 'true' : 'false';
  }

  /* ---------- foco preservado ao refazer listas ---------- */

  function rebuild(container, fn) {
    var active = document.activeElement;
    var key = active && container.contains(active) ? active.getAttribute('data-key') : null;
    container.textContent = '';
    fn(container);
    if (key) {
      var again = container.querySelector('[data-key="' + cssEscape(key) + '"]');
      if (again) { try { again.focus({ preventScroll: true }); } catch (e) { again.focus(); } }
    }
  }
  function cssEscape(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  function badgeText(n) { return n > 99 ? '99+' : String(n); }

  /* ---------- 1. trilho ---------- */

  var railHome = $('rail-home');
  var railHomeItem = $('rail-home-item');
  var railHomeBadge = $('rail-home-badge');
  var railDms = $('rail-dms');
  var railServers = $('rail-servers');
  var railAdd = $('rail-add');

  function setRailCurrent(item, btn, on) {
    item.classList.toggle('is-current', on);
    if (on) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }

  function serverIcon(s, size) {
    var span = el('span', 'server-icon' + (size ? ' server-icon-' + size : ''));
    span.dataset.tone = String(typeof s.iconColor === 'number' ? s.iconColor : U.toneFor(s.id));
    var url = U.safeImageUrl(s.iconUrl);
    if (url) {
      var img = document.createElement('img');
      img.alt = '';
      img.className = 'avatar-img';
      img.src = url;
      span.appendChild(img);
    } else {
      span.appendChild(el('span', 'rail-initials', U.initials(s.name)));
    }
    return span;
  }

  function renderRail() {
    var s = sel();
    var homeOn = s.mode !== 'server';
    setRailCurrent(railHomeItem, railHome, homeOn);
    var pending = list(view.friends).filter(function (f) { return f.relation === 'pending_in'; }).length;
    railHomeBadge.hidden = !(signedIn() && pending > 0);
    railHomeBadge.textContent = badgeText(pending);
    railHome.setAttribute('aria-label', 'Mensagens diretas e amigos' + (pending > 0 && signedIn() ? ', ' + pending + (pending === 1 ? ' pedido de amizade' : ' pedidos de amizade') : ''));

    rebuild(railDms, function (ul) {
      if (!signedIn()) return;
      list(view.dms).filter(function (d) { return d.unread > 0 && !(s.mode === 'dm' && s.dmId === d.id); }).slice(0, 5).forEach(function (d) {
        var li = el('li', 'rail-item is-unread');
        li.appendChild(pill());
        var b = el('button', 'rail-btn rail-dm');
        b.type = 'button';
        b.dataset.key = 'dm-' + d.id;
        var name = U.nameOf(d.user);
        b.dataset.tip = name;
        b.setAttribute('aria-label', name + ', ' + d.unread + (d.unread === 1 ? ' mensagem não lida' : ' mensagens não lidas'));
        b.appendChild(U.avatarEl(d.user, 'rail'));
        var badge = el('span', 'rail-badge', badgeText(d.mentions || d.unread));
        badge.setAttribute('aria-hidden', 'true');
        b.appendChild(badge);
        b.addEventListener('click', function () { select({ mode: 'dm', dmId: d.id }); });
        U.bindContextMenu(b, function () { return dmMenu(d); });
        li.appendChild(b);
        ul.appendChild(li);
      });
    });
    railDms.hidden = !railDms.firstChild;

    rebuild(railServers, function (ul) {
      if (!signedIn()) return;
      list(view.servers).forEach(function (srv) {
        var current = s.mode === 'server' && s.serverId === srv.id;
        var li = el('li', 'rail-item');
        if (current) li.classList.add('is-current');
        if (srv.unread && !srv.muted && !current) li.classList.add('is-unread');
        if (srv.muted) li.classList.add('is-muted');
        li.appendChild(pill());
        var b = el('button', 'rail-btn rail-server');
        b.type = 'button';
        b.dataset.key = 'srv-' + srv.id;
        b.dataset.tip = srv.name;
        var label = srv.name;
        if (srv.mentions > 0) label += ', ' + srv.mentions + (srv.mentions === 1 ? ' menção' : ' menções');
        else if (srv.unread && !srv.muted) label += ', mensagens não lidas';
        if (srv.muted) label += ', silenciado';
        b.setAttribute('aria-label', label);
        if (current) b.setAttribute('aria-current', 'page');
        b.appendChild(serverIcon(srv));
        if (srv.mentions > 0) {
          var badge = el('span', 'rail-badge', badgeText(srv.mentions));
          badge.setAttribute('aria-hidden', 'true');
          b.appendChild(badge);
        }
        b.addEventListener('click', function () { select({ mode: 'server', serverId: srv.id }); });
        U.bindContextMenu(b, function () { return serverMenuItems(srv); });
        li.appendChild(b);
        ul.appendChild(li);
      });
    });
    railAdd.setAttribute('aria-label', signedIn() ? 'Adicionar um servidor' : 'Entrar para criar ou entrar em servidores');
  }

  function pill() {
    var p = el('span', 'rail-pill');
    p.setAttribute('aria-hidden', 'true');
    return p;
  }

  railHome.addEventListener('click', function () {
    if (!signedIn()) { select({ mode: 'home', tab: 'mmr' }); return; }
    var s = sel();
    if (s.mode === 'server' || !s.mode) select({ mode: 'home', tab: ui.lastHomeTab || 'friends' });
  });
  railAdd.addEventListener('click', function () {
    if (!signedIn()) { opts.openSignin(); return; }
    openServerDialog('create');
  });

  /* ---------- 2. barra lateral ---------- */

  var homeNav = $('home-nav');
  var serverNav = $('server-nav');
  var homeFind = $('home-find');
  var serverHead = $('server-head');
  var serverMenuBtn = $('server-menu-btn');
  var navFriends = $('nav-friends');
  var navMmr = $('nav-mmr');
  var navRanking = $('nav-ranking');
  var dmList = $('dm-list');
  var channelTree = $('channel-tree');

  function setCurrent(btn, on) {
    if (on) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }

  function renderSidebar(page) {
    var s = sel();
    var inServer = signedIn() && s.mode === 'server' && !!view.server;
    homeNav.hidden = inServer;
    serverNav.hidden = !inServer;
    homeFind.hidden = inServer;
    serverHead.hidden = !inServer;
    if (inServer) renderServerNav(page);
    else renderHomeNav(page);
  }

  function renderHomeNav(page) {
    var signed = signedIn();
    setCurrent(navFriends, page === 'friends');
    setCurrent(navMmr, page === 'mmr');
    var pending = list(view.friends).filter(function (f) { return f.relation === 'pending_in'; }).length;
    var nb = $('nav-friends-badge');
    nb.hidden = !(signed && pending > 0);
    nb.textContent = badgeText(pending);
    $('dm-section').hidden = !signed;
    $('sidebar-cta').hidden = signed;
    homeFind.disabled = !signed;
    var s = sel();
    rebuild(dmList, function (ul) {
      list(view.dms).forEach(function (d) {
        var li = el('li', 'dm-li');
        var b = el('button', 'channel dm-item');
        b.type = 'button';
        b.dataset.key = 'dm-' + d.id;
        var current = s.mode === 'dm' && s.dmId === d.id;
        setCurrent(b, current);
        if (d.unread > 0 && !current && !d.muted) b.classList.add('is-unread');
        if (d.muted) b.classList.add('is-muted');
        b.appendChild(U.avatarEl(d.user, 'sm', { status: presenceOf(d.user.id) }));
        var text = el('span', 'dm-text');
        text.appendChild(el('span', 'channel-name', U.nameOf(d.user)));
        var u = userById(d.user.id) || d.user;
        if (u.customStatus) text.appendChild(el('span', 'dm-sub', u.customStatus));
        b.appendChild(text);
        var extra = ', ' + U.STATUS_TEXT[presenceOf(d.user.id)];
        if (d.mentions > 0 || d.unread > 0) {
          var n = d.mentions || d.unread;
          var badge = el('span', 'count-badge', badgeText(n));
          badge.setAttribute('aria-hidden', 'true');
          b.appendChild(badge);
          extra += ', ' + n + (n === 1 ? ' mensagem não lida' : ' mensagens não lidas');
        }
        if (d.muted) extra += ', silenciada';
        b.appendChild(el('span', 'visually-hidden', extra));
        if (voiceIn('dm:' + d.id).length) b.appendChild(icon('speaker', 16, 'channel-icon dm-call-icon'));
        b.addEventListener('click', function () { select({ mode: 'dm', dmId: d.id }); });
        U.bindContextMenu(b, function () { return dmMenu(d); });
        li.appendChild(b);
        ul.appendChild(li);
      });
    });
    $('dm-empty').hidden = !(signed && list(view.dms).length === 0);
  }

  navFriends.addEventListener('click', function () {
    if (!signedIn()) { opts.openSignin(); return; }
    ui.lastHomeTab = 'friends';
    select({ mode: 'home', tab: 'friends' });
  });
  navMmr.addEventListener('click', function () {
    ui.lastHomeTab = 'mmr';
    select({ mode: 'home', tab: 'mmr' });
  });
  homeFind.addEventListener('click', function () { openQuick(homeFind); });
  $('dm-new').addEventListener('click', function () {
    ui.friendsTab = 'all';
    select({ mode: 'home', tab: 'friends' }).then(function () {
      var f = $('friends-filter-input');
      if (f && !f.closest('[hidden]')) f.focus();
    });
  });
  $('sidebar-signin').addEventListener('click', function () { opts.openSignin(); });

  function renderServerNav(page) {
    var srv = view.server;
    $('server-name').textContent = srv.name;
    serverMenuBtn.setAttribute('aria-label', 'Menu do servidor ' + srv.name);
    setCurrent(navRanking, page === 'ranking');
    var s = sel();
    var speaking = speakingSet();
    var chs = sortedChannels();
    rebuild(channelTree, function (root) {
      var loose = chs.filter(function (c) { return !c.categoryId || !list(srv.categories).some(function (k) { return k.id === c.categoryId; }); });
      if (loose.length) root.appendChild(channelList(loose, s, speaking, false));
      sortedCategories().forEach(function (cat) {
        var section = el('section', 'cat');
        var collapsed = !!ui.collapsed[cat.id];
        var head = el('div', 'cat-head');
        var toggle = el('button', 'cat-toggle');
        toggle.type = 'button';
        toggle.dataset.key = 'cat-' + cat.id;
        toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        toggle.appendChild(icon('chevronDown', 12, 'btn-icon cat-chevron'));
        toggle.appendChild(el('span', 'cat-name', cat.name));
        toggle.addEventListener('click', function () {
          ui.collapsed[cat.id] = !ui.collapsed[cat.id];
          saveCollapsed();
          renderServerNav(currentPage());
        });
        U.bindContextMenu(toggle, function () { return categoryMenu(cat); });
        head.appendChild(toggle);
        if (isAdmin()) {
          var add = el('button', 'mini-btn');
          add.type = 'button';
          add.dataset.key = 'cat-add-' + cat.id;
          add.dataset.tip = 'Criar canal';
          add.setAttribute('aria-label', 'Criar canal em ' + cat.name);
          add.appendChild(icon('plus', 16));
          add.addEventListener('click', function () { openChannelDialog({ mode: 'create', categoryId: cat.id }); });
          head.appendChild(add);
        }
        section.appendChild(head);
        var mine = chs.filter(function (c) { return c.categoryId === cat.id; });
        if (collapsed) {
          mine = mine.filter(function (c) { return c.id === s.channelId || (c.kind === 'voice' && voiceIn(c.id).length) || (c.mentions > 0); });
        }
        if (mine.length) section.appendChild(channelList(mine, s, speaking, collapsed));
        root.appendChild(section);
      });
      if (!chs.length) root.appendChild(el('p', 'sidebar-note', 'Este servidor ainda não tem canais.'));
    });
  }

  function channelList(chs, s, speaking) {
    var ul = el('ul', 'channel-list');
    ul.setAttribute('role', 'list');
    chs.forEach(function (c) {
      var li = el('li', 'ch-li');
      var row = el('div', 'ch-row');
      var b = el('button', 'channel' + (c.kind === 'voice' ? ' channel-voice' : ''));
      b.type = 'button';
      b.dataset.key = 'ch-' + c.id;
      b.dataset.channelId = c.id;
      var current = s.channelId === c.id && currentPage() !== 'ranking';
      setCurrent(b, current);
      if (c.unread && !current && !c.muted) b.classList.add('is-unread');
      if (c.muted) b.classList.add('is-muted');
      var vs = ui.voiceState;
      var connectedHere = c.kind === 'voice' && vs && vs.channelId === c.id && vs.status === 'connected';
      var connectingHere = c.kind === 'voice' && vs && vs.channelId === c.id && vs.status === 'connecting';
      if (connectedHere) b.classList.add('is-connected');
      if (connectingHere) b.classList.add('is-connecting');
      b.appendChild(icon(c.kind === 'voice' ? 'speaker' : 'hash', 20, 'channel-icon'));
      b.appendChild(el('span', 'channel-name', c.name));
      var extra = c.kind === 'voice' ? ', canal de voz' : ', canal de texto';
      var people = c.kind === 'voice' ? voiceIn(c.id) : [];
      if (people.length) extra += ', ' + people.length + (people.length === 1 ? ' pessoa' : ' pessoas');
      if (connectedHere) extra += ', você está conectado';
      if (c.mentions > 0) {
        var badge = el('span', 'count-badge', badgeText(c.mentions));
        badge.setAttribute('aria-hidden', 'true');
        b.appendChild(badge);
        extra += ', ' + c.mentions + (c.mentions === 1 ? ' menção' : ' menções');
      } else if (c.unread && !c.muted) {
        extra += ', não lido';
      }
      if (c.muted) extra += ', silenciado';
      b.appendChild(el('span', 'visually-hidden', extra));
      b.addEventListener('click', function () { openChannel(c); });
      U.bindContextMenu(b, function () { return channelMenu(c); });
      row.appendChild(b);
      if (isAdmin()) {
        var gear = el('button', 'mini-btn ch-gear');
        gear.type = 'button';
        gear.dataset.key = 'ch-edit-' + c.id;
        gear.dataset.tip = 'Editar canal';
        gear.setAttribute('aria-label', 'Editar canal ' + c.name);
        gear.appendChild(icon('gear', 15));
        gear.addEventListener('click', function () { openChannelDialog({ mode: 'edit', channel: c }); });
        row.appendChild(gear);
      }
      li.appendChild(row);
      if (people.length) li.appendChild(voiceMembers(people, speaking));
      ul.appendChild(li);
    });
    return ul;
  }

  function voiceMembers(people, speaking) {
    var ul = el('ul', 'vc-members');
    ul.setAttribute('role', 'list');
    people.forEach(function (p) {
      var li = el('li');
      var b = el('button', 'vc-member');
      b.type = 'button';
      b.dataset.key = 'vcm-' + p.userId;
      var u = userById(p.userId) || { id: p.userId, displayName: 'Fantasma' };
      b.appendChild(U.avatarEl(u, 'xs', { speaking: !!speaking[p.userId] }));
      var name = displayName(p.userId, true);
      b.appendChild(el('span', 'vc-name', name));
      var flags = el('span', 'vc-flags');
      var desc = name;
      if (p.streaming) { flags.appendChild(el('span', 'live-tag', 'AO VIVO')); desc += ', transmitindo a tela'; }
      if (p.video) { flags.appendChild(icon('video', 15, 'btn-icon vc-flag')); desc += ', câmera ligada'; }
      if (p.deafened) { flags.appendChild(icon('deafened', 15, 'btn-icon vc-flag is-off')); desc += ', ensurdecido'; }
      else if (p.muted) { flags.appendChild(icon('micOff', 15, 'btn-icon vc-flag is-off')); desc += ', microfone desligado'; }
      if (speaking[p.userId]) desc += ', falando';
      b.appendChild(flags);
      b.setAttribute('aria-label', desc);
      b.addEventListener('click', function () { openProfile(p.userId, b); });
      U.bindContextMenu(b, function () { return userMenu(p.userId); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    return ul;
  }

  function openChannel(c) {
    if (c.kind === 'voice') {
      var vs = ui.voiceState;
      var already = vs && vs.channelId === c.id && vs.status && vs.status !== 'idle';
      select({ mode: 'server', serverId: view.server.id, channelId: c.id }).then(function () {
        if (!already) joinVoice({ channelId: c.id });
      });
      return;
    }
    select({ mode: 'server', serverId: view.server.id, channelId: c.id }).then(focusComposerSoon);
  }

  navRanking.addEventListener('click', function () {
    if (!view || !view.server) return;
    ui.serverPage = 'ranking';
    ui.serverPageFor = view.server.id;
    if (isNarrow()) setSidebarOpen(false, false);
    opts.rerender();
    focusTitle();
  });

  serverMenuBtn.addEventListener('click', function () {
    if (!view || !view.server) return;
    var r = serverMenuBtn.getBoundingClientRect();
    serverMenuBtn.setAttribute('aria-expanded', 'true');
    var menu = U.openContextMenu(serverMenuItems(serverById(view.server.id) || view.server, true), r.left + 8, r.bottom + 6, serverMenuBtn, { label: 'Menu do servidor' });
    if (menu) {
      menu.classList.add('ctx-wide');
      menu.style.width = Math.max(200, Math.round(r.width - 16)) + 'px';
      var obs = setInterval(function () {
        if (!document.contains(menu)) { serverMenuBtn.setAttribute('aria-expanded', 'false'); clearInterval(obs); }
      }, 150);
    } else {
      serverMenuBtn.setAttribute('aria-expanded', 'false');
    }
  });

  // Setas para cima/baixo andam entre os itens da barra lateral
  $('sidebar').addEventListener('keydown', function (ev) {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    var t = ev.target;
    if (!t || !t.closest || !t.closest('.sidebar-scroll')) return;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
    var items = Array.prototype.filter.call($('sidebar').querySelectorAll('.sidebar-scroll button'), function (b) {
      return !b.closest('[hidden]') && !b.disabled && b.offsetParent !== null && !b.classList.contains('mini-btn');
    });
    var i = items.indexOf(t);
    if (i < 0) return;
    ev.preventDefault();
    var next = items[ev.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)];
    if (next) next.focus();
  });

  /* ---------- painel do usuário ---------- */

  var userChip = $('user-chip');
  var btnAccount = $('btn-account');
  var btnSignin = $('btn-signin');

  function renderUserPanel() {
    var a = (view && view.auth) || {};
    var status = a.status;
    var signed = status === 'signed_in';
    btnSignin.hidden = status !== 'signed_out';
    // a engrenagem da voz (voice.js) já abre as configurações: sem ela, mostramos a nossa
    btnAccount.hidden = !signed || (mods.voice && !!$('voice-user-controls').querySelector('button'));
    var slot = $('user-avatar-slot');
    slot.textContent = '';
    var m = me();
    var nameText;
    var sub;
    if (signed && m) {
      var st = m.status || 'online';
      slot.appendChild(U.avatarEl(m, 'sm', { status: st === 'invisible' ? 'offline' : st }));
      nameText = U.nameOf(m);
      sub = m.customStatus || U.STATUS_TEXT[st] || 'Online';
      userChip.setAttribute('aria-label', 'Seu status: ' + (U.STATUS_TEXT[st] || 'Online') + '. ' + nameText + (m.username ? ' (@' + m.username + ')' : '') + '. Abrir menu de status');
      userChip.disabled = false;
    } else {
      var ghost = el('span', 'avatar avatar-sm user-ghost');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.appendChild(U.ghostSvg(20));
      slot.appendChild(ghost);
      if (status === 'unconfigured') { nameText = 'Ghost Rank'; sub = 'Contas ainda não configuradas'; }
      else if (status === 'signed_out') { nameText = 'Sem conta'; sub = 'Modo local'; }
      else { nameText = 'Ghost Rank'; sub = ''; }
      userChip.setAttribute('aria-label', nameText + (sub ? ', ' + sub : ''));
      userChip.disabled = status !== 'signed_out';
    }
    $('account-name').textContent = nameText;
    $('account-name').title = nameText;
    $('user-status').textContent = sub;
  }

  userChip.addEventListener('click', function () {
    if (!signedIn()) { opts.openSignin(); return; }
    var r = userChip.getBoundingClientRect();
    var menu = U.openContextMenu(statusMenuItems(), r.left, r.top - 8, userChip, { label: 'Status' });
    if (menu) {
      var mr = menu.getBoundingClientRect();
      menu.style.top = Math.max(8, Math.round(r.top - mr.height - 8)) + 'px';
    }
  });

  btnAccount.addEventListener('click', function () { openUserSettings(); });

  function statusMenuItems() {
    var m = me() || {};
    var st = m.status || 'online';
    var items = [
      { label: 'Online', dot: 'online', checked: st === 'online', action: function () { act('setStatus', 'online'); } },
      { label: 'Ausente', dot: 'idle', checked: st === 'idle', action: function () { act('setStatus', 'idle'); } },
      { label: 'Não perturbe', dot: 'dnd', hint: 'Você não vai receber notificações na área de trabalho', checked: st === 'dnd', action: function () { act('setStatus', 'dnd'); } },
      { label: 'Invisível', dot: 'offline', hint: 'Você aparece offline, mas continua usando tudo', checked: st === 'invisible', action: function () { act('setStatus', 'invisible'); } },
      { separator: true },
      { label: m.customStatus ? 'Editar status personalizado' : 'Definir status personalizado', icon: 'edit', action: editCustomStatus }
    ];
    if (m.customStatus) items.push({ label: 'Limpar status personalizado', icon: 'x', action: function () { act('setCustomStatus', null); } });
    items.push({ separator: true });
    items.push({ label: 'Editar perfil', icon: 'gear', action: function () { openUserSettings('profile'); } });
    if (m.username) items.push({ label: 'Copiar nome de usuário', icon: 'copy', action: function () { copy('@' + m.username, 'Nome de usuário copiado.'); } });
    return items;
  }

  function editCustomStatus() {
    var m = me() || {};
    U.prompt({
      title: 'Status personalizado',
      label: 'O que você está fazendo?',
      value: m.customStatus || '',
      maxLength: 128,
      required: false,
      placeholder: 'Subindo de MMR, me chama!',
      help: 'Aparece embaixo do seu nome para amigos e no servidor. Deixe vazio para limpar.',
      submit: function (v) { return act('setCustomStatus', v || null, true); }
    });
  }

  function copy(text, okMsg) {
    U.copyText(text).then(function (ok) { U.toast(ok ? okMsg : 'Não deu para copiar. Selecione e copie manualmente.', ok ? null : 'error'); });
  }

  function openUserSettings(tab) {
    if (mods.settings && typeof window.GhostSettings.openUser === 'function') {
      try { window.GhostSettings.openUser(tab); return; } catch (e) { /* cai para o diálogo antigo */ }
    }
    opts.openAccountFallback();
  }

  function openServerSettings(serverId, tab) {
    if (mods.settings && typeof window.GhostSettings.openServer === 'function') {
      try { window.GhostSettings.openServer(serverId, tab); return; } catch (e) { /* ignora */ }
    }
    U.toast('As configurações do servidor ainda não carregaram nesta versão.', 'error');
  }

  /* ---------- 3. cabeçalho ---------- */

  var headIcon = $('head-icon');
  var title = $('channel-title');
  var topic = $('channel-topic');
  var friendsTabs = $('friends-tabs');
  var btnCall = $('btn-call');
  var btnVideo = $('btn-video');
  var btnPins = $('btn-pins');
  var btnMembers = $('btn-members');
  var headSearch = $('head-search');

  var PAGE_ICON = { friends: 'friends', mmr: 'on_track', ranking: 'trophy', chat: 'hash', dm: 'at', voice: 'speaker', empty: 'ghost' };

  function renderHeader(page) {
    var s = sel();
    headIcon.textContent = '';
    var ic = PAGE_ICON[page] || 'hash';
    if (page === 'dm') {
      var d = dmById(s.dmId);
      headIcon.appendChild(U.avatarEl(d.user, 'xs', { status: presenceOf(d.user.id) }));
    } else if (ic === 'ghost') {
      headIcon.appendChild(U.ghostSvg(22, 'head-ghost'));
    } else {
      headIcon.appendChild(icon(ic, 22, 'channel-icon'));
    }
    var t = '';
    var tp = '';
    var ch = channelById(s.channelId);
    if (page === 'friends') t = 'Amigos';
    else if (page === 'mmr') t = 'Meu MMR';
    else if (page === 'ranking') t = 'Ranking dos fantasmas';
    else if (page === 'chat' || page === 'voice') { t = ch ? ch.name : ''; tp = ch && ch.topic ? ch.topic : ''; }
    else if (page === 'dm') {
      var dm = dmById(s.dmId);
      var u = userById(dm.user.id) || dm.user;
      t = U.nameOf(u);
      tp = u.customStatus || '';
    } else if (page === 'empty') {
      t = view.server ? view.server.name : 'Ghost Rank';
    }
    title.textContent = t;
    topic.textContent = tp;
    topic.hidden = !tp;
    topic.title = tp;
    friendsTabs.hidden = page !== 'friends';
    if (page === 'friends') renderFriendTabs();
    var chatLike = page === 'chat' || page === 'dm';
    btnCall.hidden = page !== 'dm';
    btnVideo.hidden = page !== 'dm';
    btnPins.hidden = !chatLike;
    headSearch.hidden = !chatLike;
    var mAvail = membersAvailable(page);
    btnMembers.hidden = !mAvail || page === 'friends';
    if (page === 'dm') {
      btnMembers.setAttribute('aria-label', 'Perfil do usuário');
      btnMembers.dataset.tip = membersVisible(page) ? 'Esconder perfil do usuário' : 'Mostrar perfil do usuário';
    } else {
      btnMembers.setAttribute('aria-label', 'Lista de membros');
      btnMembers.dataset.tip = membersVisible(page) ? 'Esconder lista de membros' : 'Mostrar lista de membros';
    }
    btnMembers.setAttribute('aria-pressed', membersVisible(page) ? 'true' : 'false');
    var inCall = page === 'dm' && dmCallActive(s.dmId);
    btnCall.disabled = inCall;
    btnVideo.disabled = inCall;
    document.title = t ? t + ' · Ghost Rank' : 'Ghost Rank';
  }

  function renderFriendTabs() {
    var pending = list(view.friends).filter(function (f) { return f.relation === 'pending_in'; }).length;
    var pb = $('ftab-pending-badge');
    pb.hidden = pending === 0;
    pb.textContent = badgeText(pending);
    Array.prototype.forEach.call(friendsTabs.querySelectorAll('.ftab'), function (b) {
      var on = b.dataset.tab === ui.friendsTab;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
  }

  friendsTabs.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('.ftab');
    if (!b) return;
    setFriendsTab(b.dataset.tab, true);
  });
  friendsTabs.addEventListener('keydown', function (ev) {
    var tabs = Array.prototype.slice.call(friendsTabs.querySelectorAll('.ftab'));
    var i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    var n = null;
    if (ev.key === 'ArrowRight') n = (i + 1) % tabs.length;
    else if (ev.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
    else if (ev.key === 'Home') n = 0;
    else if (ev.key === 'End') n = tabs.length - 1;
    if (n === null) return;
    ev.preventDefault();
    setFriendsTab(tabs[n].dataset.tab, false);
    tabs[n].focus();
  });

  function setFriendsTab(tab, focusContent) {
    ui.friendsTab = tab;
    renderFriendTabs();
    renderFriends();
    if (focusContent && tab === 'add') $('add-friend-input').focus();
  }

  btnCall.addEventListener('click', function () { var s = sel(); if (s.mode === 'dm') joinVoice({ dmId: s.dmId }); });
  btnVideo.addEventListener('click', function () {
    var s = sel();
    if (s.mode !== 'dm') return;
    joinVoice({ dmId: s.dmId }, true);
  });
  btnPins.addEventListener('click', function () {
    if (mods.chat && typeof window.GhostChat.togglePinned === 'function') {
      try { window.GhostChat.togglePinned(btnPins); } catch (e) { /* ignora */ }
    } else {
      U.toast('As mensagens fixadas chegam com o chat novo.', 'error');
    }
  });
  headSearch.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var q = $('head-search-input').value.trim();
    if (mods.chat && typeof window.GhostChat.openSearch === 'function') {
      try { window.GhostChat.openSearch(q); } catch (e) { /* ignora */ }
    } else {
      U.toast('A busca chega com o chat novo.', 'error');
    }
  });
  $('btn-keys').addEventListener('click', function () { openDialog($('dlg-keys')); });

  function focusTitle() { try { title.focus({ preventScroll: true }); } catch (e) { title.focus(); } }

  /* ---------- 4. área principal ---------- */

  var sections = {
    mmr: $('view-mmr'),
    friends: $('view-friends'),
    chat: $('view-chat'),
    voice: $('view-voice'),
    ranking: $('view-ranking'),
    empty: $('view-empty')
  };

  var dmBanner = null;
  function ensureDmBanner() {
    if (dmBanner) return dmBanner;
    dmBanner = el('div', 'dm-call-banner');
    dmBanner.hidden = true;
    sections.chat.insertBefore(dmBanner, sections.chat.firstChild);
    return dmBanner;
  }

  function renderMain(page) {
    var s = sel();
    var dmCall = page === 'dm' && dmCallActive(s.dmId);
    sections.mmr.hidden = page !== 'mmr';
    sections.friends.hidden = page !== 'friends';
    sections.chat.hidden = !(page === 'chat' || page === 'dm');
    sections.voice.hidden = !(page === 'voice' || dmCall);
    sections.ranking.hidden = page !== 'ranking';
    sections.empty.hidden = page !== 'empty';
    app.dataset.dmcall = dmCall ? 'on' : 'off';
    if (page === 'friends') renderFriends();
    if (page === 'ranking') renderRanking();
    if (page === 'empty') renderEmpty();
    renderDmBanner(page, dmCall);
    renderChatModule(page);
    var voiceOk = mods.voice;
    $('voice-fallback').hidden = voiceOk;
    $('voice-stage').hidden = !voiceOk;
  }

  function renderDmBanner(page, dmCall) {
    var b = ensureDmBanner();
    var s = sel();
    var others = page === 'dm' ? voiceIn('dm:' + s.dmId).filter(function (p) { return p.userId !== myId(); }) : [];
    var show = page === 'dm' && !dmCall && others.length > 0;
    b.hidden = !show;
    if (!show) return;
    b.textContent = '';
    b.appendChild(icon('phone', 18));
    b.appendChild(el('span', null, displayName(others[0].userId) + ' está em uma chamada com você.'));
    var join = el('button', 'btn btn-small btn-primary', 'Entrar na chamada');
    join.type = 'button';
    join.addEventListener('click', function () { joinVoice({ dmId: s.dmId }); });
    b.appendChild(join);
  }

  function renderEmpty() {
    var t = $('empty-title');
    var x = $('empty-text');
    if (view.server) {
      t.textContent = 'Escolha um canal';
      x.textContent = 'Os canais de texto e de voz deste servidor ficam na barra lateral.';
    } else {
      t.textContent = 'Nenhum servidor aberto';
      x.textContent = 'Crie um servidor ou entre em um com um convite pelo botão + no trilho à esquerda.';
    }
  }

  /* chat (chat.js) ou versão mínima embutida */
  function renderChatModule(page) {
    var chatPage = page === 'chat' || page === 'dm';
    $('chat-root').hidden = !mods.chat;
    $('chat-fallback').hidden = mods.chat || !chatPage;
    if (!chatPage) return;
    if (mods.chat) {
      try { window.GhostChat.update(view); } catch (e) { /* o chat não derruba a casca */ }
    } else {
      renderFallbackChat();
    }
  }

  function renderFallbackChat() {
    var ol = $('fallback-list');
    ol.textContent = '';
    var msgs = view.messages && Array.isArray(view.messages.items) ? view.messages.items : [];
    msgs.forEach(function (m) {
      var li = el('li', 'fallback-msg');
      li.appendChild(el('strong', null, displayName(m.authorId, sel().mode === 'server') + ': '));
      li.appendChild(document.createTextNode(m.body || (m.attachments && m.attachments.length ? '[anexo]' : '')));
      ol.appendChild(li);
    });
    ol.scrollTop = ol.scrollHeight;
    var ch = channelById(sel().channelId);
    var dm = dmById(sel().dmId);
    $('fallback-input').placeholder = ch ? 'Conversar em #' + ch.name : (dm ? 'Conversar com @' + U.nameOf(dm.user) : 'Mensagem');
  }

  $('fallback-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var input = $('fallback-input');
    var body = input.value.trim();
    if (!body) return;
    act('sendMessage', { body: body }).then(function (err) { if (!err) input.value = ''; });
  });
  $('fallback-input').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      $('fallback-form').requestSubmit ? $('fallback-form').requestSubmit() : $('fallback-form').dispatchEvent(new Event('submit'));
    }
  });

  /* ---------- página de amigos ---------- */

  var friendsListEl = $('friends-list');
  var friendsAdd = $('friends-add');
  var friendsWrap = $('friends-list-wrap');
  var friendsFilter = $('friends-filter-input');

  var TAB_TITLES = { online: 'Online', all: 'Todos os amigos', pending: 'Pendentes', blocked: 'Bloqueados' };
  var TAB_EMPTY = {
    online: 'Nenhum amigo online agora. O fantasminha está de olho — chame alguém para jogar!',
    all: 'O fantasminha está esperando amigos. Use “Adicionar amigo” para encontrar pessoas pelo nome de usuário.',
    pending: 'Não há pedidos de amizade pendentes. Aqui está um fantasma para te fazer companhia.',
    blocked: 'Você não bloqueou ninguém.'
  };

  function renderFriends() {
    var tab = ui.friendsTab;
    friendsAdd.hidden = tab !== 'add';
    friendsWrap.hidden = tab === 'add';
    if (tab === 'add') { renderAddResults(); return; }
    var q = ui.friendsFilter.toLowerCase();
    var rows = list(view.friends).filter(function (f) {
      if (tab === 'online') return f.relation === 'friend' && presenceOf(f.id) !== 'offline';
      if (tab === 'all') return f.relation === 'friend';
      if (tab === 'pending') return f.relation === 'pending_in' || f.relation === 'pending_out';
      return f.relation === 'blocked';
    }).filter(function (f) {
      if (!q) return true;
      return String(f.displayName || '').toLowerCase().indexOf(q) >= 0 || String(f.username || '').toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) {
      if (tab === 'pending' && a.relation !== b.relation) return a.relation === 'pending_in' ? -1 : 1;
      return U.nameOf(a).localeCompare(U.nameOf(b), 'pt-BR');
    });
    $('friends-count').textContent = TAB_TITLES[tab] + ' — ' + rows.length;
    rebuild(friendsListEl, function (ul) {
      rows.forEach(function (f) { ul.appendChild(personRow(f, f.relation)); });
    });
    $('friends-empty').hidden = rows.length > 0;
    $('friends-empty-text').textContent = q ? 'Ninguém com esse nome nesta lista.' : TAB_EMPTY[tab];
  }

  friendsFilter.addEventListener('input', function () {
    ui.friendsFilter = friendsFilter.value.trim();
    renderFriends();
  });

  function roundBtn(iconName, label, cls, fn, key) {
    var b = el('button', 'round-btn' + (cls ? ' ' + cls : ''));
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.dataset.tip = label;
    if (key) b.dataset.key = key;
    b.appendChild(icon(iconName, 18));
    b.addEventListener('click', function (ev) { ev.stopPropagation(); fn(b); });
    return b;
  }

  function personRow(p, relation, fromSearch) {
    var u = userById(p.id) || p;
    var li = el('li', 'person');
    var main = el('button', 'person-main');
    main.type = 'button';
    main.dataset.key = (fromSearch ? 'sr-' : 'pr-') + p.id;
    var status = presenceOf(p.id);
    main.appendChild(U.avatarEl(u, 'md', { status: relation === 'friend' ? status : null }));
    var text = el('span', 'person-text');
    var top = el('span', 'person-top');
    top.appendChild(el('span', 'person-name', U.nameOf(u)));
    if (u.username) top.appendChild(el('span', 'person-user', '@' + u.username));
    text.appendChild(top);
    var sub;
    if (relation === 'pending_in') sub = 'Pedido de amizade recebido';
    else if (relation === 'pending_out') sub = 'Pedido de amizade enviado';
    else if (relation === 'blocked') sub = 'Bloqueado';
    else if (relation === 'friend') sub = u.customStatus || U.STATUS_TEXT[status];
    else sub = u.customStatus || '';
    if (sub) text.appendChild(el('span', 'person-sub', sub));
    main.appendChild(text);
    main.addEventListener('click', function () {
      if (relation === 'friend') openDm(p.id);
      else openProfile(p.id, main);
    });
    U.bindContextMenu(main, function () { return userMenu(p.id); });
    li.appendChild(main);
    var actions = el('span', 'person-actions');
    var name = U.nameOf(u);
    if (relation === 'friend') {
      actions.appendChild(roundBtn('chat', 'Mensagem para ' + name, null, function () { openDm(p.id); }, 'pa-msg-' + p.id));
      actions.appendChild(roundBtn('more', 'Mais opções para ' + name, null, function (b) {
        var pt = U.anchorPoint(b, 'below');
        U.openContextMenu(userMenu(p.id), pt.x, pt.y, b);
      }, 'pa-more-' + p.id));
    } else if (relation === 'pending_in') {
      actions.appendChild(roundBtn('check', 'Aceitar pedido de ' + name, 'is-ok', function () { friendAction('acceptFriend', p.id, 'Agora vocês são amigos!'); }, 'pa-ok-' + p.id));
      actions.appendChild(roundBtn('x', 'Recusar pedido de ' + name, 'is-no', function () { friendAction('declineFriend', p.id, 'Pedido recusado.'); }, 'pa-no-' + p.id));
    } else if (relation === 'pending_out') {
      actions.appendChild(roundBtn('x', 'Cancelar pedido para ' + name, 'is-no', function () { friendAction('declineFriend', p.id, 'Pedido cancelado.'); }, 'pa-no-' + p.id));
    } else if (relation === 'blocked') {
      actions.appendChild(roundBtn('x', 'Desbloquear ' + name, 'is-no', function () { friendAction('unblockUser', p.id, name + ' foi desbloqueado.'); }, 'pa-unb-' + p.id));
    } else {
      var addB = el('button', 'btn btn-small btn-primary', 'Adicionar');
      addB.type = 'button';
      addB.dataset.key = 'pa-add-' + p.id;
      addB.setAttribute('aria-label', 'Enviar pedido de amizade para ' + name);
      addB.addEventListener('click', function () { sendRequest(u.username || name); });
      actions.appendChild(addB);
    }
    li.appendChild(actions);
    return li;
  }

  function friendAction(name, id, okMsg) {
    return act(name, id).then(function (err) {
      if (!err && okMsg) U.toast(okMsg);
      if (ui.friendsTab === 'add') renderAddResults();
      return err;
    });
  }

  /* adicionar amigo: busca ao vivo (300 ms) */
  var addInput = $('add-friend-input');
  var addSubmit = $('add-friend-submit');
  var addStatus = $('add-friend-status');
  var addResultsEl = $('add-friend-results');
  var addTimer = null;

  function setAddStatus(text, kind) {
    addStatus.textContent = text || '';
    addStatus.dataset.kind = kind || '';
  }

  addInput.addEventListener('input', function () {
    var q = addInput.value.trim().replace(/^@/, '');
    addSubmit.disabled = !q;
    setAddStatus('', '');
    addInput.removeAttribute('aria-invalid');
    ui.addQuery = q;
    if (addTimer) clearTimeout(addTimer);
    if (q.length < 2) { ui.addResults = []; renderAddResults(); return; }
    addTimer = setTimeout(function () { runSearch(q); }, 300);
  });

  function runSearch(q) {
    var seq = ++ui.addSeq;
    ask('searchUsers', q).then(function (res) {
      if (seq !== ui.addSeq) return; // resposta velha
      if (!res.ok) { ui.addResults = []; setAddStatus(res.error, 'error'); renderAddResults(); return; }
      ui.addResults = list(res.users);
      renderAddResults();
      if (!ui.addResults.length) setAddStatus('Ninguém encontrado com “' + q + '”. Confira o nome de usuário.', 'info');
      else setAddStatus(ui.addResults.length + (ui.addResults.length === 1 ? ' pessoa encontrada.' : ' pessoas encontradas.'), 'info');
    });
  }

  function renderAddResults() {
    rebuild(addResultsEl, function (ul) {
      ui.addResults.forEach(function (r) {
        var rel = relationOf(r.id);
        ul.appendChild(personRow(r, rel !== 'none' ? rel : (r.relation || 'none'), true));
      });
    });
  }

  $('form-add-friend').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var q = addInput.value.trim().replace(/^@/, '');
    if (!q) return;
    sendRequest(q);
  });

  function sendRequest(username) {
    addSubmit.disabled = true;
    if (!hasApi('sendFriendRequest')) { setAddStatus('Pedidos de amizade chegam com a atualização do servidor.', 'error'); addSubmit.disabled = false; return; }
    opts.call(function () { return bridge.sendFriendRequest(username); }).then(function (res) {
      addSubmit.disabled = !addInput.value.trim();
      var err = opts.applyResult(res);
      if (err) {
        setAddStatus(err, 'error');
        addInput.setAttribute('aria-invalid', 'true');
        return;
      }
      addInput.removeAttribute('aria-invalid');
      var clean = String(username).replace(/^@/, '');
      if (res.result === 'accepted') setAddStatus('Vocês agora são amigos! ' + clean + ' já tinha te mandado um pedido.', 'ok');
      else setAddStatus('Pronto! Seu pedido de amizade para ' + clean + ' foi enviado.', 'ok');
      renderAddResults();
    });
  }

  /* ---------- ranking (por servidor) ---------- */

  function renderRanking() {
    var ol = $('ranking-list');
    ol.textContent = '';
    if (!view.server) return;
    var mid = myId();
    var members = list(view.server.members).slice().sort(function (a, b) {
      var am = U.hasMmr(a.mmr);
      var bm = U.hasMmr(b.mmr);
      if (am !== bm) return am ? -1 : 1;
      if (am && b.mmr.progress !== a.mmr.progress) return b.mmr.progress - a.mmr.progress;
      if (am && b.mmr.current !== a.mmr.current) return b.mmr.current - a.mmr.current;
      return U.nameOf(a, a.nickname).localeCompare(U.nameOf(b, b.nickname), 'pt-BR');
    });
    members.forEach(function (m, idx) {
      var li = el('li', 'rank-item');
      if (m.id === mid) li.classList.add('is-me');
      li.appendChild(el('span', 'rank-pos', (idx + 1) + 'º'));
      li.appendChild(U.avatarEl(userById(m.id) || m, 'md'));
      var body = el('div', 'rank-body');
      var head = el('div', 'rank-head');
      var nameB = el('button', 'link-btn rank-name', U.nameOf(userById(m.id) || m, m.nickname));
      nameB.type = 'button';
      nameB.addEventListener('click', function () { openProfile(m.id, nameB); });
      head.appendChild(nameB);
      if (m.id === mid) head.appendChild(el('span', 'tag tag-me', 'você'));
      if (m.role === 'owner') head.appendChild(el('span', 'tag tag-owner', 'dono'));
      else if (m.role === 'admin') head.appendChild(el('span', 'tag', 'admin'));
      body.appendChild(head);
      U.mmrBlock(m.mmr, body);
      li.appendChild(body);
      ol.appendChild(li);
    });
  }

  /* ---------- lista de membros / perfil na DM / ativo agora ---------- */

  var membersEl = $('members');
  var membersBody = $('members-body');
  var scrim = $('scrim');

  function membersAvailable(page) {
    if (!signedIn()) return false;
    if (page === 'chat' || page === 'voice' || page === 'ranking') return !!view.server;
    if (page === 'dm') return true;
    if (page === 'friends') return isWide();
    return false;
  }
  function membersVisible(page) {
    if (!membersAvailable(page)) return false;
    if (page === 'friends') return true;
    return isWide() ? !ui.membersHidden : ui.membersOpen;
  }

  function renderMembers(page) {
    var visible = membersVisible(page);
    membersEl.hidden = !visible;
    app.dataset.members = visible ? (isWide() ? 'docked' : 'overlay') : 'hidden';
    if (!visible) return;
    if (page === 'dm') { membersEl.setAttribute('aria-label', 'Perfil do usuário'); renderDmProfile(); }
    else if (page === 'friends') { membersEl.setAttribute('aria-label', 'Ativo agora'); renderActiveNow(); }
    else { membersEl.setAttribute('aria-label', 'Membros do servidor'); renderServerMembers(); }
  }

  function renderServerMembers() {
    var speaking = speakingSet();
    var all = list(view.server.members);
    var online = all.filter(function (m) { return presenceOf(m.id) !== 'offline'; });
    var offline = all.filter(function (m) { return presenceOf(m.id) === 'offline'; });
    var groups = [
      { title: 'Dono', items: online.filter(function (m) { return m.role === 'owner'; }) },
      { title: 'Admins', items: online.filter(function (m) { return m.role === 'admin'; }) },
      { title: 'Online', items: online.filter(function (m) { return m.role !== 'owner' && m.role !== 'admin'; }) },
      { title: 'Offline', items: offline, offline: true }
    ];
    rebuild(membersBody, function (root) {
      groups.forEach(function (g, gi) {
        if (!g.items.length) return;
        var sec = el('section', 'members-section');
        var id = 'mg-' + gi;
        var h = el('h2', 'members-title', g.title + ' — ' + g.items.length);
        h.id = id;
        sec.setAttribute('aria-labelledby', id);
        sec.appendChild(h);
        var ul = el('ul', 'member-list');
        ul.setAttribute('role', 'list');
        g.items.slice().sort(function (a, b) { return U.nameOf(a, a.nickname).localeCompare(U.nameOf(b, b.nickname), 'pt-BR'); }).forEach(function (m) {
          ul.appendChild(memberRow(m, speaking, g.offline));
        });
        sec.appendChild(ul);
        root.appendChild(sec);
      });
    });
  }

  function memberRow(m, speaking, offline) {
    var li = el('li');
    var b = el('button', 'member' + (offline ? ' is-offline' : '') + (m.role ? ' role-' + m.role : ''));
    b.type = 'button';
    b.dataset.key = 'mem-' + m.id;
    var u = userById(m.id) || m;
    var status = presenceOf(m.id);
    b.appendChild(U.avatarEl(u, 'sm', { status: status, speaking: !!speaking[m.id] }));
    var text = el('span', 'member-text');
    var top = el('span', 'member-top');
    var name = U.nameOf(u, m.nickname);
    top.appendChild(el('span', 'member-name', name));
    if (m.role === 'owner') top.appendChild(icon('crown', 14, 'member-crown'));
    else if (m.role === 'admin') top.appendChild(icon('shield', 14, 'member-shield'));
    text.appendChild(top);
    var sub = u.customStatus || m.customStatus;
    if (!sub && U.hasMmr(m.mmr)) sub = U.num(m.mmr.current) + ' MMR';
    if (sub) text.appendChild(el('span', 'member-sub', sub));
    b.appendChild(text);
    var label = name + ', ' + U.STATUS_TEXT[status] + (m.role === 'owner' ? ', dono do servidor' : m.role === 'admin' ? ', admin' : '') + (sub ? ', ' + sub : '') + (m.id === myId() ? ', você' : '');
    b.setAttribute('aria-label', label);
    b.addEventListener('click', function () { openProfile(m.id, b); });
    U.bindContextMenu(b, function () { return userMenu(m.id); });
    li.appendChild(b);
    return li;
  }

  function renderDmProfile() {
    var d = dmById(sel().dmId);
    if (!d) return;
    var u = userById(d.user.id) || d.user;
    rebuild(membersBody, function (root) {
      root.appendChild(profileCard(u, null, true));
    });
  }

  function renderActiveNow() {
    var online = list(view.friends).filter(function (f) { return f.relation === 'friend' && presenceOf(f.id) !== 'offline'; });
    rebuild(membersBody, function (root) {
      root.appendChild(el('h2', 'active-title', 'Ativo agora'));
      if (!online.length) {
        var e = el('div', 'active-empty');
        e.appendChild(el('p', 'active-empty-title', 'Por enquanto está tudo quieto…'));
        e.appendChild(el('p', 'caption', 'Quando um amigo ficar online ou entrar numa sala de voz, ele aparece aqui.'));
        root.appendChild(e);
        return;
      }
      var ul = el('ul', 'member-list');
      ul.setAttribute('role', 'list');
      online.forEach(function (f) {
        var li = el('li');
        var b = el('button', 'active-card');
        b.type = 'button';
        b.dataset.key = 'act-' + f.id;
        b.appendChild(U.avatarEl(userById(f.id) || f, 'sm', { status: presenceOf(f.id) }));
        var t = el('span', 'member-text');
        t.appendChild(el('span', 'member-name', U.nameOf(f)));
        t.appendChild(el('span', 'member-sub', f.customStatus || U.STATUS_TEXT[presenceOf(f.id)]));
        b.appendChild(t);
        b.addEventListener('click', function () { openProfile(f.id, b); });
        U.bindContextMenu(b, function () { return userMenu(f.id); });
        li.appendChild(b);
        ul.appendChild(li);
      });
      root.appendChild(ul);
    });
  }

  btnMembers.addEventListener('click', function () {
    if (isWide()) ui.membersHidden = !ui.membersHidden;
    else ui.membersOpen = !ui.membersOpen;
    opts.rerender();
  });

  /* gavetas (telas estreitas) */
  var btnSidebar = $('btn-sidebar');
  function setSidebarOpen(open, focus) {
    ui.sidebarOpen = open;
    app.dataset.sidebar = open ? 'open' : 'closed';
    btnSidebar.setAttribute('aria-expanded', open ? 'true' : 'false');
    renderScrim();
    if (focus) {
      if (open) {
        var first = $('sidebar').querySelector('.sidebar-scroll button:not([hidden])');
        if (first) first.focus();
      } else {
        btnSidebar.focus();
      }
    }
  }
  function renderScrim() {
    scrim.hidden = !((ui.sidebarOpen && isNarrow()) || (ui.membersOpen && !isWide() && !membersEl.hidden));
  }
  btnSidebar.addEventListener('click', function () { setSidebarOpen(!ui.sidebarOpen, true); });
  scrim.addEventListener('click', function () {
    if (ui.sidebarOpen) setSidebarOpen(false, false);
    if (ui.membersOpen) { ui.membersOpen = false; opts.rerender(); }
    renderScrim();
  });
  function onLayoutChange() {
    if (!isNarrow() && ui.sidebarOpen) setSidebarOpen(false, false);
    if (view) opts.rerender();
  }
  [mqWide, mqNarrow].forEach(function (mq) {
    if (!mq) return;
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onLayoutChange);
    else if (typeof mq.addListener === 'function') mq.addListener(onLayoutChange);
  });

  /* ---------- cartão de perfil ---------- */

  var profilePop = null; // { node, userId, anchor }

  function profileCard(u, member, panel) {
    var card = el('div', panel ? 'pcard pcard-panel' : 'pcard');
    var banner = el('div', 'pcard-banner');
    banner.dataset.tone = String(U.toneOf(u));
    card.appendChild(banner);
    var head = el('div', 'pcard-head');
    head.appendChild(U.avatarEl(u, 'lg', { status: presenceOf(u.id) }));
    card.appendChild(head);
    var body = el('div', 'pcard-body');
    var names = el('div', 'pcard-names');
    var h = el('h2', 'pcard-name', U.nameOf(u, member && member.nickname));
    h.id = 'pcard-name-' + (panel ? 'panel' : 'pop');
    names.appendChild(h);
    var line = [];
    if (u.username) line.push('@' + u.username);
    if (member && member.nickname && u.displayName) line.push(u.displayName);
    if (line.length) names.appendChild(el('p', 'pcard-user', line.join(' · ')));
    var st = presenceOf(u.id);
    var stLine = el('p', 'pcard-status');
    stLine.appendChild(U.statusDot(st));
    stLine.appendChild(document.createTextNode(U.STATUS_TEXT[st] + (u.customStatus ? ' — ' + u.customStatus : '')));
    names.appendChild(stLine);
    body.appendChild(names);
    var box = el('div', 'pcard-box');
    if (u.about) {
      box.appendChild(el('h3', 'pcard-section', 'Sobre mim'));
      box.appendChild(el('p', 'pcard-about', u.about));
    }
    if (member) {
      box.appendChild(el('h3', 'pcard-section', 'MMR'));
      var mm = el('div', 'pcard-mmr');
      U.mmrBlock(member.mmr, mm);
      box.appendChild(mm);
      box.appendChild(el('h3', 'pcard-section', 'Cargo'));
      var roles = el('p', 'pcard-roles');
      var tag = el('span', 'tag role-tag role-' + (member.role || 'member'), U.ROLE_TEXT[member.role] || 'Membro');
      roles.appendChild(tag);
      box.appendChild(roles);
    }
    if (box.firstChild) body.appendChild(box);
    var actions = el('div', 'pcard-actions');
    var mid = myId();
    if (u.id === mid) {
      var edit = el('button', 'btn btn-small btn-primary', 'Editar perfil');
      edit.type = 'button';
      edit.addEventListener('click', function () { closeProfile(false); openUserSettings('profile'); });
      actions.appendChild(edit);
    } else if (signedIn()) {
      var rel = relationOf(u.id);
      if (rel !== 'blocked' && !panel) {
        var msg = el('button', 'btn btn-small btn-primary', 'Mensagem');
        msg.type = 'button';
        msg.addEventListener('click', function () { closeProfile(false); openDm(u.id); });
        actions.appendChild(msg);
      }
      if (rel === 'none' && u.username) {
        var add = el('button', 'btn btn-small', 'Adicionar amigo');
        add.type = 'button';
        add.addEventListener('click', function () { sendRequestQuiet(u.username); });
        actions.appendChild(add);
      } else if (rel === 'pending_out') {
        var pend = el('button', 'btn btn-small', 'Pedido enviado');
        pend.type = 'button';
        pend.disabled = true;
        actions.appendChild(pend);
      } else if (rel === 'pending_in') {
        var acc = el('button', 'btn btn-small', 'Aceitar pedido');
        acc.type = 'button';
        acc.addEventListener('click', function () { friendAction('acceptFriend', u.id, 'Agora vocês são amigos!'); });
        actions.appendChild(acc);
      }
      var more = el('button', 'icon-btn', null);
      more.type = 'button';
      more.setAttribute('aria-label', 'Mais opções');
      more.appendChild(icon('more', 18));
      more.addEventListener('click', function () {
        var p = U.anchorPoint(more, 'below');
        U.openContextMenu(userMenu(u.id), p.x, p.y, more);
      });
      actions.appendChild(more);
    }
    if (actions.firstChild) body.appendChild(actions);
    card.appendChild(body);
    return card;
  }

  function sendRequestQuiet(username) {
    if (!hasApi('sendFriendRequest')) { U.toast('Pedidos de amizade chegam com a atualização do servidor.', 'error'); return; }
    opts.call(function () { return bridge.sendFriendRequest(username); }).then(function (res) {
      var err = opts.applyResult(res);
      if (err) U.toast(err, 'error');
      else U.toast(res.result === 'accepted' ? 'Vocês agora são amigos!' : 'Pedido de amizade enviado.');
    });
  }

  function openProfile(userId, anchor) {
    closeProfile(false);
    var u = userById(userId);
    if (!u) return;
    var member = view.server && sel().mode === 'server' ? memberOf(userId) : null;
    var pop = el('div', 'profile-pop');
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Perfil de ' + U.nameOf(u, member && member.nickname));
    pop.tabIndex = -1;
    var card = profileCard(u, member, false);
    pop.appendChild(card);
    var close = el('button', 'icon-btn pcard-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Fechar perfil');
    close.appendChild(icon('x', 18));
    close.addEventListener('click', function () { closeProfile(true); });
    pop.appendChild(close);
    pop.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeProfile(true); }
      if (ev.key === 'Tab') {
        var f = Array.prototype.filter.call(pop.querySelectorAll('button:not(:disabled)'), function (b) { return b.offsetParent !== null; });
        if (!f.length) return;
        var i = f.indexOf(document.activeElement);
        if (ev.shiftKey && i <= 0) { ev.preventDefault(); f[f.length - 1].focus(); }
        else if (!ev.shiftKey && i === f.length - 1) { ev.preventDefault(); f[0].focus(); }
      }
    });
    $('popout-layer').appendChild(pop);
    var r = anchor ? anchor.getBoundingClientRect() : { left: window.innerWidth / 2, right: window.innerWidth / 2, top: 120 };
    var pr = pop.getBoundingClientRect();
    var left = anchor && anchor.closest && anchor.closest('.members') ? r.left - pr.width - 12 : r.right + 12;
    if (left + pr.width > window.innerWidth - 8) left = r.left - pr.width - 12;
    if (left < 8) left = 8;
    var top = Math.min(r.top, window.innerHeight - pr.height - 8);
    pop.style.left = Math.round(left) + 'px';
    pop.style.top = Math.round(Math.max(8, top)) + 'px';
    profilePop = { node: pop, userId: userId, anchor: anchor || null };
    var first = pop.querySelector('.pcard-actions button:not(:disabled)') || close;
    first.focus();
  }

  function closeProfile(restore) {
    if (!profilePop) return;
    var p = profilePop;
    profilePop = null;
    if (p.node.parentNode) p.node.parentNode.removeChild(p.node);
    if (restore && p.anchor && document.contains(p.anchor)) { try { p.anchor.focus(); } catch (e) { /* ignora */ } }
  }

  function refreshProfile() {
    if (!profilePop) return;
    var p = profilePop;
    var u = userById(p.userId);
    if (!u) { closeProfile(false); return; }
    var hadFocus = p.node.contains(document.activeElement);
    var member = view.server && sel().mode === 'server' ? memberOf(p.userId) : null;
    var old = p.node.querySelector('.pcard');
    var fresh = profileCard(u, member, false);
    p.node.replaceChild(fresh, old);
    if (hadFocus) {
      var first = p.node.querySelector('.pcard-actions button:not(:disabled)') || p.node.querySelector('.pcard-close');
      if (first) first.focus();
    }
  }

  document.addEventListener('mousedown', function (ev) {
    if (profilePop && !profilePop.node.contains(ev.target) && !(ev.target.closest && ev.target.closest('.ctx-menu'))) closeProfile(false);
  }, true);

  U.openProfile = openProfile;
  U.closeProfile = closeProfile;

  /* ---------- menus de contexto ---------- */

  function userMenu(userId) {
    var u = userById(userId) || { id: userId };
    var mid = myId();
    var isMe = userId === mid;
    var rel = relationOf(userId);
    var name = U.nameOf(u);
    var items = [{ label: 'Perfil', icon: 'friends', action: function () { openProfile(userId, document.activeElement); } }];
    if (!isMe && signedIn() && rel !== 'blocked') {
      items.push({ label: 'Mensagem', icon: 'chat', action: function () { openDm(userId); } });
      items.push({ label: 'Ligar', icon: 'phone', action: function () { callUser(userId); } });
    }
    var srv = view.server && sel().mode === 'server' ? view.server : null;
    var member = srv ? memberOf(userId) : null;
    if (isMe && srv) {
      items.push({ label: 'Mudar apelido no servidor', icon: 'edit', action: editNickname });
    }
    if (!isMe && signedIn()) {
      items.push({ separator: true });
      if (rel === 'friend') items.push({ label: 'Remover amizade', danger: true, action: function () { confirmRemoveFriend(userId, name); } });
      else if (rel === 'pending_in') {
        items.push({ label: 'Aceitar pedido de amizade', action: function () { friendAction('acceptFriend', userId, 'Agora vocês são amigos!'); } });
        items.push({ label: 'Recusar pedido', action: function () { friendAction('declineFriend', userId, 'Pedido recusado.'); } });
      } else if (rel === 'pending_out') items.push({ label: 'Cancelar pedido de amizade', action: function () { friendAction('declineFriend', userId, 'Pedido cancelado.'); } });
      else if (rel === 'none' && u.username) items.push({ label: 'Adicionar amigo', icon: 'userPlus', action: function () { sendRequestQuiet(u.username); } });
      if (rel === 'blocked') items.push({ label: 'Desbloquear', action: function () { friendAction('unblockUser', userId, name + ' foi desbloqueado.'); } });
      else items.push({ label: 'Bloquear', danger: true, action: function () { confirmBlock(userId, name); } });
    }
    if (srv && member && !isMe && isAdmin() && member.role !== 'owner' && (isOwner() || member.role === 'member')) {
      items.push({ separator: true });
      if (isOwner()) {
        if (member.role === 'admin') items.push({ label: 'Remover cargo de admin', icon: 'shield', action: function () { act('setMemberRole', { serverId: srv.id, userId: userId, role: 'member' }); } });
        else items.push({ label: 'Tornar admin', icon: 'shield', action: function () { act('setMemberRole', { serverId: srv.id, userId: userId, role: 'admin' }); } });
        items.push({ label: 'Transferir posse do servidor', icon: 'crown', action: function () { confirmTransfer(srv, userId, name); } });
      }
      items.push({ label: 'Expulsar ' + name, danger: true, action: function () { confirmKick(srv, userId, name); } });
      items.push({ label: 'Banir ' + name, danger: true, action: function () { confirmBan(srv, userId, name); } });
    }
    items.push({ separator: true });
    if (u.username) items.push({ label: 'Copiar nome de usuário', icon: 'copy', action: function () { copy('@' + u.username, 'Nome de usuário copiado.'); } });
    items.push({ label: 'Copiar ID do usuário', icon: 'copy', action: function () { copy(userId, 'ID copiado.'); } });
    return items;
  }

  function callUser(userId) {
    openDm(userId).then(function (err) {
      if (err) return;
      var s = sel();
      if (s.mode === 'dm') joinVoice({ dmId: s.dmId });
    });
  }

  function confirmRemoveFriend(id, name) {
    U.confirm({ title: 'Remover ' + name + '?', body: 'Vocês deixam de ser amigos. A conversa continua aqui se vocês dividirem um servidor.', confirmLabel: 'Remover amizade', danger: true }).then(function (ok) {
      if (ok) friendAction('removeFriend', id, 'Amizade desfeita.');
    });
  }
  function confirmBlock(id, name) {
    U.confirm({ title: 'Bloquear ' + name + '?', body: 'A pessoa não poderá te mandar mensagens diretas nem pedidos de amizade, e some da sua lista de amigos.', confirmLabel: 'Bloquear', danger: true }).then(function (ok) {
      if (ok) friendAction('blockUser', id, name + ' foi bloqueado.');
    });
  }
  function confirmKick(srv, id, name) {
    U.confirm({ title: 'Expulsar ' + name + '?', body: 'A pessoa sai de ' + srv.name + ' e do ranking. Ela pode voltar com um novo convite.', confirmLabel: 'Expulsar', danger: true }).then(function (ok) {
      if (ok) act('kickMember', { serverId: srv.id, userId: id }).then(function (err) { if (!err) U.toast(name + ' foi expulso.'); });
    });
  }
  function confirmBan(srv, id, name) {
    U.confirm({ title: 'Banir ' + name + '?', body: 'A pessoa sai de ' + srv.name + ' e não consegue voltar, nem com convite, até ser desbanida nas configurações do servidor.', confirmLabel: 'Banir', danger: true }).then(function (ok) {
      if (ok) act('banMember', { serverId: srv.id, userId: id }).then(function (err) { if (!err) U.toast(name + ' foi banido.'); });
    });
  }
  function confirmTransfer(srv, id, name) {
    U.confirm({ title: 'Transferir a posse para ' + name + '?', body: name + ' vira dono de ' + srv.name + ' e você passa a ser admin. Só o novo dono pode desfazer isso.', confirmLabel: 'Transferir posse', danger: true }).then(function (ok) {
      if (ok) act('transferOwnership', { serverId: srv.id, userId: id }).then(function (err) { if (!err) U.toast(name + ' agora é o dono do servidor.'); });
    });
  }

  function editNickname() {
    if (!view.server) return;
    var mine = memberOf(myId()) || {};
    var srv = view.server;
    U.prompt({
      title: 'Mudar apelido',
      label: 'Apelido em ' + srv.name,
      value: mine.nickname || '',
      maxLength: 32,
      required: false,
      help: 'Só vale neste servidor. Deixe vazio para usar o seu nome normal.',
      submit: function (v) { return act('setNickname', { serverId: srv.id, nickname: v || null }, true); }
    });
  }

  function serverMenuItems(srv, fromHeader) {
    if (!srv) return [];
    var selected = view.server && view.server.id === srv.id;
    var role = srv.role || (selected ? view.server.role : 'member');
    var admin = role === 'owner' || role === 'admin';
    var muted = isMuted('s:' + srv.id) || !!srv.muted;
    var items = [
      { label: 'Convidar pessoas', icon: 'userPlus', accent: true, action: function () { openInvite(srv.id); } }
    ];
    if (admin) items.push({ label: 'Configurações do servidor', icon: 'gear', action: function () { openServerSettings(srv.id); } });
    if (admin && selected) {
      items.push({ label: 'Criar canal', icon: 'plus', action: function () { openChannelDialog({ mode: 'create', categoryId: null }); } });
      items.push({ label: 'Criar categoria', icon: 'folder', action: createCategory });
    }
    if (selected) items.push({ label: 'Editar perfil no servidor', icon: 'edit', action: editNickname });
    items.push({ label: muted ? 'Ativar notificações do servidor' : 'Silenciar servidor', icon: 'bellOff', action: function () { act('muteTarget', { target: 's:' + srv.id, muted: !muted }); } });
    items.push({ separator: true });
    if (role === 'owner') items.push({ label: 'Excluir servidor', icon: 'trash', danger: true, action: function () { confirmDeleteServer(srv); } });
    items.push({ label: 'Sair do servidor', icon: 'leave', danger: true, action: function () { confirmLeave(srv, role); } });
    if (!fromHeader) {
      items.push({ separator: true });
      items.push({ label: 'Copiar ID do servidor', icon: 'copy', action: function () { copy(srv.id, 'ID copiado.'); } });
    }
    return items;
  }

  function confirmLeave(srv, role) {
    var body = role === 'owner'
      ? 'Você é o dono. Ao sair, a posse passa para o admin mais antigo (ou para o membro mais antigo). Se você for o único membro, o servidor é apagado.'
      : 'Você sai de ' + srv.name + ' e só volta com um novo convite.';
    U.confirm({ title: 'Sair de ' + srv.name + '?', body: body, confirmLabel: 'Sair do servidor', danger: true }).then(function (ok) {
      if (!ok) return;
      var p = view.legacy ? act('leaveGroup') : act('leaveServer', srv.id);
      p.then(function (err) { if (!err) U.toast('Você saiu de ' + srv.name + '.'); });
    });
  }

  function confirmDeleteServer(srv) {
    U.confirm({ title: 'Excluir ' + srv.name + '?', body: 'Todos os canais, mensagens e convites somem para sempre. Não dá para desfazer.', confirmLabel: 'Excluir servidor', danger: true }).then(function (ok) {
      if (ok) act('deleteServer', srv.id).then(function (err) { if (!err) U.toast(srv.name + ' foi excluído.'); });
    });
  }

  function createCategory() {
    if (!view.server) return;
    var srvId = view.server.id;
    U.prompt({
      title: 'Criar categoria',
      label: 'Nome da categoria',
      maxLength: 32,
      placeholder: 'Ranqueadas',
      confirmLabel: 'Criar categoria',
      validate: function (v) { return v.length < 1 ? 'Dê um nome para a categoria.' : null; },
      submit: function (v) { return act('createCategory', { serverId: srvId, name: v }, true); }
    });
  }

  function categoryMenu(cat) {
    if (!isAdmin()) return [];
    return [
      { label: 'Criar canal aqui', icon: 'plus', action: function () { openChannelDialog({ mode: 'create', categoryId: cat.id }); } },
      { label: 'Renomear categoria', icon: 'edit', action: function () {
        U.prompt({ title: 'Renomear categoria', label: 'Nome da categoria', value: cat.name, maxLength: 32,
          submit: function (v) { return act('updateCategory', { categoryId: cat.id, name: v }, true); } });
      } },
      { separator: true },
      { label: 'Apagar categoria', icon: 'trash', danger: true, action: function () {
        U.confirm({ title: 'Apagar a categoria ' + cat.name + '?', body: 'Os canais dela não são apagados: ficam sem categoria no topo da lista.', confirmLabel: 'Apagar categoria', danger: true }).then(function (ok) {
          if (ok) act('deleteCategory', cat.id);
        });
      } }
    ];
  }

  function channelMenu(c) {
    var s = sel();
    var target = 'c:' + c.id;
    var muted = isMuted(target) || !!c.muted;
    var items = [];
    if (c.kind === 'text' && s.channelId === c.id) items.push({ label: 'Marcar como lido', icon: 'check', action: function () { act('markRead', undefined, true); } });
    if (c.kind === 'voice') items.push({ label: 'Entrar no canal de voz', icon: 'speaker', action: function () { openChannel(c); } });
    items.push({ label: muted ? 'Ativar notificações do canal' : 'Silenciar canal', icon: 'bellOff', action: function () { act('muteTarget', { target: target, muted: !muted }); } });
    if (isAdmin()) {
      items.push({ separator: true });
      items.push({ label: 'Editar canal', icon: 'gear', action: function () { openChannelDialog({ mode: 'edit', channel: c }); } });
      items.push({ label: 'Apagar canal', icon: 'trash', danger: true, action: function () { confirmDeleteChannel(c); } });
    }
    items.push({ separator: true });
    items.push({ label: 'Copiar ID do canal', icon: 'copy', action: function () { copy(c.id, 'ID copiado.'); } });
    return items;
  }

  function dmMenu(d) {
    var target = 'd:' + d.id;
    var muted = isMuted(target) || !!d.muted;
    return [
      { label: 'Perfil', icon: 'friends', action: function () { openProfile(d.user.id, document.activeElement); } },
      { label: 'Ligar', icon: 'phone', action: function () { select({ mode: 'dm', dmId: d.id }).then(function () { joinVoice({ dmId: d.id }); }); } },
      { label: muted ? 'Ativar notificações da conversa' : 'Silenciar conversa', icon: 'bellOff', action: function () { act('muteTarget', { target: target, muted: !muted }); } },
      { separator: true },
      { label: 'Copiar ID do usuário', icon: 'copy', action: function () { copy(d.user.id, 'ID copiado.'); } }
    ];
  }

  function confirmDeleteChannel(c) {
    U.confirm({ title: 'Apagar #' + c.name + '?', body: c.kind === 'voice' ? 'O canal de voz some da lista. Quem estiver nele é desconectado.' : 'Todas as mensagens do canal somem para sempre. Não dá para desfazer.', confirmLabel: 'Apagar canal', danger: true }).then(function (ok) {
      if (ok) act('deleteChannel', c.id).then(function (err) { if (!err && $('dlg-channel').open) $('dlg-channel').close(); });
    });
  }

  /* ---------- diálogos ---------- */

  function openDialog(dlg) {
    if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); }
    else dlg.setAttribute('open', '');
  }

  /* criar servidor / entrar com convite */
  var dlgServer = $('dlg-server');
  var paneCreate = $('server-pane-create');
  var paneJoin = $('server-pane-join');
  var createName = $('create-server-name');
  var joinCode = $('join-server-code');
  var joinSubmit = $('join-server-submit');
  var invitePreviewBox = $('invite-preview');
  var preview = null; // { code, invite }
  var serverDlgReturn = null;

  (function buildSwatches() {
    var row = $('create-server-colors');
    var names = ['Verde-fantasma', 'Violeta', 'Azul', 'Âmbar', 'Verde', 'Rosa', 'Ciano', 'Laranja'];
    names.forEach(function (n, i) {
      var label = el('label', 'swatch');
      label.dataset.tone = String(i);
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'server-color';
      input.value = String(i);
      input.className = 'swatch-input';
      input.setAttribute('aria-label', n);
      label.appendChild(input);
      label.appendChild(el('span', 'swatch-dot'));
      row.appendChild(label);
    });
  })();

  function setPane(which) {
    paneCreate.hidden = which !== 'create';
    paneJoin.hidden = which !== 'join';
    dlgServer.setAttribute('aria-labelledby', which === 'create' ? 'server-dlg-title' : '');
    if (which === 'join') {
      dlgServer.removeAttribute('aria-labelledby');
      dlgServer.setAttribute('aria-label', 'Entrar em um servidor');
      joinCode.focus();
    } else {
      dlgServer.removeAttribute('aria-label');
      dlgServer.setAttribute('aria-labelledby', 'server-dlg-title');
      createName.focus();
      createName.select();
    }
  }

  function showError(node, text) {
    node.textContent = text || '';
    node.hidden = !text;
  }

  function openServerDialog(which, code) {
    serverDlgReturn = document.activeElement;
    var m = me();
    createName.value = ('Servidor de ' + (m ? U.nameOf(m) : 'fantasma')).slice(0, 32);
    var radios = dlgServer.querySelectorAll('input[name="server-color"]');
    var pick = Math.floor(Math.random() * 8);
    Array.prototype.forEach.call(radios, function (r, i) { r.checked = i === pick; });
    showError($('create-server-error'), '');
    showError($('join-server-error'), '');
    joinCode.value = code || '';
    resetPreview();
    openDialog(dlgServer);
    setPane(which);
    if (code) submitJoin();
  }

  function resetPreview() {
    preview = null;
    invitePreviewBox.hidden = true;
    joinSubmit.textContent = 'Ver convite';
  }

  dlgServer.addEventListener('close', function () {
    if (serverDlgReturn && document.contains(serverDlgReturn)) { try { serverDlgReturn.focus(); } catch (e) { /* ignora */ } }
  });
  $('to-join').addEventListener('click', function () { setPane('join'); });
  $('to-create').addEventListener('click', function () { setPane('create'); });

  $('form-create-server').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var name = createName.value.trim();
    var errEl = $('create-server-error');
    if (name.length < 2 || name.length > 32) { showError(errEl, 'O nome precisa ter de 2 a 32 caracteres.'); createName.focus(); return; }
    if (/[<>]/.test(name)) { showError(errEl, 'O nome não pode ter os caracteres < ou >.'); createName.focus(); return; }
    var color = dlgServer.querySelector('input[name="server-color"]:checked');
    var btn = $('create-server-submit');
    btn.disabled = true;
    btn.textContent = 'Criando…';
    var p = hasApi('createServer') ? act('createServer', { name: name, iconColor: color ? Number(color.value) : 0 }, true) : act('createGroup', name, true);
    p.then(function (err) {
      btn.disabled = false;
      btn.textContent = 'Criar';
      if (err) { showError(errEl, err); createName.focus(); return; }
      serverDlgReturn = null;
      dlgServer.close();
      U.toast('Servidor criado! Use “Convidar pessoas” no menu do servidor para chamar a galera.');
      focusTitle();
    });
  });

  function extractCode(raw) {
    var up = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, ' ');
    var m = up.match(/[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}/g);
    if (m && m.length) return m[m.length - 1];
    var compact = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/.test(compact) ? compact : null;
  }

  joinCode.addEventListener('input', function () {
    if (/^[a-z0-9\s-]{0,14}$/i.test(joinCode.value)) {
      var pos = joinCode.selectionStart;
      joinCode.value = joinCode.value.toUpperCase();
      try { joinCode.setSelectionRange(pos, pos); } catch (e) { /* ignora */ }
    }
    if (preview && extractCode(joinCode.value) !== preview.code) resetPreview();
    showError($('join-server-error'), '');
  });

  $('form-join-server').addEventListener('submit', function (ev) { ev.preventDefault(); submitJoin(); });

  function submitJoin() {
    var errEl = $('join-server-error');
    var code = extractCode(joinCode.value);
    if (!code) { showError(errEl, 'Não reconheci esse convite. São 10 letras e números (sem I, L, O, 0 e 1), como K7M2QX9PTA.'); joinCode.focus(); return; }
    joinSubmit.disabled = true;
    if (preview && preview.code === code) {
      joinSubmit.textContent = 'Entrando…';
      var p = hasApi('joinServer') ? act('joinServer', code, true) : act('joinGroup', code, true);
      p.then(function (err) {
        joinSubmit.disabled = false;
        if (err) { joinSubmit.textContent = preview ? labelForPreview(preview.invite) : 'Ver convite'; showError(errEl, err); return; }
        var name = preview.invite.name;
        serverDlgReturn = null;
        dlgServer.close();
        U.toast(preview.invite.alreadyMember ? 'Você já fazia parte de ' + name + '.' : 'Boas-vindas a ' + name + '!');
        focusTitle();
      });
      return;
    }
    if (!hasApi('previewInvite')) {
      // versão antiga: entra direto
      preview = { code: code, invite: { name: 'o servidor', alreadyMember: false } };
      joinSubmit.disabled = false;
      submitJoin();
      return;
    }
    joinSubmit.textContent = 'Procurando…';
    ask('previewInvite', code).then(function (res) {
      joinSubmit.disabled = false;
      if (!res.ok || !res.invite) { joinSubmit.textContent = 'Ver convite'; showError(errEl, res.error || 'Esse convite não vale: o código está errado, expirou ou já foi usado.'); return; }
      preview = { code: code, invite: res.invite };
      var inv = res.invite;
      var ic = $('invite-preview-icon');
      ic.textContent = '';
      ic.dataset.tone = String(typeof inv.iconColor === 'number' ? inv.iconColor : U.toneFor(inv.serverId));
      var url = U.safeImageUrl(inv.iconUrl);
      if (url) { var img = document.createElement('img'); img.alt = ''; img.className = 'avatar-img'; img.src = url; ic.appendChild(img); }
      else ic.appendChild(el('span', 'rail-initials', U.initials(inv.name)));
      $('invite-preview-name').textContent = inv.name;
      var meta = (typeof inv.memberCount === 'number' ? U.num(inv.memberCount) + (inv.memberCount === 1 ? ' membro' : ' membros') : '');
      if (inv.alreadyMember) meta += (meta ? ' · ' : '') + 'Você já é membro';
      $('invite-preview-meta').textContent = meta;
      invitePreviewBox.hidden = false;
      joinSubmit.textContent = labelForPreview(inv);
      joinSubmit.focus();
    });
  }

  function labelForPreview(inv) { return inv.alreadyMember ? 'Abrir servidor' : 'Entrar em ' + inv.name; }

  /* convidar pessoas */
  var dlgInvite = $('dlg-invite');
  var inviteServerId = null;
  var inviteBusy = false;
  var dateFmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  function openInvite(serverId) {
    var srv = serverById(serverId) || view.server;
    if (!srv) return;
    inviteServerId = srv.id;
    $('dlg-invite-title').textContent = 'Convide amigos para ' + srv.name;
    $('invite-age').value = '';
    $('invite-uses').value = '';
    $('invite-options').open = false;
    showError($('invite-error'), '');
    $('invite-box').hidden = true;
    $('invite-status').textContent = '';
    openDialog(dlgInvite);
    loadInvite(null, null);
  }

  function loadInvite(maxAge, maxUses) {
    if (inviteBusy) return;
    inviteBusy = true;
    $('invite-loading').textContent = 'Gerando o código…';
    var useNew = hasApi('createInvite');
    var p = view.legacy
      ? opts.call(function () { return bridge.createInvite(); })
      : (useNew ? opts.call(function () { return bridge.createInvite({ serverId: inviteServerId, maxAgeSeconds: maxAge, maxUses: maxUses }); }) : Promise.resolve({ ok: false, error: 'Convites indisponíveis.' }));
    p.then(function (res) {
      inviteBusy = false;
      $('invite-loading').textContent = '';
      if (!res || !res.ok) { showError($('invite-error'), (res && res.error) || 'Não deu para gerar o convite.'); return; }
      var inv = res.invite || { code: res.code, expiresAt: res.expiresAt || null, maxUses: null, uses: 0 };
      $('invite-code').textContent = inv.code;
      var parts = [];
      if (!inv.expiresAt && !inv.maxUses) parts.push('Este convite nunca expira e não tem limite de usos.');
      else {
        parts.push(inv.expiresAt ? 'Expira ' + dateFmt.format(new Date(inv.expiresAt)) + '.' : 'Não expira.');
        parts.push(inv.maxUses ? 'Usado ' + (inv.uses || 0) + ' de ' + inv.maxUses + ' vezes.' : 'Sem limite de usos.');
      }
      $('invite-expiry').textContent = parts.join(' ');
      $('invite-box').hidden = false;
      $('invite-code').focus();
    });
  }

  $('btn-copy-invite').addEventListener('click', function () {
    var code = $('invite-code').textContent;
    U.copyText(code).then(function (ok) {
      $('invite-status').textContent = ok ? 'Copiado! Agora é só colar para quem você quer chamar.' : 'Não deu para copiar. Selecione o código e copie manualmente.';
    });
  });
  $('invite-generate').addEventListener('click', function () {
    var age = $('invite-age').value;
    var uses = $('invite-uses').value;
    $('invite-status').textContent = '';
    loadInvite(age ? Number(age) : null, uses ? Number(uses) : null);
  });

  /* criar/editar canal */
  var dlgChannel = $('dlg-channel');
  var channelForm = $('form-channel');
  var channelName = $('channel-name');
  var channelDlg = null; // { mode, channel? }

  function normalizeChannelName(v, kind) {
    var s = String(v || '');
    if (kind === 'voice') return s.trim().slice(0, 32);
    return s.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 32);
  }

  function channelKind() {
    var r = channelForm.querySelector('input[name="channel-kind"]:checked');
    return r ? r.value : 'text';
  }

  function updateChannelHelp() {
    var kind = channelDlg && channelDlg.mode === 'edit' ? channelDlg.channel.kind : channelKind();
    var n = normalizeChannelName(channelName.value, kind);
    $('channel-name-help').textContent = kind === 'voice'
      ? 'De 1 a 32 caracteres.'
      : (n ? 'Vai aparecer como #' + n + ' (minúsculas, espaços viram hífen).' : 'Minúsculas, sem espaços (espaços viram hífen).');
  }

  function openChannelDialog(o) {
    if (!view.server) return;
    channelDlg = o;
    var edit = o.mode === 'edit';
    $('channel-dlg-title').textContent = edit ? 'Editar canal' : 'Criar canal';
    $('channel-kind').hidden = edit;
    $('channel-topic-field').hidden = !(edit && o.channel.kind === 'text');
    $('channel-delete').hidden = !edit;
    $('channel-submit').textContent = edit ? 'Salvar alterações' : 'Criar canal';
    var sel2 = $('channel-category');
    sel2.textContent = '';
    var none = document.createElement('option');
    none.value = '';
    none.textContent = 'Sem categoria';
    sel2.appendChild(none);
    sortedCategories().forEach(function (cat) {
      var op = document.createElement('option');
      op.value = cat.id;
      op.textContent = cat.name;
      sel2.appendChild(op);
    });
    if (edit) {
      channelName.value = o.channel.name;
      $('channel-topic-input').value = o.channel.topic || '';
      sel2.value = o.channel.categoryId || '';
    } else {
      channelName.value = '';
      var kindRadio = channelForm.querySelector('input[name="channel-kind"][value="' + (o.kind || 'text') + '"]');
      if (kindRadio) kindRadio.checked = true;
      sel2.value = o.categoryId || '';
      // canal de voz por padrão quando a categoria parece de voz
      var cat = sortedCategories().filter(function (k) { return k.id === o.categoryId; })[0];
      if (!o.kind && cat && /voz|voice/i.test(cat.name)) {
        var v = channelForm.querySelector('input[name="channel-kind"][value="voice"]');
        if (v) v.checked = true;
      }
    }
    showError($('channel-error'), '');
    updateChannelHelp();
    openDialog(dlgChannel);
    channelName.focus();
    channelName.select();
  }

  channelName.addEventListener('input', updateChannelHelp);
  Array.prototype.forEach.call(channelForm.querySelectorAll('input[name="channel-kind"]'), function (r) { r.addEventListener('change', updateChannelHelp); });

  channelForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (!channelDlg || !view.server) return;
    var edit = channelDlg.mode === 'edit';
    var kind = edit ? channelDlg.channel.kind : channelKind();
    var name = normalizeChannelName(channelName.value, kind);
    if (!name) { showError($('channel-error'), 'Dê um nome para o canal.'); channelName.focus(); return; }
    var cat = $('channel-category').value || null;
    var btn = $('channel-submit');
    btn.disabled = true;
    var p = edit
      ? act('updateChannel', { channelId: channelDlg.channel.id, name: name, topic: kind === 'text' ? ($('channel-topic-input').value.trim() || null) : undefined, categoryId: cat }, true)
      : act('createChannel', { serverId: view.server.id, kind: kind, name: name, categoryId: cat }, true);
    p.then(function (err) {
      btn.disabled = false;
      if (err) { showError($('channel-error'), err); channelName.focus(); return; }
      dlgChannel.close();
      U.toast(edit ? 'Canal atualizado.' : 'Canal criado.');
    });
  });
  $('channel-delete').addEventListener('click', function () { if (channelDlg && channelDlg.channel) confirmDeleteChannel(channelDlg.channel); });

  /* ---------- busca rápida (Ctrl+K) ---------- */

  var dlgQuick = $('dlg-quick');
  var quickInput = $('quick-input');
  var quickList = $('quick-list');
  var quickItems = [];
  var quickIndex = 0;
  var quickReturn = null;

  function openQuick(from) {
    if (!signedIn()) { opts.openSignin(); return; }
    quickReturn = from || document.activeElement;
    quickInput.value = '';
    openDialog(dlgQuick);
    renderQuick();
    quickInput.focus();
  }

  function quickCandidates() {
    var out = [];
    list(view.dms).forEach(function (d) {
      out.push({ kind: '@', label: U.nameOf(d.user), sub: d.user.username ? '@' + d.user.username : 'Mensagem direta', user: d.user, run: function () { select({ mode: 'dm', dmId: d.id }).then(focusComposerSoon); } });
    });
    list(view.friends).filter(function (f) { return f.relation === 'friend' && !list(view.dms).some(function (d) { return d.user.id === f.id; }); }).forEach(function (f) {
      out.push({ kind: '@', label: U.nameOf(f), sub: f.username ? '@' + f.username : 'Amigo', user: f, run: function () { openDm(f.id); } });
    });
    if (view.server) {
      displayOrder().forEach(function (c) {
        out.push({ kind: c.kind === 'voice' ? '!' : '#', label: c.name, sub: view.server.name, channel: c, run: function () { openChannel(c); } });
      });
    }
    list(view.servers).forEach(function (s) {
      out.push({ kind: '*', label: s.name, sub: 'Servidor', server: s, run: function () { select({ mode: 'server', serverId: s.id }); } });
    });
    return out;
  }

  function renderQuick() {
    var raw = quickInput.value.trim();
    var prefix = /^[@#!*]/.test(raw) ? raw.charAt(0) : null;
    var q = (prefix ? raw.slice(1) : raw).toLowerCase();
    var all = quickCandidates().filter(function (c) { return !prefix || c.kind === prefix; });
    var scored = all.map(function (c) {
      var l = c.label.toLowerCase();
      var s2 = String(c.sub || '').toLowerCase();
      var score = !q ? 1 : (l.indexOf(q) === 0 ? 3 : (l.indexOf(q) > 0 ? 2 : (s2.indexOf(q) >= 0 ? 1 : 0)));
      return { c: c, score: score };
    }).filter(function (x) { return x.score > 0; }).sort(function (a, b) { return b.score - a.score; }).slice(0, 12);
    quickItems = scored.map(function (x) { return x.c; });
    quickIndex = 0;
    quickList.textContent = '';
    quickItems.forEach(function (c, i) {
      var li = el('li', 'quick-item');
      li.id = 'quick-opt-' + i;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', i === quickIndex ? 'true' : 'false');
      if (c.user) li.appendChild(U.avatarEl(c.user, 'xs', { status: presenceOf(c.user.id) }));
      else if (c.server) li.appendChild(serverIcon(c.server, 'xs'));
      else li.appendChild(icon(c.kind === '!' ? 'speaker' : 'hash', 18, 'channel-icon'));
      li.appendChild(el('span', 'quick-label', c.label));
      li.appendChild(el('span', 'quick-sub', c.sub || ''));
      li.addEventListener('mousedown', function (ev) { ev.preventDefault(); runQuick(i); });
      quickList.appendChild(li);
    });
    if (!quickItems.length) {
      var none = el('li', 'quick-none', 'Nada encontrado. Tente outro nome.');
      none.setAttribute('role', 'option');
      none.setAttribute('aria-disabled', 'true');
      quickList.appendChild(none);
    }
    syncQuickActive();
  }

  function syncQuickActive() {
    Array.prototype.forEach.call(quickList.querySelectorAll('.quick-item'), function (li, i) {
      li.setAttribute('aria-selected', i === quickIndex ? 'true' : 'false');
    });
    if (quickItems.length) quickInput.setAttribute('aria-activedescendant', 'quick-opt-' + quickIndex);
    else quickInput.removeAttribute('aria-activedescendant');
    var act2 = $('quick-opt-' + quickIndex);
    if (act2 && act2.scrollIntoView) act2.scrollIntoView({ block: 'nearest' });
  }

  function runQuick(i) {
    var c = quickItems[i];
    if (!c) return;
    quickReturn = null;
    dlgQuick.close();
    c.run();
  }

  quickInput.addEventListener('input', renderQuick);
  quickInput.addEventListener('keydown', function (ev) {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); if (quickItems.length) { quickIndex = (quickIndex + 1) % quickItems.length; syncQuickActive(); } }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); if (quickItems.length) { quickIndex = (quickIndex - 1 + quickItems.length) % quickItems.length; syncQuickActive(); } }
    else if (ev.key === 'Enter') { ev.preventDefault(); runQuick(quickIndex); }
  });
  dlgQuick.addEventListener('close', function () {
    if (quickReturn && document.contains(quickReturn)) { try { quickReturn.focus(); } catch (e) { /* ignora */ } }
  });
  dlgQuick.addEventListener('click', function (ev) { if (ev.target === dlgQuick) dlgQuick.close(); });

  /* ---------- voz ---------- */

  function voiceApi() {
    var gv = window.GhostVoice;
    return gv && typeof gv.init === 'function' && typeof gv.update === 'function' && typeof gv.join === 'function' ? gv : null;
  }

  function joinVoice(target, withVideo) {
    var gv = voiceApi();
    if (!mods.voice || !gv) { U.toast('A voz não carregou nesta versão do Ghost Rank.', 'error'); return; }
    if (view.legacy) target = undefined;
    try {
      var p = gv.join(target);
      if (withVideo && typeof gv.toggleVideo === 'function') {
        Promise.resolve(p).then(function () {
          var st = typeof gv.getState === 'function' ? gv.getState() : null;
          if (st && st.status === 'connected' && !st.video) gv.toggleVideo();
        }).catch(function () { /* voice.js mostra o erro */ });
      }
    } catch (e) { /* voice.js mostra o erro no palco */ }
  }

  function onVoiceState(state) {
    ui.voiceState = state && typeof state === 'object' ? state : null;
    if (!view) return;
    // mantém compatibilidade com o formato antigo { connected, connecting }
    if (ui.voiceState && !ui.voiceState.status) {
      ui.voiceState.status = ui.voiceState.connected ? 'connected' : (ui.voiceState.connecting ? 'connecting' : 'idle');
    }
    app.dataset.voice = ui.voiceState && ui.voiceState.status === 'connected' ? 'connected' : 'off';
    var page = currentPage();
    if (signedIn() && sel().mode === 'server' && view.server) renderServerNav(page);
    if (page === 'dm') { renderMain(page); renderHeader(page); }
    if (!membersEl.hidden && page !== 'dm' && page !== 'friends') renderServerMembers();
  }

  /* ---------- atalhos ---------- */

  function anyOverlayOpen() {
    return !!document.querySelector('dialog[open]') || U.isMenuOpen() || !!profilePop || (mods.settings && typeof window.GhostSettings.isOpen === 'function' && window.GhostSettings.isOpen());
  }

  function navTargets(unreadOnly) {
    var s = sel();
    if (s.mode === 'server' && view.server) {
      return displayOrder().filter(function (c) { return c.kind === 'text' && (!unreadOnly || c.unread || c.mentions > 0 || c.id === s.channelId); })
        .map(function (c) { return { key: c.id, go: function () { select({ mode: 'server', serverId: view.server.id, channelId: c.id }); } }; });
    }
    var out = [];
    if (!unreadOnly) out.push({ key: 'friends', go: function () { select({ mode: 'home', tab: 'friends' }); } });
    list(view.dms).forEach(function (d) {
      if (!unreadOnly || d.unread > 0 || (s.mode === 'dm' && s.dmId === d.id)) out.push({ key: d.id, go: function () { select({ mode: 'dm', dmId: d.id }); } });
    });
    return out;
  }

  function currentNavKey() {
    var s = sel();
    if (s.mode === 'server') return s.channelId;
    if (s.mode === 'dm') return s.dmId;
    return 'friends';
  }

  document.addEventListener('keydown', function (ev) {
    var k = String(ev.key || '');
    var lower = k.toLowerCase();
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && lower === 'k') {
      ev.preventDefault();
      if (dlgQuick.open) dlgQuick.close(); else openQuick();
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && (k === '/' || ev.code === 'Slash')) {
      ev.preventDefault();
      openDialog($('dlg-keys'));
      return;
    }
    if (ev.ctrlKey && ev.shiftKey && !ev.altKey && !ev.metaKey && (lower === 'm' || lower === 'd')) {
      var gv = voiceApi();
      var st = ui.voiceState;
      if (mods.voice && gv && st && (st.status === 'connected' || st.connected)) {
        ev.preventDefault();
        try {
          if (lower === 'm' && typeof gv.toggleMute === 'function') gv.toggleMute();
          if (lower === 'd' && typeof gv.toggleDeafen === 'function') gv.toggleDeafen();
        } catch (e) { /* ignora */ }
      }
      return;
    }
    if (ev.altKey && !ev.ctrlKey && !ev.metaKey && (k === 'ArrowUp' || k === 'ArrowDown') && signedIn() && view) {
      if (anyOverlayOpen()) return;
      ev.preventDefault();
      var targets = navTargets(ev.shiftKey);
      if (!targets.length) return;
      var cur = currentNavKey();
      var i = -1;
      targets.forEach(function (t, idx) { if (t.key === cur) i = idx; });
      var n = k === 'ArrowDown' ? i + 1 : i - 1;
      if (i < 0) n = k === 'ArrowDown' ? 0 : targets.length - 1;
      if (n < 0 || n >= targets.length) return;
      if (ev.shiftKey && targets[n].key === cur) return;
      targets[n].go();
      return;
    }
    if (k === 'Escape' && !ev.defaultPrevented) {
      if (profilePop) { closeProfile(true); return; }
      if (document.querySelector('dialog[open]') || U.isMenuOpen()) return;
      if (mods.settings && typeof window.GhostSettings.isOpen === 'function' && window.GhostSettings.isOpen()) return;
      if (ui.membersOpen && !isWide()) { ui.membersOpen = false; opts.rerender(); btnMembers.focus(); return; }
      if (ui.sidebarOpen) { setSidebarOpen(false, true); return; }
      var page = currentPage();
      if ((page === 'chat' || page === 'dm') && hasApi('markRead')) act('markRead', undefined, true);
    }
  });

  /* ---------- módulos (chat, configurações, voz) ---------- */

  function initModules() {
    var gc = window.GhostChat;
    if (gc && typeof gc.init === 'function' && typeof gc.update === 'function') {
      try {
        gc.init({ bridge: bridge, root: $('chat-root'), getView: function () { return view; }, openProfile: openProfile, openContextMenu: U.openContextMenu });
        mods.chat = true;
      } catch (e) { mods.chat = false; }
    }
    var gs = window.GhostSettings;
    if (gs && typeof gs.init === 'function') {
      try {
        gs.init({ bridge: bridge, getView: function () { return view; }, onClose: function () { /* settings.js devolve o foco */ } });
        mods.settings = true;
      } catch (e) { mods.settings = false; }
    }
    var gv = voiceApi();
    if (gv) {
      try {
        gv.init({
          bridge: bridge,
          els: { stage: $('voice-stage'), connection: $('voice-connection'), userControls: $('voice-user-controls') },
          getView: function () { return view; },
          onState: onVoiceState,
          onOpenSettings: function (tab) { openUserSettings(tab || 'account'); }
        });
        mods.voice = true;
      } catch (e) { mods.voice = false; }
    }
  }

  /* som de menção (preferência de notificações) */
  function mentionSound() {
    var total = 0;
    list(view.servers).forEach(function (s) { if (!s.muted) total += s.mentions || 0; });
    list(view.dms).forEach(function (d) { if (!d.muted) total += d.mentions || d.unread || 0; });
    var prev = ui.lastMentionTotal;
    ui.lastMentionTotal = total;
    if (prev === null || total <= prev) return;
    var n = view.prefs && view.prefs.notifications;
    var meSt = me() && me().status;
    if (n && n.sounds === false) return;
    if (meSt === 'dnd') return;
    var gv = window.GhostVoice;
    if (gv && typeof gv.playSound === 'function') { try { gv.playSound('message'); } catch (e) { /* ignora */ } }
  }

  /* ---------- render principal ---------- */

  function render(v) {
    view = v;
    if (!view) return;
    if (view.server && ui.serverPageFor && ui.serverPageFor !== view.server.id) ui.serverPage = null;
    var page = currentPage();
    app.dataset.mode = signedIn() ? (sel().mode || 'home') : 'home';
    app.dataset.page = page;
    app.dataset.auth = signedIn() ? 'in' : 'out';
    if (sel().mode === 'home' && signedIn()) ui.lastHomeTab = sel().tab === 'mmr' ? 'mmr' : 'friends';
    applyAppearance();
    renderRail();
    renderSidebar(page);
    renderUserPanel();
    renderHeader(page);
    renderMain(page);
    renderMembers(page);
    renderScrim();
    if (mods.settings) { try { window.GhostSettings.update(view); } catch (e) { /* ignora */ } }
    if (mods.voice) { try { window.GhostVoice.update(view); } catch (e) { /* ignora */ } }
    refreshProfile();
    if (dlgQuick.open) renderQuick();
    if (dlgInvite.open && inviteServerId && !serverById(inviteServerId) && !view.legacy) dlgInvite.close();
    if (signedIn()) mentionSound();
  }

  function init(o) {
    opts = o;
    bridge = o.bridge;
    initModules();
    if (window.ghostRank && typeof window.ghostRank.onNotificationClick === 'function') {
      try { window.ghostRank.onNotificationClick(function () { focusTitle(); }); } catch (e) { /* opcional */ }
    }
  }

  window.GhostShell = {
    init: init,
    render: render,
    normalize: normalize,
    currentPage: currentPage,
    openServerDialog: openServerDialog,
    openInvite: openInvite,
    openProfile: openProfile,
    isVoiceReady: function () { return mods.voice; }
  };
})();
