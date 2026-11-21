/* Harness isolado da frente R3: ?k=user|server&t=<aba>&role=owner|admin|member&dirty=1&dlg=1 */
(function () {
  'use strict';
  var q = new URLSearchParams(location.search);
  var ME = 'u-me';
  function u(id, username, displayName, color, extra) { return Object.assign({ id: id, username: username, displayName: displayName, avatarColor: color, avatarUrl: null, customStatus: '' }, extra || {}); }
  var role = q.get('role') || 'owner';
  var view = {
    me: u(ME, 'fantasma.noturno', 'Fantasma Noturno', 1, { about: 'Mid main. Invoker e Storm. Jogo à noite depois das 21h.', customStatus: 'subindo para Divino 🔥', status: 'online', mmrVisibility: 'group' }),
    auth: { status: 'signed_in', email: 'fantasma@exemplo.com', mmrVisibility: 'group' },
    prefs: { notifications: { desktop: true, sounds: true, mentionsOnly: false }, muted: ['c:x'], appearance: { theme: 'dark', fontScale: 100, compact: false }, voice: {} },
    friends: [u('u-b1', 'troll.lua', 'Lua Trolladora', 6, { relation: 'blocked' }), u('u-f1', 'cris', 'Cris', 2, { relation: 'friend' })],
    servers: [{ id: 's1', name: 'Os Assombrados', iconColor: 0, role: role }],
    server: {
      id: 's1', name: 'Os Assombrados', iconColor: 0, iconUrl: null, role: role, ownerId: role === 'owner' ? ME : 'u-2',
      categories: [{ id: 'k1', name: 'Canais de texto', position: 0 }, { id: 'k2', name: 'Canais de voz', position: 1 }],
      channels: [
        { id: 'c1', kind: 'text', name: 'geral', topic: 'Papo geral e combinados de partida', categoryId: 'k1', position: 0 },
        { id: 'c2', kind: 'text', name: 'clipes', topic: null, categoryId: 'k1', position: 1 },
        { id: 'c3', kind: 'text', name: 'builds', topic: 'Itens e talentos', categoryId: 'k1', position: 2 },
        { id: 'v1', kind: 'voice', name: 'Geral', categoryId: 'k2', position: 0 },
        { id: 'v2', kind: 'voice', name: 'Ranked 5x', categoryId: 'k2', position: 1 },
        { id: 'c9', kind: 'text', name: 'regras', categoryId: null, position: 0 },
      ],
      members: [
        u(ME, 'fantasma.noturno', 'Fantasma Noturno', 1, { role: role }),
        u('u-2', 'lua.sombria', 'Lua Sombria', 3, { role: role === 'owner' ? 'admin' : 'owner' }),
        u('u-3', 'eco', 'Eco', 2, { role: 'member', nickname: 'Eco Carregador' }),
        u('u-4', 'vulto', 'Vulto', 4, { role: 'member' }),
        u('u-5', 'nevoa', 'Névoa', 7, { role: 'member' }),
      ],
    },
  };
  function ok() { return Promise.resolve({ ok: true, view: view }); }
  var bridge = new Proxy({
    listInvites: function () { return new Promise(function (r) { setTimeout(function () { r({ ok: true, invites: [
      { code: 'K7M2QX9PTA', createdBy: ME, expiresAt: null, maxUses: null, uses: 12 },
      { code: 'H4RZ8WCNJE', createdBy: 'u-2', expiresAt: new Date(Date.now() + 5 * 3600e3).toISOString(), maxUses: 10, uses: 3 }] }); }, 150); }); },
    listBans: function () { return Promise.resolve({ ok: true, bans: [u('u-9', 'griefer99', 'Griefer', 6, { bannedAt: '2026-11-10T12:00:00Z' })] }); },
    createInvite: function (p) { return Promise.resolve({ ok: true, invite: { code: 'FANTASMA23', expiresAt: p.maxAgeSeconds ? new Date(Date.now() + p.maxAgeSeconds * 1000).toISOString() : null, maxUses: p.maxUses, uses: 0 } }); },
  }, { get: function (t, k) { return t[k] || function () { console.log('[bridge]', k, arguments[0]); return ok(); }; } });

  window.GhostVoice = { renderSettings: function (el) {
    var p = document.createElement('p'); p.className = 'gs-hint'; p.textContent = '(GhostVoice.renderSettings montado aqui pela frente V)'; el.appendChild(p);
  }, destroySettings: function () {} };

  GhostSettings.init({ bridge: bridge, getView: function () { return view; } });
  GhostSettings.update(view);
  function go() {
    if ((q.get('k') || 'user') === 'server') GhostSettings.openServer('s1', q.get('t') || 'overview');
    else GhostSettings.openUser(q.get('t') || 'account');
    if (q.get('dirty')) setTimeout(function () {
      var i = document.querySelector('.gs-panel input.gs-input, .gs-panel textarea');
      if (i) { i.value += ' editado'; i.dispatchEvent(new Event('input')); }
    }, 50);
    if (q.get('dlg')) setTimeout(function () { var b = document.querySelector('[data-fk^="ch-edit-"], [data-fk="acc-delete"]'); if (b) b.click(); }, 80);
    if (q.get('gen')) setTimeout(function () { var b = document.querySelector('[data-fk="iv-create"]'); if (b) b.click(); }, 80);
  }
  document.getElementById('opener').addEventListener('click', go);
  go();
})();
