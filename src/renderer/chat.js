/* Ghost Rank — GhostChat (frente R2, Etapa 6).
   Renderiza view.messages (canal ou DM selecionado) e o compositor.
   Regras: nada de innerHTML com dado; só createElement/textContent. Menções no corpo usam o formato <@uuid>.
   API: GhostChat.init({bridge, root, getView, openProfile, openContextMenu}), update(view),
        focusComposer(), togglePinned(anchorEl), openSearch(query?). */
(function () {
  'use strict';

  var GROUP_MS = 7 * 60 * 1000;
  var MAX_FILES = 4;
  var MAX_BYTES = 8 * 1024 * 1024;
  var MAX_BODY = 2000;
  var TYPING_EVERY_MS = 3000;
  var UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
  var MENTION_TOKEN_RE = new RegExp('<@(' + UUID + ')>', 'g');
  var INLINE_SRC = [
    '`([^`\\n]+)`',                                   // 1 código
    '\\|\\|([\\s\\S]+?)\\|\\|',                        // 2 spoiler
    '\\*\\*([\\s\\S]+?)\\*\\*',                        // 3 negrito
    '__([\\s\\S]+?)__',                               // 4 sublinhado
    '~~([\\s\\S]+?)~~',                               // 5 riscado
    '\\*(?![\\s*])([\\s\\S]*?[^\\s*])\\*',             // 6 itálico *
    '(?:^|(?<=[\\s(]))_(?![\\s_])([\\s\\S]*?[^\\s_])_(?![\\w])', // 7 itálico _
    '<@(' + UUID + ')>',                              // 8 menção
    '(https?:\\/\\/[^\\s<>]+[^\\s<>.,:;"\')\\]!?])',   // 9 link
    '(@everyone|@here)'                               // 10
  ].join('|');
  var JUMBO_RE = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$/u;
  var PICTO_RE = /\p{Extended_Pictographic}/gu;

  var ICONS = {
    reply: 'M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z',
    edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
    more: 'M6 10a2 2 0 110 4 2 2 0 010-4zm6 0a2 2 0 110 4 2 2 0 010-4zm6 0a2 2 0 110 4 2 2 0 010-4z',
    smile: 'M12 2a10 10 0 100 20 10 10 0 000-20zm-3.5 7a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm7 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM12 17.5c-2.3 0-4.3-1.4-5.1-3.5h10.2c-.8 2.1-2.8 3.5-5.1 3.5z',
    crown: 'M5 16L3 6l5.5 4L12 4l3.5 6L21 6l-2 10H5zm0 2h14v2H5z',
    plus: 'M12 2a10 10 0 100 20 10 10 0 000-20zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z',
    close: 'M6.4 5L12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z',
    file: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm0 7V3.5L19.5 9H14z',
    pin: 'M16 3l5 5-2 1-3 3 1 5-2 2-4-4-5 5-1-1 5-5-4-4 2-2 5 1 3-3 1-2z',
    search: 'M15.5 14h-.8l-.3-.3A6.5 6.5 0 109.5 16a6.5 6.5 0 004.2-1.6l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 110-9 4.5 4.5 0 010 9z',
    trash: 'M6 19a2 2 0 002 2h8a2 2 0 002-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
    hash: 'M10 3L8 21h2l2-18h-2zm6 0l-2 18h2l2-18h-2zM4 8v2h17V8H4zm-1 6v2h17v-2H3z',
    ext: 'M14 3v2h3.6l-9.8 9.8 1.4 1.4L19 6.4V10h2V3h-7zm5 16H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7h-2v7z',
    arrowDown: 'M12 16l-6-6h12z'
  };

  var opts = {};
  var bridge = null;
  var root = null;
  var view = null;
  var dom = {};
  var st = {
    target: null,
    drafts: Object.create(null),
    replies: Object.create(null),
    files: Object.create(null),
    editingId: null,
    editText: '',
    atBottom: true,
    loadingOlder: false,
    nodes: new Map(),
    lastMarked: null,
    markTimer: null,
    typingSentAt: 0,
    panel: null,
    ac: null,
    picker: null,
    recent: [],
    dragDepth: 0,
    error: null,
    errorTimer: null,
    shift: false
  };

  // ---------------------------------------------------------------- utilidades
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function txt(s) { return document.createTextNode(s); }
  function icon(name, size) {
    var NS = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', String(size || 20));
    s.setAttribute('height', String(size || 20));
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('d', ICONS[name]);
    p.setAttribute('fill', 'currentColor');
    s.appendChild(p);
    return s;
  }
  function iconButton(name, label, cls) {
    var b = el('button', 'gc-icon-btn' + (cls ? ' ' + cls : ''));
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.appendChild(icon(name, 20));
    return b;
  }
  function same(a, b) { return a != null && b != null && String(a) === String(b); }
  function toDate(v) {
    var d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
    return isNaN(d.getTime()) ? new Date(0) : d;
  }
  function dayKey(d) { return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
  function hhmm(d) { return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  function fullDate(d) { return d.toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' }); }
  function headerTime(d) {
    var now = new Date();
    var y = new Date(now); y.setDate(now.getDate() - 1);
    if (dayKey(d) === dayKey(now)) return 'Hoje às ' + hhmm(d);
    if (dayKey(d) === dayKey(y)) return 'Ontem às ' + hhmm(d);
    return d.toLocaleDateString('pt-BR') + ' ' + hhmm(d);
  }
  function dayLabel(d) { return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }); }
  function fmtSize(n) {
    if (!(n >= 0)) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0).replace('.', ',') + ' KB';
    return (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
  }
  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // ---------------------------------------------------------------- dados da view
  function msgs() { return view && view.messages ? view.messages : null; }
  function items() { var m = msgs(); return m && Array.isArray(m.items) ? m.items : []; }
  function myId() { return view && view.me ? view.me.id : null; }
  function isDm() { return typeof st.target === 'string' && st.target.indexOf('d:') === 0; }
  function userOf(id) { return (view && view.users && view.users[id]) || null; }
  function memberOf(id) {
    var s = view && view.server;
    if (!s || !Array.isArray(s.members) || isDm()) return null;
    for (var i = 0; i < s.members.length; i++) if (same(s.members[i].id, id)) return s.members[i];
    return null;
  }
  function personOf(id) {
    var m = memberOf(id);
    var u = userOf(id);
    if (!u && !m && view && view.me && same(view.me.id, id)) u = view.me;
    if (!u && !m && isDm()) { var dm = currentDm(); if (dm && dm.user && same(dm.user.id, id)) u = dm.user; }
    return m || u ? { user: u || m, member: m } : null;
  }
  function nameOf(id) {
    var p = personOf(id);
    if (!p) return 'Pessoa desconhecida';
    if (p.member && p.member.nickname) return p.member.nickname;
    return p.user.displayName || p.user.username || 'Alguém';
  }
  function roleOf(id) { var m = memberOf(id); return m ? m.role : null; }
  function myRole() { return view && view.server && !isDm() ? view.server.role : null; }
  function canModerate() { var r = myRole(); return r === 'owner' || r === 'admin'; }
  function canPin() { return isDm() || canModerate(); }
  function currentDm() {
    if (!view || !Array.isArray(view.dms) || !isDm()) return null;
    var id = st.target.slice(2);
    for (var i = 0; i < view.dms.length; i++) if (same(view.dms[i].id, id)) return view.dms[i];
    return null;
  }
  function currentChannel() {
    if (!view || !view.server || !Array.isArray(view.server.channels) || isDm() || !st.target) return null;
    var id = st.target.slice(2);
    for (var i = 0; i < view.server.channels.length; i++) if (same(view.server.channels[i].id, id)) return view.server.channels[i];
    return null;
  }
  function targetLabel() {
    var dm = currentDm();
    if (dm) return '@' + (dm.user.displayName || dm.user.username || 'pessoa');
    var ch = currentChannel();
    return ch ? '#' + ch.name : 'esta conversa';
  }
  function mentionables() {
    var out = [];
    if (isDm()) {
      var dm = currentDm();
      if (dm && dm.user) out.push({ id: dm.user.id, username: dm.user.username, name: dm.user.displayName || dm.user.username, user: dm.user });
      if (view && view.me) out.push({ id: view.me.id, username: view.me.username, name: view.me.displayName || view.me.username, user: view.me });
    } else if (view && view.server && Array.isArray(view.server.members)) {
      view.server.members.forEach(function (m) {
        out.push({ id: m.id, username: m.username, name: m.nickname || m.displayName || m.username, user: m });
      });
    }
    return out;
  }
  function findMsg(id) {
    var list = items();
    for (var i = 0; i < list.length; i++) if (same(list[i].id, id)) return list[i];
    return null;
  }

  // ---------------------------------------------------------------- avatar
  function avatarEl(user, size) {
    var a = el('span', 'gc-avatar gc-avatar-' + (size || 40));
    var tone = user && Number.isInteger(user.avatarColor) ? user.avatarColor : 0;
    a.dataset.tone = String(Math.max(0, Math.min(7, tone)));
    a.setAttribute('aria-hidden', 'true');
    if (user && typeof user.avatarUrl === 'string' && /^(https:|data:image\/)/.test(user.avatarUrl)) {
      var img = el('img');
      img.src = user.avatarUrl;
      img.alt = '';
      img.decoding = 'async';
      img.loading = 'lazy';
      a.appendChild(img);
    } else {
      var n = user ? (user.displayName || user.username || '?') : '?';
      a.textContent = Array.from(n.trim())[0] ? Array.from(n.trim())[0].toUpperCase() : '?';
    }
    return a;
  }

  // ---------------------------------------------------------------- markdown seguro
  function renderMarkdown(text) {
    var frag = document.createDocumentFragment();
    var re = /```(?:([A-Za-z0-9_+#.-]{1,20})\n)?([\s\S]*?)```/g;
    var last = 0;
    var m;
    while ((m = re.exec(text))) {
      if (m.index > last) appendBlocks(frag, text.slice(last, m.index).replace(/\n$/, ''));
      var pre = el('pre', 'gc-codeblock');
      if (m[1]) pre.dataset.lang = m[1];
      var code = el('code');
      code.textContent = m[2].replace(/^\n/, '').replace(/\n$/, '');
      pre.appendChild(code);
      frag.appendChild(pre);
      last = re.lastIndex;
      if (text.charAt(last) === '\n') last++;
    }
    if (last < text.length) appendBlocks(frag, text.slice(last));
    return frag;
  }
  function appendBlocks(frag, text) {
    var lines = text.split('\n');
    var buf = [];
    var quote = [];
    function flushText() {
      if (!buf.length) return;
      var span = el('span', 'gc-text');
      span.appendChild(inline(buf.join('\n'), 0));
      frag.appendChild(span);
      buf = [];
    }
    function flushQuote() {
      if (!quote.length) return;
      var bq = el('blockquote', 'gc-quote');
      bq.appendChild(inline(quote.join('\n'), 0));
      frag.appendChild(bq);
      quote = [];
    }
    lines.forEach(function (line) {
      var q = /^> ?(.*)$/.exec(line);
      if (q) { flushText(); quote.push(q[1]); } else { flushQuote(); buf.push(line); }
    });
    flushText();
    flushQuote();
  }
  function inline(text, depth) {
    var frag = document.createDocumentFragment();
    if (depth > 6) { frag.appendChild(txt(text)); return frag; }
    var re = new RegExp(INLINE_SRC, 'g');
    var last = 0;
    var m;
    while ((m = re.exec(text))) {
      if (m[0] === '') { re.lastIndex++; continue; }
      if (m.index > last) frag.appendChild(txt(text.slice(last, m.index)));
      var node;
      if (m[1] != null) node = el('code', 'gc-code', m[1]);
      else if (m[2] != null) node = spoiler(inline(m[2], depth + 1));
      else if (m[3] != null) { node = el('strong'); node.appendChild(inline(m[3], depth + 1)); }
      else if (m[4] != null) { node = el('u'); node.appendChild(inline(m[4], depth + 1)); }
      else if (m[5] != null) { node = el('s'); node.appendChild(inline(m[5], depth + 1)); }
      else if (m[6] != null || m[7] != null) { node = el('em'); node.appendChild(inline(m[6] != null ? m[6] : m[7], depth + 1)); }
      else if (m[8] != null) node = mentionChip(m[8]);
      else if (m[9] != null) node = linkEl(m[9]);
      else node = el('span', 'gc-mention is-everyone', m[10]);
      frag.appendChild(node);
      last = re.lastIndex;
    }
    if (last < text.length) frag.appendChild(txt(text.slice(last)));
    return frag;
  }
  function spoiler(content) {
    var s = el('span', 'gc-spoiler');
    s.tabIndex = 0;
    s.setAttribute('role', 'button');
    s.setAttribute('aria-label', 'Spoiler oculto. Ative para revelar.');
    s.setAttribute('aria-expanded', 'false');
    var inner = el('span', 'gc-spoiler-text');
    inner.appendChild(content);
    s.appendChild(inner);
    function reveal(ev) {
      if (s.classList.contains('is-revealed')) return;
      ev.preventDefault();
      ev.stopPropagation();
      s.classList.add('is-revealed');
      s.removeAttribute('role');
      s.removeAttribute('aria-label');
      s.removeAttribute('aria-expanded');
      s.removeAttribute('tabindex');
    }
    s.addEventListener('click', reveal);
    s.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') reveal(ev); });
    return s;
  }
  function mentionChip(id) {
    var b = el('span', 'gc-mention' + (same(id, myId()) ? ' is-me' : ''), '@' + nameOf(id));
    b.tabIndex = 0;
    b.setAttribute('role', 'button');
    b.dataset.userId = id;
    b.addEventListener('click', function (ev) { ev.stopPropagation(); profile(id, b); });
    b.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); profile(id, b); } });
    return b;
  }
  function safeUrl(raw) {
    try {
      var u = new URL(raw);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
    } catch (e) { return null; }
  }
  function linkEl(raw) {
    var href = safeUrl(raw);
    if (!href) return txt(raw);
    var a = el('a', 'gc-link', raw);
    a.href = href;
    a.rel = 'noopener noreferrer';
    a.title = href + ' (abre no navegador)';
    a.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); openExternal(href); });
    return a;
  }
  function openExternal(href) {
    if (bridge && typeof bridge.openExternal === 'function') {
      Promise.resolve(bridge.openExternal(href)).then(function (r) {
        if (r && r.ok === false) showError(r.error || 'Não deu para abrir o link.');
      }).catch(function () {});
    }
  }
  function isJumbo(body) {
    if (!body || body.length > 200 || !JUMBO_RE.test(body)) return false;
    var count = (body.match(PICTO_RE) || []).length;
    return count > 0 && count <= 27;
  }
  function plainExcerpt(body, max) {
    var s = String(body || '').replace(MENTION_TOKEN_RE, function (_, id) { return '@' + nameOf(id); })
      .replace(/```[\s\S]*?```/g, '[código]').replace(/[*_~`|]{1,3}/g, '').replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  // ---------------------------------------------------------------- codificação do compositor
  function splitCode(s, fn) {
    return s.split(/(```[\s\S]*?```|`[^`\n]+`)/).map(function (part, i) { return i % 2 ? part : fn(part); }).join('');
  }
  function encodeBody(raw) {
    var people = mentionables();
    return splitCode(raw, function (part) {
      part = part.replace(/(^|[\s(])@([A-Za-z0-9_.]{2,32})/g, function (all, pre, uname) {
        var low = uname.toLowerCase();
        for (var i = 0; i < people.length; i++) {
          if (people[i].username && people[i].username.toLowerCase() === low) return pre + '<@' + people[i].id + '>';
        }
        return all;
      });
      return part.replace(/:([a-z0-9_]{2,32}):/gi, function (all, n) {
        var e = window.GhostEmoji && window.GhostEmoji.byName(n);
        return e ? e.emoji : all;
      });
    });
  }
  function decodeBody(body) {
    return String(body || '').replace(MENTION_TOKEN_RE, function (all, id) {
      var p = personOf(id);
      return p && p.user.username ? '@' + p.user.username : all;
    });
  }

  // ---------------------------------------------------------------- estrutura
  function build() {
    root.textContent = '';
    root.classList.add('gc-root');
    var wrap = el('div', 'gc');
    dom.wrap = wrap;

    var main = el('div', 'gc-main');
    dom.main = main;

    var scroll = el('div', 'gc-scroll');
    scroll.tabIndex = 0;
    scroll.setAttribute('aria-label', 'Mensagens. Use as setas para navegar.');
    dom.scroll = scroll;
    dom.top = el('div', 'gc-top');
    dom.list = el('ol', 'gc-list');
    dom.list.setAttribute('role', 'log');
    dom.list.setAttribute('aria-live', 'polite');
    dom.list.setAttribute('aria-relevant', 'additions');
    dom.list.setAttribute('aria-label', 'Mensagens');
    dom.spacer = el('div', 'gc-spacer');
    scroll.appendChild(dom.top);
    scroll.appendChild(dom.list);
    scroll.appendChild(dom.spacer);
    main.appendChild(scroll);

    dom.jump = el('div', 'gc-jump');
    dom.jump.hidden = true;
    dom.jump.appendChild(el('span', 'gc-jump-text', 'Você está vendo mensagens antigas'));
    var jb = el('button', 'gc-jump-btn');
    jb.type = 'button';
    jb.appendChild(txt('Ir para o presente'));
    jb.appendChild(icon('arrowDown', 16));
    jb.addEventListener('click', function () { scrollToBottom(true); focusComposer(); });
    dom.jump.appendChild(jb);

    var bottom = el('div', 'gc-bottom');
    dom.bottom = bottom;
    dom.error = el('p', 'gc-error');
    dom.error.setAttribute('role', 'alert');
    dom.error.hidden = true;

    dom.replyBar = el('div', 'gc-reply-bar');
    dom.replyBar.hidden = true;
    dom.replyText = el('span', 'gc-reply-text');
    var rc = iconButton('close', 'Cancelar resposta', 'gc-reply-cancel');
    rc.addEventListener('click', function () { setReply(null); focusComposer(); });
    dom.replyBar.appendChild(dom.replyText);
    dom.replyBar.appendChild(rc);

    dom.tray = el('ul', 'gc-tray');
    dom.tray.setAttribute('aria-label', 'Arquivos para enviar');
    dom.tray.hidden = true;

    var form = el('form', 'gc-composer');
    form.noValidate = true;
    dom.form = form;
    var attach = iconButton('plus', 'Enviar arquivo', 'gc-attach');
    dom.fileInput = el('input');
    dom.fileInput.type = 'file';
    dom.fileInput.multiple = true;
    dom.fileInput.hidden = true;
    dom.fileInput.tabIndex = -1;
    attach.addEventListener('click', function () { dom.fileInput.click(); });
    dom.fileInput.addEventListener('change', function () {
      addFiles(Array.from(dom.fileInput.files || []));
      dom.fileInput.value = '';
    });

    var input = el('textarea', 'gc-input');
    input.rows = 1;
    input.maxLength = MAX_BODY + 500;
    input.setAttribute('aria-label', 'Mensagem');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', 'gc-ac');
    input.setAttribute('aria-expanded', 'false');
    input.spellcheck = true;
    dom.input = input;

    var emojiBtn = iconButton('smile', 'Escolher emoji', 'gc-emoji-btn');
    emojiBtn.addEventListener('click', function () { openPicker(emojiBtn, { mode: 'insert', field: dom.input }); });
    dom.emojiBtn = emojiBtn;
    dom.counter = el('span', 'gc-counter');
    dom.counter.hidden = true;

    form.appendChild(attach);
    form.appendChild(dom.fileInput);
    form.appendChild(input);
    form.appendChild(dom.counter);
    form.appendChild(emojiBtn);

    dom.ac = el('ul', 'gc-ac');
    dom.ac.id = 'gc-ac';
    dom.ac.setAttribute('role', 'listbox');
    dom.ac.hidden = true;

    dom.typing = el('div', 'gc-typing');
    dom.typing.setAttribute('aria-live', 'polite');

    bottom.appendChild(dom.jump);
    bottom.appendChild(dom.ac);
    bottom.appendChild(dom.error);
    bottom.appendChild(dom.replyBar);
    bottom.appendChild(dom.tray);
    bottom.appendChild(form);
    bottom.appendChild(dom.typing);
    main.appendChild(bottom);

    dom.drop = el('div', 'gc-drop');
    dom.drop.hidden = true;
    var dropCard = el('div', 'gc-drop-card');
    dropCard.appendChild(icon('file', 40));
    dropCard.appendChild(el('strong', null, 'Solte para enviar'));
    dom.dropText = el('span', null, '');
    dropCard.appendChild(dom.dropText);
    dom.drop.appendChild(dropCard);
    main.appendChild(dom.drop);

    wrap.appendChild(main);

    dom.panel = el('aside', 'gc-panel');
    dom.panel.hidden = true;
    wrap.appendChild(dom.panel);

    root.appendChild(wrap);

    bindComposer();
    bindScroll();
    bindDrop();
    bindListKeys();
  }

  // ---------------------------------------------------------------- update
  function update(v) {
    view = v || null;
    if (!root) return;
    var m = msgs();
    var target = m ? m.target : null;
    if (target !== st.target) switchTarget(target);
    if (!m) {
      dom.wrap.hidden = true;
      return;
    }
    dom.wrap.hidden = false;
    var sc = dom.scroll;
    var wasBottom = st.atBottom;
    var anchor = null;
    if (!st.justSwitched && !wasBottom) anchor = firstVisible();
    renderTop();
    renderList();
    renderTyping();
    renderReplyBar();
    dom.input.placeholder = 'Conversar em ' + targetLabel();
    if (st.justSwitched) {
      if (m.status === 'ready' || items().length) {
        st.justSwitched = false;
        var divider = dom.list.querySelector('.gc-divider-new');
        if (divider && divider.offsetTop > sc.clientHeight * 0.6) {
          sc.scrollTop = Math.max(0, divider.offsetTop - sc.clientHeight / 3);
          st.atBottom = false;
        } else scrollToBottom(false);
      }
    } else if (wasBottom) {
      scrollToBottom(false);
    } else if (anchor) {
      var n = st.nodes.get('m:' + anchor.id);
      if (n && n.isConnected) sc.scrollTop += n.getBoundingClientRect().top - anchor.top;
    }
    if (st.loadingOlder && m.status !== 'loading') st.loadingOlder = false;
    if (st.panel && st.panel.kind === 'pinned' && st.panel.target === st.target) refreshPinnedSoon();
    var editing = st.editingId != null ? dom.list.querySelector('.gc-edit-input') : null;
    if (editing && !editing.__focused) {
      editing.__focused = true;
      editing.focus({ preventScroll: true });
      editing.setSelectionRange(editing.value.length, editing.value.length);
      var host = editing.closest('.gc-msg');
      if (host) host.scrollIntoView({ block: 'nearest' });
      st.atBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 48;
    }
    syncJump();
    maybeMarkRead();
  }

  function switchTarget(target) {
    if (st.target) {
      st.drafts[st.target] = dom.input.value;
    }
    st.target = target;
    st.editingId = null;
    st.nodes.clear();
    dom.list.textContent = '';
    st.atBottom = true;
    st.loadingOlder = false;
    st.justSwitched = true;
    st.lastMarked = null;
    closeAc();
    closePicker();
    if (st.panel && st.panel.target !== target) closePanel();
    clearError();
    dom.input.value = target && st.drafts[target] ? st.drafts[target] : '';
    autosize();
    renderTray();
  }

  function renderTop() {
    var m = msgs();
    dom.top.textContent = '';
    if (m.status === 'error') {
      var box = el('div', 'gc-state gc-state-error');
      box.setAttribute('role', 'alert');
      box.appendChild(el('p', null, m.error || 'Não deu para carregar as mensagens.'));
      var r = el('button', 'gc-btn', 'Tentar de novo');
      r.type = 'button';
      r.addEventListener('click', function () {
        if (bridge && typeof bridge.select === 'function' && view && view.selection) bridge.select(view.selection);
      });
      box.appendChild(r);
      dom.top.appendChild(box);
      return;
    }
    if (m.status === 'loading' && !items().length) {
      var sk = el('div', 'gc-skeleton');
      sk.setAttribute('aria-busy', 'true');
      sk.setAttribute('aria-label', 'Carregando mensagens');
      for (var i = 0; i < 5; i++) {
        var row = el('div', 'gc-sk-row');
        row.appendChild(el('span', 'gc-sk-avatar'));
        var lines = el('span', 'gc-sk-lines');
        lines.appendChild(el('span', 'gc-sk-line gc-sk-short'));
        lines.appendChild(el('span', 'gc-sk-line' + (i % 2 ? ' gc-sk-mid' : '')));
        row.appendChild(lines);
        sk.appendChild(row);
      }
      dom.top.appendChild(sk);
      return;
    }
    if (m.hasMore) {
      var more = el('div', 'gc-loading-older');
      more.setAttribute('aria-live', 'polite');
      more.appendChild(el('span', 'gc-spinner'));
      more.appendChild(txt(st.loadingOlder ? 'Carregando mensagens antigas…' : 'Role para carregar mensagens antigas'));
      dom.top.appendChild(more);
      return;
    }
    dom.top.appendChild(welcome());
  }

  function welcome() {
    var w = el('div', 'gc-welcome');
    var dm = currentDm();
    if (dm) {
      w.appendChild(avatarEl(dm.user, 80));
      w.appendChild(el('h2', 'gc-welcome-title', dm.user.displayName || dm.user.username));
      if (dm.user.username) w.appendChild(el('p', 'gc-welcome-handle', '@' + dm.user.username));
      w.appendChild(el('p', 'gc-welcome-text', 'Este é o começo do seu histórico de mensagens diretas com ' + (dm.user.displayName || dm.user.username) + '.'));
    } else {
      var ch = currentChannel();
      var ic = el('span', 'gc-welcome-icon');
      ic.appendChild(icon('hash', 40));
      w.appendChild(ic);
      w.appendChild(el('h2', 'gc-welcome-title', 'Boas-vindas a #' + (ch ? ch.name : 'canal') + '!'));
      w.appendChild(el('p', 'gc-welcome-text', 'Este é o começo do canal #' + (ch ? ch.name : 'canal') + '.' + (ch && ch.topic ? ' ' + ch.topic : '')));
    }
    return w;
  }

  // ---------------------------------------------------------------- lista
  function renderList() {
    var list = items();
    var m = msgs();
    var order = [];
    var used = new Set();
    var prev = null;
    var prevDate = null;
    var now = Date.now();
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var d = toDate(it.createdAt);
      if (!prev || dayKey(prevDate) !== dayKey(d)) {
        var dk = 'd:' + dayKey(d);
        order.push(cached(dk, function () { return daySep(d); }));
        used.add(dk);
      }
      var divider = m.firstUnreadId != null && same(it.id, m.firstUnreadId) && i > 0;
      if (divider) { order.push(cached('new', newDivider)); used.add('new'); }
      var grouped = !!prev && !divider && dayKey(prevDate) === dayKey(d) && same(prev.authorId, it.authorId) &&
        !it.replyTo && !prev.failed && !it.failed && (d - prevDate) < GROUP_MS && (d - prevDate) >= 0;
      var key = 'm:' + it.id;
      var sig = signature(it, grouped);
      var node = st.nodes.get(key);
      if (!node || node.__sig !== sig) {
        var focused = node && node.contains(document.activeElement) && !(node.querySelector('.gc-edit-input') === document.activeElement);
        var fresh = buildMessage(it, grouped);
        fresh.__sig = sig;
        if (node && node.parentNode) node.parentNode.replaceChild(fresh, node);
        st.nodes.set(key, fresh);
        if (focused) fresh.focus({ preventScroll: true });
        node = fresh;
      }
      used.add(key);
      order.push(node);
      prev = it;
      prevDate = d;
    }
    void now;
    var cur = dom.list.firstChild;
    order.forEach(function (n) {
      if (n === cur) cur = cur.nextSibling;
      else dom.list.insertBefore(n, cur);
    });
    while (cur) { var nx = cur.nextSibling; dom.list.removeChild(cur); cur = nx; }
    st.nodes.forEach(function (_, k) { if (!used.has(k)) st.nodes.delete(k); });
  }
  function cached(key, make) {
    var n = st.nodes.get(key);
    if (!n) { n = make(); st.nodes.set(key, n); }
    return n;
  }
  function daySep(d) {
    var li = el('li', 'gc-day');
    li.setAttribute('role', 'separator');
    li.setAttribute('aria-label', dayLabel(d));
    li.appendChild(el('span', 'gc-day-label', dayLabel(d)));
    return li;
  }
  function newDivider() {
    var li = el('li', 'gc-divider-new');
    li.setAttribute('role', 'separator');
    li.setAttribute('aria-label', 'Mensagens novas a partir daqui');
    li.appendChild(el('span', 'gc-divider-label', 'NOVAS'));
    return li;
  }
  function signature(it, grouped) {
    var p = personOf(it.authorId);
    var replyName = it.replyTo ? nameOf(it.replyTo.authorId) : '';
    return JSON.stringify([
      it.body, it.editedAt, !!it.pending, !!it.failed, !!it.pinned, !!it.mentionsMe, it.reactions, it.attachments,
      it.replyTo, replyName, grouped, nameOf(it.authorId), roleOf(it.authorId),
      p ? [p.user.avatarUrl, p.user.avatarColor] : null, same(st.editingId, it.id), it.createdAt, canPin(), canModerate(), myId()
    ]);
  }

  function buildMessage(it, grouped) {
    var mine = same(it.authorId, myId());
    var li = el('li', 'gc-msg');
    li.dataset.id = String(it.id);
    li.tabIndex = -1;
    if (grouped) li.classList.add('is-grouped');
    if (mine) li.classList.add('is-mine');
    if (it.pending) li.classList.add('is-pending');
    if (it.failed) li.classList.add('is-failed');
    if (it.mentionsMe) li.classList.add('is-mention');
    var d = toDate(it.createdAt);
    var name = nameOf(it.authorId);
    var p = personOf(it.authorId);
    li.setAttribute('aria-label', name + ', ' + headerTime(d) + (it.pinned ? ', fixada' : '') + (it.editedAt ? ', editada' : ''));

    if (it.replyTo) li.appendChild(replyRef(it.replyTo));

    if (!grouped) {
      var ab = el('button', 'gc-avatar-btn');
      ab.type = 'button';
      ab.tabIndex = -1;
      ab.setAttribute('aria-label', 'Perfil de ' + name);
      ab.appendChild(avatarEl(p ? p.user : null, 40));
      ab.addEventListener('click', function () { profile(it.authorId, ab); });
      li.appendChild(ab);

      var head = el('div', 'gc-head');
      var role = roleOf(it.authorId);
      var nb = el('button', 'gc-name' + (role === 'owner' ? ' is-owner' : role === 'admin' ? ' is-admin' : ''));
      nb.type = 'button';
      nb.appendChild(txt(name));
      nb.addEventListener('click', function () { profile(it.authorId, nb); });
      head.appendChild(nb);
      if (role === 'owner') {
        var cr = el('span', 'gc-crown');
        cr.title = 'Dono do servidor';
        cr.appendChild(icon('crown', 14));
        head.appendChild(cr);
      }
      var t = el('time', 'gc-time', headerTime(d));
      t.dateTime = d.toISOString();
      t.title = fullDate(d);
      head.appendChild(t);
      if (it.pinned) {
        var pn = el('span', 'gc-pinned-mark');
        pn.title = 'Mensagem fixada';
        pn.appendChild(icon('pin', 14));
        head.appendChild(pn);
      }
      li.appendChild(head);
    } else {
      var gt = el('time', 'gc-gutter-time', hhmm(d));
      gt.dateTime = d.toISOString();
      gt.title = fullDate(d);
      li.appendChild(gt);
    }

    var content = el('div', 'gc-content');
    if (same(st.editingId, it.id)) {
      content.appendChild(editForm(it));
    } else if (it.body) {
      var body = el('div', 'gc-body');
      if (isJumbo(it.body.trim())) body.classList.add('gc-jumbo');
      body.appendChild(renderMarkdown(it.body));
      if (it.editedAt) {
        var ed = el('span', 'gc-edited', '(editado)');
        ed.title = 'Editada em ' + fullDate(toDate(it.editedAt));
        body.appendChild(txt(' '));
        body.appendChild(ed);
      }
      content.appendChild(body);
    }
    li.appendChild(content);

    if (Array.isArray(it.attachments) && it.attachments.length) li.appendChild(attachmentsEl(it.attachments));
    if (Array.isArray(it.reactions) && it.reactions.length) li.appendChild(reactionsEl(it));

    if (it.failed) {
      var f = el('div', 'gc-failed');
      f.appendChild(el('span', null, 'Não foi possível enviar esta mensagem.'));
      var retry = el('button', 'gc-link-btn', 'Tentar de novo');
      retry.type = 'button';
      retry.addEventListener('click', function () { retryMessage(it); });
      f.appendChild(retry);
      li.appendChild(f);
    }

    if (!it.pending && !it.failed && !same(st.editingId, it.id)) li.appendChild(actionsBar(it, mine));

    li.addEventListener('contextmenu', function (ev) {
      if (ev.target.closest('a.gc-link')) return;
      ev.preventDefault();
      messageMenu(it, ev.clientX, ev.clientY, li);
    });
    return li;
  }

  function replyRef(r) {
    var b = el('button', 'gc-reply-ref');
    b.type = 'button';
    b.tabIndex = -1;
    b.appendChild(el('span', 'gc-reply-spine'));
    if (r.missing) {
      b.appendChild(el('span', 'gc-reply-missing', 'A mensagem original foi apagada.'));
      b.disabled = true;
      return b;
    }
    var p = personOf(r.authorId);
    b.appendChild(avatarEl(p ? p.user : null, 16));
    b.appendChild(el('span', 'gc-reply-name', '@' + nameOf(r.authorId)));
    b.appendChild(el('span', 'gc-reply-body', plainExcerpt(r.body, 120) || 'Clique para ver o anexo'));
    b.setAttribute('aria-label', 'Respondendo a ' + nameOf(r.authorId) + ': ' + plainExcerpt(r.body, 80) + '. Ir para a mensagem original.');
    b.addEventListener('click', function () { jumpTo(r.id); });
    return b;
  }

  function attachmentsEl(list) {
    var box = el('div', 'gc-attachments');
    list.forEach(function (a) {
      var url = typeof a.url === 'string' && /^(https:|data:)/.test(a.url) ? a.url : null;
      if (a.isImage && url) {
        var btn = el('button', 'gc-image');
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Abrir imagem ' + (a.name || ''));
        var img = el('img');
        img.src = url;
        img.alt = a.name || 'Imagem';
        img.loading = 'lazy';
        img.decoding = 'async';
        if (a.width > 0 && a.height > 0) {
          var scale = Math.min(1, 400 / a.width, 300 / a.height);
          img.width = Math.round(a.width * scale);
          img.height = Math.round(a.height * scale);
        }
        img.addEventListener('load', function () { if (st.atBottom) scrollToBottom(false); });
        btn.appendChild(img);
        btn.addEventListener('click', function () { openLightbox(a, url, btn); });
        box.appendChild(btn);
      } else {
        var card = el('div', 'gc-file');
        card.appendChild(icon('file', 32));
        var info = el('div', 'gc-file-info');
        var nm = el('span', 'gc-file-name', a.name || 'arquivo');
        info.appendChild(nm);
        info.appendChild(el('span', 'gc-file-size', fmtSize(a.size)));
        card.appendChild(info);
        if (url && /^https:/.test(url)) {
          var dl = iconButton('ext', 'Baixar ' + (a.name || 'arquivo') + ' no navegador', 'gc-file-dl');
          dl.addEventListener('click', function () { openExternal(url); });
          card.appendChild(dl);
        }
        box.appendChild(card);
      }
    });
    return box;
  }

  function reactionsEl(it) {
    var box = el('div', 'gc-reactions');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Reações');
    it.reactions.forEach(function (r) {
      if (!r || !r.emoji || !(r.count > 0)) return;
      var b = el('button', 'gc-reaction' + (r.me ? ' is-me' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', r.me ? 'true' : 'false');
      b.setAttribute('aria-label', r.emoji + ', ' + r.count + (r.count === 1 ? ' reação' : ' reações') + (r.me ? '. Você reagiu; ative para remover.' : '. Ative para reagir.'));
      b.appendChild(el('span', 'gc-reaction-emoji', r.emoji));
      b.appendChild(el('span', 'gc-reaction-count', String(r.count)));
      b.addEventListener('click', function () { react(it.id, r.emoji); });
      box.appendChild(b);
    });
    var add = el('button', 'gc-reaction gc-reaction-add');
    add.type = 'button';
    add.setAttribute('aria-label', 'Adicionar reação');
    add.title = 'Adicionar reação';
    add.appendChild(icon('smile', 16));
    add.addEventListener('click', function () { openPicker(add, { mode: 'react', id: it.id }); });
    box.appendChild(add);
    return box;
  }

  function actionsBar(it, mine) {
    var bar = el('div', 'gc-actions');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Ações da mensagem');
    var r = iconButton('smile', 'Adicionar reação');
    r.addEventListener('click', function () { openPicker(r, { mode: 'react', id: it.id }); });
    bar.appendChild(r);
    var rp = iconButton('reply', 'Responder');
    rp.addEventListener('click', function () { startReply(it); });
    bar.appendChild(rp);
    if (mine) {
      var ed = iconButton('edit', 'Editar');
      ed.addEventListener('click', function () { startEdit(it.id); });
      bar.appendChild(ed);
    }
    if (mine || canModerate()) {
      var del = iconButton('trash', 'Apagar mensagem (sem confirmar)', 'gc-shift-only gc-danger');
      del.addEventListener('click', function () { deleteMessage(it, true); });
      bar.appendChild(del);
    }
    var mo = iconButton('more', 'Mais opções');
    mo.addEventListener('click', function () {
      var rc = mo.getBoundingClientRect();
      messageMenu(it, rc.left, rc.bottom + 4, mo);
    });
    bar.appendChild(mo);
    return bar;
  }

  // ---------------------------------------------------------------- ações
  function profile(userId, anchor) {
    if (typeof opts.openProfile === 'function') opts.openProfile(userId, anchor);
  }
  function call(name, arg) {
    if (!bridge || typeof bridge[name] !== 'function') return Promise.resolve({ ok: false, error: 'Indisponível.' });
    return Promise.resolve(bridge[name](arg)).then(function (r) {
      if (r && r.ok === false && r.error) showError(r.error);
      return r;
    }).catch(function () {
      showError('Algo deu errado. Tente de novo.');
      return { ok: false };
    });
  }
  function react(id, emoji) {
    pushRecent(emoji);
    call('toggleReaction', { id: id, emoji: emoji });
  }
  function startReply(it) {
    setReply({ id: it.id, authorId: it.authorId });
    focusComposer();
  }
  function setReply(r) {
    if (!st.target) return;
    if (r) st.replies[st.target] = r; else delete st.replies[st.target];
    renderReplyBar();
  }
  function renderReplyBar() {
    var r = st.target ? st.replies[st.target] : null;
    dom.replyBar.hidden = !r;
    dom.replyText.textContent = '';
    if (!r) return;
    dom.replyText.appendChild(txt('Respondendo a '));
    dom.replyText.appendChild(el('strong', null, nameOf(r.authorId)));
  }
  function startEdit(id) {
    var it = findMsg(id);
    if (!it || !same(it.authorId, myId())) return;
    st.editingId = it.id;
    st.editText = decodeBody(it.body);
    update(view);
  }
  function editForm(it) {
    var wrap = el('div', 'gc-edit');
    var ta = el('textarea', 'gc-edit-input');
    ta.value = st.editText;
    ta.rows = 1;
    ta.setAttribute('aria-label', 'Editar mensagem');
    ta.addEventListener('input', function () { st.editText = ta.value; autosizeField(ta); });
    ta.addEventListener('keydown', function (ev) {
      if (st.ac && st.ac.field === ta && acKey(ev)) return;
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); cancelEdit(); }
      else if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); saveEdit(it); }
    });
    ta.addEventListener('input', function () { updateAc(ta); });
    requestAnimationFrame(function () { autosizeField(ta); });
    wrap.appendChild(ta);
    var hint = el('div', 'gc-edit-hint');
    hint.appendChild(txt('Esc para '));
    var c = el('button', 'gc-link-btn', 'cancelar');
    c.type = 'button';
    c.addEventListener('click', cancelEdit);
    hint.appendChild(c);
    hint.appendChild(txt(' • Enter para '));
    var s = el('button', 'gc-link-btn', 'salvar');
    s.type = 'button';
    s.addEventListener('click', function () { saveEdit(it); });
    hint.appendChild(s);
    wrap.appendChild(hint);
    return wrap;
  }
  function cancelEdit() {
    var id = st.editingId;
    st.editingId = null;
    closeAc();
    update(view);
    var n = id != null ? st.nodes.get('m:' + id) : null;
    if (n) n.focus({ preventScroll: true }); else focusComposer();
  }
  function saveEdit(it) {
    var raw = st.editText.trim();
    if (!raw && !(it.attachments && it.attachments.length)) {
      cancelEdit();
      deleteMessage(it, false);
      return;
    }
    var body = encodeBody(raw);
    if (body.length > MAX_BODY) { showError('A mensagem pode ter no máximo ' + MAX_BODY + ' caracteres.'); return; }
    st.editingId = null;
    closeAc();
    update(view);
    focusComposer();
    if (body !== it.body) call('editMessage', { id: it.id, body: body });
  }
  function deleteMessage(it, skipConfirm) {
    var go = function () { call('deleteMessage', it.id); };
    if (skipConfirm) { go(); return; }
    confirmBox({
      title: 'Apagar mensagem',
      body: 'Tem certeza de que quer apagar esta mensagem?' + (it.body ? '\n\n“' + plainExcerpt(it.body, 140) + '”' : ''),
      hint: 'Dica: segure Shift ao clicar em apagar para pular esta confirmação.',
      confirmLabel: 'Apagar',
      danger: true
    }).then(function (yes) { if (yes) go(); });
  }
  function retryMessage(it) {
    if (bridge && typeof bridge.retryMessage === 'function') { call('retryMessage', it.id); return; }
    var payload = { body: it.body || '' };
    if (it.replyTo && it.replyTo.id != null) payload.replyTo = it.replyTo.id;
    call('sendMessage', payload);
  }
  function copyText(s) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(s).catch(function () { showError('Não deu para copiar.'); });
    }
  }

  function messageMenu(it, x, y, returnEl) {
    var mine = same(it.authorId, myId());
    var list = [];
    if (!it.pending && !it.failed) {
      list.push({ label: 'Adicionar reação', action: function () { openPicker(returnEl, { mode: 'react', id: it.id }); } });
      list.push({ label: 'Responder', action: function () { startReply(it); } });
      if (mine) list.push({ label: 'Editar mensagem', action: function () { startEdit(it.id); } });
      if (canPin()) list.push({ label: it.pinned ? 'Desafixar mensagem' : 'Fixar mensagem', action: function () { call('pinMessage', { id: it.id, pinned: !it.pinned }); } });
    }
    if (it.body) list.push({ label: 'Copiar texto', action: function () { copyText(plainCopy(it.body)); } });
    list.push({ label: 'Copiar ID da mensagem', action: function () { copyText(String(it.id)); } });
    if (it.failed) list.push({ label: 'Tentar enviar de novo', action: function () { retryMessage(it); } });
    if (!it.pending && (mine || canModerate())) {
      list.push({ separator: true });
      list.push({ label: 'Apagar mensagem', danger: true, action: function () { deleteMessage(it, st.shift); } });
    }
    contextMenu(list, x, y, returnEl);
  }
  function plainCopy(body) {
    return String(body).replace(MENTION_TOKEN_RE, function (_, id) { return '@' + nameOf(id); });
  }

  // ---------------------------------------------------------------- menu de contexto / confirmação (com reserva própria)
  function contextMenu(list, x, y, returnEl) {
    var fn = opts.openContextMenu || (window.GhostUI && window.GhostUI.openContextMenu);
    if (typeof fn === 'function') { fn(list, x, y, returnEl); return; }
    fallbackMenu(list, x, y, returnEl);
  }
  function fallbackMenu(list, x, y, returnEl) {
    closeFallbackMenu();
    var menu = el('div', 'gc-menu');
    menu.setAttribute('role', 'menu');
    var buttons = [];
    list.forEach(function (itm) {
      if (itm.separator) { menu.appendChild(el('div', 'gc-menu-sep')); return; }
      var b = el('button', 'gc-menu-item' + (itm.danger ? ' is-danger' : ''), itm.label);
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.tabIndex = -1;
      if (itm.disabled) b.disabled = true;
      b.addEventListener('click', function () { closeFallbackMenu(); if (returnEl && returnEl.focus) returnEl.focus({ preventScroll: true }); itm.action(); });
      menu.appendChild(b);
      buttons.push(b);
    });
    document.body.appendChild(menu);
    var r = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
    var idx = 0;
    if (buttons[0]) buttons[0].focus();
    menu.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        idx = (idx + (ev.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[idx].focus();
      } else if (ev.key === 'Escape' || ev.key === 'Tab') {
        ev.preventDefault();
        closeFallbackMenu();
        if (returnEl && returnEl.focus) returnEl.focus();
      }
    });
    st.menu = menu;
    setTimeout(function () { document.addEventListener('mousedown', outsideMenu, true); }, 0);
  }
  function outsideMenu(ev) { if (st.menu && !st.menu.contains(ev.target)) closeFallbackMenu(); }
  function closeFallbackMenu() {
    if (st.menu) { st.menu.remove(); st.menu = null; }
    document.removeEventListener('mousedown', outsideMenu, true);
  }

  function confirmBox(o) {
    if (window.GhostUI && typeof window.GhostUI.confirm === 'function') {
      return Promise.resolve(window.GhostUI.confirm({ title: o.title, body: o.body, confirmLabel: o.confirmLabel, danger: o.danger }));
    }
    return new Promise(function (resolve) {
      var prevFocus = document.activeElement;
      var dlg = el('dialog', 'gc-dialog');
      dlg.setAttribute('aria-labelledby', 'gc-dialog-title');
      var h = el('h2', 'gc-dialog-title', o.title);
      h.id = 'gc-dialog-title';
      dlg.appendChild(h);
      dlg.appendChild(el('p', 'gc-dialog-body', o.body));
      if (o.hint) dlg.appendChild(el('p', 'gc-dialog-hint', o.hint));
      var row = el('div', 'gc-dialog-actions');
      var cancel = el('button', 'gc-btn gc-btn-ghost', 'Cancelar');
      cancel.type = 'button';
      var ok = el('button', 'gc-btn' + (o.danger ? ' gc-btn-danger' : ''), o.confirmLabel || 'Confirmar');
      ok.type = 'button';
      row.appendChild(cancel);
      row.appendChild(ok);
      dlg.appendChild(row);
      document.body.appendChild(dlg);
      var done = function (v) {
        dlg.close();
        dlg.remove();
        if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
        resolve(v);
      };
      cancel.addEventListener('click', function () { done(false); });
      ok.addEventListener('click', function () { done(true); });
      dlg.addEventListener('cancel', function (ev) { ev.preventDefault(); done(false); });
      dlg.showModal();
      ok.focus();
    });
  }

  // ---------------------------------------------------------------- compositor
  function bindComposer() {
    var input = dom.input;
    input.addEventListener('input', function () {
      autosize();
      updateCounter();
      updateAc(input);
      if (input.value.trim() && Date.now() - st.typingSentAt > TYPING_EVERY_MS && bridge && typeof bridge.setTyping === 'function') {
        st.typingSentAt = Date.now();
        Promise.resolve(bridge.setTyping()).catch(function () {});
      }
      if (st.target) st.drafts[st.target] = input.value;
    });
    input.addEventListener('keydown', function (ev) {
      if (st.ac && st.ac.field === input && acKey(ev)) return;
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
        ev.preventDefault();
        send();
      } else if (ev.key === 'ArrowUp' && !input.value && !ev.shiftKey && !ev.altKey && !ev.ctrlKey) {
        var list = items();
        for (var i = list.length - 1; i >= 0; i--) {
          if (same(list[i].authorId, myId()) && !list[i].pending && !list[i].failed) {
            ev.preventDefault();
            startEdit(list[i].id);
            return;
          }
        }
      } else if (ev.key === 'Escape') {
        if (st.target && st.replies[st.target]) { ev.preventDefault(); ev.stopPropagation(); setReply(null); }
      }
    });
    input.addEventListener('blur', function () { setTimeout(function () { if (!dom.ac.contains(document.activeElement)) closeAc(); }, 120); });
    input.addEventListener('paste', function (ev) {
      var files = ev.clipboardData && ev.clipboardData.files ? Array.from(ev.clipboardData.files) : [];
      if (files.length) { ev.preventDefault(); addFiles(files); }
    });
    dom.form.addEventListener('submit', function (ev) { ev.preventDefault(); send(); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Shift') setShift(true); });
    document.addEventListener('keyup', function (ev) { if (ev.key === 'Shift') setShift(false); });
    window.addEventListener('blur', function () { setShift(false); });
    window.addEventListener('focus', function () { maybeMarkRead(); });
    document.addEventListener('visibilitychange', function () { maybeMarkRead(); });
  }
  function setShift(on) {
    if (st.shift === on) return;
    st.shift = on;
    if (dom.wrap) dom.wrap.classList.toggle('is-shift', on);
  }
  function autosize() { autosizeField(dom.input); }
  function autosizeField(ta) {
    ta.style.height = 'auto';
    var max = Math.round(window.innerHeight * 0.45);
    ta.style.height = Math.min(ta.scrollHeight, max) + 'px';
    ta.style.overflowY = ta.scrollHeight > max ? 'auto' : 'hidden';
  }
  function updateCounter() {
    var left = MAX_BODY - dom.input.value.length;
    dom.counter.hidden = left > 200;
    dom.counter.textContent = String(left);
    dom.counter.classList.toggle('is-over', left < 0);
    dom.counter.setAttribute('aria-label', left < 0 ? (-left) + ' caracteres acima do limite' : left + ' caracteres restantes');
  }
  function send() {
    if (!st.target) return;
    var raw = dom.input.value;
    var trimmed = raw.trim();
    var files = st.files[st.target] || [];
    if (!trimmed && !files.length) return;
    var body = encodeBody(trimmed);
    if (body.length > MAX_BODY) { showError('A mensagem pode ter no máximo ' + MAX_BODY + ' caracteres.'); return; }
    var reply = st.replies[st.target];
    var payload = { body: body };
    if (reply) payload.replyTo = reply.id;
    var target = st.target;
    var go = function (attachments) {
      if (attachments) payload.attachments = attachments;
      if (st.target === target) {
        dom.input.value = '';
        st.drafts[target] = '';
        autosize();
        updateCounter();
      }
      delete st.replies[target];
      delete st.files[target];
      renderReplyBar();
      renderTray();
      closeAc();
      st.atBottom = true;
      clearError();
      return call('sendMessage', payload).then(function (r) {
        if (r && r.ok === false && st.target === target && !dom.input.value) {
          dom.input.value = raw;
          st.drafts[target] = raw;
          autosize();
        }
      });
    };
    if (!files.length) { go(null); return; }
    Promise.all(files.map(function (f) {
      return f.file.arrayBuffer().then(function (data) {
        return { name: f.file.name || 'arquivo', mime: f.file.type || 'application/octet-stream', data: data };
      });
    })).then(go).catch(function () { showError('Não deu para ler o arquivo.'); });
  }

  // ---------------------------------------------------------------- anexos
  function addFiles(list) {
    if (!st.target || !list.length) return;
    var cur = st.files[st.target] || (st.files[st.target] = []);
    var problems = [];
    list.forEach(function (file) {
      if (cur.length >= MAX_FILES) { problems.push('Você pode enviar até ' + MAX_FILES + ' arquivos por mensagem.'); return; }
      if (file.size > MAX_BYTES) { problems.push('“' + file.name + '” passa de 8 MB.'); return; }
      if (file.size === 0) { problems.push('“' + file.name + '” está vazio.'); return; }
      var entry = { file: file, preview: null, id: Math.random().toString(36).slice(2) };
      cur.push(entry);
      if (/^image\/(png|jpe?g|gif|webp)$/.test(file.type)) {
        var fr = new FileReader();
        fr.onload = function () { entry.preview = typeof fr.result === 'string' ? fr.result : null; renderTray(); };
        fr.readAsDataURL(file);
      }
    });
    if (problems.length) showError(problems.filter(function (p, i, a) { return a.indexOf(p) === i; }).join(' '));
    renderTray();
    focusComposer();
  }
  function renderTray() {
    var cur = st.target ? (st.files[st.target] || []) : [];
    dom.tray.textContent = '';
    dom.tray.hidden = !cur.length;
    cur.forEach(function (entry) {
      var li = el('li', 'gc-tray-item');
      if (entry.preview) {
        var img = el('img', 'gc-tray-thumb');
        img.src = entry.preview;
        img.alt = '';
        li.appendChild(img);
      } else {
        var ic = el('span', 'gc-tray-icon');
        ic.appendChild(icon('file', 40));
        li.appendChild(ic);
      }
      li.appendChild(el('span', 'gc-tray-name', entry.file.name));
      li.appendChild(el('span', 'gc-tray-size', fmtSize(entry.file.size)));
      var rm = iconButton('trash', 'Remover ' + entry.file.name, 'gc-tray-remove gc-danger');
      rm.addEventListener('click', function () {
        var arr = st.files[st.target] || [];
        st.files[st.target] = arr.filter(function (e) { return e !== entry; });
        renderTray();
        focusComposer();
      });
      li.appendChild(rm);
      dom.tray.appendChild(li);
    });
  }
  function bindDrop() {
    var hasFiles = function (ev) {
      var t = ev.dataTransfer && ev.dataTransfer.types;
      return t && Array.prototype.indexOf.call(t, 'Files') !== -1;
    };
    dom.main.addEventListener('dragenter', function (ev) {
      if (!hasFiles(ev) || !st.target) return;
      ev.preventDefault();
      st.dragDepth++;
      dom.dropText.textContent = 'Os arquivos vão para ' + targetLabel() + '.';
      dom.drop.hidden = false;
    });
    dom.main.addEventListener('dragover', function (ev) { if (hasFiles(ev)) ev.preventDefault(); });
    dom.main.addEventListener('dragleave', function () {
      st.dragDepth = Math.max(0, st.dragDepth - 1);
      if (!st.dragDepth) dom.drop.hidden = true;
    });
    dom.main.addEventListener('drop', function (ev) {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      st.dragDepth = 0;
      dom.drop.hidden = true;
      addFiles(Array.from(ev.dataTransfer.files || []));
    });
  }

  // ---------------------------------------------------------------- autocompletar (@ e :)
  function updateAc(field) {
    var pos = field.selectionStart;
    if (pos !== field.selectionEnd) { closeAc(); return; }
    var before = field.value.slice(0, pos);
    var m = /(^|[\s(])@([A-Za-z0-9_.]{0,32})$/.exec(before);
    var results = [];
    var kind = null;
    var query = '';
    if (m) {
      kind = 'user';
      query = m[2].toLowerCase();
      results = mentionables().filter(function (p) {
        return !query || (p.username && p.username.toLowerCase().indexOf(query) === 0) ||
          (p.name && p.name.toLowerCase().split(/\s+/).some(function (w) { return w.indexOf(query) === 0; }));
      }).slice(0, 8);
    } else {
      var e = /(^|\s):([a-z0-9_]{2,32})$/i.exec(before);
      if (e && window.GhostEmoji) {
        kind = 'emoji';
        query = e[2];
        results = window.GhostEmoji.search(query, 8);
      }
    }
    if (!kind || !results.length) { closeAc(); return; }
    st.ac = { field: field, kind: kind, query: query, results: results, index: 0, start: pos - query.length - 1 };
    renderAc();
  }
  function renderAc() {
    var ac = st.ac;
    dom.ac.textContent = '';
    dom.ac.appendChild(el('li', 'gc-ac-head', ac.kind === 'user' ? 'Membros' : 'Emojis que combinam com :' + ac.query));
    dom.ac.firstChild.setAttribute('role', 'presentation');
    ac.results.forEach(function (r, i) {
      var li = el('li', 'gc-ac-item' + (i === ac.index ? ' is-active' : ''));
      li.id = 'gc-ac-' + i;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', i === ac.index ? 'true' : 'false');
      if (ac.kind === 'user') {
        li.appendChild(avatarEl(r.user, 24));
        li.appendChild(el('span', 'gc-ac-name', r.name));
        if (r.username) li.appendChild(el('span', 'gc-ac-sub', '@' + r.username));
      } else {
        li.appendChild(el('span', 'gc-ac-emoji', r.emoji));
        li.appendChild(el('span', 'gc-ac-name', ':' + r.name + ':'));
      }
      li.addEventListener('mousedown', function (ev) { ev.preventDefault(); ac.index = i; chooseAc(); });
      dom.ac.appendChild(li);
    });
    var field = ac.field;
    if (field !== dom.input) {
      var r = field.getBoundingClientRect();
      var br = dom.bottom.getBoundingClientRect();
      dom.ac.style.bottom = Math.max(0, br.bottom - r.top + 6) + 'px';
    } else {
      dom.ac.style.bottom = '';
    }
    dom.ac.hidden = false;
    field.setAttribute('aria-expanded', 'true');
    field.setAttribute('aria-controls', 'gc-ac');
    field.setAttribute('aria-activedescendant', 'gc-ac-' + ac.index);
  }
  function acKey(ev) {
    var ac = st.ac;
    if (!ac || dom.ac.hidden) return false;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      ac.index = (ac.index + (ev.key === 'ArrowDown' ? 1 : -1) + ac.results.length) % ac.results.length;
      renderAc();
      return true;
    }
    if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); chooseAc(); return true; }
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeAc(); return true; }
    return false;
  }
  function chooseAc() {
    var ac = st.ac;
    if (!ac) return;
    var r = ac.results[ac.index];
    var field = ac.field;
    var insert = ac.kind === 'user' ? '@' + (r.username || r.name) + ' ' : r.emoji + ' ';
    if (ac.kind === 'emoji') pushRecent(r.emoji);
    var pos = field.selectionStart;
    field.value = field.value.slice(0, ac.start) + insert + field.value.slice(pos);
    var c = ac.start + insert.length;
    field.setSelectionRange(c, c);
    closeAc();
    field.dispatchEvent(new Event('input'));
    field.focus();
  }
  function closeAc() {
    if (st.ac && st.ac.field) {
      st.ac.field.setAttribute('aria-expanded', 'false');
      st.ac.field.removeAttribute('aria-activedescendant');
    }
    st.ac = null;
    if (dom.ac) { dom.ac.hidden = true; dom.ac.textContent = ''; }
  }

  // ---------------------------------------------------------------- seletor de emoji
  function pushRecent(emoji) {
    st.recent = [emoji].concat(st.recent.filter(function (e) { return e !== emoji; })).slice(0, 24);
  }
  function openPicker(anchor, mode) {
    if (!window.GhostEmoji) return;
    if (st.picker && st.picker.anchor === anchor) { closePicker(); return; }
    closePicker();
    var pk = el('div', 'gc-picker');
    pk.setAttribute('role', 'dialog');
    pk.setAttribute('aria-label', mode.mode === 'react' ? 'Escolher reação' : 'Escolher emoji');
    var head = el('div', 'gc-picker-head');
    var search = el('input', 'gc-picker-search');
    search.type = 'search';
    search.placeholder = 'Procurar emoji';
    search.setAttribute('aria-label', 'Procurar emoji');
    head.appendChild(search);
    pk.appendChild(head);

    var body = el('div', 'gc-picker-body');
    var cats = el('nav', 'gc-picker-cats');
    cats.setAttribute('aria-label', 'Categorias');
    var scroll = el('div', 'gc-picker-scroll');
    body.appendChild(cats);
    body.appendChild(scroll);
    pk.appendChild(body);

    var foot = el('div', 'gc-picker-foot');
    var fe = el('span', 'gc-picker-foot-emoji', '👻');
    var fn = el('span', 'gc-picker-foot-name', 'Escolha um emoji');
    foot.appendChild(fe);
    foot.appendChild(fn);
    pk.appendChild(foot);

    var sections = [];
    function emojiBtn(e) {
      var b = el('button', 'gc-picker-emoji', e.emoji);
      b.type = 'button';
      b.setAttribute('aria-label', ':' + e.name + ':');
      b.title = ':' + e.name + ':';
      b.tabIndex = -1;
      b.addEventListener('mouseenter', function () { fe.textContent = e.emoji; fn.textContent = ':' + e.name + ':'; });
      b.addEventListener('focus', function () { fe.textContent = e.emoji; fn.textContent = ':' + e.name + ':'; });
      b.addEventListener('click', function (ev) { choose(e.emoji, ev.shiftKey); });
      return b;
    }
    function section(id, label, list) {
      var sec = el('section', 'gc-picker-sec');
      sec.dataset.cat = id;
      var h = el('h3', 'gc-picker-sec-title', label);
      h.id = 'gc-pk-' + id;
      sec.setAttribute('aria-labelledby', h.id);
      sec.appendChild(h);
      var grid = el('div', 'gc-picker-grid');
      list.forEach(function (e) { grid.appendChild(emojiBtn(e)); });
      sec.appendChild(grid);
      return sec;
    }
    function fill(q) {
      scroll.textContent = '';
      sections = [];
      if (q) {
        var res = window.GhostEmoji.search(q, 120);
        if (!res.length) scroll.appendChild(el('p', 'gc-picker-empty', 'Nenhum emoji encontrado.'));
        else scroll.appendChild(section('busca', 'Resultados', res));
        return;
      }
      if (st.recent.length) {
        var rec = st.recent.map(function (em) {
          var hit = window.GhostEmoji.all.filter(function (x) { return x.emoji === em; })[0];
          return hit || { emoji: em, name: 'emoji' };
        });
        var s0 = section('recentes', 'Usados recentemente', rec);
        scroll.appendChild(s0);
        sections.push(s0);
      }
      window.GhostEmoji.categories.forEach(function (c) {
        var s = section(c.id, c.label, c.items.map(function (it) { return { emoji: it[0], name: it[1].split(' ')[0] }; }));
        scroll.appendChild(s);
        sections.push(s);
      });
    }
    var catList = (st.recent.length ? [{ id: 'recentes', label: 'Usados recentemente', icon: '🕘' }] : []).concat(window.GhostEmoji.categories);
    catList.forEach(function (c) {
      var b = el('button', 'gc-picker-cat', c.icon);
      b.type = 'button';
      b.setAttribute('aria-label', c.label);
      b.title = c.label;
      b.addEventListener('click', function () {
        search.value = '';
        fill('');
        var sec = scroll.querySelector('[data-cat="' + c.id + '"]');
        if (sec) scroll.scrollTop = sec.offsetTop - scroll.offsetTop;
      });
      cats.appendChild(b);
    });
    fill('');
    search.addEventListener('input', function () { fill(search.value.trim()); });
    search.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown' || ev.key === 'Enter') {
        var first = scroll.querySelector('.gc-picker-emoji');
        if (first) {
          ev.preventDefault();
          if (ev.key === 'Enter') first.click(); else first.focus();
        }
      }
    });
    scroll.addEventListener('keydown', function (ev) {
      var all = Array.from(scroll.querySelectorAll('.gc-picker-emoji'));
      var i = all.indexOf(document.activeElement);
      if (i === -1) return;
      var step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 8, ArrowUp: -8 }[ev.key];
      if (step) {
        ev.preventDefault();
        var j = i + step;
        if (j < 0) { search.focus(); return; }
        if (all[Math.min(j, all.length - 1)]) all[Math.min(j, all.length - 1)].focus();
      }
    });
    pk.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closePicker(true); }
    });

    function choose(emoji, keepOpen) {
      pushRecent(emoji);
      if (mode.mode === 'react') {
        call('toggleReaction', { id: mode.id, emoji: emoji });
        closePicker(true);
        return;
      }
      var f = mode.field && mode.field.isConnected ? mode.field : dom.input;
      var s = f.selectionStart != null ? f.selectionStart : f.value.length;
      var e2 = f.selectionEnd != null ? f.selectionEnd : s;
      f.value = f.value.slice(0, s) + emoji + f.value.slice(e2);
      var c = s + emoji.length;
      f.setSelectionRange(c, c);
      f.dispatchEvent(new Event('input'));
      if (!keepOpen) { closePicker(false); f.focus(); }
    }

    document.body.appendChild(pk);
    var ar = anchor.getBoundingClientRect();
    var pr = pk.getBoundingClientRect();
    var left = Math.min(Math.max(8, ar.right - pr.width), window.innerWidth - pr.width - 8);
    var top = ar.top - pr.height - 8;
    if (top < 8) top = Math.min(ar.bottom + 8, window.innerHeight - pr.height - 8);
    pk.style.left = left + 'px';
    pk.style.top = Math.max(8, top) + 'px';
    st.picker = { el: pk, anchor: anchor };
    search.focus();
    setTimeout(function () { document.addEventListener('mousedown', outsidePicker, true); }, 0);
  }
  function outsidePicker(ev) {
    if (st.picker && !st.picker.el.contains(ev.target) && !st.picker.anchor.contains(ev.target)) closePicker(false);
  }
  function closePicker(returnFocus) {
    document.removeEventListener('mousedown', outsidePicker, true);
    if (!st.picker) return;
    var a = st.picker.anchor;
    st.picker.el.remove();
    st.picker = null;
    if (returnFocus && a && a.isConnected) a.focus();
  }

  // ---------------------------------------------------------------- lightbox
  function openLightbox(a, url, returnEl) {
    var box = el('div', 'gc-lightbox');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Imagem: ' + (a.name || 'anexo'));
    var fig = el('figure', 'gc-lightbox-fig');
    var img = el('img', 'gc-lightbox-img');
    img.src = url;
    img.alt = a.name || 'Imagem';
    fig.appendChild(img);
    var cap = el('figcaption', 'gc-lightbox-cap');
    cap.appendChild(el('span', null, (a.name || 'imagem') + (a.size ? ' · ' + fmtSize(a.size) : '')));
    if (/^https:/.test(url)) {
      var open = el('button', 'gc-link-btn', 'Abrir no navegador');
      open.type = 'button';
      open.addEventListener('click', function () { openExternal(url); });
      cap.appendChild(open);
    }
    fig.appendChild(cap);
    box.appendChild(fig);
    var close = iconButton('close', 'Fechar imagem', 'gc-lightbox-close');
    box.appendChild(close);
    function done() {
      box.remove();
      document.removeEventListener('keydown', onKey, true);
      if (returnEl && returnEl.isConnected) returnEl.focus();
    }
    function onKey(ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); done(); }
      else if (ev.key === 'Tab') { ev.preventDefault(); close.focus(); }
    }
    close.addEventListener('click', done);
    box.addEventListener('click', function (ev) { if (ev.target === box || ev.target === fig) done(); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(box);
    close.focus();
  }

  // ---------------------------------------------------------------- painel (fixadas / busca)
  function togglePinned(anchorEl) {
    if (st.panel && st.panel.kind === 'pinned') { closePanel(); if (anchorEl) anchorEl.focus(); return; }
    openPanel('pinned', anchorEl);
  }
  function openSearch(query) {
    openPanel('search', null, query);
  }
  function openPanel(kind, anchorEl, query) {
    st.panel = { kind: kind, target: st.target, anchor: anchorEl || null, results: null, query: query || '', status: 'idle' };
    dom.panel.hidden = false;
    dom.wrap.classList.add('has-panel');
    renderPanel();
    if (kind === 'pinned') loadPinned();
    else if (query) runSearch(query);
    var focusEl = dom.panel.querySelector(kind === 'search' ? '.gc-panel-search' : '.gc-panel-close');
    if (focusEl) focusEl.focus();
  }
  function closePanel() {
    st.panel = null;
    dom.panel.hidden = true;
    dom.panel.textContent = '';
    dom.wrap.classList.remove('has-panel');
  }
  var pinnedTimer = null;
  function refreshPinnedSoon() {
    clearTimeout(pinnedTimer);
    pinnedTimer = setTimeout(function () {
      if (st.panel && st.panel.kind === 'pinned') {
        var count = items().filter(function (i) { return i.pinned; }).length;
        if (count !== st.panel.lastPinnedCount) loadPinned();
      }
    }, 300);
  }
  function loadPinned() {
    var p = st.panel;
    p.status = 'loading';
    p.lastPinnedCount = items().filter(function (i) { return i.pinned; }).length;
    renderPanel();
    call('listPinned').then(function (r) {
      if (st.panel !== p) return;
      p.status = r && r.ok ? 'ready' : 'error';
      p.results = r && Array.isArray(r.items) ? r.items : [];
      renderPanel();
    });
  }
  function runSearch(q) {
    var p = st.panel;
    p.query = q;
    if (q.trim().length < 2) { p.status = 'idle'; p.results = null; renderPanel(); return; }
    p.status = 'loading';
    renderPanel();
    call('searchMessages', q.trim()).then(function (r) {
      if (st.panel !== p || p.query !== q) return;
      p.status = r && r.ok ? 'ready' : 'error';
      p.results = r && Array.isArray(r.items) ? r.items : [];
      renderPanel();
    });
  }
  function renderPanel() {
    var p = st.panel;
    if (!p) return;
    var keepSearch = dom.panel.querySelector('.gc-panel-search');
    var hadFocus = keepSearch && document.activeElement === keepSearch;
    var caret = hadFocus ? keepSearch.selectionStart : null;
    dom.panel.textContent = '';
    dom.panel.setAttribute('aria-label', p.kind === 'pinned' ? 'Mensagens fixadas' : 'Buscar mensagens');
    var head = el('div', 'gc-panel-head');
    var h = el('h2', 'gc-panel-title');
    h.appendChild(icon(p.kind === 'pinned' ? 'pin' : 'search', 18));
    h.appendChild(txt(p.kind === 'pinned' ? 'Mensagens fixadas' : 'Buscar em ' + targetLabel()));
    head.appendChild(h);
    var cl = iconButton('close', 'Fechar painel', 'gc-panel-close');
    cl.addEventListener('click', function () {
      var a = st.panel && st.panel.anchor;
      closePanel();
      if (a && a.isConnected) a.focus(); else focusComposer();
    });
    head.appendChild(cl);
    dom.panel.appendChild(head);
    if (p.kind === 'search') {
      var form = el('form', 'gc-panel-form');
      form.setAttribute('role', 'search');
      var inp = el('input', 'gc-panel-search');
      inp.type = 'search';
      inp.placeholder = 'Buscar mensagens';
      inp.setAttribute('aria-label', 'Buscar mensagens em ' + targetLabel());
      inp.value = p.query;
      form.appendChild(inp);
      form.addEventListener('submit', function (ev) { ev.preventDefault(); runSearch(inp.value); });
      dom.panel.appendChild(form);
      if (hadFocus) { inp.focus(); if (caret != null) inp.setSelectionRange(caret, caret); }
    }
    var body = el('div', 'gc-panel-body');
    body.setAttribute('aria-live', 'polite');
    if (p.status === 'loading') body.appendChild(el('p', 'gc-panel-note', 'Carregando…'));
    else if (p.status === 'error') body.appendChild(el('p', 'gc-panel-note', 'Não deu para carregar. Tente de novo.'));
    else if (p.results === null) body.appendChild(el('p', 'gc-panel-note', p.kind === 'search' ? 'Digite pelo menos 2 letras e aperte Enter.' : 'Carregando…'));
    else if (!p.results.length) {
      body.appendChild(el('p', 'gc-panel-note', p.kind === 'pinned'
        ? 'Nenhuma mensagem fixada ainda. Use o menu da mensagem para fixar algo importante.'
        : 'Nenhum resultado para “' + p.query + '”.'));
    } else {
      if (p.kind === 'search') body.appendChild(el('p', 'gc-panel-count', p.results.length + (p.results.length === 1 ? ' resultado' : ' resultados')));
      var ul = el('ul', 'gc-panel-list');
      p.results.forEach(function (it) { ul.appendChild(panelCard(it, p.kind)); });
      body.appendChild(ul);
    }
    dom.panel.appendChild(body);
  }
  function panelCard(it, kind) {
    var li = el('li', 'gc-card');
    var p = personOf(it.authorId);
    var d = toDate(it.createdAt);
    var head = el('div', 'gc-card-head');
    head.appendChild(avatarEl(p ? p.user : null, 24));
    head.appendChild(el('span', 'gc-card-name', nameOf(it.authorId)));
    var t = el('time', 'gc-time', headerTime(d));
    t.dateTime = d.toISOString();
    t.title = fullDate(d);
    head.appendChild(t);
    li.appendChild(head);
    if (it.body) {
      var b = el('div', 'gc-body gc-card-body');
      b.appendChild(renderMarkdown(it.body));
      li.appendChild(b);
    }
    if (Array.isArray(it.attachments) && it.attachments.length) {
      li.appendChild(el('p', 'gc-card-files', it.attachments.map(function (a) { return '📎 ' + (a.name || 'arquivo'); }).join('  ')));
    }
    var row = el('div', 'gc-card-actions');
    var go = el('button', 'gc-btn gc-btn-small', 'Ir até a mensagem');
    go.type = 'button';
    go.addEventListener('click', function () {
      if (!jumpTo(it.id)) note.textContent = 'Essa mensagem é antiga. Role o chat para cima para carregá-la.';
    });
    row.appendChild(go);
    if (kind === 'pinned' && canPin()) {
      var un = el('button', 'gc-btn gc-btn-small gc-btn-ghost', 'Desafixar');
      un.type = 'button';
      un.addEventListener('click', function () { call('pinMessage', { id: it.id, pinned: false }).then(function () { loadPinned(); }); });
      row.appendChild(un);
    }
    li.appendChild(row);
    var note = el('p', 'gc-card-note');
    note.setAttribute('aria-live', 'polite');
    li.appendChild(note);
    return li;
  }

  // ---------------------------------------------------------------- rolagem, digitando, lidas
  function bindScroll() {
    dom.scroll.addEventListener('scroll', onScroll, { passive: true });
  }
  function onScroll() {
    var sc = dom.scroll;
    var dist = sc.scrollHeight - sc.scrollTop - sc.clientHeight;
    st.atBottom = dist < 48;
    syncJump();
    var m = msgs();
    if (m && m.hasMore && !st.loadingOlder && m.status === 'ready' && sc.scrollTop < 240 && items().length) {
      st.loadingOlder = true;
      renderTop();
      Promise.resolve(bridge && bridge.loadOlder ? bridge.loadOlder() : null).then(function (r) {
        if (r && r.ok === false && r.error) showError(r.error);
      }).catch(function () {}).then(function () {
        st.loadingOlder = false;
        if (msgs()) renderTop();
      });
    }
    maybeMarkRead();
  }
  function syncJump() {
    var sc = dom.scroll;
    var dist = sc.scrollHeight - sc.scrollTop - sc.clientHeight;
    dom.jump.hidden = dist < sc.clientHeight * 1.5;
  }
  function scrollToBottom(smooth) {
    var sc = dom.scroll;
    if (smooth && !reducedMotion() && sc.scrollTo) sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
    else sc.scrollTop = sc.scrollHeight;
    st.atBottom = true;
    syncJump();
  }
  function firstVisible() {
    var top = dom.scroll.getBoundingClientRect().top;
    var all = dom.list.querySelectorAll('.gc-msg');
    for (var i = 0; i < all.length; i++) {
      var r = all[i].getBoundingClientRect();
      if (r.bottom > top) return { id: all[i].dataset.id, top: r.top };
    }
    return null;
  }
  function jumpTo(id) {
    var n = st.nodes.get('m:' + id);
    if (!n || !n.isConnected) return false;
    n.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    n.classList.remove('is-flash');
    void n.offsetWidth;
    n.classList.add('is-flash');
    n.focus({ preventScroll: true });
    setTimeout(function () { n.classList.remove('is-flash'); }, 2000);
    return true;
  }
  function renderTyping() {
    var m = msgs();
    var ids = (m && Array.isArray(m.typing) ? m.typing : []).filter(function (id) { return !same(id, myId()); });
    dom.typing.textContent = '';
    if (!ids.length) { dom.typing.classList.remove('is-on'); return; }
    dom.typing.classList.add('is-on');
    var dots = el('span', 'gc-typing-dots');
    dots.setAttribute('aria-hidden', 'true');
    dots.appendChild(el('i'));
    dots.appendChild(el('i'));
    dots.appendChild(el('i'));
    dom.typing.appendChild(dots);
    var text = el('span');
    if (ids.length > 3) text.appendChild(txt('Várias pessoas estão digitando…'));
    else {
      ids.forEach(function (id, i) {
        if (i > 0) text.appendChild(txt(i === ids.length - 1 ? ' e ' : ', '));
        text.appendChild(el('strong', null, nameOf(id)));
      });
      text.appendChild(txt(ids.length === 1 ? ' está digitando…' : ' estão digitando…'));
    }
    dom.typing.appendChild(text);
  }
  function maybeMarkRead() {
    var m = msgs();
    if (!m || m.status !== 'ready' || !st.atBottom || document.hidden || !document.hasFocus()) return;
    var list = items();
    if (!list.length) return;
    var key = st.target + ':' + list[list.length - 1].id;
    if (st.lastMarked === key) return;
    clearTimeout(st.markTimer);
    st.markTimer = setTimeout(function () {
      if (st.lastMarked === key) return;
      st.lastMarked = key;
      if (bridge && typeof bridge.markRead === 'function') Promise.resolve(bridge.markRead()).catch(function () {});
    }, 400);
  }

  // ---------------------------------------------------------------- teclado nas mensagens
  function bindListKeys() {
    dom.scroll.addEventListener('keydown', function (ev) {
      var t = ev.target;
      var isInput = t.closest && t.closest('textarea, input');
      if (isInput) return;
      var msgEl = t.closest ? t.closest('.gc-msg') : null;
      var all = Array.from(dom.list.querySelectorAll('.gc-msg'));
      if (!all.length) return;
      if (t === dom.scroll && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
        ev.preventDefault();
        var vis = firstVisible();
        var start = ev.key === 'ArrowUp' ? all[all.length - 1] : (vis ? dom.list.querySelector('.gc-msg[data-id="' + cssEsc(vis.id) + '"]') : all[0]);
        if (st.atBottom && ev.key === 'ArrowUp') start = all[all.length - 1];
        if (start) start.focus();
        return;
      }
      if (!msgEl || t !== msgEl) {
        if (msgEl && (ev.key === 'ContextMenu' || (ev.key === 'F10' && ev.shiftKey))) { /* deixa abrir pelo item */ }
        return;
      }
      var i = all.indexOf(msgEl);
      var go = null;
      if (ev.key === 'ArrowUp') go = all[Math.max(0, i - 1)];
      else if (ev.key === 'ArrowDown') go = all[Math.min(all.length - 1, i + 1)];
      else if (ev.key === 'Home') go = all[0];
      else if (ev.key === 'End') go = all[all.length - 1];
      else if (ev.key === 'Escape') { ev.preventDefault(); focusComposer(); return; }
      else if (ev.key === 'ContextMenu' || (ev.key === 'F10' && ev.shiftKey)) {
        ev.preventDefault();
        var it = findMsg(msgEl.dataset.id);
        var r = msgEl.getBoundingClientRect();
        if (it) messageMenu(it, r.left + 60, r.top + 20, msgEl);
        return;
      }
      if (go) { ev.preventDefault(); go.focus(); go.scrollIntoView({ block: 'nearest' }); }
    });
  }
  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(String(s)) : String(s).replace(/"/g, '\\"'); }

  // ---------------------------------------------------------------- erros
  function showError(text) {
    if (!dom.error) return;
    dom.error.textContent = text;
    dom.error.hidden = false;
    clearTimeout(st.errorTimer);
    st.errorTimer = setTimeout(clearError, 8000);
  }
  function clearError() {
    if (!dom.error) return;
    dom.error.hidden = true;
    dom.error.textContent = '';
  }

  function focusComposer() {
    if (dom.input && !dom.wrap.hidden) dom.input.focus();
  }

  // ---------------------------------------------------------------- API
  function init(o) {
    opts = o || {};
    bridge = opts.bridge || null;
    root = opts.root || null;
    if (!root) return;
    build();
    var v = typeof opts.getView === 'function' ? opts.getView() : null;
    if (v) update(v);
  }

  window.GhostChat = Object.freeze({
    init: init,
    update: update,
    focusComposer: focusComposer,
    togglePinned: togglePinned,
    openSearch: openSearch,
    isPanelOpen: function () { return !!st.panel; }
  });
})();
