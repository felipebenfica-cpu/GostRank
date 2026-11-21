/* Harness da frente LOOK: ?m=frames | effects | editor | channels &role=admin|member &e=<efeito> */
(function () {
  'use strict';
  var q = new URLSearchParams(location.search);
  var mode = q.get('m') || 'frames';
  var GL = window.GhostLook;
  var root = document.getElementById('app');

  function photo(seed, w, hgt) {
    var c = document.createElement('canvas'); c.width = w || 256; c.height = hgt || 256;
    var g = c.getContext('2d');
    var gr = g.createLinearGradient(0, 0, c.width, c.height);
    var hues = [[28, 70], [210, 260], [330, 10], [140, 190]][seed % 4];
    gr.addColorStop(0, 'hsl(' + hues[0] + ',70%,45%)'); gr.addColorStop(1, 'hsl(' + hues[1] + ',60%,22%)');
    g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.arc(c.width / 2, c.height * 0.42, c.width * 0.18, 0, 7); g.fill();
    g.beginPath(); g.ellipse(c.width / 2, c.height * 0.95, c.width * 0.33, c.height * 0.3, 0, 0, 7); g.fill();
    return c.toDataURL('image/png');
  }
  function user(i, extra) {
    var src = photo(i);
    return Object.assign({ id: 'u' + i, username: 'jogador' + i, displayName: 'Jogador ' + (i + 1), avatarColor: i % 8, avatarUrl: src, avatarThumbUrl: src,
      bannerUrl: photo(i + 1, 600, 200), bannerPos: 50, status: 'online', customStatus: 'na fila de ranqueada', about: 'Mid main. Invoker e Storm.' }, extra || {});
  }
  function title(t) { var e = document.createElement('h1'); e.className = 'hl-title'; e.textContent = t; root.appendChild(e); }

  if (mode === 'frames') {
    title('Molduras — 96 px, 40 px e 28 px');
    var grid = document.createElement('div'); grid.className = 'hl-grid'; root.appendChild(grid);
    GL.FRAMES.forEach(function (f, i) {
      var cell = document.createElement('div'); cell.className = 'hl-cell';
      var row = document.createElement('div'); row.className = 'hl-row';
      var u = user(i, { frame: f.id });
      [96, 40, 28].forEach(function (sz) { row.appendChild(GL.avatar(u, { size: sz, frame: true, animate: 'always', status: 'online' })); });
      cell.appendChild(row);
      var l = document.createElement('small'); l.textContent = f.label; cell.appendChild(l);
      grid.appendChild(cell);
    });
  } else if (mode === 'effects') {
    title('Efeitos de perfil (dentro do cartão)');
    var only = q.get('e');
    var wrap = document.createElement('div'); wrap.className = 'hl-cards'; root.appendChild(wrap);
    GL.EFFECTS.filter(function (e) { return !only || e.id === only; }).forEach(function (e, i) {
      var u = user(i, { effect: e.id, frame: GL.FRAMES[i].id, displayName: e.label });
      var card = GL.profileCard(u, { compact: true });
      wrap.appendChild(card);
      GL.mountCardEffect(card, u);
    });
  } else {
    var role = q.get('role') || 'admin';
    var me = user(0, { id: 'u-me', username: 'felipe', displayName: 'Felipe', frame: 'gold', effect: 'burst', avatarCrop: { x: 50, y: 40, zoom: 1.2 }, about: 'Carry.', mmrVisibility: 'group' });
    var view = {
      me: me, auth: { status: 'signed_in', email: 'felipe@exemplo.com' },
      prefs: { notifications: { desktop: true, sounds: true, mentionsOnly: false }, muted: [], appearance: { theme: q.get('theme') || 'dark', fontScale: 100, compact: false }, voice: {} },
      uploads: { avatar: q.get('up') ? { status: 'uploading', progress: 0.42, error: null } : null, banner: null },
      friends: [], servers: [{ id: 's1', name: 'Os Assombrados', iconColor: 0, role: role }],
      server: { id: 's1', name: 'Os Assombrados', iconColor: 0, role: role, ownerId: 'u-me',
        categories: [{ id: 'k1', name: 'Canais de texto', position: 0 }, { id: 'k2', name: 'Canais de voz', position: 1 }],
        channels: [
          { id: 'c1', kind: 'text', name: 'geral', categoryId: 'k1', position: 0 }, { id: 'c2', kind: 'text', name: 'clipes', categoryId: 'k1', position: 1 },
          { id: 'v1', kind: 'voice', name: 'Geral', categoryId: 'k2', position: 0 }, { id: 'v2', kind: 'voice', name: 'Ranked 5x', categoryId: 'k2', position: 1 }],
        members: [Object.assign({ role: role }, me)] },
    };
    window.__calls = [];
    var bridge = new Proxy({}, { get: function (t, k) {
      return function (p) {
        window.__calls.push([k, p]);
        if (k === 'reorderChannels') {
          p.channels.forEach(function (c) { var ch = view.server.channels.filter(function (x) { return x.id === c.id; })[0]; if (ch) { ch.categoryId = c.categoryId; ch.position = c.position; } });
          if (p.categories) p.categories.forEach(function (c) { var k2 = view.server.categories.filter(function (x) { return x.id === c.id; })[0]; if (k2) k2.position = c.position; });
        }
        if (k === 'updateProfileLook') Object.keys(p || {}).forEach(function (key) { me[key] = p[key]; });
        return Promise.resolve({ ok: true, view: view });
      };
    } });
    GhostSettings.init({ bridge: bridge, getView: function () { return view; } });
    GhostSettings.update(view);
    if (mode === 'channels') GhostSettings.openServer('s1', 'channels');
    else if (mode === 'appearance') GhostSettings.openUser('appearance');
    else GhostSettings.openUser('look');
  }
})();
/* Diagnóstico: ?probe=1 conta pixels pintados no canvas do efeito e grava em <body data-probe>. */
(function () {
  if (!new URLSearchParams(location.search).get('probe')) return;
  setInterval(function () {
    var c = document.querySelector('canvas.gl-fx'); if (!c) return;
    var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, n = 0, maxA = 0;
    for (var i = 3; i < d.length; i += 4) { if (d[i] > 8) n++; if (d[i] > maxA) maxA = d[i]; }
    document.body.setAttribute('data-probe', n + ':' + maxA);
  }, 200);
})();
/* Teste do arrastar: ?m=channels&role=admin&simdrag=1 arrasta "clipes" para antes de "geral" e grava o resultado em <body data-calls>. */
(function () {
  var q = new URLSearchParams(location.search);
  if (!q.get('simdrag')) return;
  setTimeout(function () {
    var src = document.querySelector('[data-dnd="channel"][data-id="c2"]');
    var dst = document.querySelector('[data-dnd="channel"][data-id="c1"]');
    document.body.setAttribute('data-src', src ? 'yes' : 'no');
    if (!src || !dst) return;
    var a = src.getBoundingClientRect(), b = dst.getBoundingClientRect();
    function ev(type, el, x, y) { el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y })); }
    var x0 = a.left + 60, y0 = a.top + a.height / 2;
    ev('pointerdown', src, x0, y0);
    var steps = [[x0, y0 - 10], [x0, b.top + 12], [x0, b.top + 6]];
    steps.forEach(function (p, i) { setTimeout(function () { ev('pointermove', document.elementFromPoint(p[0], p[1]) || document, p[0], p[1]); }, 30 * (i + 1)); });
    setTimeout(function () { ev('pointerup', document.elementFromPoint(x0, b.top + 6) || document, x0, b.top + 6); }, 160);
    setTimeout(function () { document.body.setAttribute('data-calls', JSON.stringify(window.__calls.filter(function (c) { return c[0] === 'reorderChannels'; }))); }, 400);
  }, 300);
})();
