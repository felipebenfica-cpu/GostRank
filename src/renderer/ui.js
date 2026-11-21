/* LUMENEX - GhostUI: utilidades de interface compartilhadas (ícones, avatares, menus de contexto,
   confirmação, aviso rápido). Script clássico, sem innerHTML. Carregado antes de chat.js, settings.js,
   voice.js, shell.js e app.js. O cartão de perfil (openProfile) é registrado pelo shell.js. */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var GHOST_PATH = 'M6.5 3.5h4.6v12.2h8.2l-2.4 4.8H6.5z'; // ícone 'mark' = L do LUMENEX

  // Cada ícone: lista de [tag, atributos]. Traço herdado de .btn-icon / .channel-icon.
  var ICONS = {
    on_track: [['polyline', { points: '3 17 9 11 13 15 21 7' }], ['polyline', { points: '15 7 21 7 21 13' }]],
    unreachable: [['path', { d: 'M12 3 2.5 20h19L12 3z' }], ['line', { x1: 12, y1: 10, x2: 12, y2: 14.5 }], ['line', { x1: 12, y1: 17.4, x2: 12, y2: 17.5 }]],
    insufficient_data: [['circle', { cx: 12, cy: 12, r: 9 }], ['line', { x1: 12, y1: 11, x2: 12, y2: 16 }], ['line', { x1: 12, y1: 7.9, x2: 12, y2: 8 }]],
    goal_reached: [['circle', { cx: 12, cy: 12, r: 9 }], ['polyline', { points: '8 12.5 11 15.5 16 9.5' }]],
    hidden: [['path', { d: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z' }], ['circle', { cx: 12, cy: 12, r: 3 }], ['line', { x1: 4, y1: 4, x2: 20, y2: 20 }]],
    crown: [['path', { d: 'M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z' }]],
    shield: [['path', { d: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z' }]],
    micOff: [['path', { d: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z' }], ['path', { d: 'M5 11a7 7 0 0 0 14 0' }], ['line', { x1: 12, y1: 18, x2: 12, y2: 21 }], ['line', { x1: 3, y1: 3, x2: 21, y2: 21 }]],
    deafened: [['path', { d: 'M3 14v-2a9 9 0 0 1 18 0v2' }], ['path', { d: 'M3 14h3v6H4a1 1 0 0 1-1-1v-5z' }], ['path', { d: 'M18 14h3v5a1 1 0 0 1-1 1h-2v-6z' }], ['line', { x1: 3, y1: 3, x2: 21, y2: 21 }]],
    hash: [['line', { x1: 4, y1: 9, x2: 20, y2: 9 }], ['line', { x1: 4, y1: 15, x2: 20, y2: 15 }], ['line', { x1: 10, y1: 3, x2: 8, y2: 21 }], ['line', { x1: 16, y1: 3, x2: 14, y2: 21 }]],
    speaker: [['path', { d: 'M11 5 6 9H3v6h3l5 4V5z' }], ['path', { d: 'M15.5 8.5a5 5 0 0 1 0 7' }], ['path', { d: 'M18.5 5.5a9 9 0 0 1 0 13' }]],
    friends: [['circle', { cx: 9, cy: 8, r: 3.5 }], ['path', { d: 'M2.5 20v-1a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v1' }], ['path', { d: 'M16 4.5a3.5 3.5 0 0 1 0 7' }], ['path', { d: 'M21.5 20v-1a5 5 0 0 0-3.5-4.8' }]],
    userPlus: [['circle', { cx: 9, cy: 8, r: 3.5 }], ['path', { d: 'M2.5 20v-1a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v1' }], ['line', { x1: 19, y1: 8, x2: 19, y2: 14 }], ['line', { x1: 16, y1: 11, x2: 22, y2: 11 }]],
    at: [['circle', { cx: 12, cy: 12, r: 4 }], ['path', { d: 'M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8' }]],
    plus: [['line', { x1: 12, y1: 5, x2: 12, y2: 19 }], ['line', { x1: 5, y1: 12, x2: 19, y2: 12 }]],
    x: [['line', { x1: 6, y1: 6, x2: 18, y2: 18 }], ['line', { x1: 18, y1: 6, x2: 6, y2: 18 }]],
    check: [['polyline', { points: '5 12.5 10 17.5 19 7' }]],
    more: [['circle', { cx: 12, cy: 5, r: 1.2 }], ['circle', { cx: 12, cy: 12, r: 1.2 }], ['circle', { cx: 12, cy: 19, r: 1.2 }]],
    chevronDown: [['polyline', { points: '6 9 12 15 18 9' }]],
    chevronRight: [['polyline', { points: '9 6 15 12 9 18' }]],
    gear: [['circle', { cx: 12, cy: 12, r: 3 }], ['path', { d: 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' }]],
    search: [['circle', { cx: 11, cy: 11, r: 6.5 }], ['line', { x1: 16, y1: 16, x2: 21, y2: 21 }]],
    pin: [['path', { d: 'M9 4h6l-1 6 4 3v2H6v-2l4-3-1-6z' }], ['line', { x1: 12, y1: 15, x2: 12, y2: 21 }]],
    phone: [['path', { d: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z' }]],
    video: [['rect', { x: 2, y: 6, width: 14, height: 12, rx: 2 }], ['path', { d: 'M16 10l6-3v10l-6-3z' }]],
    live: [['rect', { x: 3, y: 5, width: 18, height: 12, rx: 2 }], ['line', { x1: 8, y1: 21, x2: 16, y2: 21 }], ['line', { x1: 12, y1: 17, x2: 12, y2: 21 }]],
    chat: [['path', { d: 'M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12z' }]],
    leave: [['path', { d: 'M16 17l5-5-5-5' }], ['path', { d: 'M21 12H9' }], ['path', { d: 'M12 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7' }]],
    trash: [['polyline', { points: '4 7 20 7' }], ['path', { d: 'M9 7V4h6v3' }], ['path', { d: 'M6 7l1 13h10l1-13' }]],
    edit: [['path', { d: 'M4 20h4L19 9l-4-4L4 16v4z' }], ['line', { x1: 13.5, y1: 6.5, x2: 17.5, y2: 10.5 }]],
    copy: [['rect', { x: 9, y: 9, width: 11, height: 11, rx: 2 }], ['path', { d: 'M5 15V5a2 2 0 0 1 2-2h10' }]],
    bellOff: [['path', { d: 'M18 16V11a6 6 0 0 0-9.3-5' }], ['path', { d: 'M6 11v5l-2 2h13' }], ['path', { d: 'M10 21h4' }], ['line', { x1: 3, y1: 3, x2: 21, y2: 21 }]],
    trophy: [['path', { d: 'M8 21h8' }], ['path', { d: 'M12 17v4' }], ['path', { d: 'M7 4h10v5a5 5 0 0 1-10 0V4z' }], ['path', { d: 'M17 5h3v2a3 3 0 0 1-3 3' }], ['path', { d: 'M7 5H4v2a3 3 0 0 0 3 3' }]],
    keyboard: [['rect', { x: 2, y: 6, width: 20, height: 12, rx: 2 }], ['line', { x1: 6, y1: 10, x2: 6, y2: 10.1 }], ['line', { x1: 10, y1: 10, x2: 10, y2: 10.1 }], ['line', { x1: 14, y1: 10, x2: 14, y2: 10.1 }], ['line', { x1: 18, y1: 10, x2: 18, y2: 10.1 }], ['line', { x1: 7, y1: 14, x2: 17, y2: 14 }]],
    folder: [['path', { d: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z' }]],
    link: [['path', { d: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1' }], ['path', { d: 'M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1' }]],
    inbox: [['path', { d: 'M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z' }], ['path', { d: 'M3 13h5l1 3h6l1-3h5' }]],
    mark: [['path', { d: GHOST_PATH }]]
  };

  var STATUS_TEXT = { online: 'Online', idle: 'Ausente', dnd: 'Não perturbe', offline: 'Offline', invisible: 'Invisível' };
  var ROLE_TEXT = { owner: 'Dono', admin: 'Admin', member: 'Membro' };
  var MMR_STATUS = {
    goal_reached: 'Meta alcançada',
    on_track: 'No caminho da meta',
    unreachable: 'Com esse winrate a meta não chega',
    insufficient_data: 'Poucos jogos recentes para estimar'
  };

  var nf = new Intl.NumberFormat('pt-BR');
  function num(n) { return nf.format(n); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function icon(name, size, cls) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size || 18));
    svg.setAttribute('height', String(size || 18));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', cls || 'btn-icon');
    (ICONS[name] || []).forEach(function (part) {
      var node = document.createElementNS(SVG_NS, part[0]);
      Object.keys(part[1]).forEach(function (k) { node.setAttribute(k, String(part[1][k])); });
      svg.appendChild(node);
    });
    return svg;
  }

  // Símbolo LUMENEX (provisório: "L" dourado com traço vermelho). O nome ghostSvg fica por compatibilidade.
  var MARK_L = 'M6.5 3.5h4.6v12.2h8.2l-2.4 4.8H6.5z';
  var MARK_SPARK = 'M16.4 3.5h2.6l-3.2 6.2h-1.7z';
  function markSvg(size, cls) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size || 24));
    svg.setAttribute('height', String(size || 24));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', 'lx-mark' + (cls ? ' ' + cls : ''));
    var p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('class', 'ghost-body lx-l');
    p.setAttribute('d', MARK_L);
    svg.appendChild(p);
    var q = document.createElementNS(SVG_NS, 'path');
    q.setAttribute('class', 'lx-spark');
    q.setAttribute('d', MARK_SPARK);
    svg.appendChild(q);
    return svg;
  }
  var ghostSvg = markSvg;

  // Iniciais: primeira letra das duas primeiras palavras ("Lua<Cheia>" -> "LC", "Eco" -> "E")
  function initials(name) {
    var words = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    var a = Array.from(words[0])[0] || '';
    var b = words.length > 1 ? (Array.from(words[1])[0] || '') : '';
    return (a + b).toUpperCase();
  }

  function toneFor(key) {
    var s = String(key || '');
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % 8;
  }

  function toneOf(user) {
    if (user && typeof user.avatarColor === 'number' && user.avatarColor >= 0 && user.avatarColor <= 7) return user.avatarColor | 0;
    return toneFor(user && (user.id || user.userId || user.username || user.displayName));
  }

  function nameOf(user, nickname) {
    if (!user) return 'Pessoa desconhecida';
    return nickname || user.nickname || user.displayName || user.username || 'Jogador';
  }

  function safeImageUrl(url) {
    if (typeof url !== 'string' || url.length > 200000) return null;
    if (url.indexOf('data:image/') === 0) return url;
    if (/^https:\/\/[a-z0-9.-]+\.supabase\.co\/storage\//i.test(url)) return url;
    return null;
  }

  // Avatar: imagem enviada (data:image ou storage do Supabase) ou iniciais na cor escolhida.
  var AVATAR_PX = { xs: 24, sm: 32, md: 40, rail: 48, lg: 80 };

  // Foto para listas: miniatura estática (avatarThumbUrl). O original (às vezes animado e pesado)
  // só entra no tamanho grande (cartão de perfil) ou quando o GhostLook troca no hover.
  function avatarSrc(user, size) {
    if (!user) return null;
    if (size === 'lg') return safeImageUrl(user.avatarUrl) || safeImageUrl(user.avatarThumbUrl);
    return safeImageUrl(user.avatarThumbUrl) || (user.animatedAvatar ? null : safeImageUrl(user.avatarUrl));
  }

  function avatarEl(user, size, opts) {
    opts = opts || {};
    size = size || 'sm';
    var a = el('span', 'avatar avatar-' + size);
    a.dataset.tone = String(toneOf(user));
    a.setAttribute('aria-hidden', 'true');
    var look = null;
    if (user && window.GhostLook && typeof window.GhostLook.avatar === 'function') {
      try {
        look = window.GhostLook.avatar(user, {
          size: AVATAR_PX[size] || 32,
          animate: opts.animate || (size === 'lg' ? 'always' : 'hover'),
          frame: opts.frame !== undefined ? !!opts.frame : (size === 'sm' || size === 'md' || size === 'lg')
        });
      } catch (e) { look = null; }
    }
    if (look) {
      a.classList.add('has-look');
      look.classList.add('avatar-look');
      a.appendChild(look);
    } else {
      var url = avatarSrc(user, size);
      if (url) {
        var img = document.createElement('img');
        img.className = 'avatar-img';
        img.alt = '';
        img.decoding = 'async';
        img.loading = 'lazy';
        img.src = url;
        a.appendChild(img);
      } else {
        a.appendChild(el('span', 'avatar-initials', initials(nameOf(user))));
      }
    }
    if (opts.status) a.appendChild(statusDot(opts.status));
    if (opts.speaking) a.classList.add('is-speaking');
    return a;
  }

  function statusDot(status) {
    var s = STATUS_TEXT[status] ? status : 'offline';
    var d = el('span', 'status-dot');
    d.dataset.status = s;
    return d;
  }

  /* ---------- camada flutuante: menus de contexto ---------- */

  var layer = null;
  function getLayer() {
    if (!layer) {
      layer = document.getElementById('popout-layer');
      if (!layer) {
        layer = el('div', 'popout-layer');
        layer.id = 'popout-layer';
        document.body.appendChild(layer);
      }
    }
    return layer;
  }

  var openMenu = null; // { node, returnFocus }

  function closeContextMenu(restore) {
    if (!openMenu) return;
    var m = openMenu;
    openMenu = null;
    if (m.node.parentNode) m.node.parentNode.removeChild(m.node);
    if (restore !== false && m.returnFocus && document.contains(m.returnFocus)) {
      try { m.returnFocus.focus(); } catch (e) { /* ignora */ }
    }
  }

  function place(node, x, y, alignRight) {
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var r = node.getBoundingClientRect();
    var left = alignRight ? x - r.width : x;
    var top = y;
    if (left + r.width > vw - 8) left = vw - r.width - 8;
    if (top + r.height > vh - 8) top = Math.max(8, vh - r.height - 8);
    if (left < 8) left = 8;
    if (top < 8) top = 8;
    node.style.left = Math.round(left) + 'px';
    node.style.top = Math.round(top) + 'px';
  }

  /**
   * items: [{ label, action(), danger?, disabled?, separator?, hint?, icon?, checked? }]
   * Abre na posição (x, y) da janela; teclado: setas, Home/End, Enter, Esc.
   */
  function openContextMenu(items, x, y, returnFocusEl, opts) {
    closeContextMenu(false);
    opts = opts || {};
    var menu = el('div', 'ctx-menu');
    menu.setAttribute('role', 'menu');
    if (opts.label) menu.setAttribute('aria-label', opts.label);
    var buttons = [];
    (items || []).forEach(function (it) {
      if (!it) return;
      if (it.separator) {
        var sep = el('div', 'ctx-sep');
        sep.setAttribute('role', 'separator');
        menu.appendChild(sep);
        return;
      }
      var b = el('button', 'ctx-item' + (it.danger ? ' is-danger' : '') + (it.accent ? ' is-accent' : ''));
      b.type = 'button';
      b.setAttribute('role', typeof it.checked === 'boolean' ? 'menuitemradio' : 'menuitem');
      if (typeof it.checked === 'boolean') b.setAttribute('aria-checked', it.checked ? 'true' : 'false');
      b.tabIndex = -1;
      var text = el('span', 'ctx-text');
      text.appendChild(el('span', 'ctx-label', it.label));
      if (it.hint) text.appendChild(el('span', 'ctx-hint', it.hint));
      b.appendChild(text);
      if (it.dot) b.insertBefore(statusDot(it.dot), text);
      if (it.icon) b.appendChild(icon(it.icon, 18, 'btn-icon ctx-icon'));
      if (it.disabled) b.disabled = true;
      b.addEventListener('click', function () {
        if (b.disabled) return;
        closeContextMenu(!it.keepFocusAway);
        try { if (typeof it.action === 'function') it.action(); } catch (e) { /* a ação não derruba o menu */ }
      });
      menu.appendChild(b);
      buttons.push(b);
    });
    if (!buttons.length) return null;
    menu.addEventListener('keydown', function (ev) {
      var enabled = buttons.filter(function (b) { return !b.disabled; });
      var i = enabled.indexOf(document.activeElement);
      if (ev.key === 'ArrowDown') { ev.preventDefault(); (enabled[(i + 1) % enabled.length] || enabled[0]).focus(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); (enabled[(i - 1 + enabled.length) % enabled.length] || enabled[0]).focus(); }
      else if (ev.key === 'Home') { ev.preventDefault(); enabled[0].focus(); }
      else if (ev.key === 'End') { ev.preventDefault(); enabled[enabled.length - 1].focus(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeContextMenu(true); }
      else if (ev.key === 'Tab') { ev.preventDefault(); closeContextMenu(true); }
    });
    getLayer().appendChild(menu);
    place(menu, x, y, !!opts.alignRight);
    openMenu = { node: menu, returnFocus: returnFocusEl || document.activeElement };
    var first = buttons.filter(function (b) { return !b.disabled; })[0];
    if (first) first.focus();
    return menu;
  }

  // Posição para abrir menu a partir de um elemento (teclado ou botão)
  function anchorPoint(elm, where) {
    var r = elm.getBoundingClientRect();
    if (where === 'below') return { x: r.left, y: r.bottom + 6 };
    if (where === 'above') return { x: r.left, y: r.top - 6 };
    if (where === 'left') return { x: r.left - 8, y: r.top };
    return { x: r.right + 8, y: r.top };
  }

  // Clique direito ou tecla de menu (Shift+F10) em `node` chama build(ev) → itens.
  function bindContextMenu(node, build) {
    node.addEventListener('contextmenu', function (ev) {
      var items = build(ev);
      if (!items || !items.length) return;
      ev.preventDefault();
      var x = ev.clientX;
      var y = ev.clientY;
      if (!x && !y) { var p = anchorPoint(node, 'below'); x = p.x; y = p.y; }
      openContextMenu(items, x, y, node);
    });
  }

  document.addEventListener('mousedown', function (ev) {
    if (openMenu && !openMenu.node.contains(ev.target)) closeContextMenu(false);
  }, true);
  window.addEventListener('blur', function () { closeContextMenu(false); });
  window.addEventListener('resize', function () { closeContextMenu(false); });

  /* ---------- confirmação e pergunta (diálogos genéricos) ---------- */

  function confirmDialog(opts) {
    opts = opts || {};
    var dlg = document.getElementById('dlg-confirm');
    if (!dlg || typeof dlg.showModal !== 'function') return Promise.resolve(window.confirm ? window.confirm(opts.body || opts.title || '') : false);
    var returnFocus = document.activeElement;
    document.getElementById('confirm-title').textContent = opts.title || 'Tem certeza?';
    document.getElementById('confirm-body').textContent = opts.body || '';
    var ok = document.getElementById('confirm-ok');
    ok.textContent = opts.confirmLabel || 'Confirmar';
    ok.className = 'btn ' + (opts.danger ? 'btn-danger-solid' : 'btn-primary');
    return new Promise(function (resolve) {
      var done = false;
      function finish(v) {
        if (done) return;
        done = true;
        ok.removeEventListener('click', onOk);
        dlg.removeEventListener('close', onClose);
        if (dlg.open) dlg.close();
        if (returnFocus && document.contains(returnFocus)) { try { returnFocus.focus(); } catch (e) { /* ignora */ } }
        resolve(v);
      }
      function onOk() { finish(true); }
      function onClose() { finish(false); }
      ok.addEventListener('click', onOk);
      dlg.addEventListener('close', onClose);
      dlg.showModal();
      (opts.danger ? dlg.querySelector('[data-close]') : ok).focus();
    });
  }

  /** Pergunta um texto. Resolve com o texto (aparado) ou null se cancelar. */
  function promptDialog(opts) {
    opts = opts || {};
    var dlg = document.getElementById('dlg-prompt');
    if (!dlg || typeof dlg.showModal !== 'function') return Promise.resolve(null);
    var returnFocus = document.activeElement;
    var form = document.getElementById('form-prompt');
    var input = document.getElementById('prompt-input');
    var err = document.getElementById('prompt-error');
    document.getElementById('prompt-title').textContent = opts.title || '';
    document.getElementById('prompt-label').textContent = opts.label || '';
    var help = document.getElementById('prompt-help');
    help.textContent = opts.help || '';
    help.hidden = !opts.help;
    var ok = document.getElementById('prompt-ok');
    ok.textContent = opts.confirmLabel || 'Salvar';
    input.value = opts.value || '';
    input.maxLength = opts.maxLength || 100;
    input.placeholder = opts.placeholder || '';
    err.hidden = true;
    err.textContent = '';
    input.removeAttribute('aria-invalid');
    return new Promise(function (resolve) {
      var done = false;
      function finish(v) {
        if (done) return;
        done = true;
        form.removeEventListener('submit', onSubmit);
        dlg.removeEventListener('close', onClose);
        if (dlg.open) dlg.close();
        if (returnFocus && document.contains(returnFocus)) { try { returnFocus.focus(); } catch (e) { /* ignora */ } }
        resolve(v);
      }
      function onSubmit(ev) {
        ev.preventDefault();
        var v = input.value.trim();
        var problem = typeof opts.validate === 'function' ? opts.validate(v) : (opts.required !== false && !v ? 'Preencha o campo.' : null);
        if (problem) {
          err.textContent = problem;
          err.hidden = false;
          input.setAttribute('aria-invalid', 'true');
          input.focus();
          return;
        }
        if (typeof opts.submit === 'function') {
          ok.disabled = true;
          Promise.resolve(opts.submit(v)).then(function (errorText) {
            ok.disabled = false;
            if (errorText) {
              err.textContent = errorText;
              err.hidden = false;
              input.setAttribute('aria-invalid', 'true');
              input.focus();
            } else {
              finish(v);
            }
          });
          return;
        }
        finish(v);
      }
      function onClose() { finish(null); }
      form.addEventListener('submit', onSubmit);
      dlg.addEventListener('close', onClose);
      dlg.showModal();
      input.focus();
      input.select();
    });
  }

  /* ---------- aviso rápido ---------- */

  var toastTimer = null;
  function toast(text, kind) {
    var region = document.getElementById('toast-region');
    if (!region) return;
    region.textContent = '';
    var t = el('p', 'toast' + (kind === 'error' ? ' is-error' : ''), text);
    region.appendChild(t);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { region.textContent = ''; }, 4200);
  }

  /* ---------- copiar ---------- */

  function copyText(text) {
    var s = String(text == null ? '' : text);
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(s).then(function () { return true; }, function () { return legacyCopy(s); });
    }
    return Promise.resolve(legacyCopy(s));
  }
  function legacyCopy(s) {
    var ta = el('textarea', 'visually-hidden');
    ta.value = s;
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  /* ---------- MMR (ranking e cartão de perfil) ---------- */

  function toMs(t) {
    if (typeof t !== 'number' || !isFinite(t)) return null;
    return t < 1e12 ? t * 1000 : t;
  }

  function relative(ms) {
    var secs = Math.max(0, (Date.now() - ms) / 1000);
    if (secs < 60) return 'agora há pouco';
    var mins = Math.floor(secs / 60);
    if (mins < 60) return 'há ' + mins + ' min';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return 'há ' + hours + ' h';
    var days = Math.floor(hours / 24);
    return 'há ' + days + (days === 1 ? ' dia' : ' dias');
  }

  function relTime(ms) {
    var t = el('time', 'rel-time', relative(ms));
    t.dataset.ts = String(ms);
    t.setAttribute('datetime', new Date(ms).toISOString());
    return t;
  }

  function hasMmr(mmr) { return !!(mmr && typeof mmr.progress === 'number' && typeof mmr.current === 'number'); }

  function mmrBlock(mmr, parent) {
    if (hasMmr(mmr)) {
      var pct = Math.floor(Math.max(0, Math.min(1, mmr.progress)) * 100);
      var line = el('p', 'rank-mmr');
      line.appendChild(el('strong', null, num(mmr.current)));
      line.appendChild(el('span', 'rank-arrow', ' → '));
      line.appendChild(document.createTextNode(num(mmr.goal) + ' MMR'));
      parent.appendChild(line);
      var bar = el('div', 'rank-progress');
      var track = el('div', 'mini-progress');
      track.setAttribute('aria-hidden', 'true');
      var fill = el('div', 'mini-progress-fill');
      fill.style.setProperty('--progress', String(pct));
      track.appendChild(fill);
      bar.appendChild(track);
      bar.appendChild(el('span', 'rank-pct', pct + '% da meta'));
      parent.appendChild(bar);
      var st = el('p', 'rank-status');
      var status = MMR_STATUS[mmr.status] ? mmr.status : 'insufficient_data';
      st.dataset.status = status;
      st.appendChild(icon(status, 18, 'rank-icon'));
      st.appendChild(el('span', null, MMR_STATUS[status]));
      parent.appendChild(st);
      var upd = toMs(mmr.updatedAt);
      if (upd != null) {
        var cap = el('p', 'caption rank-updated');
        cap.appendChild(document.createTextNode('Atualizado '));
        cap.appendChild(relTime(upd));
        parent.appendChild(cap);
      }
    } else {
      var hid = el('p', 'rank-status rank-hidden');
      hid.appendChild(icon('hidden', 18, 'rank-icon'));
      hid.appendChild(el('span', null, 'MMR escondido'));
      parent.appendChild(hid);
    }
  }

  window.GhostUI = {
    el: el,
    icon: icon,
    ghostSvg: ghostSvg,
    avatarSrc: avatarSrc,
    markSvg: markSvg,
    initials: initials,
    toneFor: toneFor,
    toneOf: toneOf,
    nameOf: nameOf,
    num: num,
    relative: relative,
    relTime: relTime,
    toMs: toMs,
    avatarEl: avatarEl,
    statusDot: statusDot,
    safeImageUrl: safeImageUrl,
    STATUS_TEXT: STATUS_TEXT,
    ROLE_TEXT: ROLE_TEXT,
    MMR_STATUS: MMR_STATUS,
    hasMmr: hasMmr,
    mmrBlock: mmrBlock,
    openContextMenu: openContextMenu,
    closeContextMenu: closeContextMenu,
    bindContextMenu: bindContextMenu,
    anchorPoint: anchorPoint,
    isMenuOpen: function () { return !!openMenu; },
    confirm: confirmDialog,
    prompt: promptDialog,
    toast: toast,
    copyText: copyText,
    // registrado pelo shell.js
    openProfile: function () {}
  };
})();
