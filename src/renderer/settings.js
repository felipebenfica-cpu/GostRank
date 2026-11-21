/* LUMENEX — Configurações (Etapa 6, frente R3; Etapa 7: Personalização do Perfil, tema AMOLED, canais por arrastar).
   Modal de tela cheia no modelo de uso do Discord: seções à esquerda, conteúdo à direita,
   fechar com ESC, foco preso, barra de "alterações não salvas".
   API: GhostSettings.init({bridge, getView, onClose}) · openUser(tab) · openServer(serverId, tab)
        · update(view) · isOpen() · close()
   Regras: sem innerHTML, sem style inline em HTML (só CSSOM), dados sempre de `view`. */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Utilitários de DOM
  // ---------------------------------------------------------------------------
  function h(tag, props) {
    var node = document.createElement(tag);
    var p = props || {};
    if (p.class) node.className = p.class;
    if (p.text != null) node.textContent = String(p.text);
    if (p.attrs) {
      Object.keys(p.attrs).forEach(function (k) {
        var v = p.attrs[k];
        if (v === false || v == null) return;
        node.setAttribute(k, v === true ? '' : String(v));
      });
    }
    if (p.props) Object.keys(p.props).forEach(function (k) { node[k] = p.props[k]; });
    if (p.on) Object.keys(p.on).forEach(function (k) { node.addEventListener(k, p.on[k]); });
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }

  function append(parent, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(parent, c); }); return; }
    parent.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  function icon(name, size) {
    var paths = {
      close: 'M6 6l12 12M18 6L6 18',
      text: 'M5 9h14M5 15h14M10 4L8 20M16 4l-2 16',
      voice: 'M4 10v4h4l5 4V6L8 10H4zM16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11',
      up: 'M12 19V5M6 11l6-6 6 6',
      down: 'M12 5v14M6 13l6 6 6-6',
      edit: 'M4 20h4L19 9l-4-4L4 16v4z',
      trash: 'M5 7h14M10 11v6M14 11v6M7 7l1 13h8l1-13M9 7V4h6v3',
      plus: 'M12 5v14M5 12h14',
      copy: 'M9 9h10v10H9zM5 15V5h10',
      crown: 'M4 18h16l-1-10-4 4-3-6-3 6-4-4z',
      warn: 'M12 3l10 18H2L12 3zM12 10v5M12 18v.5',
      logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
    };
    var s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', String(size || 18));
    s.setAttribute('height', String(size || 18));
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    s.setAttribute('class', 'gs-icon');
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', paths[name] || paths.close);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    s.appendChild(path);
    return s;
  }

  var uid = 0;
  function nextId(prefix) { uid += 1; return (prefix || 'gs') + '-' + uid; }

  function prefersReducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  function sameJson(a, b) {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
  }

  function initial(name) {
    var s = String(name || '?').trim();
    return s ? s.charAt(0).toUpperCase() : '?';
  }

  function maskEmail(email) {
    var e = String(email || '');
    var at = e.indexOf('@');
    if (at < 1) return e ? '••••••' : '';
    return '•'.repeat(Math.max(4, Math.min(10, at))) + e.slice(at);
  }

  function relTime(iso) {
    if (!iso) return 'Nunca';
    var t = Date.parse(iso);
    if (!isFinite(t)) return '—';
    var diff = t - Date.now();
    if (diff <= 0) return 'Expirado';
    var min = Math.round(diff / 60000);
    if (min < 60) return 'em ' + min + ' min';
    var hr = Math.round(min / 60);
    if (hr < 48) return 'em ' + hr + ' h';
    return 'em ' + Math.round(hr / 24) + ' dias';
  }

  function dateLabel(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return '';
    try { return new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }); } catch (e) { return ''; }
  }

  function avatar(user, size, extraClass) {
    var u = user || {};
    var c = Number.isInteger(u.avatarColor) ? Math.max(0, Math.min(7, u.avatarColor)) : 0;
    var wrap = h('span', { class: 'gs-av gs-av-' + (size || 'md') + (extraClass ? ' ' + extraClass : ''), attrs: { 'data-c': c, 'aria-hidden': 'true' } });
    if (u.avatarUrl) {
      wrap.appendChild(h('img', { attrs: { src: u.avatarUrl, alt: '' } }));
    } else {
      wrap.appendChild(h('span', { class: 'gs-av-initial', text: initial(u.displayName || u.username || u.name) }));
    }
    return wrap;
  }

  function serverIcon(server, size, previewUrl) {
    var s = server || {};
    var c = Number.isInteger(s.iconColor) ? Math.max(0, Math.min(7, s.iconColor)) : 0;
    var wrap = h('span', { class: 'gs-av gs-sv gs-av-' + (size || 'md'), attrs: { 'data-c': c, 'aria-hidden': 'true' } });
    var url = previewUrl || s.iconUrl;
    if (url) wrap.appendChild(h('img', { attrs: { src: url, alt: '' } }));
    else {
      var words = String(s.name || '?').trim().split(/\s+/).slice(0, 3);
      wrap.appendChild(h('span', { class: 'gs-av-initial', text: words.map(function (w) { return w.charAt(0); }).join('').toUpperCase() || '?' }));
    }
    return wrap;
  }

  var COLOR_NAMES = ['Violeta', 'Verde-jade', 'Azul', 'Rosa', 'Laranja', 'Âmbar', 'Vermelho', 'Ardósia'];

  var STATUS_LABEL = { online: 'Online', idle: 'Ausente', dnd: 'Não perturbe', invisible: 'Invisível', offline: 'Offline' };
  var ROLE_LABEL = { owner: 'Dono', admin: 'Admin', member: 'Membro' };

  // ---------------------------------------------------------------------------
  // Estado
  // ---------------------------------------------------------------------------
  var S = {
    bridge: null,
    getView: function () { return null; },
    onClose: function () {},
    view: null,
    root: null,
    els: {},
    open: false,
    kind: 'user',
    tab: 'account',
    serverId: null,
    returnFocus: null,
    form: null,         // { initial, read(), save() → Promise<boolean>, extraDirty() }
    sig: null,
    remote: {},         // dados buscados sob demanda (convites, banimentos)
    lastInvite: null,
    voiceMounted: false,
    dialog: null,       // diálogo interno aberto
    busy: false,
  };

  function view() { return S.view || (S.getView ? S.getView() : null) || {}; }
  function me() { return view().me || null; }

  function currentServer() {
    var v = view();
    var s = v.server;
    if (!s || (S.serverId && s.id !== S.serverId)) return null;
    return s;
  }

  function role() { var s = currentServer(); return s ? s.role : 'member'; }
  function isAdmin() { var r = role(); return r === 'owner' || r === 'admin'; }
  function isOwner() { return role() === 'owner'; }

  function userById(id) {
    var v = view();
    if (v.users && v.users[id]) return v.users[id];
    var s = v.server;
    if (s && Array.isArray(s.members)) {
      for (var i = 0; i < s.members.length; i++) if (s.members[i].id === id) return s.members[i];
    }
    if (Array.isArray(v.friends)) {
      for (var j = 0; j < v.friends.length; j++) if (v.friends[j].id === id) return v.friends[j];
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Chamadas à ponte
  // ---------------------------------------------------------------------------
  function call(method, arg) {
    var b = S.bridge;
    if (!b || typeof b[method] !== 'function') {
      return Promise.resolve({ ok: false, error: 'Recurso indisponível nesta versão.' });
    }
    var p;
    try { p = arguments.length > 1 ? b[method](arg) : b[method](); } catch (e) { p = null; }
    return Promise.resolve(p).then(function (res) {
      if (!res || typeof res !== 'object') return { ok: false, error: 'Algo deu errado. Tente novamente.' };
      if (res.ok && res.view) S.view = res.view;
      return res;
    }, function () { return { ok: false, error: 'Algo deu errado. Tente novamente.' }; });
  }

  function announce(text) {
    if (!S.els.live) return;
    S.els.live.textContent = '';
    window.setTimeout(function () { S.els.live.textContent = text; }, 30);
  }

  function showError(container, text) {
    if (!container) return;
    container.textContent = text || '';
    container.hidden = !text;
  }

  // ---------------------------------------------------------------------------
  // Seções
  // ---------------------------------------------------------------------------
  var USER_NAV = [
    { group: 'Configurações de usuário', items: [
      { id: 'account', label: 'Minha conta' },
      { id: 'profile', label: 'Perfil' },
      { id: 'look', label: 'Personalização do Perfil' },
      { id: 'privacy', label: 'Privacidade' },
    ] },
    { group: 'Configurações do app', items: [
      { id: 'voice', label: 'Voz e vídeo' },
      { id: 'notifications', label: 'Notificações' },
      { id: 'appearance', label: 'Aparência' },
      { id: 'keybinds', label: 'Atalhos' },
    ] },
    { group: null, items: [{ id: 'logout', label: 'Sair', danger: true, action: true }] },
  ];

  function serverNav() {
    var s = currentServer();
    var items = [
      { group: s ? s.name : 'Servidor', items: [
        { id: 'overview', label: 'Visão geral' },
      ] },
      { group: 'Gerenciamento', items: [
        { id: 'channels', label: 'Canais' },
        { id: 'members', label: 'Membros' },
        { id: 'invites', label: 'Convites' },
      ] },
    ];
    if (isAdmin()) items[1].items.push({ id: 'bans', label: 'Banimentos' });
    items.push({ group: null, items: [isOwner()
      ? { id: 'delete', label: 'Excluir servidor', danger: true }
      : { id: 'delete', label: 'Sair do servidor', danger: true }] });
    return items;
  }

  var TITLES = {
    account: 'Minha conta', profile: 'Perfil', look: 'Personalização do Perfil', privacy: 'Privacidade', voice: 'Voz e vídeo',
    notifications: 'Notificações', appearance: 'Aparência', keybinds: 'Atalhos',
    overview: 'Visão geral do servidor', channels: 'Canais', members: 'Membros', invites: 'Convites',
    bans: 'Banimentos', delete: 'Excluir servidor',
  };

  // ---------------------------------------------------------------------------
  // Construção do modal
  // ---------------------------------------------------------------------------
  function build() {
    if (S.root) return;
    var titleId = nextId('gs-title');
    var root = h('div', {
      class: 'gs-root',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, hidden: true, id: 'ghost-settings' },
    });
    var nav = h('nav', { class: 'gs-nav', attrs: { 'aria-label': 'Seções das configurações' } });
    var side = h('div', { class: 'gs-side' }, h('div', { class: 'gs-side-inner' }, nav));
    var title = h('h2', { class: 'gs-title', attrs: { id: titleId, tabindex: '-1' } });
    var panel = h('div', { class: 'gs-panel' });
    var closeBtn = h('button', {
      class: 'gs-close-btn',
      attrs: { type: 'button', 'aria-label': 'Fechar configurações (Esc)', 'data-fk': 'close' },
      on: { click: function () { requestClose(); } },
    }, icon('close', 18));
    var close = h('div', { class: 'gs-close' }, closeBtn, h('span', { class: 'gs-close-key', attrs: { 'aria-hidden': 'true' }, text: 'ESC' }));
    var content = h('div', { class: 'gs-content' },
      h('div', { class: 'gs-content-inner' }, title, panel),
      close);

    var unsavedText = h('span', { class: 'gs-unsaved-text', text: 'Cuidado — você tem alterações não salvas!' });
    var resetBtn = h('button', { class: 'gs-link-btn', attrs: { type: 'button' }, text: 'Redefinir', on: { click: function () { resetForm(); } } });
    var saveBtn = h('button', { class: 'btn btn-primary btn-small gs-save', attrs: { type: 'button' }, text: 'Salvar alterações', on: { click: function () { saveForm(); } } });
    var unsavedErr = h('span', { class: 'gs-unsaved-err', attrs: { role: 'alert', hidden: true } });
    var unsaved = h('div', { class: 'gs-unsaved', attrs: { hidden: true, role: 'region', 'aria-label': 'Alterações não salvas' } },
      unsavedText, unsavedErr, h('span', { class: 'gs-unsaved-actions' }, resetBtn, saveBtn));
    var live = h('div', { class: 'gs-sr', attrs: { 'aria-live': 'polite', role: 'status' } });

    root.appendChild(side);
    root.appendChild(content);
    root.appendChild(unsaved);
    root.appendChild(live);
    root.addEventListener('keydown', onKeydown);
    document.body.appendChild(root);

    S.root = root;
    S.els = { nav: nav, title: title, panel: panel, unsaved: unsaved, unsavedErr: unsavedErr, saveBtn: saveBtn, resetBtn: resetBtn, live: live, content: content, closeBtn: closeBtn };
  }

  function renderNav() {
    var nav = S.els.nav;
    clear(nav);
    var groups = S.kind === 'user' ? USER_NAV : serverNav();
    S.navSig = S.kind === 'server' ? JSON.stringify(groups) : null;
    groups.forEach(function (g, gi) {
      if (gi > 0) nav.appendChild(h('div', { class: 'gs-nav-sep', attrs: { role: 'separator' } }));
      if (g.group) nav.appendChild(h('div', { class: 'gs-nav-head', text: g.group }));
      var list = h('ul', { class: 'gs-nav-list', attrs: { role: 'list' } });
      g.items.forEach(function (it) {
        var btn = h('button', {
          class: 'gs-nav-item' + (it.danger ? ' is-danger' : ''),
          attrs: { type: 'button', 'aria-current': S.tab === it.id ? 'page' : false, 'data-fk': 'nav-' + it.id },
          text: it.label,
          on: { click: function () { goTab(it.id); } },
        });
        if (it.id === 'logout') btn.appendChild(icon('logout', 16));
        list.appendChild(h('li', null, btn));
      });
      nav.appendChild(list);
    });
  }

  function goTab(id) {
    if (id === 'logout') { doLogout(); return; }
    if (id === S.tab) return;
    if (isDirty()) { nudgeUnsaved(); return; }
    leaveTab();
    S.tab = id;
    S.form = null;
    renderAll(true);
  }

  function leaveTab() {
    if (S.voiceMounted && window.GhostVoice && typeof window.GhostVoice.destroySettings === 'function') {
      try { window.GhostVoice.destroySettings(); } catch (e) { /* opcional */ }
    }
    S.voiceMounted = false;
    if (S.lookEditor) {
      try { S.lookEditor.destroy(); } catch (e2) { /* opcional */ }
      S.lookEditor = null;
    }
    if (S.chDnd) {
      try { S.chDnd.destroy(); } catch (e3) { /* opcional */ }
      S.chDnd = null;
    }
  }

  function renderAll(focusTitle) {
    if (!S.root) return;
    renderNav();
    renderPanel(focusTitle);
  }

  function tabSignature() {
    var v = view();
    var slice;
    if (S.kind === 'user') {
      if (S.tab === 'look') return 'user:look';   // o editor se atualiza sozinho (update), sem redesenhar a aba
      if (S.tab === 'account') slice = [v.me, v.auth && v.auth.email];
      else if (S.tab === 'profile') slice = [v.me];
      else if (S.tab === 'privacy') slice = [v.auth && v.auth.mmrVisibility, (v.friends || []).filter(function (f) { return f.relation === 'blocked'; })];
      else if (S.tab === 'notifications' || S.tab === 'appearance') slice = [v.prefs];
      else slice = [S.tab];
    } else {
      slice = [currentServer(), S.remote];
    }
    try { return S.kind + ':' + S.tab + ':' + JSON.stringify(slice); } catch (e) { return String(Math.random()); }
  }

  function renderPanel(focusTitle) {
    var panel = S.els.panel;
    var active = document.activeElement;
    var fk = active && S.root.contains(active) && active.getAttribute ? active.getAttribute('data-fk') : null;
    var scroll = S.els.content.querySelector('.gs-content-inner');
    var top = scroll ? scroll.scrollTop : 0;

    leaveTab();
    clear(panel);
    S.els.title.textContent = S.kind === 'server' && S.tab === 'delete' && !isOwner() ? 'Sair do servidor' : (TITLES[S.tab] || 'Configurações');
    var render = RENDER[S.tab];
    if (S.kind === 'server' && !currentServer()) {
      panel.appendChild(h('p', { class: 'gs-muted', text: 'Carregando o servidor…' }));
    } else if (render) {
      render(panel);
    }
    S.sig = tabSignature();

    if (scroll && !focusTitle) scroll.scrollTop = top;
    if (focusTitle) {
      if (scroll) scroll.scrollTop = 0;
      S.els.title.focus({ preventScroll: true });
    } else if (fk) {
      var again = S.root.querySelector('[data-fk="' + cssEscape(fk) + '"]');
      if (again) again.focus({ preventScroll: true });
    }
  }

  function cssEscape(s) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  // ---------------------------------------------------------------------------
  // Formulário com "alterações não salvas"
  // ---------------------------------------------------------------------------
  function useForm(initialValues, read, save, extraDirty) {
    S.form = { initial: initialValues, read: read, save: save, extraDirty: extraDirty || function () { return false; } };
    checkDirty();
  }

  function isDirty() {
    var f = S.form;
    if (!f) return false;
    if (f.custom) { try { return Boolean(f.isDirty()); } catch (e) { return false; } }
    var cur;
    try { cur = f.read(); } catch (e) { return false; }
    return !sameJson(cur, f.initial) || Boolean(f.extraDirty());
  }

  function checkDirty() {
    var bar = S.els.unsaved;
    if (!bar) return;
    // Abas com barra própria (Personalização do Perfil) não usam a barra global.
    if (S.form && S.form.custom) { bar.hidden = true; return; }
    var dirty = isDirty();
    if (dirty && bar.hidden) {
      bar.hidden = false;
      showError(S.els.unsavedErr, '');
      bar.classList.remove('is-in');
      void bar.offsetWidth;
      bar.classList.add('is-in');
    } else if (!dirty && !bar.hidden) {
      bar.hidden = true;
      bar.classList.remove('is-nudge', 'is-in');
    }
  }

  function nudgeUnsaved() {
    if (S.form && S.form.custom) { try { S.form.nudge(); } catch (e) { /* editor */ } return; }
    var bar = S.els.unsaved;
    if (!bar || bar.hidden) return;
    bar.classList.remove('is-nudge');
    void bar.offsetWidth;
    bar.classList.add('is-nudge');
    announce('Você tem alterações não salvas. Salve ou redefina antes de sair.');
    S.els.saveBtn.focus();
  }

  function resetForm() {
    S.form = null;
    S.els.unsaved.hidden = true;
    renderPanel(false);
    announce('Alterações descartadas.');
  }

  function saveForm() {
    var f = S.form;
    if (!f || S.busy) return;
    S.busy = true;
    S.els.saveBtn.disabled = true;
    S.els.saveBtn.textContent = 'Salvando…';
    showError(S.els.unsavedErr, '');
    Promise.resolve(f.save(f.read())).then(function (err) {
      S.busy = false;
      S.els.saveBtn.disabled = false;
      S.els.saveBtn.textContent = 'Salvar alterações';
      if (err) {
        showError(S.els.unsavedErr, err);
        return;
      }
      S.form = null;
      S.els.unsaved.hidden = true;
      announce('Alterações salvas.');
      renderPanel(false);
    }, function () {
      S.busy = false;
      S.els.saveBtn.disabled = false;
      S.els.saveBtn.textContent = 'Salvar alterações';
      showError(S.els.unsavedErr, 'Não foi possível salvar. Tente novamente.');
    });
  }

  // ---------------------------------------------------------------------------
  // Componentes de formulário
  // ---------------------------------------------------------------------------
  function field(label, input, hint, counter) {
    var id = input.id || nextId('gs-f');
    input.id = id;
    var hintEl = null;
    var desc = [];
    if (hint) { hintEl = h('p', { class: 'gs-hint', attrs: { id: id + '-hint' }, text: hint }); desc.push(id + '-hint'); }
    if (counter) { counter.id = id + '-count'; desc.push(id + '-count'); }
    if (desc.length) input.setAttribute('aria-describedby', desc.join(' '));
    return h('div', { class: 'gs-field' },
      h('div', { class: 'gs-field-top' }, h('label', { class: 'gs-label', attrs: { for: id }, text: label }), counter || null),
      input, hintEl);
  }

  function textInput(value, opts) {
    var o = opts || {};
    var el = h(o.multiline ? 'textarea' : 'input', {
      class: 'gs-input' + (o.multiline ? ' gs-textarea' : ''),
      attrs: {
        type: o.multiline ? false : (o.type || 'text'),
        maxlength: o.max || false,
        placeholder: o.placeholder || false,
        autocomplete: 'off',
        spellcheck: o.spellcheck ? 'true' : 'false',
        rows: o.multiline ? (o.rows || 4) : false,
        'data-fk': o.fk || false,
        disabled: o.disabled || false,
      },
    });
    el.value = value == null ? '' : String(value);
    if (o.onInput) el.addEventListener('input', o.onInput);
    return el;
  }

  function counterFor(input, max) {
    var c = h('span', { class: 'gs-count', attrs: { 'aria-live': 'off' } });
    function upd() {
      var left = max - input.value.length;
      c.textContent = String(left);
      c.classList.toggle('is-low', left < 20);
    }
    input.addEventListener('input', upd);
    upd();
    return c;
  }

  function toggle(label, desc, checked, onChange, fk) {
    var id = nextId('gs-t');
    var input = h('input', {
      class: 'gs-switch-input',
      attrs: { type: 'checkbox', id: id, role: 'switch', 'data-fk': fk || false, 'aria-describedby': desc ? id + '-d' : false },
    });
    input.checked = Boolean(checked);
    input.addEventListener('change', function () { onChange(input.checked, input); });
    return h('div', { class: 'gs-row-toggle' },
      h('div', { class: 'gs-row-text' },
        h('label', { class: 'gs-row-label', attrs: { for: id }, text: label }),
        desc ? h('p', { class: 'gs-hint', attrs: { id: id + '-d' }, text: desc }) : null),
      h('span', { class: 'gs-switch' }, input, h('span', { class: 'gs-switch-track', attrs: { 'aria-hidden': 'true' } })));
  }

  function radioGroup(legend, name, options, value, onChange, cls) {
    var fs = h('fieldset', { class: 'gs-radios ' + (cls || '') }, h('legend', { class: 'gs-label', text: legend }));
    options.forEach(function (o) {
      var id = nextId('gs-r');
      var input = h('input', { attrs: { type: 'radio', name: name, id: id, value: o.value, 'data-fk': name + '-' + o.value } });
      input.checked = o.value === value;
      input.addEventListener('change', function () { if (input.checked) onChange(o.value); });
      var lab = h('label', { class: 'gs-radio', attrs: { for: id } }, input,
        o.render ? o.render() : null,
        h('span', { class: 'gs-radio-text' }, h('span', { class: 'gs-radio-title', text: o.label }), o.desc ? h('span', { class: 'gs-hint', text: o.desc }) : null));
      fs.appendChild(lab);
    });
    return fs;
  }

  function colorPicker(legend, name, value, onChange) {
    var fs = h('fieldset', { class: 'gs-colors' }, h('legend', { class: 'gs-label', text: legend }));
    var row = h('div', { class: 'gs-color-row' });
    for (var c = 0; c < 8; c++) {
      (function (ci) {
        var id = nextId('gs-c');
        var input = h('input', { class: 'gs-color-input', attrs: { type: 'radio', name: name, id: id, value: String(ci), 'data-fk': name + '-' + ci } });
        input.checked = ci === value;
        input.addEventListener('change', function () { if (input.checked) onChange(ci); });
        row.appendChild(h('label', { class: 'gs-color', attrs: { for: id, title: COLOR_NAMES[ci] } }, input,
          h('span', { class: 'gs-color-dot', attrs: { 'data-c': ci, 'aria-hidden': 'true' } }),
          h('span', { class: 'gs-sr', text: COLOR_NAMES[ci] })));
      })(c);
    }
    fs.appendChild(row);
    return fs;
  }

  function section(title, desc) {
    var sec = h('section', { class: 'gs-section' });
    if (title) sec.appendChild(h('h3', { class: 'gs-h3', text: title }));
    if (desc) sec.appendChild(h('p', { class: 'gs-hint gs-section-desc', text: desc }));
    return sec;
  }

  function errorBox() { return h('p', { class: 'gs-error', attrs: { role: 'alert', hidden: true } }); }

  function btn(label, cls, onClick, opts) {
    var o = opts || {};
    var b = h('button', {
      class: 'btn ' + (cls || ''),
      attrs: { type: 'button', 'aria-label': o.aria || false, 'data-fk': o.fk || false, disabled: o.disabled || false, title: o.title || false },
      on: { click: onClick },
    });
    if (o.icon) b.appendChild(icon(o.icon, 16));
    if (label) b.appendChild(document.createTextNode(label));
    return b;
  }

  function iconBtn(name, label, onClick, fk, disabled) {
    return h('button', {
      class: 'gs-icon-btn',
      attrs: { type: 'button', 'aria-label': label, title: label, 'data-fk': fk || false, disabled: disabled || false },
      on: { click: onClick },
    }, icon(name, 16));
  }

  /** Lê uma imagem: valida tipo/tamanho, devolve {name, mime, data:ArrayBuffer, preview:dataURL}. */
  function readImage(file, maxBytes) {
    return new Promise(function (resolve) {
      if (!file) { resolve({ error: 'Nenhum arquivo escolhido.' }); return; }
      var okTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
      if (okTypes.indexOf(file.type) < 0) { resolve({ error: 'Use uma imagem PNG, JPG, WEBP ou GIF.' }); return; }
      if (file.size > maxBytes) { resolve({ error: 'A imagem precisa ter no máximo ' + Math.round(maxBytes / 1048576) + ' MB.' }); return; }
      var r1 = new FileReader();
      r1.onerror = function () { resolve({ error: 'Não foi possível ler a imagem.' }); };
      r1.onload = function () {
        var buf = r1.result;
        var r2 = new FileReader();
        r2.onerror = function () { resolve({ error: 'Não foi possível ler a imagem.' }); };
        r2.onload = function () { resolve({ name: String(file.name || 'imagem').slice(0, 120), mime: file.type, data: buf, preview: r2.result }); };
        r2.readAsDataURL(file);
      };
      r1.readAsArrayBuffer(file);
    });
  }

  // ---------------------------------------------------------------------------
  // Diálogo interno (confirmar / formulário)
  // ---------------------------------------------------------------------------
  function openDialog(opts) {
    return new Promise(function (resolve) {
      closeDialog(null);
      var titleId = nextId('gs-dt');
      var bodyId = nextId('gs-db');
      var err = errorBox();
      var inputs = {};
      var form = h('form', { class: 'gs-dialog', attrs: { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': titleId, 'aria-describedby': opts.body ? bodyId : false, novalidate: true } });
      form.appendChild(h('h3', { class: 'gs-dialog-title', attrs: { id: titleId }, text: opts.title }));
      if (opts.body) form.appendChild(h('p', { class: 'gs-dialog-body', attrs: { id: bodyId }, text: opts.body }));
      (opts.fields || []).forEach(function (f) {
        var input;
        if (f.type === 'select') {
          input = h('select', { class: 'gs-input' });
          f.options.forEach(function (o) {
            var opt = h('option', { attrs: { value: o.value }, text: o.label });
            if (o.value === f.value) opt.selected = true;
            input.appendChild(opt);
          });
        } else if (f.type === 'radio') {
          var chosen = f.value;
          input = radioGroup(f.label, nextId('gs-dr'), f.options, f.value, function (v) { chosen = v; }, 'gs-radios-compact');
          input.getValue = function () { return chosen; };
          form.appendChild(input);
          inputs[f.name] = input;
          return;
        } else {
          input = textInput(f.value || '', { max: f.max, placeholder: f.placeholder, multiline: f.multiline, rows: 3 });
        }
        inputs[f.name] = input;
        form.appendChild(field(f.label, input, f.hint, f.max && f.multiline ? counterFor(input, f.max) : null));
      });
      var requireInput = null;
      if (opts.requireText) {
        requireInput = textInput('', { placeholder: opts.requireText });
        form.appendChild(field('Para confirmar, digite "' + opts.requireText + '"', requireInput));
      }
      form.appendChild(err);
      var cancel = h('button', { class: 'gs-link-btn', attrs: { type: 'button' }, text: opts.cancelLabel || 'Cancelar', on: { click: function () { closeDialog(null); } } });
      var ok = h('button', { class: 'btn btn-small ' + (opts.danger ? 'btn-danger-solid' : 'btn-primary'), attrs: { type: 'submit' }, text: opts.confirmLabel || 'Confirmar' });
      form.appendChild(h('div', { class: 'gs-dialog-actions' }, cancel, ok));
      if (requireInput) {
        ok.disabled = true;
        requireInput.addEventListener('input', function () { ok.disabled = requireInput.value.trim() !== opts.requireText; });
      }
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        if (requireInput && requireInput.value.trim() !== opts.requireText) return;
        var values = {};
        Object.keys(inputs).forEach(function (k) { values[k] = typeof inputs[k].getValue === 'function' ? inputs[k].getValue() : inputs[k].value; });
        if (typeof opts.onSubmit === 'function') {
          ok.disabled = true;
          showError(err, '');
          Promise.resolve(opts.onSubmit(values)).then(function (msg) {
            ok.disabled = false;
            if (msg) { showError(err, msg); return; }
            closeDialog(values);
          });
        } else {
          closeDialog(values);
        }
      });
      var overlay = h('div', { class: 'gs-dialog-overlay' }, form);
      overlay.addEventListener('mousedown', function (ev) { if (ev.target === overlay) closeDialog(null); });
      S.root.appendChild(overlay);
      S.dialog = { overlay: overlay, resolve: resolve, returnFocus: document.activeElement };
      var first = form.querySelector('input, select, textarea') || ok;
      if (opts.danger && !requireInput && !(opts.fields && opts.fields.length)) first = cancel;
      first.focus();
    });
  }

  function closeDialog(result) {
    var d = S.dialog;
    if (!d) return;
    S.dialog = null;
    if (d.overlay.parentNode) d.overlay.parentNode.removeChild(d.overlay);
    if (d.returnFocus && document.contains(d.returnFocus)) d.returnFocus.focus();
    d.resolve(result);
  }

  function confirmDialog(opts) {
    return openDialog(opts).then(function (r) { return r !== null; });
  }

  // ---------------------------------------------------------------------------
  // Abas do usuário
  // ---------------------------------------------------------------------------
  function profileCard(user, opts) {
    var o = opts || {};
    var u = user || {};
    var c = Number.isInteger(u.avatarColor) ? u.avatarColor : 0;
    var status = u.status || 'online';
    var GL = window.GhostLook;
    // Com a Personalização do Perfil carregada, o cartão mostra banner, recorte e moldura de verdade.
    var bannerEl = GL ? GL.banner(u, { animate: 'always' }) : h('div', { class: 'gs-card-banner', attrs: { 'data-c': c, 'aria-hidden': 'true' } });
    if (GL) bannerEl.classList.add('gs-card-banner');
    var avEl = GL && !o.previewUrl ? GL.avatar(u, { size: 80, animate: 'always' }) : avatar(o.previewUrl ? { avatarUrl: o.previewUrl } : u, 'xl');
    var card = h('div', { class: 'gs-card' + (o.compact ? ' is-compact' : '') },
      bannerEl,
      h('div', { class: 'gs-card-head' },
        h('span', { class: 'gs-card-av' + (GL ? ' has-look' : ''), attrs: GL ? { 'data-gl-anchor': '' } : null },
          avEl,
          h('span', { class: 'gs-status-dot', attrs: { 'data-s': status === 'invisible' ? 'offline' : status, title: STATUS_LABEL[status] || '' } }),
          h('span', { class: 'gs-sr', text: 'Status: ' + (STATUS_LABEL[status] || 'Online') })),
        o.action || null),
      h('div', { class: 'gs-card-body' },
        h('div', { class: 'gs-card-name', text: u.displayName || u.username || 'Jogador' }),
        h('div', { class: 'gs-card-user', text: u.username ? '@' + u.username : '' }),
        u.customStatus ? h('div', { class: 'gs-card-custom', text: u.customStatus }) : null,
        o.showAbout && u.about ? h('div', { class: 'gs-card-about' }, h('div', { class: 'gs-card-label', text: 'Sobre mim' }), h('p', { text: u.about })) : null));
    return card;
  }

  var USERNAME_RE = /^[a-z0-9_.]{2,32}$/;

  function renderAccount(panel) {
    var u = me();
    var v = view();
    if (!u) { panel.appendChild(h('p', { class: 'gs-muted', text: 'Entre na sua conta para ver estas configurações.' })); return; }
    var email = v.auth && v.auth.email ? v.auth.email : '';
    var shown = false;

    panel.appendChild(profileCard(u, {
      action: btn('Editar perfil', 'btn-primary btn-small', function () { goTab('profile'); }, { fk: 'acc-edit-profile' }),
    }));

    var nameInput = textInput(u.displayName || '', { max: 32, fk: 'acc-name', onInput: checkDirty });
    var userInput = textInput(u.username || '', { max: 32, fk: 'acc-username', onInput: function () {
      var lower = userInput.value.toLowerCase();
      if (lower !== userInput.value) {
        var pos = userInput.selectionStart;
        userInput.value = lower;
        try { userInput.setSelectionRange(pos, pos); } catch (e) { /* ok */ }
      }
      checkDirty();
    } });
    var emailText = h('span', { class: 'gs-email', text: maskEmail(email) });
    var showBtn = h('button', { class: 'gs-link-btn', attrs: { type: 'button', 'aria-pressed': 'false', 'data-fk': 'acc-show-email' }, text: 'Mostrar', on: { click: function () {
      shown = !shown;
      emailText.textContent = shown ? email : maskEmail(email);
      showBtn.textContent = shown ? 'Ocultar' : 'Mostrar';
      showBtn.setAttribute('aria-pressed', shown ? 'true' : 'false');
    } } });

    var box = h('div', { class: 'gs-box' },
      field('Nome de exibição', nameInput, 'É como as pessoas veem você nos servidores e nas conversas.'),
      field('Nome de usuário', userInput, 'Único. Só letras minúsculas, números, _ e ponto (2 a 32). É por ele que te acham para adicionar como amigo.'),
      h('div', { class: 'gs-field' },
        h('div', { class: 'gs-label', text: 'E-mail' }),
        h('div', { class: 'gs-email-row' }, emailText, email ? showBtn : null)));
    panel.appendChild(box);

    useForm({ displayName: u.displayName || '', username: u.username || '' },
      function () { return { displayName: nameInput.value.trim(), username: userInput.value.trim() }; },
      function (cur) {
        if (cur.displayName.length < 1 || cur.displayName.length > 32 || /[<>]/.test(cur.displayName)) return 'O nome de exibição precisa ter de 1 a 32 caracteres, sem < ou >.';
        if (!USERNAME_RE.test(cur.username)) return 'Nome de usuário inválido: use 2 a 32 letras minúsculas, números, _ ou ponto.';
        var patch = {};
        if (cur.displayName !== (u.displayName || '')) patch.displayName = cur.displayName;
        if (cur.username !== (u.username || '')) patch.username = cur.username;
        return call('updateProfile', patch).then(function (r) { return r.ok ? null : r.error; });
      });

    var pwSec = section('Senha e autenticação', 'Enviamos um link para o seu e-mail para você criar uma senha nova.');
    var pwErr = errorBox();
    var pwOk = h('p', { class: 'gs-ok', attrs: { role: 'status', hidden: true } });
    pwSec.appendChild(btn('Trocar senha', 'btn-primary btn-small', function () {
      showError(pwErr, '');
      call('recover', { email: email }).then(function (r) {
        if (r.ok) { pwOk.textContent = 'Se o e-mail estiver certo, o link chega em instantes.'; pwOk.hidden = false; }
        else showError(pwErr, r.error);
      });
    }, { fk: 'acc-pw', disabled: !email }));
    pwSec.appendChild(pwErr);
    pwSec.appendChild(pwOk);
    panel.appendChild(pwSec);

    var out = section('Sessão');
    out.appendChild(btn('Sair da conta', 'btn-small', doLogout, { fk: 'acc-logout', icon: 'logout' }));
    panel.appendChild(out);

    var danger = section('Remoção da conta', 'Excluir a conta apaga seu perfil, amizades e mensagens diretas. Servidores que você é dono passam para outra pessoa ou são apagados. Não dá para desfazer.');
    var delErr = errorBox();
    danger.appendChild(btn('Excluir conta', 'btn-danger btn-small', function () {
      var name = u.username || u.displayName || '';
      openDialog({
        title: 'Excluir conta',
        body: 'Tem certeza? Tudo o que é seu no LUMENEX será apagado para sempre.',
        requireText: name,
        confirmLabel: 'Excluir conta',
        danger: true,
        onSubmit: function () {
          return call('deleteAccount').then(function (r) { return r.ok ? null : r.error; });
        },
      }).then(function (r) { if (r) close(true); });
    }, { fk: 'acc-delete' }));
    danger.appendChild(delErr);
    panel.appendChild(danger);
  }

  function renderProfile(panel) {
    var u = me();
    if (!u) { panel.appendChild(h('p', { class: 'gs-muted', text: 'Entre na sua conta para editar o perfil.' })); return; }
    var state = { avatarColor: Number.isInteger(u.avatarColor) ? u.avatarColor : 0 };
    var previewHost = h('div', { class: 'gs-preview-col' });
    var grid = h('div', { class: 'gs-profile-grid' });
    var left = h('div', { class: 'gs-profile-form' });

    var about = textInput(u.about || '', { multiline: true, max: 190, rows: 4, fk: 'pf-about', spellcheck: true, placeholder: 'Conte um pouco sobre você (heróis, rotas, horários)…', onInput: function () { checkDirty(); refreshPreview(); } });
    var custom = textInput(u.customStatus || '', { max: 128, fk: 'pf-custom', placeholder: 'Ex.: subindo para Divino 🔥', onInput: function () { checkDirty(); refreshPreview(); } });

    var avSec = section('Avatar, banner e efeitos', 'Foto e banner de até 40 MB (inclusive GIF e WebP animados), moldura e efeito especial ficam em Personalização do Perfil.');
    avSec.appendChild(h('div', { class: 'gs-btn-row' },
      btn('Abrir Personalização do Perfil', 'btn-primary btn-small', function () { goTab('look'); }, { fk: 'pf-open-look' })));
    avSec.appendChild(colorPicker('Cor do perfil', 'pf-color', state.avatarColor, function (c) { state.avatarColor = c; checkDirty(); refreshPreview(); }));
    avSec.appendChild(h('p', { class: 'gs-hint', text: 'A cor aparece no lugar do avatar e do banner quando você não usa imagem.' }));
    left.appendChild(avSec);

    var stSec = section(null);
    stSec.classList.add('gs-section-tight');
    stSec.appendChild(field('Texto do status', custom, 'Aparece embaixo do seu nome na lista de membros e de amigos.', counterFor(custom, 128)));
    left.appendChild(stSec);

    var abSec = section(null);
    abSec.classList.add('gs-section-tight');
    abSec.appendChild(field('Sobre mim', about, null, counterFor(about, 190)));
    left.appendChild(abSec);

    function refreshPreview() {
      clear(previewHost);
      previewHost.appendChild(h('div', { class: 'gs-label', text: 'Prévia' }));
      var draft = Object.assign({}, u, {
        avatarColor: state.avatarColor,
        customStatus: custom.value.trim(), about: about.value.trim(),
      });
      previewHost.appendChild(profileCard(draft, { showAbout: true, compact: true }));
    }
    refreshPreview();

    grid.appendChild(left);
    grid.appendChild(previewHost);
    panel.appendChild(grid);

    useForm({ about: u.about || '', custom: u.customStatus || '', color: state.avatarColor },
      function () { return { about: about.value.trim(), custom: custom.value.trim(), color: state.avatarColor }; },
      function (cur) {
        var chain = Promise.resolve(null);
        chain = chain.then(function () {
          var patch = {};
          if (cur.about !== (u.about || '')) patch.about = cur.about;
          if (cur.color !== u.avatarColor) patch.avatarColor = cur.color;
          if (!Object.keys(patch).length) return null;
          return call('updateProfile', patch).then(function (r) { return r.ok ? null : r.error; });
        });
        chain = chain.then(function (err) {
          if (err) return err;
          if (cur.custom === (u.customStatus || '')) return null;
          return call('setCustomStatus', cur.custom || null).then(function (r) { return r.ok ? null : r.error; });
        });
        return chain;
      });
  }

  function renderLook(panel) {
    if (!me()) { panel.appendChild(h('p', { class: 'gs-muted', text: 'Entre na sua conta para personalizar o perfil.' })); return; }
    var GL = window.GhostLook;
    if (!GL || typeof GL.renderEditor !== 'function') {
      panel.appendChild(h('p', { class: 'gs-muted', text: 'A personalização do perfil não carregou. Feche e abra o LUMENEX de novo.' }));
      return;
    }
    panel.appendChild(h('p', { class: 'gs-hint gs-section-desc', text: 'Tudo aqui é gratuito e aparece só no seu perfil e no seu cartão — o resto do app continua com o tema que você escolheu em Aparência.' }));
    var host = h('div', { class: 'gs-look-host' });
    panel.appendChild(host);
    var editor = GL.renderEditor(host, { bridge: S.bridge, getView: view, onDirtyChange: function () { checkDirty(); } });
    S.lookEditor = editor;
    S.form = { custom: true, isDirty: function () { return editor.isDirty(); }, nudge: function () { editor.nudge(); } };
    checkDirty();
  }

  function renderPrivacy(panel) {
    var v = view();
    var vis = (v.me && v.me.mmrVisibility) || (v.auth && v.auth.mmrVisibility) || 'friends';
    var err = errorBox();
    var sec = section('Quem vê o meu MMR', 'Vale para a lista de membros, o ranking e o seu cartão de perfil.');
    sec.appendChild(radioGroup('Visibilidade do MMR', 'pv-mmr', [
      { value: 'friends', label: 'Só amigos', desc: 'Pessoas que você aceitou como amigas.' },
      { value: 'group', label: 'Amigos e servidores', desc: 'Também quem está em um servidor com você.' },
      { value: 'nobody', label: 'Ninguém', desc: 'Seu MMR fica só para você.' },
    ], vis, function (val) {
      showError(err, '');
      call('updateProfile', { mmrVisibility: val }).then(function (r) {
        if (r.ok) announce('Visibilidade do MMR salva.');
        else { showError(err, r.error); renderPanel(false); }
      });
    }));
    sec.appendChild(err);
    panel.appendChild(sec);

    var blocked = (v.friends || []).filter(function (f) { return f.relation === 'blocked'; });
    var bsec = section('Pessoas bloqueadas', 'Quem você bloqueia não pode te mandar mensagem nem pedido de amizade.');
    if (!blocked.length) {
      bsec.appendChild(h('p', { class: 'gs-empty', text: 'Você não bloqueou ninguém.' }));
    } else {
      var list = h('ul', { class: 'gs-list', attrs: { role: 'list' } });
      var berr = errorBox();
      blocked.forEach(function (b) {
        list.appendChild(h('li', { class: 'gs-list-row' },
          avatar(b, 'sm'),
          h('span', { class: 'gs-list-main' }, h('span', { class: 'gs-list-name', text: b.displayName || b.username }), h('span', { class: 'gs-list-sub', text: '@' + (b.username || '') })),
          btn('Desbloquear', 'btn-small', function () {
            call('unblockUser', b.id).then(function (r) {
              if (r.ok) { announce((b.displayName || b.username) + ' foi desbloqueado.'); renderPanel(false); } else showError(berr, r.error);
            });
          }, { fk: 'pv-unblock-' + b.id, aria: 'Desbloquear ' + (b.displayName || b.username) })));
      });
      bsec.appendChild(list);
      bsec.appendChild(berr);
    }
    panel.appendChild(bsec);
  }

  function renderVoice(panel) {
    var host = h('div', { class: 'gs-voice-host' });
    panel.appendChild(host);
    var GV = window.GhostVoice;
    if (GV && typeof GV.renderSettings === 'function') {
      try {
        GV.renderSettings(host);
        S.voiceMounted = true;
        return;
      } catch (e) { clear(host); }
    }
    host.appendChild(h('p', { class: 'gs-muted', text: 'As configurações de voz e vídeo ainda não estão disponíveis nesta versão.' }));
  }

  function prefs() {
    var p = view().prefs || {};
    return {
      notifications: Object.assign({ desktop: true, sounds: true, mentionsOnly: false }, p.notifications || {}),
      appearance: Object.assign({ theme: 'dark', fontScale: 100, compact: false }, p.appearance || {}),
    };
  }

  function savePref(patch, err, okText) {
    showError(err, '');
    return call('updatePrefs', patch).then(function (r) {
      if (r.ok) { if (okText) announce(okText); }
      else { showError(err, r.error); renderPanel(false); }
      return r;
    });
  }

  function renderNotifications(panel) {
    var n = prefs().notifications;
    var err = errorBox();
    var sec = section('Notificações');
    sec.appendChild(toggle('Notificações na área de trabalho', 'Avisa de menções e mensagens diretas quando o LUMENEX está em segundo plano.', n.desktop, function (on) {
      if (on && typeof window.Notification === 'function' && window.Notification.permission === 'default') {
        try { window.Notification.requestPermission(); } catch (e) { /* ok */ }
      }
      savePref({ notifications: { desktop: on } }, err, on ? 'Notificações ligadas.' : 'Notificações desligadas.');
    }, 'nt-desktop'));
    sec.appendChild(toggle('Sons', 'Toca um som curto ao receber mensagem e ao entrar ou sair da voz.', n.sounds, function (on) {
      savePref({ notifications: { sounds: on } }, err, on ? 'Sons ligados.' : 'Sons desligados.');
    }, 'nt-sounds'));
    sec.appendChild(toggle('Só menções', 'Nos servidores, só avisa quando alguém te @mencionar. Mensagens diretas sempre avisam.', n.mentionsOnly, function (on) {
      savePref({ notifications: { mentionsOnly: on } }, err, on ? 'Só menções vão avisar.' : 'Todas as mensagens vão avisar.');
    }, 'nt-mentions'));
    sec.appendChild(err);
    panel.appendChild(sec);
    var muted = (view().prefs && view().prefs.muted) || [];
    var msec = section('Silenciados', muted.length ? 'Você silenciou ' + muted.length + (muted.length === 1 ? ' canal, servidor ou conversa.' : ' canais, servidores ou conversas.') + ' Para tirar, clique com o botão direito neles.' : 'Nada silenciado. Para silenciar, clique com o botão direito em um canal, servidor ou conversa.');
    panel.appendChild(msec);
  }

  function renderAppearance(panel) {
    var a = prefs().appearance;
    var err = errorBox();
    var sec = section('Tema');
    var themes = radioGroup('Tema', 'ap-theme', [
      { value: 'dark', label: 'Escuro', render: function () { return h('span', { class: 'gs-theme-swatch', attrs: { 'data-t': 'dark', 'aria-hidden': 'true' } }); } },
      { value: 'midnight', label: 'Meia-Noite (AMOLED)', render: function () { return h('span', { class: 'gs-theme-swatch', attrs: { 'data-t': 'midnight', 'aria-hidden': 'true' } }); } },
      { value: 'light', label: 'Claro', render: function () { return h('span', { class: 'gs-theme-swatch', attrs: { 'data-t': 'light', 'aria-hidden': 'true' } }); } },
    ], a.theme, function (t) { savePref({ appearance: { theme: t } }, err, 'Tema aplicado.'); }, 'gs-themes');
    themes.querySelector('legend').className = 'gs-sr';
    sec.appendChild(themes);
    panel.appendChild(sec);

    var fsec = section('Tamanho da fonte do chat');
    var sample = h('div', { class: 'gs-sample' + (a.compact ? ' is-compact' : '') });
    var u = me() || { displayName: 'Jogador', avatarColor: 1 };
    sample.appendChild(h('div', { class: 'gs-sample-msg' },
      avatar(u, 'md'),
      h('div', null,
        h('div', { class: 'gs-sample-head' }, h('span', { class: 'gs-sample-name', text: u.displayName || 'Jogador' }), h('span', { class: 'gs-sample-time', text: 'Hoje às 21:47' })),
        h('div', { class: 'gs-sample-body', text: 'Bora uma ranked? Tô com 87% de vitória de Invoker essa semana ⚡' }))));
    function applyScale(v) { sample.style.setProperty('--gs-sample-scale', String(v / 100)); }
    applyScale(a.fontScale);
    var rangeId = nextId('gs-range');
    var out = h('output', { class: 'gs-range-out', attrs: { for: rangeId }, text: a.fontScale + '%' });
    var range = h('input', { class: 'gs-range', attrs: { type: 'range', id: rangeId, min: '80', max: '130', step: '5', 'data-fk': 'ap-font', 'aria-valuetext': a.fontScale + '%' } });
    range.value = String(a.fontScale);
    range.addEventListener('input', function () {
      out.textContent = range.value + '%';
      range.setAttribute('aria-valuetext', range.value + '%');
      applyScale(Number(range.value));
    });
    range.addEventListener('change', function () { savePref({ appearance: { fontScale: Number(range.value) } }, err, 'Tamanho da fonte: ' + range.value + '%.'); });
    fsec.appendChild(h('div', { class: 'gs-range-row' },
      h('label', { class: 'gs-label', attrs: { for: rangeId }, text: 'Tamanho' }), range, out));
    fsec.appendChild(sample);
    panel.appendChild(fsec);

    var csec = section('Densidade');
    csec.appendChild(toggle('Modo compacto', 'Mostra mais mensagens na tela, com menos espaço entre elas.', a.compact, function (on) {
      sample.classList.toggle('is-compact', on);
      savePref({ appearance: { compact: on } }, err, on ? 'Modo compacto ligado.' : 'Modo compacto desligado.');
    }, 'ap-compact'));
    csec.appendChild(err);
    panel.appendChild(csec);
  }

  var KEYBINDS = [
    ['Busca rápida (servidores, canais, conversas, amigos)', ['Ctrl', 'K']],
    ['Canal anterior / próximo', ['Alt', '↑ / ↓']],
    ['Canal não lido anterior / próximo', ['Alt', 'Shift', '↑ / ↓']],
    ['Marcar canal como lido / fechar', ['Esc']],
    ['Mutar / desmutar microfone', ['Ctrl', 'Shift', 'M']],
    ['Ensurdecer / voltar a ouvir', ['Ctrl', 'Shift', 'D']],
    ['Editar sua última mensagem (campo vazio)', ['↑']],
    ['Lista de atalhos', ['Ctrl', '/']],
    ['Apertar para falar (quando ligado)', ['tecla escolhida em Voz e vídeo']],
    ['Abrir menu de contexto', ['Shift', 'F10']],
  ];

  function renderKeybinds(panel) {
    panel.appendChild(h('p', { class: 'gs-hint gs-section-desc', text: 'Atalhos do teclado do LUMENEX. Funcionam com a janela em foco.' }));
    var table = h('table', { class: 'gs-table gs-keys' });
    table.appendChild(h('caption', { class: 'gs-sr', text: 'Atalhos do teclado' }));
    table.appendChild(h('thead', null, h('tr', null, h('th', { attrs: { scope: 'col' }, text: 'Ação' }), h('th', { attrs: { scope: 'col' }, text: 'Atalho' }))));
    var tb = h('tbody');
    KEYBINDS.forEach(function (k) {
      var keys = h('td', { class: 'gs-key-cell' });
      k[1].forEach(function (key, i) {
        if (i > 0) keys.appendChild(h('span', { class: 'gs-key-plus', attrs: { 'aria-hidden': 'true' }, text: '+' }));
        keys.appendChild(h('kbd', { class: 'gs-kbd', text: key }));
      });
      tb.appendChild(h('tr', null, h('td', { text: k[0] }), keys));
    });
    table.appendChild(tb);
    panel.appendChild(table);
  }

  function doLogout() {
    confirmDialog({ title: 'Sair da conta', body: 'Tem certeza de que quer sair? Você sai também da sala de voz.', confirmLabel: 'Sair', danger: true }).then(function (yes) {
      if (!yes) return;
      call('signOut').then(function (r) {
        if (r.ok) close(true);
        else announce(r.error || 'Não foi possível sair.');
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Abas do servidor
  // ---------------------------------------------------------------------------
  function readOnlyNote(panel, text) {
    panel.appendChild(h('p', { class: 'gs-note', text: text || 'Só o dono e os admins podem mudar isto.' }));
  }

  function renderOverview(panel) {
    var s = currentServer();
    var admin = isAdmin();
    if (!admin) readOnlyNote(panel);
    var pending = { file: null };
    var state = { iconColor: Number.isInteger(s.iconColor) ? s.iconColor : 0 };
    var iconHost = h('div', { class: 'gs-sv-icon-host' });
    var nameInput = textInput(s.name || '', { max: 32, fk: 'ov-name', disabled: !admin, onInput: function () { checkDirty(); refreshIcon(); } });
    function refreshIcon() {
      clear(iconHost);
      iconHost.appendChild(serverIcon({ name: nameInput.value || s.name, iconColor: state.iconColor, iconUrl: s.iconUrl }, 'xxl', pending.file ? pending.file.preview : null));
    }
    refreshIcon();
    var err = errorBox();
    var file = h('input', { class: 'gs-sr', attrs: { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', tabindex: '-1', 'aria-hidden': 'true' } });
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      file.value = '';
      showError(err, '');
      readImage(f, 2 * 1048576).then(function (r) {
        if (r.error) { showError(err, r.error); return; }
        pending.file = r;
        checkDirty();
        refreshIcon();
      });
    });
    var top = h('div', { class: 'gs-overview' },
      h('div', { class: 'gs-ov-icon' }, iconHost,
        admin ? btn('Enviar imagem', 'btn-small', function () { file.click(); }, { fk: 'ov-upload' }) : null, file,
        h('p', { class: 'gs-hint', text: 'Quadrada, até 2 MB.' })),
      h('div', { class: 'gs-ov-fields' },
        field('Nome do servidor', nameInput, '2 a 32 caracteres.'),
        admin ? colorPicker('Cor do ícone', 'ov-color', state.iconColor, function (c) { state.iconColor = c; checkDirty(); refreshIcon(); }) : null,
        err));
    panel.appendChild(top);
    var count = Array.isArray(s.members) ? s.members.length : 0;
    panel.appendChild(h('p', { class: 'gs-hint', text: count + (count === 1 ? ' membro' : ' membros') + ' · seu cargo: ' + (ROLE_LABEL[s.role] || 'Membro') }));

    if (!admin) return;
    useForm({ name: s.name || '', iconColor: state.iconColor },
      function () { return { name: nameInput.value.trim(), iconColor: state.iconColor }; },
      function (cur) {
        if (cur.name.length < 2 || cur.name.length > 32 || /[<>]/.test(cur.name)) return 'O nome do servidor precisa ter de 2 a 32 caracteres, sem < ou >.';
        var chain = Promise.resolve(null);
        if (pending.file) {
          var f = pending.file;
          chain = call('uploadServerIcon', { serverId: s.id, name: f.name, mime: f.mime, data: f.data }).then(function (r) { return r.ok ? null : r.error; });
        }
        return chain.then(function (e) {
          if (e) return e;
          var patch = { serverId: s.id };
          if (cur.name !== s.name) patch.name = cur.name;
          if (cur.iconColor !== s.iconColor) patch.iconColor = cur.iconColor;
          if (Object.keys(patch).length === 1) return null;
          return call('updateServer', patch).then(function (r) { return r.ok ? null : r.error; });
        }).then(function (e) { if (!e) pending.file = null; return e; });
      },
      function () { return Boolean(pending.file); });
  }

  function byPos(a, b) { return (a.position || 0) - (b.position || 0) || String(a.name).localeCompare(String(b.name)); }

  function renderChannels(panel) {
    var s = currentServer();
    var admin = isAdmin();
    if (!admin) readOnlyNote(panel);
    var err = errorBox();
    var cats = (s.categories || []).slice().sort(byPos);
    var chans = (s.channels || []).slice();

    function result(r, okText) {
      if (r.ok) { if (okText) announce(okText); renderPanel(false); }
      else showError(err, r.error);
    }

    if (admin) {
      panel.appendChild(h('div', { class: 'gs-btn-row gs-toolbar' },
        btn('Criar canal', 'btn-primary btn-small', function () { createChannelDialog(null); }, { fk: 'ch-create', icon: 'plus' }),
        btn('Criar categoria', 'btn-small', function () {
          openDialog({
            title: 'Criar categoria',
            fields: [{ name: 'name', label: 'Nome da categoria', max: 32, placeholder: 'Nova categoria' }],
            confirmLabel: 'Criar categoria',
            onSubmit: function (v) {
              var n = String(v.name || '').trim();
              if (n.length < 1) return 'Dê um nome para a categoria.';
              return call('createCategory', { serverId: s.id, name: n }).then(function (r) { if (r.ok) { announce('Categoria criada.'); renderPanel(false); return null; } return r.error; });
            },
          });
        }, { fk: 'cat-create', icon: 'plus' })));
    }
    panel.appendChild(err);

    function createChannelDialog(categoryId) {
      openDialog({
        title: 'Criar canal',
        fields: [
          { name: 'kind', type: 'radio', label: 'Tipo de canal', value: 'text', options: [
            { value: 'text', label: 'Texto', desc: 'Mensagens, imagens, links e reações.' },
            { value: 'voice', label: 'Voz', desc: 'Conversa por voz, vídeo e tela compartilhada.' }] },
          { name: 'name', label: 'Nome do canal', max: 32, placeholder: 'novo-canal' },
          { name: 'category', type: 'select', label: 'Categoria', value: categoryId || '', options: [{ value: '', label: 'Sem categoria' }].concat(cats.map(function (c) { return { value: c.id, label: c.name }; })) },
        ],
        confirmLabel: 'Criar canal',
        onSubmit: function (v) {
          var n = String(v.name || '').trim();
          if (v.kind === 'text') n = n.toLowerCase().replace(/\s+/g, '-');
          if (n.length < 1) return 'Dê um nome para o canal.';
          return call('createChannel', { serverId: s.id, kind: v.kind, name: n, categoryId: v.category || null }).then(function (r) {
            if (r.ok) { announce('Canal criado.'); renderPanel(false); return null; }
            return r.error;
          });
        },
      });
    }

    // Ordem exibida: categoria (null primeiro) → texto antes de voz → posição.
    function orderedIn(catId) {
      return chans.filter(function (c) { return (c.categoryId || null) === catId; }).sort(function (a, b) {
        if (a.kind !== b.kind) return a.kind === 'text' ? -1 : 1;
        return byPos(a, b);
      });
    }
    function chLabel(c) { return (c.kind === 'text' ? '#' : '') + c.name; }

    // Leva o canal `id` para a categoria `catId`, na posição `index` da lista exibida dela, e salva a organização inteira.
    function placeChannel(id, catId, index) {
      var moving = chans.filter(function (c) { return c.id === id; })[0];
      if (!moving) return;
      var groups = {};
      [null].concat(cats.map(function (k) { return k.id; })).forEach(function (k) {
        groups[k] = orderedIn(k).filter(function (c) { return c.id !== id; });
      });
      var target = groups[catId] || (groups[catId] = []);
      index = clampInt(index, 0, target.length);
      target.splice(index, 0, moving);
      var layout = [];
      Object.keys(groups).forEach(function (k) {
        groups[k].forEach(function (c, i) { layout.push({ id: c.id, categoryId: k === 'null' ? null : k, position: i }); });
      });
      var catName = catId ? (cats.filter(function (k) { return k.id === catId; })[0] || {}).name : 'Sem categoria';
      call('reorderChannels', { serverId: s.id, channels: layout }).then(function (r) {
        result(r, chLabel(moving) + ' movido para a posição ' + (index + 1) + ' em ' + catName + '.');
      });
    }
    function placeCategory(id, index) {
      var rest = cats.filter(function (k) { return k.id !== id; });
      var moving = cats.filter(function (k) { return k.id === id; })[0];
      if (!moving) return;
      index = clampInt(index, 0, rest.length);
      rest.splice(index, 0, moving);
      var layout = chans.map(function (c) { return { id: c.id, categoryId: c.categoryId || null, position: c.position || 0 }; });
      call('reorderChannels', { serverId: s.id, channels: layout, categories: rest.map(function (k, i) { return { id: k.id, position: i }; }) }).then(function (r) {
        result(r, 'Categoria ' + moving.name + ' movida para a posição ' + (index + 1) + '.');
      });
    }
    function clampInt(v, a, b) { v = Math.round(Number(v)); if (!isFinite(v)) v = b; return Math.max(a, Math.min(b, v)); }

    // "Mover para…" (teclado e menu de contexto): mesma ação do arrastar, escolhida numa lista.
    function moveChannelDialog(c) {
      var opts = [];
      [null].concat(cats.map(function (k) { return k.id; })).forEach(function (k) {
        var name = k ? (cats.filter(function (x) { return x.id === k; })[0] || {}).name : 'Sem categoria';
        var list = orderedIn(k).filter(function (x) { return x.id !== c.id; });
        opts.push({ value: (k || '') + '|0', label: name + ' — no início' });
        list.forEach(function (x, i) { opts.push({ value: (k || '') + '|' + (i + 1), label: name + ' — depois de ' + chLabel(x) }); });
      });
      var cur = orderedIn(c.categoryId || null);
      var curIdx = cur.map(function (x) { return x.id; }).indexOf(c.id);
      openDialog({
        title: 'Mover ' + chLabel(c),
        fields: [{ name: 'to', type: 'select', label: 'Para onde', value: (c.categoryId || '') + '|' + Math.max(0, curIdx), options: opts }],
        confirmLabel: 'Mover',
        onSubmit: function (v) {
          var parts = String(v.to || '').split('|');
          placeChannel(c.id, parts[0] || null, Number(parts[1]) || 0);
          return null;
        },
      });
    }
    function moveCategoryDialog(cat) {
      var rest = cats.filter(function (k) { return k.id !== cat.id; });
      var opts = [{ value: '0', label: 'Primeira categoria' }].concat(rest.map(function (k, i) { return { value: String(i + 1), label: 'Depois de ' + k.name }; }));
      openDialog({
        title: 'Mover categoria ' + cat.name,
        fields: [{ name: 'to', type: 'select', label: 'Para onde', value: String(Math.max(0, cats.indexOf(cat))), options: opts }],
        confirmLabel: 'Mover',
        onSubmit: function (v) { placeCategory(cat.id, Number(v.to) || 0); return null; },
      });
    }
    function contextMenuFor(el, items, ev) {
      var UI = window.GhostUI;
      var r = el.getBoundingClientRect();
      var x = ev && ev.clientX ? ev.clientX : r.left + 24;
      var y = ev && ev.clientY ? ev.clientY : r.top + r.height / 2;
      if (UI && typeof UI.openContextMenu === 'function') UI.openContextMenu(items, x, y, el);
      else if (items[0]) items[0].action();
    }
    function bindMenu(el, items) {
      el.addEventListener('contextmenu', function (ev) { ev.preventDefault(); contextMenuFor(el, items, ev); });
      el.addEventListener('keydown', function (ev) {
        if (ev.target !== el) return;
        if (ev.key === 'ContextMenu' || (ev.shiftKey && ev.key === 'F10')) { ev.preventDefault(); contextMenuFor(el, items, null); }
      });
    }

    function channelRow(c, list, idx) {
      var label = chLabel(c);
      var row = h('li', { class: 'gs-list-row gs-ch-row', attrs: admin ? { 'data-dnd': 'channel', 'data-id': c.id, 'data-cat': c.categoryId || '', tabindex: '0', 'aria-label': label + ' — clique com o botão direito ou Shift+F10 para mover' } : null },
        h('span', { class: 'gs-ch-kind', attrs: { title: c.kind === 'text' ? 'Canal de texto' : 'Canal de voz' } }, icon(c.kind === 'text' ? 'text' : 'voice', 16), h('span', { class: 'gs-sr', text: c.kind === 'text' ? 'Texto:' : 'Voz:' })),
        h('span', { class: 'gs-list-main' },
          h('span', { class: 'gs-list-name', text: c.name }),
          c.topic ? h('span', { class: 'gs-list-sub', text: c.topic }) : null));
      if (admin) {
        row.appendChild(h('span', { class: 'gs-row-actions' },
          iconBtn('edit', 'Editar ' + label, function () {
            var fields = [{ name: 'name', label: 'Nome do canal', max: 32, value: c.name }];
            if (c.kind === 'text') fields.push({ name: 'topic', label: 'Tópico do canal', max: 1024, multiline: true, value: c.topic || '', placeholder: 'Sobre o que é este canal' });
            fields.push({ name: 'category', type: 'select', label: 'Categoria', value: c.categoryId || '', options: [{ value: '', label: 'Sem categoria' }].concat(cats.map(function (k) { return { value: k.id, label: k.name }; })) });
            openDialog({
              title: 'Editar ' + label,
              fields: fields,
              confirmLabel: 'Salvar',
              onSubmit: function (v) {
                var n = String(v.name || '').trim();
                if (c.kind === 'text') n = n.toLowerCase().replace(/\s+/g, '-');
                if (n.length < 1) return 'Dê um nome para o canal.';
                var patch = { channelId: c.id, name: n, categoryId: v.category || null };
                if (c.kind === 'text') patch.topic = String(v.topic || '').trim() || null;
                return call('updateChannel', patch).then(function (r) { if (r.ok) { announce('Canal salvo.'); renderPanel(false); return null; } return r.error; });
              },
            });
          }, 'ch-edit-' + c.id),
          iconBtn('trash', 'Apagar ' + label, function () {
            confirmDialog({ title: 'Apagar ' + label, body: 'Tem certeza? ' + (c.kind === 'text' ? 'Todas as mensagens deste canal serão apagadas. ' : '') + 'Não dá para desfazer.', confirmLabel: 'Apagar canal', danger: true }).then(function (yes) {
              if (!yes) return;
              call('deleteChannel', c.id).then(function (r) { result(r, label + ' apagado.'); });
            });
          }, 'ch-del-' + c.id)));
        bindMenu(row, [{ label: 'Mover para…', action: function () { moveChannelDialog(c); } }]);
      }
      return row;
    }

    function block(cat, ci) {
      var list = chans.filter(function (c) { return (c.categoryId || null) === (cat ? cat.id : null); }).sort(function (a, b) {
        if (a.kind !== b.kind) return a.kind === 'text' ? -1 : 1;
        return byPos(a, b);
      });
      if (!cat && !list.length) return null;
      var head = h('div', { class: 'gs-cat-head', attrs: admin && cat ? { 'data-dnd': 'category', 'data-id': cat.id, tabindex: '0', 'aria-label': 'Categoria ' + cat.name + ' — clique com o botão direito ou Shift+F10 para mover' } : null }, h('h3', { class: 'gs-cat-name', text: cat ? cat.name : 'Sem categoria' }));
      if (admin && cat) {
        bindMenu(head, [{ label: 'Mover para…', action: function () { moveCategoryDialog(cat); } }]);
        head.appendChild(h('span', { class: 'gs-row-actions' },
          iconBtn('plus', 'Criar canal em ' + cat.name, function () { createChannelDialog(cat.id); }, 'cat-add-' + cat.id),
          iconBtn('edit', 'Renomear categoria ' + cat.name, function () {
            openDialog({
              title: 'Renomear categoria',
              fields: [{ name: 'name', label: 'Nome da categoria', max: 32, value: cat.name }],
              confirmLabel: 'Salvar',
              onSubmit: function (v) {
                var n = String(v.name || '').trim();
                if (!n) return 'Dê um nome para a categoria.';
                return call('updateCategory', { categoryId: cat.id, name: n }).then(function (r) { if (r.ok) { renderPanel(false); return null; } return r.error; });
              },
            });
          }, 'cat-edit-' + cat.id),
          iconBtn('trash', 'Apagar categoria ' + cat.name, function () {
            confirmDialog({ title: 'Apagar categoria ' + cat.name, body: 'Os canais dela continuam existindo, só ficam sem categoria.', confirmLabel: 'Apagar categoria', danger: true }).then(function (yes) {
              if (!yes) return;
              call('deleteCategory', cat.id).then(function (r) { result(r, 'Categoria apagada.'); });
            });
          }, 'cat-del-' + cat.id)));
      }
      var ul = h('ul', { class: 'gs-list gs-ch-list', attrs: { role: 'list', 'data-cat': cat ? cat.id : '' } });
      if (!list.length) ul.appendChild(h('li', { class: 'gs-empty', text: 'Nenhum canal nesta categoria.' }));
      list.forEach(function (c, i) { ul.appendChild(channelRow(c, list, i)); });
      return h('div', { class: 'gs-cat', attrs: { 'data-cat': cat ? cat.id : '' } }, head, ul);
    }

    var listHost = h('div', { class: 'gs-ch-board' + (admin ? ' is-admin' : '') });
    append(listHost, block(null, -1));
    cats.forEach(function (c, i) { append(listHost, block(c, i)); });
    if (admin) panel.appendChild(h('p', { class: 'gs-hint gs-ch-hint', text: 'Arraste canais e categorias para reorganizar (no celular, toque e segure). Pelo teclado: Shift+F10 em um item e "Mover para…".' }));
    panel.appendChild(listHost);

    // Arrastar e soltar: só ADM; membro comum não recebe nada arrastável.
    if (admin && window.GhostDnd && typeof window.GhostDnd.attach === 'function') {
      if (S.chDnd) { try { S.chDnd.destroy(); } catch (e) { /* já destruído */ } }
      S.chDnd = window.GhostDnd.attach(listHost, {
        selector: '[data-dnd]',
        enabled: function () { return isAdmin(); },
        label: function (el) {
          var id = el.getAttribute('data-id');
          if (el.getAttribute('data-dnd') === 'category') { var k = cats.filter(function (x) { return x.id === id; })[0]; return k ? k.name : ''; }
          var c = chans.filter(function (x) { return x.id === id; })[0]; return c ? chLabel(c) : '';
        },
        resolve: function (el, x, y) {
          var hit = document.elementFromPoint(x, y);
          if (!hit || !listHost.contains(hit)) return null;
          var kind = el.getAttribute('data-dnd');
          if (kind === 'category') {
            var box = hit.closest('.gs-cat');
            if (!box || !box.getAttribute('data-cat') || box.contains(el)) return null;
            var rb = box.getBoundingClientRect();
            return { el: box, position: y < rb.top + rb.height / 2 ? 'before' : 'after' };
          }
          var row = hit.closest('[data-dnd="channel"]');
          if (row && row !== el) {
            var rr = row.getBoundingClientRect();
            return { el: row, position: y < rr.top + rr.height / 2 ? 'before' : 'after' };
          }
          var cbox = hit.closest('.gs-cat');
          if (cbox) { var u = cbox.querySelector('.gs-ch-list'); if (u) return { el: u, position: 'end' }; }
          return null;
        },
        onDrop: function (el, t) {
          var id = el.getAttribute('data-id');
          if (el.getAttribute('data-dnd') === 'category') {
            var refId = t.el.getAttribute('data-cat');
            var rest = cats.filter(function (k) { return k.id !== id; }).map(function (k) { return k.id; });
            var i = rest.indexOf(refId);
            if (i < 0) return;
            placeCategory(id, t.position === 'after' ? i + 1 : i);
            return;
          }
          if (t.position === 'end') {
            var cid = t.el.getAttribute('data-cat') || null;
            placeChannel(id, cid, orderedIn(cid).filter(function (c) { return c.id !== id; }).length);
            return;
          }
          var refCh = t.el.getAttribute('data-id');
          var catId = t.el.getAttribute('data-cat') || null;
          var list = orderedIn(catId).filter(function (c) { return c.id !== id; }).map(function (c) { return c.id; });
          var j = list.indexOf(refCh);
          if (j < 0) return;
          placeChannel(id, catId, t.position === 'after' ? j + 1 : j);
        },
      });
    }
  }

  function renderMembers(panel) {
    var s = currentServer();
    var myId = me() ? me().id : null;
    var owner = isOwner();
    var admin = isAdmin();
    var q = S.remote.memberQuery || '';
    var err = errorBox();
    var search = textInput(q, { placeholder: 'Buscar membros', fk: 'mb-search' });
    search.setAttribute('type', 'search');
    search.setAttribute('aria-label', 'Buscar membros');
    var listHost = h('div');
    search.addEventListener('input', function () { S.remote.memberQuery = search.value; drawList(); });
    panel.appendChild(h('div', { class: 'gs-toolbar' }, search));
    panel.appendChild(err);
    panel.appendChild(listHost);

    function act(r, okText) {
      if (r.ok) { announce(okText); renderPanel(false); } else showError(err, r.error);
    }

    function drawList() {
      clear(listHost);
      var needle = String(S.remote.memberQuery || '').trim().toLowerCase();
      var order = { owner: 0, admin: 1, member: 2 };
      var members = (s.members || []).filter(function (m) {
        if (!needle) return true;
        return [m.displayName, m.username, m.nickname].some(function (t) { return t && String(t).toLowerCase().indexOf(needle) >= 0; });
      }).sort(function (a, b) {
        return (order[a.role] - order[b.role]) || String(a.nickname || a.displayName || '').localeCompare(String(b.nickname || b.displayName || ''), 'pt-BR');
      });
      listHost.appendChild(h('p', { class: 'gs-hint', attrs: { 'aria-live': 'polite' }, text: members.length + (members.length === 1 ? ' membro' : ' membros') + (needle ? ' encontrados' : '') }));
      var table = h('ul', { class: 'gs-list gs-members', attrs: { role: 'list' } });
      members.forEach(function (m) {
        var name = m.nickname || m.displayName || m.username;
        var isMe = m.id === myId;
        var canTarget = !isMe && m.role !== 'owner' && (owner || (admin && m.role === 'member'));
        var row = h('li', { class: 'gs-list-row' },
          avatar(m, 'sm'),
          h('span', { class: 'gs-list-main' },
            h('span', { class: 'gs-list-name' }, name, isMe ? h('span', { class: 'gs-you', text: ' (você)' }) : null),
            h('span', { class: 'gs-list-sub', text: '@' + (m.username || '') + (m.nickname ? ' · ' + (m.displayName || '') : '') })),
          owner && !isMe && m.role !== 'owner' ? null : h('span', { class: 'gs-role gs-role-' + m.role }, m.role === 'owner' ? icon('crown', 14) : null, ROLE_LABEL[m.role] || 'Membro'));
        var actions = h('span', { class: 'gs-row-actions' });
        if (owner && !isMe && m.role !== 'owner') {
          var selId = nextId('gs-role');
          var sel = h('select', { class: 'gs-input gs-select-sm', attrs: { id: selId, 'aria-label': 'Cargo de ' + name, 'data-fk': 'mb-role-' + m.id } },
            h('option', { attrs: { value: 'member' }, text: 'Membro' }),
            h('option', { attrs: { value: 'admin' }, text: 'Admin' }));
          sel.value = m.role === 'admin' ? 'admin' : 'member';
          sel.addEventListener('change', function () {
            call('setMemberRole', { serverId: s.id, userId: m.id, role: sel.value }).then(function (r) { act(r, name + ' agora é ' + (sel.value === 'admin' ? 'admin.' : 'membro.')); });
          });
          actions.appendChild(sel);
        }
        if (canTarget) {
          actions.appendChild(btn('Expulsar', 'btn-small btn-quiet-danger', function () {
            confirmDialog({ title: 'Expulsar ' + name, body: name + ' sai do servidor, mas pode voltar com um convite.', confirmLabel: 'Expulsar', danger: true }).then(function (yes) {
              if (yes) call('kickMember', { serverId: s.id, userId: m.id }).then(function (r) { act(r, name + ' foi expulso.'); });
            });
          }, { fk: 'mb-kick-' + m.id, aria: 'Expulsar ' + name }));
          actions.appendChild(btn('Banir', 'btn-small btn-danger', function () {
            confirmDialog({ title: 'Banir ' + name, body: name + ' sai do servidor e não consegue voltar, nem com convite, até ser desbanido.', confirmLabel: 'Banir', danger: true }).then(function (yes) {
              if (yes) call('banMember', { serverId: s.id, userId: m.id }).then(function (r) { act(r, name + ' foi banido.'); });
            });
          }, { fk: 'mb-ban-' + m.id, aria: 'Banir ' + name }));
        }
        if (owner && !isMe && m.role !== 'owner') {
          actions.appendChild(iconBtn('crown', 'Transferir posse para ' + name, function () {
            openDialog({
              title: 'Transferir posse do servidor',
              body: name + ' vira dono de "' + s.name + '" e você vira admin. Só o novo dono pode desfazer.',
              requireText: s.name,
              confirmLabel: 'Transferir posse',
              danger: true,
              onSubmit: function () { return call('transferOwnership', { serverId: s.id, userId: m.id }).then(function (r) { return r.ok ? null : r.error; }); },
            }).then(function (r) { if (r) { announce('Posse transferida para ' + name + '.'); renderAll(false); } });
          }, 'mb-owner-' + m.id));
        }
        if (actions.childNodes.length) row.appendChild(actions);
        table.appendChild(row);
      });
      if (!members.length) table.appendChild(h('li', { class: 'gs-empty', text: 'Ninguém encontrado.' }));
      listHost.appendChild(table);
    }
    drawList();
  }

  var EXPIRY_OPTIONS = [
    { value: '', label: 'Nunca' },
    { value: '1800', label: '30 minutos' },
    { value: '3600', label: '1 hora' },
    { value: '21600', label: '6 horas' },
    { value: '43200', label: '12 horas' },
    { value: '86400', label: '1 dia' },
    { value: '604800', label: '7 dias' },
  ];
  var USES_OPTIONS = [
    { value: '', label: 'Sem limite' },
    { value: '1', label: '1 uso' },
    { value: '5', label: '5 usos' },
    { value: '10', label: '10 usos' },
    { value: '25', label: '25 usos' },
    { value: '50', label: '50 usos' },
    { value: '100', label: '100 usos' },
  ];

  function copyText(text, button) {
    function done(ok) {
      if (!button) return;
      var old = button.getAttribute('data-label') || button.textContent;
      button.setAttribute('data-label', old);
      button.textContent = ok ? 'Copiado!' : 'Copie manualmente';
      announce(ok ? 'Código copiado.' : 'Não deu para copiar. Selecione o código e copie.');
      window.setTimeout(function () { button.textContent = old; }, 1600);
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
        return;
      }
    } catch (e) { /* cai no aviso */ }
    done(false);
  }

  function select(options, value, label, fk) {
    var s = h('select', { class: 'gs-input', attrs: { 'aria-label': label, 'data-fk': fk } });
    options.forEach(function (o) { s.appendChild(h('option', { attrs: { value: o.value }, text: o.label })); });
    s.value = value;
    return s;
  }

  function renderInvites(panel) {
    var s = currentServer();
    var admin = isAdmin();
    var err = errorBox();

    var create = section('Criar convite', 'Por padrão o convite nunca expira e pode ser usado quantas vezes quiser.');
    var exp = select(EXPIRY_OPTIONS, '', 'Expira depois de', 'iv-exp');
    var uses = select(USES_OPTIONS, '', 'Número máximo de usos', 'iv-uses');
    var resultHost = h('div', { class: 'gs-invite-result', attrs: { 'aria-live': 'polite' } });
    create.appendChild(h('div', { class: 'gs-invite-form' },
      field('Expira depois de', exp), field('Número máximo de usos', uses),
      h('div', { class: 'gs-field gs-field-btn' }, btn('Gerar convite', 'btn-primary', function () {
        showError(err, '');
        var payload = { serverId: s.id, maxAgeSeconds: exp.value ? Number(exp.value) : null, maxUses: uses.value ? Number(uses.value) : null };
        call('createInvite', payload).then(function (r) {
          if (!r.ok) { showError(err, r.error); return; }
          S.lastInvite = r.invite || null;
          drawResult();
          if (admin) loadInvites(true);
        });
      }, { fk: 'iv-create' }))));
    create.appendChild(resultHost);
    create.appendChild(err);
    panel.appendChild(create);

    function drawResult() {
      clear(resultHost);
      var inv = S.lastInvite;
      if (!inv || !inv.code) return;
      var codeEl = h('input', { class: 'gs-input gs-code', attrs: { readonly: true, 'aria-label': 'Código do convite' } });
      codeEl.value = inv.code;
      codeEl.addEventListener('focus', function () { codeEl.select(); });
      var copyBtn = btn('Copiar', 'btn-primary btn-small', function () { copyText(inv.code, copyBtn); }, { fk: 'iv-copy', icon: 'copy' });
      resultHost.appendChild(h('div', { class: 'gs-code-row' }, codeEl, copyBtn));
      resultHost.appendChild(h('p', { class: 'gs-hint', text: 'Envie este código para a pessoa. Ela entra pelo botão "+" no LUMENEX. ' +
        (inv.expiresAt ? 'Expira ' + relTime(inv.expiresAt) + '. ' : 'Nunca expira. ') +
        (inv.maxUses ? 'Vale para ' + inv.maxUses + (inv.maxUses === 1 ? ' uso.' : ' usos.') : 'Usos ilimitados.') }));
    }
    drawResult();

    if (!admin) {
      readOnlyNote(panel, 'A lista de convites ativos aparece só para o dono e os admins.');
      return;
    }

    var listSec = section('Convites ativos');
    var listHost = h('div', { attrs: { 'aria-busy': 'false' } });
    listSec.appendChild(listHost);
    panel.appendChild(listSec);

    function draw() {
      clear(listHost);
      var data = S.remote.invites;
      if (!data || data.serverId !== s.id || data.status === 'loading') {
        listHost.setAttribute('aria-busy', 'true');
        listHost.appendChild(h('p', { class: 'gs-muted', text: 'Carregando convites…' }));
        return;
      }
      listHost.setAttribute('aria-busy', 'false');
      if (data.status === 'error') {
        listHost.appendChild(h('p', { class: 'gs-error', attrs: { role: 'alert' }, text: data.error }));
        listHost.appendChild(btn('Tentar de novo', 'btn-small', function () { loadInvites(true); }, { fk: 'iv-retry' }));
        return;
      }
      if (!data.items.length) { listHost.appendChild(h('p', { class: 'gs-empty', text: 'Nenhum convite ativo.' })); return; }
      var table = h('table', { class: 'gs-table' });
      table.appendChild(h('caption', { class: 'gs-sr', text: 'Convites ativos' }));
      table.appendChild(h('thead', null, h('tr', null,
        h('th', { attrs: { scope: 'col' }, text: 'Criado por' }),
        h('th', { attrs: { scope: 'col' }, text: 'Código' }),
        h('th', { attrs: { scope: 'col' }, text: 'Usos' }),
        h('th', { attrs: { scope: 'col' }, text: 'Expira' }),
        h('th', { attrs: { scope: 'col' } }, h('span', { class: 'gs-sr', text: 'Ações' })))));
      var tb = h('tbody');
      data.items.forEach(function (inv) {
        var author = userById(inv.createdBy) || {};
        var revokeBtn = btn('Revogar', 'btn-small btn-quiet-danger', function () {
          confirmDialog({ title: 'Revogar convite ' + inv.code, body: 'Quem tiver este código não vai mais conseguir entrar.', confirmLabel: 'Revogar', danger: true }).then(function (yes) {
            if (!yes) return;
            call('revokeInvite', inv.code).then(function (r) {
              if (r.ok) { announce('Convite revogado.'); if (S.lastInvite && S.lastInvite.code === inv.code) S.lastInvite = null; loadInvites(true); }
              else showError(err, r.error);
            });
          });
        }, { fk: 'iv-revoke-' + inv.code, aria: 'Revogar convite ' + inv.code });
        var copyBtn = iconBtn('copy', 'Copiar código ' + inv.code, function () { copyText(inv.code, null); announce('Código copiado.'); }, 'iv-cp-' + inv.code);
        tb.appendChild(h('tr', null,
          h('td', null, h('span', { class: 'gs-inline-user' }, avatar(author, 'xs'), author.displayName || author.username || 'Alguém')),
          h('td', null, h('code', { class: 'gs-code-text', text: inv.code }), copyBtn),
          h('td', { text: (inv.uses || 0) + ' / ' + (inv.maxUses ? inv.maxUses : '∞') }),
          h('td', { text: relTime(inv.expiresAt) }),
          h('td', { class: 'gs-td-actions' }, revokeBtn)));
      });
      table.appendChild(tb);
      listHost.appendChild(table);
    }

    function loadInvites(force) {
      var cur = S.remote.invites;
      if (!force && cur && cur.serverId === s.id && cur.status !== 'error') { draw(); return; }
      S.remote.invites = { serverId: s.id, status: 'loading', items: [] };
      draw();
      call('listInvites', s.id).then(function (r) {
        if (!S.remote.invites || S.remote.invites.serverId !== s.id) return;
        S.remote.invites = r.ok
          ? { serverId: s.id, status: 'ready', items: Array.isArray(r.invites) ? r.invites : [] }
          : { serverId: s.id, status: 'error', error: r.error, items: [] };
        S.sig = tabSignature();
        if (S.open && S.tab === 'invites') draw();
      });
    }
    loadInvites(false);
  }

  function renderBans(panel) {
    var s = currentServer();
    if (!isAdmin()) { readOnlyNote(panel); return; }
    var err = errorBox();
    var host = h('div');
    panel.appendChild(h('p', { class: 'gs-hint gs-section-desc', text: 'Pessoas banidas não conseguem voltar ao servidor, nem com convite.' }));
    panel.appendChild(err);
    panel.appendChild(host);

    function draw() {
      clear(host);
      var d = S.remote.bans;
      if (!d || d.serverId !== s.id || d.status === 'loading') { host.appendChild(h('p', { class: 'gs-muted', text: 'Carregando banimentos…' })); return; }
      if (d.status === 'error') {
        host.appendChild(h('p', { class: 'gs-error', attrs: { role: 'alert' }, text: d.error }));
        host.appendChild(btn('Tentar de novo', 'btn-small', function () { load(true); }, { fk: 'bn-retry' }));
        return;
      }
      if (!d.items.length) { host.appendChild(h('p', { class: 'gs-empty', text: 'Ninguém foi banido deste servidor.' })); return; }
      var ul = h('ul', { class: 'gs-list', attrs: { role: 'list' } });
      d.items.forEach(function (b) {
        var name = b.displayName || b.username || 'Alguém';
        ul.appendChild(h('li', { class: 'gs-list-row' },
          avatar(b, 'sm'),
          h('span', { class: 'gs-list-main' },
            h('span', { class: 'gs-list-name', text: name }),
            h('span', { class: 'gs-list-sub', text: '@' + (b.username || '') + (b.bannedAt ? ' · banido em ' + dateLabel(b.bannedAt) : '') })),
          btn('Desbanir', 'btn-small', function () {
            call('unbanMember', { serverId: s.id, userId: b.id }).then(function (r) {
              if (r.ok) { announce(name + ' foi desbanido.'); load(true); } else showError(err, r.error);
            });
          }, { fk: 'bn-un-' + b.id, aria: 'Desbanir ' + name })));
      });
      host.appendChild(ul);
    }

    function load(force) {
      var cur = S.remote.bans;
      if (!force && cur && cur.serverId === s.id && cur.status !== 'error') { draw(); return; }
      S.remote.bans = { serverId: s.id, status: 'loading', items: [] };
      draw();
      call('listBans', s.id).then(function (r) {
        if (!S.remote.bans || S.remote.bans.serverId !== s.id) return;
        S.remote.bans = r.ok ? { serverId: s.id, status: 'ready', items: Array.isArray(r.bans) ? r.bans : [] } : { serverId: s.id, status: 'error', error: r.error, items: [] };
        S.sig = tabSignature();
        if (S.open && S.tab === 'bans') draw();
      });
    }
    load(false);
  }

  function renderDelete(panel) {
    var s = currentServer();
    var err = errorBox();
    if (isOwner()) {
      panel.appendChild(h('div', { class: 'gs-danger-box' },
        h('span', { class: 'gs-danger-icon' }, icon('warn', 22)),
        h('div', null,
          h('p', { class: 'gs-danger-title', text: 'Excluir "' + s.name + '"' }),
          h('p', { text: 'Apaga o servidor, todos os canais, mensagens e convites. Ninguém consegue recuperar. Se quiser só sair, transfira a posse para alguém em Membros antes.' }))));
      panel.appendChild(btn('Excluir servidor', 'btn-danger-solid', function () {
        openDialog({
          title: 'Excluir "' + s.name + '"',
          body: 'Esta ação não pode ser desfeita.',
          requireText: s.name,
          confirmLabel: 'Excluir servidor',
          danger: true,
          onSubmit: function () { return call('deleteServer', s.id).then(function (r) { return r.ok ? null : r.error; }); },
        }).then(function (r) { if (r) close(true); });
      }, { fk: 'del-server' }));
    } else {
      panel.appendChild(h('p', { text: 'Você sai de "' + s.name + '" e para de ver os canais dele. Para voltar, precisa de um convite novo.' }));
      panel.appendChild(btn('Sair do servidor', 'btn-danger-solid', function () {
        confirmDialog({ title: 'Sair de "' + s.name + '"', body: 'Tem certeza de que quer sair do servidor?', confirmLabel: 'Sair do servidor', danger: true }).then(function (yes) {
          if (!yes) return;
          call('leaveServer', s.id).then(function (r) { if (r.ok) close(true); else showError(err, r.error); });
        });
      }, { fk: 'leave-server' }));
    }
    panel.appendChild(err);
  }

  var RENDER = {
    account: renderAccount, profile: renderProfile, look: renderLook, privacy: renderPrivacy, voice: renderVoice,
    notifications: renderNotifications, appearance: renderAppearance, keybinds: renderKeybinds,
    overview: renderOverview, channels: renderChannels, members: renderMembers, invites: renderInvites,
    bans: renderBans, delete: renderDelete,
  };

  // ---------------------------------------------------------------------------
  // Teclado: Esc e foco preso
  // ---------------------------------------------------------------------------
  function focusables(container) {
    var list = container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    return Array.prototype.filter.call(list, function (el) {
      return !el.closest('[hidden]') && (el.offsetParent !== null || el === document.activeElement);
    });
  }

  function onKeydown(ev) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      if (S.dialog) { closeDialog(null); return; }
      requestClose();
      return;
    }
    if (ev.key === 'Tab') {
      var scope = S.dialog ? S.dialog.overlay : S.root;
      var items = focusables(scope);
      if (!items.length) { ev.preventDefault(); return; }
      var first = items[0];
      var last = items[items.length - 1];
      var active = document.activeElement;
      if (!scope.contains(active)) { ev.preventDefault(); first.focus(); return; }
      if (ev.shiftKey && active === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && active === last) { ev.preventDefault(); first.focus(); }
    }
  }

  // ---------------------------------------------------------------------------
  // Abrir / fechar
  // ---------------------------------------------------------------------------
  function openWith(kind, tab, serverId) {
    build();
    var wasOpen = S.open;
    if (wasOpen && isDirty()) { nudgeUnsaved(); return; }
    if (!wasOpen) S.returnFocus = document.activeElement;
    leaveTab();
    S.kind = kind;
    S.serverId = serverId || null;
    S.tab = tab;
    S.form = null;
    S.lastInvite = null;
    S.remote = {};
    S.els.unsaved.hidden = true;
    S.open = true;
    S.root.hidden = false;
    S.root.classList.remove('is-closing');
    S.root.setAttribute('data-kind', kind);
    document.documentElement.classList.add('gs-open');
    var app = document.getElementById('app');
    if (app) app.setAttribute('aria-hidden', 'true');
    if (!wasOpen && !prefersReducedMotion()) {
      S.root.classList.remove('is-entering');
      void S.root.offsetWidth;
      S.root.classList.add('is-entering');
    }
    renderAll(true);
  }

  function openUser(tab) {
    var t = RENDER[tab] && ['account', 'profile', 'look', 'privacy', 'voice', 'notifications', 'appearance', 'keybinds'].indexOf(tab) >= 0 ? tab : 'account';
    openWith('user', t);
  }

  function openServer(serverId, tab) {
    if (typeof serverId !== 'string' || !serverId) return;
    var v = view();
    if ((!v.server || v.server.id !== serverId) && S.bridge && typeof S.bridge.select === 'function') {
      call('select', { mode: 'server', serverId: serverId }).then(function () { if (S.open && S.kind === 'server') renderAll(false); });
    }
    var allowed = ['overview', 'channels', 'members', 'invites', 'bans', 'delete'];
    openWith('server', allowed.indexOf(tab) >= 0 ? tab : 'overview', serverId);
  }

  function requestClose() {
    if (S.dialog) { closeDialog(null); return; }
    if (isDirty()) { nudgeUnsaved(); return; }
    close(false);
  }

  function close(force) {
    if (!S.open) return;
    if (!force && isDirty()) { nudgeUnsaved(); return; }
    closeDialog(null);
    leaveTab();
    S.open = false;
    S.form = null;
    S.remote = {};
    S.lastInvite = null;
    document.documentElement.classList.remove('gs-open');
    var app = document.getElementById('app');
    if (app) app.removeAttribute('aria-hidden');
    var finish = function () {
      if (S.open) return;
      S.root.hidden = true;
      S.root.classList.remove('is-closing', 'is-entering');
      clear(S.els.panel);
    };
    if (prefersReducedMotion()) finish();
    else {
      S.root.classList.add('is-closing');
      window.setTimeout(finish, 160);
    }
    var rf = S.returnFocus;
    S.returnFocus = null;
    if (rf && document.contains(rf) && typeof rf.focus === 'function') rf.focus();
    try { S.onClose(); } catch (e) { /* o app não pode quebrar as configurações */ }
  }

  function update(v) {
    if (v && typeof v === 'object') S.view = v;
    if (!S.open || !S.root) return;
    if (S.kind === 'server') {
      var cur = view();
      // Servidor apagado ou você saiu: fecha.
      if (cur.servers && Array.isArray(cur.servers) && !cur.servers.some(function (s) { return s.id === S.serverId; })) { close(true); return; }
      // Cargo ou nome mudou: refaz o menu (ex.: virou admin), mantendo o foco.
      var navSig = JSON.stringify(serverNav());
      if (navSig !== S.navSig) {
        var a = document.activeElement;
        var fk = a && S.root.contains(a) ? a.getAttribute('data-fk') : null;
        renderNav();
        if (fk && fk.indexOf('nav-') === 0) {
          var again = S.root.querySelector('[data-fk="' + cssEscape(fk) + '"]');
          if (again) again.focus({ preventScroll: true });
        }
      }
    }
    if (S.kind === 'user' && !me()) { close(true); return; }
    if (S.lookEditor) { try { S.lookEditor.update(view()); } catch (e) { /* editor */ } return; }
    if (isDirty() || S.dialog) return;
    var sig = tabSignature();
    if (sig !== S.sig) renderPanel(false);
  }

  function init(opts) {
    var o = opts || {};
    S.bridge = o.bridge || window.ghostRank || null;
    if (typeof o.getView === 'function') S.getView = o.getView;
    if (typeof o.onClose === 'function') S.onClose = o.onClose;
    build();
  }

  window.GhostSettings = {
    init: init,
    openUser: openUser,
    openServer: openServer,
    update: update,
    isOpen: function () { return S.open; },
    close: function () { requestClose(); },
  };
})();
