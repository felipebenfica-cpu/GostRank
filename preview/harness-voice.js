/* Banco de testes da voz: ponte e view mínimas no formato da Etapa 6.
   ?join=1 entra no canal Geral · ?cam=1 liga a câmera · ?ptt=1 modo apertar-para-falar
   ?dm=1 chamada com Lua · ?settings=1 abre a aba Voz e vídeo · ?full=1 (com settings) prefs extras
   ?move=1 (com join) um ADM move você para Ranqueada · ?look=1 usa um GhostLook falso (moldura) */
(function () {
  'use strict';
  var q = new URLSearchParams(location.search);
  if (q.get('look') && !window.GhostLook) {
    // GhostLook falso só para conferir o encaixe (o real é src/renderer/profile-look.js)
    window.GhostLook = { avatar: function (user, o) {
      var w = document.createElement('span'); w.className = 'hv-look' + (o && o.frame ? ' hv-look-frame' : '');
      w.textContent = (user.displayName || '?').charAt(0).toUpperCase(); return w; } };
  }
  var ME = '11111111-1111-4111-8111-111111111111';
  var LUA = '22222222-2222-4222-8222-222222222222';
  var SOMBRA = '33333333-3333-4333-8333-333333333333';
  var ECO = '44444444-4444-4444-8444-444444444444';
  var SERVER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  var CH_GERAL = 'c0000000-0000-4000-8000-000000000001';
  var CH_RANKED = 'c0000000-0000-4000-8000-000000000002';
  var DM_LUA = 'd0000000-0000-4000-8000-000000000001';
  function u(id, name, color) { return { id: id, username: name.toLowerCase(), displayName: name, avatarColor: color, avatarUrl: null, customStatus: null }; }
  var view = {
    auth: { status: 'signed_in' },
    me: Object.assign(u(ME, 'Fantasma Noturno', 0), { about: '', status: 'online' }),
    users: {},
    voice: { available: true },
    prefs: {
      notifications: { desktop: true, sounds: true, mentionsOnly: false },
      muted: [],
      voice: { inputDeviceId: 'default', outputDeviceId: 'default', mode: q.get('ptt') ? 'ptt' : 'vad', pttKey: 'KeyV',
        sensitivity: -45, autoSensitivity: !q.get('manual'), noiseSuppression: true, echoCancellation: true,
        inputVolume: 100, outputVolume: 100, cameraDeviceId: 'default' },
      appearance: { theme: 'dark', fontScale: 100, compact: false }
    },
    servers: [{ id: SERVER, name: 'Os Assombrados', iconColor: 1, iconUrl: null, role: 'owner', unread: false, mentions: 0, muted: false }],
    server: {
      id: SERVER, name: 'Os Assombrados', iconColor: 1, iconUrl: null, role: 'owner', ownerId: ME,
      categories: [{ id: 'k1', name: 'Canais de voz', position: 0 }],
      channels: [
        { id: CH_GERAL, kind: 'voice', name: 'Geral', topic: null, categoryId: 'k1', position: 0, unread: false, mentions: 0, muted: false },
        { id: CH_RANKED, kind: 'voice', name: 'Ranqueada', topic: null, categoryId: 'k1', position: 1, unread: false, mentions: 0, muted: false }
      ],
      members: []
    },
    dms: [{ id: DM_LUA, user: u(LUA, 'Lua', 1), lastMessageAt: null, unread: 0, mentions: 0, muted: false }],
    selection: { mode: 'server', serverId: SERVER, channelId: CH_GERAL },
    voiceStates: {}
  };
  view.voiceStates[CH_RANKED] = [{ userId: SOMBRA, muted: true, deafened: false, streaming: false, video: false }, { userId: LUA, muted: false, deafened: false, streaming: true, video: true }];
  [u(ME, 'Fantasma Noturno', 0), u(LUA, 'Lua', 1), u(SOMBRA, 'Sombra', 3), u(ECO, 'Eco', 2)].forEach(function (x) { view.users[x.id] = x; });
  view.server.members = Object.keys(view.users).map(function (k) { return Object.assign({ role: 'member', nickname: null, mmr: null }, view.users[k]); });
  window.__voiceLog = [];
  var logBox = document.createElement('pre');
  logBox.id = 'hv-log';
  logBox.hidden = true;
  document.body.appendChild(logBox);
  setInterval(function () { logBox.textContent = JSON.stringify(window.__voiceLog); }, 200);

  function merge(a, b) {
    Object.keys(b).forEach(function (k) {
      if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) { a[k] = a[k] || {}; merge(a[k], b[k]); } else a[k] = b[k];
    });
  }
  function push() { window.GhostVoice.update(JSON.parse(JSON.stringify(view))); }

  var bridge = {
    voiceToken: function (t) { window.__voiceLog.push({ voiceToken: t || null }); return Promise.resolve({ ok: true, url: 'wss://ghost-rank-previa.livekit.cloud', token: 'cabecalho.conteudo.assinatura' }); },
    setVoiceState: function (vs) {
      window.__voiceLog.push({ setVoiceState: vs });
      Object.keys(view.voiceStates).forEach(function (k) { view.voiceStates[k] = view.voiceStates[k].filter(function (s) { return s.userId !== ME; }); });
      var key = vs.channelId || (vs.dmId ? 'dm:' + vs.dmId : null);
      if (key) (view.voiceStates[key] = view.voiceStates[key] || []).push({ userId: ME, muted: vs.muted, deafened: vs.deafened, streaming: vs.streaming, video: vs.video });
      setTimeout(push, 30);
      return Promise.resolve({ ok: true });
    },
    updatePrefs: function (partial) { window.__voiceLog.push({ updatePrefs: partial }); merge(view.prefs, partial); setTimeout(push, 20); return Promise.resolve({ ok: true }); },
    listScreenSources: function () { return Promise.resolve({ ok: true, sources: [{ id: 'screen:1', kind: 'screen', name: 'Tela 1' }, { id: 'window:2', kind: 'window', name: 'Dota 2' }] }); },
    pickScreenSource: function () { return Promise.resolve({ ok: true }); }
  };

  var settingsBox = document.getElementById('hv-settings');
  function openSettings() {
    settingsBox.hidden = false;
    window.GhostVoice.renderSettings(settingsBox);
  }
  window.GhostVoice.init({
    bridge: bridge,
    els: { stage: document.getElementById('voice-stage'), connection: document.getElementById('voice-connection'), userControls: document.getElementById('voice-user-controls') },
    getView: function () { return view; },
    onOpenSettings: openSettings,
    onState: function (st) { window.__voiceState = st; }
  });

  function select(sel) { view.selection = sel; settingsBox.hidden = true; window.GhostVoice.destroySettings(); push(); }
  document.getElementById('hv-ch-geral').addEventListener('click', function () { select({ mode: 'server', serverId: SERVER, channelId: CH_GERAL }); window.GhostVoice.join({ channelId: CH_GERAL }); });
  document.getElementById('hv-ch-ranked').addEventListener('click', function () { select({ mode: 'server', serverId: SERVER, channelId: CH_RANKED }); });
  document.getElementById('hv-dm-lua').addEventListener('click', function () { select({ mode: 'dm', dmId: DM_LUA }); });
  document.getElementById('hv-open-settings').addEventListener('click', openSettings);

  if (q.get('dm')) view.selection = { mode: 'dm', dmId: DM_LUA };
  if (q.get('ranked')) view.selection = { mode: 'server', serverId: SERVER, channelId: CH_RANKED };
  push();
  if (q.get('join')) {
    setTimeout(function () {
      window.GhostVoice.join(q.get('dm') ? { dmId: DM_LUA } : { channelId: CH_GERAL }).then(function () {
        if (q.get('cam')) setTimeout(function () { window.GhostVoice.toggleVideo(); }, 400);
        if (q.get('move')) setTimeout(function () {
          view.voiceMove = { nonce: 'm1', serverId: SERVER, channelId: CH_RANKED, by: LUA };
          push();
          setTimeout(push, 300); // o mesmo nonce de novo não move outra vez
        }, 1200);
      });
    }, 100);
  }
  if (q.get('settings')) setTimeout(openSettings, q.get('join') ? 1800 : 50);
})();
