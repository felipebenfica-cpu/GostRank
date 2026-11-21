/* Ghost Rank - voz (LiveKit), no modelo de uso do Discord: vários canais de voz, chamada em DM,
   câmera, transmissão de tela, apertar-para-falar, sensibilidade, dispositivos e sons.
   Script clássico em um único IIFE. Carregado depois de vendor/livekit-client.umd.js
   (que define window.LivekitClient, se instalado) e antes de app.js.
   Contrato: docs/plans/etapa-6-discord-completo.md.

   API:
     GhostVoice.init({ bridge, els: { stage, connection, userControls, channelMembers? }, getView, onState, onOpenSettings })
     GhostVoice.update(view)
     GhostVoice.join({ channelId } | { dmId })  (sem argumento: alvo selecionado na tela, ou a sala antiga do grupo)
     GhostVoice.leave()  GhostVoice.toggleMute()  GhostVoice.toggleDeafen()  GhostVoice.toggleVideo()
     GhostVoice.getState() → { status:'idle'|'connecting'|'connected', channelId, dmId, muted, deafened,
                               streaming, video, speaking:[userId], ptt, ...campos antigos }
     GhostVoice.renderSettings(container)  GhostVoice.destroySettings()
     GhostVoice.playSound('join'|'leave'|'mute'|'unmute'|'deafen'|'undeafen'|'message')

   Toda mudança de estado local (entrar, sair, mutar, ensurdecer, transmitir, câmera) vai para
   bridge.setVoiceState para os outros verem na barra lateral. Mudanças nas configurações vão para
   bridge.updatePrefs({ voice }) e voltam em view.prefs.voice, que é aplicado ao vivo.

   Nunca usa innerHTML nem estilo inline: tudo é criado com createElement/textContent e
   a aparência vem de classes em voice.css. */
(function () {
  'use strict';

  /* ---------- utilidades ---------- */

  // Detalhe técnico curto do erro (sem tokens) para diagnóstico.
  function techDetail(err) {
    if (!err) return '';
    var msg = String((err && (err.message || err.reason)) || err);
    msg = msg.replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[token]')
      .replace(/access_token=[^&\s]+/g, 'access_token=[token]');
    if (msg.length > 180) msg = msg.slice(0, 180) + '…';
    var name = err && err.name ? String(err.name) + ': ' : '';
    return ' (Detalhe: ' + name + msg + ')';
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var ICONS = {
    mic: [['path', { d: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z' }], ['path', { d: 'M5 11a7 7 0 0 0 14 0' }], ['line', { x1: 12, y1: 18, x2: 12, y2: 21 }]],
    micOff: [['path', { d: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z' }], ['path', { d: 'M5 11a7 7 0 0 0 14 0' }], ['line', { x1: 12, y1: 18, x2: 12, y2: 21 }], ['line', { x1: 3, y1: 3, x2: 21, y2: 21 }]],
    headphones: [['path', { d: 'M4 15v-3a8 8 0 0 1 16 0v3' }], ['rect', { x: 3, y: 14, width: 5, height: 7, rx: 2 }], ['rect', { x: 16, y: 14, width: 5, height: 7, rx: 2 }]],
    headphonesOff: [['path', { d: 'M4 15v-3a8 8 0 0 1 16 0v3' }], ['rect', { x: 3, y: 14, width: 5, height: 7, rx: 2 }], ['rect', { x: 16, y: 14, width: 5, height: 7, rx: 2 }], ['line', { x1: 3, y1: 3, x2: 21, y2: 21 }]],
    screen: [['rect', { x: 3, y: 4, width: 18, height: 12, rx: 2 }], ['line', { x1: 8, y1: 20, x2: 16, y2: 20 }], ['line', { x1: 12, y1: 16, x2: 12, y2: 20 }]],
    screenUp: [['rect', { x: 3, y: 4, width: 18, height: 12, rx: 2 }], ['line', { x1: 8, y1: 20, x2: 16, y2: 20 }], ['path', { d: 'M12 13V7' }], ['path', { d: 'm9 10 3-3 3 3' }]],
    window: [['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }], ['line', { x1: 3, y1: 9, x2: 21, y2: 9 }]],
    phoneDown: [['path', { d: 'M2.5 15.2c0-.9.4-1.8 1.1-2.4C5.8 11 8.8 10 12 10s6.2 1 8.4 2.8c.7.6 1.1 1.5 1.1 2.4v1.3c0 .6-.5 1.1-1.1 1.1h-3.2c-.6 0-1.1-.5-1.1-1.1v-2a10.6 10.6 0 0 0-8.2 0v2c0 .6-.5 1.1-1.1 1.1H3.6c-.6 0-1.1-.5-1.1-1.1z' }]],
    expand: [['path', { d: 'M4 9V4h5' }], ['path', { d: 'M20 9V4h-5' }], ['path', { d: 'M4 15v5h5' }], ['path', { d: 'M20 15v5h-5' }]],
    shrink: [['path', { d: 'M9 4v5H4' }], ['path', { d: 'M15 4v5h5' }], ['path', { d: 'M9 20v-5H4' }], ['path', { d: 'M15 20v-5h5' }]],
    pip: [['rect', { x: 3, y: 5, width: 18, height: 14, rx: 2 }], ['rect', { x: 12, y: 12, width: 7, height: 5, rx: 1 }]],
    volume: [['path', { d: 'M11 5 6 9H3v6h3l5 4V5z' }], ['path', { d: 'M15.5 8.5a5 5 0 0 1 0 7' }], ['path', { d: 'M18.5 5.5a9 9 0 0 1 0 13' }]],
    volumeOff: [['path', { d: 'M11 5 6 9H3v6h3l5 4V5z' }], ['line', { x1: 16, y1: 9, x2: 22, y2: 15 }], ['line', { x1: 22, y1: 9, x2: 16, y2: 15 }]],
    eye: [['path', { d: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z' }], ['circle', { cx: 12, cy: 12, r: 3 }]],
    stop: [['rect', { x: 6, y: 6, width: 12, height: 12, rx: 2 }]],
    more: [['circle', { cx: 5, cy: 12, r: 1.4 }], ['circle', { cx: 12, cy: 12, r: 1.4 }], ['circle', { cx: 19, cy: 12, r: 1.4 }]],
    signal: [['line', { x1: 5, y1: 20, x2: 5, y2: 16 }], ['line', { x1: 10, y1: 20, x2: 10, y2: 12 }], ['line', { x1: 15, y1: 20, x2: 15, y2: 8 }], ['line', { x1: 20, y1: 20, x2: 20, y2: 4 }]],
    close: [['line', { x1: 6, y1: 6, x2: 18, y2: 18 }], ['line', { x1: 18, y1: 6, x2: 6, y2: 18 }]],
    speaker: [['path', { d: 'M11 5 6 9H3v6h3l5 4V5z' }], ['path', { d: 'M15.5 8.5a5 5 0 0 1 0 7' }]],
    camera: [['rect', { x: 2, y: 6, width: 14, height: 12, rx: 2 }], ['path', { d: 'm16 10 6-3v10l-6-3z' }]],
    cameraOff: [['rect', { x: 2, y: 6, width: 14, height: 12, rx: 2 }], ['path', { d: 'm16 10 6-3v10l-6-3z' }], ['line', { x1: 2, y1: 3, x2: 21, y2: 21 }]],
    gear: [['circle', { cx: 12, cy: 12, r: 3 }], ['path', { d: 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' }]],
    keyboard: [['rect', { x: 2, y: 6, width: 20, height: 12, rx: 2 }], ['line', { x1: 6, y1: 10, x2: 6, y2: 10 }], ['line', { x1: 10, y1: 10, x2: 10, y2: 10 }], ['line', { x1: 14, y1: 10, x2: 14, y2: 10 }], ['line', { x1: 18, y1: 10, x2: 18, y2: 10 }], ['line', { x1: 7, y1: 14, x2: 17, y2: 14 }]]
  };

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

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function button(className, label, iconName, opts) {
    opts = opts || {};
    var b = el('button', className);
    b.type = 'button';
    if (iconName) b.appendChild(icon(iconName, opts.size || 18));
    if (opts.iconOnly) b.setAttribute('aria-label', label);
    else if (label) b.appendChild(el('span', 'vc-btn-text', label));
    if (opts.title) b.title = opts.title;
    else if (opts.iconOnly) b.title = label;
    return b;
  }

  function setIcon(btn, iconName, size) {
    var old = btn.querySelector('svg');
    var fresh = icon(iconName, size || 18);
    if (old) btn.replaceChild(fresh, old); else btn.insertBefore(fresh, btn.firstChild);
  }

  function setText(node, text) { if (node.textContent !== text) node.textContent = text; }
  function show(node, visible) { if (node && node.hidden === !!visible) node.hidden = !visible; }
  function pressed(btn, on) { btn.setAttribute('aria-pressed', on ? 'true' : 'false'); }

  function initials(name) {
    var words = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    var a = Array.from(words[0])[0] || '';
    var b = words.length > 1 ? (Array.from(words[1])[0] || '') : '';
    return (a + b).toUpperCase();
  }

  function hueOf(id) {
    var s = String(id || ''), h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % 6;
  }

  // Cor do avatar: avatarColor (0..7) do perfil; sem ela, deriva do id.
  function hueFor(id) {
    var u = userInfo(id);
    var c = u && Number(u.avatarColor);
    return (c >= 0 && c <= 7 && Math.floor(c) === c) ? c : hueOf(id);
  }

  // Único lugar que define src de imagem. Quem chama já validou a URL (safeImageUrl ou data:image/).
  function setImageSrc(img, url) { img.src = url; }

  function safeImageUrl(v) {
    if (typeof v !== 'string' || v.length > 2048) return '';
    return /^(https:\/\/|data:image\/|blob:)/.test(v) ? v : '';
  }

  function avatar(name, id, small) {
    var a = el('span', 'vc-avatar vc-hue-' + hueFor(id) + (small ? ' vc-avatar-sm' : ''));
    a.setAttribute('aria-hidden', 'true');
    var u = userInfo(id);
    var url = u ? safeImageUrl(u.avatarUrl) : '';
    if (url) {
      var img = document.createElement('img');
      img.className = 'vc-avatar-img';
      img.alt = '';
      img.decoding = 'async';
      setImageSrc(img, url);
      img.addEventListener('error', function () {
        if (img.parentNode) img.parentNode.removeChild(img);
        a.appendChild(el('span', 'vc-avatar-text', initials(name)));
      });
      a.appendChild(img);
    } else {
      a.appendChild(el('span', 'vc-avatar-text', initials(name)));
    }
    return a;
  }

  var WHAT = {
    mic: { busy: 'o microfone', missing: 'Nenhum microfone foi encontrado neste computador.', fail: 'Não deu para ligar o microfone. Tente de novo.',
      denied: 'O Ghost Rank não recebeu permissão para usar o microfone. Libere o microfone nas configurações de privacidade do sistema.' },
    camera: { busy: 'a câmera', missing: 'Nenhuma câmera foi encontrada neste computador.', fail: 'Não deu para ligar a câmera. Tente de novo.',
      denied: 'O Ghost Rank não recebeu permissão para usar a câmera. Libere a câmera nas configurações de privacidade do sistema.' },
    screen: { busy: 'o compartilhamento de tela', missing: 'Não encontramos essa tela ou janela. Escolha de novo.', fail: 'Não deu para compartilhar a tela. Tente de novo.',
      denied: 'O compartilhamento de tela foi cancelado ou bloqueado.' }
  };

  function mediaErrorMessage(err, what) {
    var w = WHAT[what] || WHAT.mic;
    var name = err && err.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') return w.denied;
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return w.missing;
    if (name === 'NotReadableError') return 'Outro programa está usando ' + w.busy + '. Feche-o e tente de novo.';
    return w.fail;
  }

  /* ---------- estado ---------- */

  var bridge = null;
  var LK = null;
  var els = null;
  var onState = null;
  var onOpenSettings = null;
  var getViewFn = null;
  var lastView = null;

  var room = null;
  var roomGroupId = null;      // compatibilidade: sala antiga do grupo (join() sem alvo e sem canais)
  var target = null;           // { channelId } | { dmId } | { legacy: true } da sala atual (ou que está conectando)
  var targetInfo = null;       // { serverId, serverName, channelName, dmUserId } guardado ao entrar
  var cameraMedia = {};        // identity -> { el, track } câmera remota
  var localCamera = null;      // { el, track } da própria câmera
  var cameraBusy = false;
  var pttHeld = false;         // tecla de apertar-para-falar pressionada
  var gateOpen = true;         // detecção de voz: microfone aberto agora
  var lastVoiceSig = '';
  var appliedVoicePrefs = '';  // assinatura das prefs de voz já aplicadas à sala
  var status = 'off'; // off | connecting | connected | reconnecting
  var leavingOnPurpose = false;
  var errorText = '';

  var prefMuted = false;       // o usuário quer o microfone desligado
  var deafened = false;
  var mutedBeforeDeafen = false;
  var micBusy = false;

  var speaking = {};           // identity -> true
  var watching = {};           // identity -> true (assistindo a transmissão)
  var streamMedia = {};        // identity -> { el, track }
  var snapshots = {};          // identity -> canvas com o último quadro visto
  var localPreview = null;     // { el, track } da própria transmissão
  var audioEls = {};           // trackSid -> [elementos de áudio]
  var prefs = {};              // userId -> { volume: 0..2, mutedForMe }
  var streamVolume = {};       // userId -> 0..1
  var focusKey = null;         // 'p:<id>' | 's:<id>' em destaque
  var expanded = null;         // tile ampliado dentro da janela (sem tela cheia do sistema)
  var lastStateSig = '';
  var lastReason = null;
  var pingTimer = null;
  var renderQueued = false;

  var ui = null;               // elementos criados por este módulo
  var tiles = {};              // key -> tile

  var QUALITY = {
    '720': { label: '720p', width: 1280, height: 720, bitrate: 3000000 },
    '1080': { label: '1080p', width: 1920, height: 1080, bitrate: 6000000 },
    source: { label: 'Fonte', width: 2560, height: 1440, bitrate: 10000000 }
  };
  var shareChoice = { res: '1080', fps: 30 };

  function SRC() {
    var s = LK && LK.Track && LK.Track.Source;
    return {
      mic: (s && s.Microphone) || 'microphone',
      camera: (s && s.Camera) || 'camera',
      screen: (s && s.ScreenShare) || 'screen_share',
      screenAudio: (s && s.ScreenShareAudio) || 'screen_share_audio'
    };
  }

  function evName(key, fallback) { return (LK && LK.RoomEvent && LK.RoomEvent[key]) || fallback; }

  function inRoom() { return !!room && (status === 'connected' || status === 'reconnecting'); }

  function call(fn) {
    if (!bridge) return Promise.resolve({ ok: false, error: 'A ponte com o aplicativo não está disponível.' });
    return Promise.resolve().then(fn).catch(function () {
      return { ok: false, error: 'Algo deu errado ao falar com o aplicativo. Tente de novo.' };
    });
  }

  function announce(text) {
    if (!ui) return;
    ui.live.textContent = '';
    window.setTimeout(function () { ui.live.textContent = text; }, 50);
  }

  function setError(message) {
    errorText = message || '';
    scheduleRender();
  }

  /* ---------- disponibilidade e nomes ---------- */

  function signedIn(view) {
    var a = view && view.auth;
    if (a && a.status === 'signed_in') return true;
    return !!(view && view.me && view.me.id && (!a || a.status === 'signed_in'));
  }

  // Motivo para a voz não funcionar (independe do alvo).
  function unavailableReason(view) {
    if (!signedIn(view)) return 'Entre na sua conta para usar a voz.';
    if (!LK || typeof LK.Room !== 'function') return 'Voz indisponível neste computador: rode npm install.';
    if (view.voice && view.voice.available === false) return 'Voz indisponível neste computador: rode npm install.';
    return null;
  }

  function isUuidLike(v) { return typeof v === 'string' && /^[0-9a-fA-F-]{8,64}$/.test(v); }

  function cleanTarget(t) {
    if (!t || typeof t !== 'object') return null;
    if (isUuidLike(t.channelId)) return { channelId: t.channelId };
    if (isUuidLike(t.dmId)) return { dmId: t.dmId };
    if (t.legacy) return { legacy: true };
    return null;
  }

  function sameTarget(a, b) {
    if (!a || !b) return false;
    if (a.channelId || b.channelId) return a.channelId === b.channelId;
    if (a.dmId || b.dmId) return a.dmId === b.dmId;
    return !!(a.legacy && b.legacy);
  }

  function findChannel(view, channelId) {
    var s = view && view.server;
    var list = s && Array.isArray(s.channels) ? s.channels : [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === channelId) return list[i];
    return null;
  }

  function findDm(view, dmId) {
    var list = view && Array.isArray(view.dms) ? view.dms : [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === dmId) return list[i];
    return null;
  }

  // Alvo que a tela está mostrando agora (canal de voz selecionado ou DM aberta).
  function selectedTarget(view) {
    var sel = view && view.selection;
    if (sel && sel.mode === 'dm' && isUuidLike(sel.dmId)) return { dmId: sel.dmId };
    if (sel && sel.mode === 'server' && isUuidLike(sel.channelId)) {
      var ch = findChannel(view, sel.channelId);
      if (ch && ch.kind === 'voice') return { channelId: ch.id };
    }
    return null;
  }

  // Sem canais na view (versão antiga): a sala do grupo.
  function legacyAvailable(view) { return !!(view && view.group && !view.server && !Array.isArray(view.servers)); }

  function userInfo(id) {
    var v = lastView;
    if (!v || !id) return null;
    if (v.users && Object.prototype.hasOwnProperty.call(v.users, id)) return v.users[id];
    if (v.me && v.me.id === id) return v.me;
    var members = v.server && Array.isArray(v.server.members) ? v.server.members : [];
    for (var i = 0; i < members.length; i++) if (members[i] && members[i].id === id) return members[i];
    return null;
  }

  function displayNameOf(id, fallback) {
    var v = lastView;
    // apelido no servidor da sala (quando é o servidor mostrado)
    if (v && v.server && targetInfo && targetInfo.serverId === v.server.id && Array.isArray(v.server.members)) {
      for (var j = 0; j < v.server.members.length; j++) {
        var m = v.server.members[j];
        if (m && m.id === id && m.nickname) return String(m.nickname);
      }
    }
    var u = userInfo(id);
    if (u && u.displayName) return String(u.displayName);
    var members = (v && v.group && Array.isArray(v.group.members)) ? v.group.members : [];
    for (var i = 0; i < members.length; i++) {
      if (members[i] && members[i].userId === id && members[i].displayName) return String(members[i].displayName);
    }
    return fallback || 'Fantasma';
  }

  function nameFor(participant) {
    if (!participant) return 'Fantasma';
    var fb = (typeof participant.name === 'string' && participant.name) ? participant.name : 'Fantasma';
    return displayNameOf(participant.identity, fb);
  }

  function infoFor(view, t) {
    var info = { serverId: null, serverName: '', channelName: '', dmUserId: null };
    if (!t) return info;
    if (t.channelId) {
      var ch = findChannel(view, t.channelId);
      info.channelName = ch ? String(ch.name || 'Canal de voz') : 'Canal de voz';
      if (ch && view.server) { info.serverId = view.server.id; info.serverName = String(view.server.name || ''); }
    } else if (t.dmId) {
      var dm = findDm(view, t.dmId);
      info.dmUserId = dm && dm.user ? dm.user.id : null;
    } else if (view && view.group) {
      info.channelName = 'Sala de voz';
      info.serverName = String(view.group.name || 'Grupo');
    }
    return info;
  }

  // "Geral / Os Assombrados" ou "Chamada com Lua".
  function whereLabel() {
    if (!targetInfo) return '';
    if (target && target.dmId) {
      var dm = findDm(lastView, target.dmId);
      var uid = (dm && dm.user && dm.user.id) || targetInfo.dmUserId;
      var nm = dm && dm.user && dm.user.displayName ? String(dm.user.displayName) : displayNameOf(uid, 'alguém');
      return 'Chamada com ' + nm;
    }
    if (target && target.channelId) {
      var ch = findChannel(lastView, target.channelId);
      if (ch && ch.name) targetInfo.channelName = String(ch.name);
    }
    return targetInfo.channelName + (targetInfo.serverName ? ' / ' + targetInfo.serverName : '');
  }

  function groupName() { return whereLabel() || 'Sala de voz'; }

  /* ---------- preferências de voz (view.prefs.voice) ---------- */

  var VOICE_DEFAULTS = {
    inputDeviceId: 'default', outputDeviceId: 'default', mode: 'vad', pttKey: 'KeyV',
    sensitivity: -50, autoSensitivity: true, noiseSuppression: true, echoCancellation: true,
    inputVolume: 100, outputVolume: 100, cameraDeviceId: 'default'
  };

  function vp() {
    var src = lastView && lastView.prefs && lastView.prefs.voice ? lastView.prefs.voice : {};
    var o = {};
    Object.keys(VOICE_DEFAULTS).forEach(function (k) { o[k] = src[k] != null ? src[k] : VOICE_DEFAULTS[k]; });
    o.mode = o.mode === 'ptt' ? 'ptt' : 'vad';
    o.sensitivity = Math.max(-100, Math.min(0, Number(o.sensitivity) || -50));
    o.inputVolume = Math.max(0, Math.min(200, Number(o.inputVolume)));
    o.outputVolume = Math.max(0, Math.min(200, Number(o.outputVolume)));
    if (!isFinite(o.inputVolume)) o.inputVolume = 100;
    if (!isFinite(o.outputVolume)) o.outputVolume = 100;
    if (typeof o.pttKey !== 'string' || !o.pttKey || o.pttKey.length > 32) o.pttKey = 'KeyV';
    ['inputDeviceId', 'outputDeviceId', 'cameraDeviceId'].forEach(function (k) {
      if (typeof o[k] !== 'string' || !o[k] || o[k].length > 256) o[k] = 'default';
    });
    o.autoSensitivity = o.autoSensitivity !== false;
    o.noiseSuppression = o.noiseSuppression !== false;
    o.echoCancellation = o.echoCancellation !== false;
    return o;
  }

  function soundsOn() {
    var n = lastView && lastView.prefs && lastView.prefs.notifications;
    return !(n && n.sounds === false);
  }

  function savePrefs(partial) {
    // aplica já na cópia local (resposta imediata) e manda para o app
    if (lastView) {
      lastView.prefs = lastView.prefs || {};
      var cur = lastView.prefs.voice || {};
      var next = {};
      Object.keys(cur).forEach(function (k) { next[k] = cur[k]; });
      Object.keys(partial).forEach(function (k) { next[k] = partial[k]; });
      lastView.prefs.voice = next;
    }
    applyVoicePrefs();
    if (bridge && typeof bridge.updatePrefs === 'function') {
      call(function () { return bridge.updatePrefs({ voice: partial }); });
    }
  }

  function keyLabel(code) {
    if (typeof code !== 'string') return '?';
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^Numpad[0-9]$/.test(code)) return 'Num ' + code.slice(6);
    if (/^F[0-9]{1,2}$/.test(code)) return code;
    var map = {
      Space: 'Espaço', ShiftLeft: 'Shift esq.', ShiftRight: 'Shift dir.', ControlLeft: 'Ctrl esq.', ControlRight: 'Ctrl dir.',
      AltLeft: 'Alt', AltRight: 'Alt Gr', CapsLock: 'Caps Lock', Backquote: '`', Tab: 'Tab', Backslash: '\\',
      MetaLeft: 'Win', MetaRight: 'Win dir.', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down',
      Pause: 'Pause', ScrollLock: 'Scroll Lock', BracketLeft: '[', BracketRight: ']', Semicolon: 'Ç', Quote: '~', Comma: ',', Period: '.', Slash: ';',
      ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→'
    };
    return map[code] || code;
  }

  function prefsFor(id) { return prefs[id] || (prefs[id] = { volume: 1, mutedForMe: false }); }

  /* ---------- participantes ---------- */

  function participantsList() {
    if (!room) return [];
    var list = [];
    if (room.localParticipant) list.push(room.localParticipant);
    var remotes = room.remoteParticipants || room.participants;
    if (remotes && typeof remotes.forEach === 'function') remotes.forEach(function (p) { list.push(p); });
    return list;
  }

  function findParticipant(id) {
    var list = participantsList();
    for (var i = 0; i < list.length; i++) if (list[i].identity === id) return list[i];
    return null;
  }

  function isLocal(p) { return !!room && p === room.localParticipant; }

  function publication(p, source) {
    if (!p) return null;
    if (typeof p.getTrackPublication === 'function') {
      var pub = p.getTrackPublication(source);
      if (pub) return pub;
    }
    var found = null;
    var map = p.trackPublications;
    if (map && typeof map.forEach === 'function') map.forEach(function (pb) { if (!found && pb && pb.source === source) found = pb; });
    return found;
  }

  function micOn(p) {
    if (isLocal(p)) return !!p.isMicrophoneEnabled;
    return !!p.isMicrophoneEnabled;
  }

  function isSharing(p) {
    if (!p) return false;
    if (isLocal(p)) return !!p.isScreenShareEnabled;
    return !!publication(p, SRC().screen) || !!p.isScreenShareEnabled;
  }

  function isSpeaking(p) { return micOn(p) && !!(speaking[p.identity] || p.isSpeaking) && !(isLocal(p) && deafened); }

  /* ---------- volumes ---------- */

  function safeSetVolume(p, v, source) {
    if (!p || typeof p.setVolume !== 'function') return;
    try { p.setVolume(v, source); } catch (e) {
      // Sem mixagem por Web Audio o elemento só aceita até 100%.
      try { p.setVolume(Math.min(v, 1), source); } catch (e2) { /* ignora */ }
    }
  }

  function applyVolumes(p) {
    if (!p || isLocal(p)) return;
    var pr = prefsFor(p.identity);
    var out = vp().outputVolume / 100; // volume de saída geral (0..2)
    safeSetVolume(p, (deafened || pr.mutedForMe) ? 0 : Math.min(4, pr.volume * out), SRC().mic);
    var sv = streamVolume[p.identity];
    safeSetVolume(p, deafened ? 0 : Math.min(2, (sv == null ? 1 : sv) * out), SRC().screenAudio);
  }

  function applyAllVolumes() { participantsList().forEach(applyVolumes); }

  /* ---------- sons curtos (Web Audio, sem arquivos) ---------- */

  var audioCtx = null;
  function tones(seq, gainLevel, force) {
    if (deafened && !force) return;
    if (!soundsOn()) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume().catch(function () {});
      var t0 = audioCtx.currentTime + 0.02;
      seq.forEach(function (s) {
        var osc = audioCtx.createOscillator();
        var g = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = s[0];
        var start = t0 + s[1], end = start + s[2];
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(gainLevel || 0.07, start + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, end);
        osc.connect(g);
        g.connect(audioCtx.destination);
        osc.start(start);
        osc.stop(end + 0.02);
      });
    } catch (e) { /* sem som */ }
  }
  var SOUND = {
    join: function () { tones([[523.25, 0, 0.09], [783.99, 0.09, 0.14]]); },
    leave: function () { tones([[783.99, 0, 0.09], [523.25, 0.09, 0.14]]); },
    otherJoin: function () { tones([[659.25, 0, 0.08], [880, 0.08, 0.1]], 0.045); },
    otherLeave: function () { tones([[880, 0, 0.08], [659.25, 0.08, 0.1]], 0.045); },
    mute: function () { tones([[440, 0, 0.07], [330, 0.07, 0.09]], 0.05); },
    unmute: function () { tones([[330, 0, 0.07], [440, 0.07, 0.09]], 0.05); },
    deafen: function () { tones([[392, 0, 0.08], [261.63, 0.08, 0.12]], 0.06, true); },
    undeafen: function () { tones([[261.63, 0, 0.08], [392, 0.08, 0.12]], 0.06); },
    message: function () { tones([[987.77, 0, 0.06], [1318.5, 0.06, 0.12]], 0.04); }
  };

  function playSound(name) {
    var map = { join: 'join', leave: 'leave', mute: 'mute', unmute: 'unmute', deafen: 'deafen', undeafen: 'undeafen', message: 'message' };
    var k = map[name];
    if (k && SOUND[k]) SOUND[k]();
  }

  /* ---------- áudio remoto ---------- */

  function addAudio(track) {
    var media = track.attach();
    if (!media) return;
    media.hidden = true;
    media.controls = false;
    ui.audioSink.appendChild(media);
    var sid = track.sid || String(Math.random());
    (audioEls[sid] = audioEls[sid] || []).push(media);
  }

  function removeAudio(track) {
    var sid = track.sid;
    var detached = [];
    try { detached = track.detach() || []; } catch (e) { /* ignora */ }
    (audioEls[sid] || []).concat(detached).forEach(function (m) {
      if (m && m.parentNode) m.parentNode.removeChild(m);
    });
    delete audioEls[sid];
  }

  /* ---------- transmissões ---------- */

  function prepareMedia(media, muted) {
    if (!media) return media;
    if (media.tagName === 'VIDEO') {
      media.controls = false;
      media.muted = !!muted;
      media.playsInline = true;
      media.autoplay = true;
    }
    media.classList.add('vc-media');
    return media;
  }

  function setSubscribed(pub, on) {
    if (!pub || typeof pub.setSubscribed !== 'function') return;
    try { pub.setSubscribed(on); } catch (e) { /* ignora */ }
  }

  function unsubscribeIfNotWatching(pub, participant) {
    if (!pub || !participant || isLocal(participant)) return;
    var src = pub.source;
    if ((src === SRC().screen || src === SRC().screenAudio) && !watching[participant.identity]) setSubscribed(pub, false);
  }

  function watch(identity) {
    var p = findParticipant(identity);
    if (!p || isLocal(p)) return;
    watching[identity] = true;
    focusKey = 's:' + identity;
    [SRC().screen, SRC().screenAudio].forEach(function (src) {
      var pub = publication(p, src);
      setSubscribed(pub, true);
      // já estava assinada (corrida com a assinatura automática): usa a faixa que existe
      if (src === SRC().screen && pub && pub.track && pub.isSubscribed && !streamMedia[identity]) onTrackSubscribed(pub.track, pub, p);
    });
    applyVolumes(p);
    scheduleRender();
    window.setTimeout(function () {
      var t = tiles['s:' + identity];
      if (t && t.stopBtn) t.stopBtn.focus();
    }, 0);
  }

  function snapshot(identity) {
    var m = streamMedia[identity];
    if (!m || !m.el) return;
    try {
      var w = m.el.videoWidth || m.el.width || 0;
      var h = m.el.videoHeight || m.el.height || 0;
      if (!w || !h) return;
      var c = document.createElement('canvas');
      var scale = Math.min(1, 640 / w);
      c.width = Math.round(w * scale);
      c.height = Math.round(h * scale);
      var ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(m.el, 0, 0, c.width, c.height);
      c.className = 'vc-media vc-snapshot';
      c.setAttribute('aria-hidden', 'true');
      snapshots[identity] = c;
    } catch (e) { /* sem prévia */ }
  }

  function detachStream(identity) {
    var m = streamMedia[identity];
    if (!m) return;
    try { if (m.track && typeof m.track.detach === 'function') m.track.detach(m.el); } catch (e) { /* ignora */ }
    if (m.el && m.el.parentNode) m.el.parentNode.removeChild(m.el);
    delete streamMedia[identity];
  }

  function stopWatching(identity, silent) {
    var tile = tiles['s:' + identity];
    if (tile) leaveBig(tile);
    snapshot(identity);
    detachStream(identity);
    delete watching[identity];
    var p = findParticipant(identity);
    if (p) {
      setSubscribed(publication(p, SRC().screen), false);
      setSubscribed(publication(p, SRC().screenAudio), false);
    }
    if (focusKey === 's:' + identity) {
      var other = Object.keys(watching)[0];
      focusKey = other ? 's:' + other : null;
    }
    scheduleRender();
    if (!silent) window.setTimeout(function () {
      var t = tiles['s:' + identity];
      if (t && t.watchBtn && !t.watchBtn.hidden) t.watchBtn.focus();
    }, 0);
  }

  /* ---------- eventos da sala ---------- */

  function detachCamera(identity) {
    var m = cameraMedia[identity];
    if (!m) return;
    try { if (m.track && typeof m.track.detach === 'function') m.track.detach(m.el); } catch (e) { /* ignora */ }
    if (m.el && m.el.parentNode) m.el.parentNode.removeChild(m.el);
    delete cameraMedia[identity];
  }

  function dropLocalCamera() {
    if (!localCamera) return;
    try { localCamera.track.detach(localCamera.el); } catch (e) { /* ignora */ }
    if (localCamera.el && localCamera.el.parentNode) localCamera.el.parentNode.removeChild(localCamera.el);
    localCamera = null;
  }

  function onTrackSubscribed(track, pub, participant) {
    var src = (pub && pub.source) || (track && track.source);
    var kind = track && track.kind;
    if (src === SRC().camera && kind === 'video') {
      detachCamera(participant.identity);
      var cam = prepareMedia(track.attach(), true);
      if (cam) cam.classList.add('vc-camera');
      cameraMedia[participant.identity] = { el: cam, track: track };
    } else if (src === SRC().screen && kind === 'video') {
      if (!watching[participant.identity]) { setSubscribed(pub, false); return; }
      try { if (pub && pub.setVideoQuality && LK.VideoQuality) pub.setVideoQuality(LK.VideoQuality.HIGH); } catch (e) { /* ignora */ }
      detachStream(participant.identity);
      streamMedia[participant.identity] = { el: prepareMedia(track.attach(), false), track: track };
      delete snapshots[participant.identity];
    } else if (kind === 'audio') {
      if (src === SRC().screenAudio && !watching[participant.identity]) { setSubscribed(pub, false); return; }
      addAudio(track);
      applyVolumes(participant);
    }
    scheduleRender();
  }

  function onTrackUnsubscribed(track, pub, participant) {
    var src = (pub && pub.source) || (track && track.source);
    if (track && track.kind === 'audio') removeAudio(track);
    else if (src === SRC().camera && participant) {
      var c = cameraMedia[participant.identity];
      if (c && c.track === track) detachCamera(participant.identity);
    } else if (src === SRC().screen && participant) {
      var m = streamMedia[participant.identity];
      if (m && m.track === track) detachStream(participant.identity);
    }
    scheduleRender();
  }

  function onTrackPublished(pub, participant) {
    if (pub && pub.source === SRC().screen && participant && !isLocal(participant)) {
      announce(nameFor(participant) + ' começou a transmitir a tela.');
    }
    unsubscribeIfNotWatching(pub, participant);
    scheduleRender();
  }

  function onTrackUnpublished(pub, participant) {
    if (pub && pub.source === SRC().camera && participant) detachCamera(participant.identity);
    if (pub && pub.source === SRC().screen && participant) {
      var id = participant.identity;
      var tile = tiles['s:' + id];
      if (tile) leaveBig(tile);
      detachStream(id);
      delete watching[id];
      delete snapshots[id];
      if (focusKey === 's:' + id) { var other = Object.keys(watching)[0]; focusKey = other ? 's:' + other : null; }
      announce(nameFor(participant) + ' parou de transmitir.');
    }
    scheduleRender();
  }

  function onLocalPublished(pub) {
    var track = pub && pub.track;
    if (track && track.kind === 'audio' && pub.source === SRC().mic) setupMicPipeline();
    if (track && track.kind === 'video' && pub.source === SRC().camera) {
      dropLocalCamera();
      var cam = prepareMedia(track.attach(), true);
      if (cam) cam.classList.add('vc-camera', 'is-mirrored');
      localCamera = { el: cam, track: track };
    }
    if (track && track.kind === 'video' && pub.source === SRC().screen) {
      if (localPreview) { try { localPreview.track.detach(localPreview.el); } catch (e) { /* ignora */ } }
      localPreview = { el: prepareMedia(track.attach(), true), track: track };
    }
    scheduleRender();
  }

  function onLocalUnpublished(pub) {
    if (pub && pub.source === SRC().camera) dropLocalCamera();
    if (pub && pub.source === SRC().mic) teardownMicPipeline();
    if (pub && pub.source === SRC().screen) {
      if (localPreview) {
        try { localPreview.track.detach(localPreview.el); } catch (e) { /* ignora */ }
        if (localPreview.el && localPreview.el.parentNode) localPreview.el.parentNode.removeChild(localPreview.el);
      }
      localPreview = null;
      var me = room && room.localParticipant;
      var t = me && tiles['s:' + me.identity];
      if (t) leaveBig(t);
      if (me && focusKey === 's:' + me.identity) focusKey = null;
    }
    scheduleRender();
  }

  function cleanupMedia() {
    Object.keys(streamMedia).forEach(detachStream);
    Object.keys(cameraMedia).forEach(detachCamera);
    dropLocalCamera();
    teardownMicPipeline();
    pttHeld = false;
    cameraBusy = false;
    if (localPreview && localPreview.el && localPreview.el.parentNode) localPreview.el.parentNode.removeChild(localPreview.el);
    localPreview = null;
    Object.keys(audioEls).forEach(function (sid) {
      audioEls[sid].forEach(function (m) { if (m.parentNode) m.parentNode.removeChild(m); });
    });
    audioEls = {};
    if (ui) ui.audioSink.textContent = '';
    speaking = {};
    watching = {};
    snapshots = {};
    focusKey = null;
    if (expanded) { expanded.root.classList.remove('is-expanded'); expanded = null; }
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
    closeMenu(false);
  }

  function wire(r) {
    var mine = function (fn) { return function () { if (r === room) fn.apply(null, arguments); }; };
    r.on(evName('ParticipantConnected', 'participantConnected'), mine(function (p) {
      announce(nameFor(p) + ' entrou na sala de voz.');
      SOUND.otherJoin();
      applyVolumes(p);
      scheduleRender();
    }));
    r.on(evName('ParticipantDisconnected', 'participantDisconnected'), mine(function (p) {
      if (p) {
        delete speaking[p.identity];
        detachStream(p.identity);
        detachCamera(p.identity);
        delete watching[p.identity];
        delete snapshots[p.identity];
        if (focusKey === 'p:' + p.identity || focusKey === 's:' + p.identity) focusKey = null;
      }
      announce(nameFor(p) + ' saiu da sala de voz.');
      SOUND.otherLeave();
      scheduleRender();
    }));
    r.on(evName('TrackSubscribed', 'trackSubscribed'), mine(onTrackSubscribed));
    r.on(evName('TrackUnsubscribed', 'trackUnsubscribed'), mine(onTrackUnsubscribed));
    r.on(evName('TrackPublished', 'trackPublished'), mine(onTrackPublished));
    r.on(evName('TrackUnpublished', 'trackUnpublished'), mine(onTrackUnpublished));
    r.on(evName('TrackMuted', 'trackMuted'), mine(scheduleRender));
    r.on(evName('TrackUnmuted', 'trackUnmuted'), mine(scheduleRender));
    r.on(evName('LocalTrackPublished', 'localTrackPublished'), mine(onLocalPublished));
    r.on(evName('LocalTrackUnpublished', 'localTrackUnpublished'), mine(onLocalUnpublished));
    r.on(evName('ActiveSpeakersChanged', 'activeSpeakersChanged'), mine(function (speakers) {
      speaking = {};
      (speakers || []).forEach(function (p) { if (p && p.identity) speaking[p.identity] = true; });
      scheduleRender();
    }));
    r.on(evName('AudioPlaybackStatusChanged', 'audioPlaybackChanged'), mine(scheduleRender));
    r.on(evName('Reconnecting', 'reconnecting'), mine(function () { status = 'reconnecting'; scheduleRender(); }));
    r.on(evName('Reconnected', 'reconnected'), mine(function () { status = 'connected'; errorText = ''; scheduleRender(); }));
    r.on(evName('MediaDevicesError', 'mediaDevicesError'), mine(function (err) { setError(mediaErrorMessage(err, 'mic')); }));
    r.on(evName('Disconnected', 'disconnected'), mine(function () {
      var purposeful = leavingOnPurpose;
      room = null;
      roomGroupId = null;
      target = null;
      targetInfo = null;
      leavingOnPurpose = false;
      status = 'off';
      cleanupMedia();
      stopPing();
      if (!purposeful) errorText = 'A conexão com a voz caiu. Tente entrar de novo.';
      SOUND.leave();
      announce('Você saiu da voz.');
      scheduleRender();
    }));
  }

  /* ---------- entrar, sair, mutar, ensurdecer ---------- */

  var joinSeq = 0;

  function micConstraints() {
    var p = vp();
    var c = { noiseSuppression: p.noiseSuppression, echoCancellation: p.echoCancellation, autoGainControl: true };
    if (p.inputDeviceId && p.inputDeviceId !== 'default') c.deviceId = p.inputDeviceId;
    return c;
  }

  function cameraConstraints() {
    var p = vp();
    var c = { resolution: { width: 1280, height: 720, frameRate: 30 } };
    if (p.cameraDeviceId && p.cameraDeviceId !== 'default') c.deviceId = p.cameraDeviceId;
    return c;
  }

  function tokenPayload(t) {
    if (t && t.channelId) return { channelId: t.channelId };
    if (t && t.dmId) return { dmId: t.dmId };
    return undefined;
  }

  function join(arg) {
    var reason = unavailableReason(lastView);
    if (reason) { setError(reason); return Promise.resolve(); }
    var t = cleanTarget(arg) || selectedTarget(lastView) || (legacyAvailable(lastView) ? { legacy: true } : null);
    if (!t) { setError('Escolha um canal de voz para entrar.'); return Promise.resolve(); }
    if ((room || status === 'connecting') && target && sameTarget(target, t)) return Promise.resolve();
    // já em outra sala: troca (como clicar em outro canal de voz no Discord)
    var switching = !!(room || status === 'connecting');
    var before = switching ? leave(true) : Promise.resolve();

    var seq = ++joinSeq;
    errorText = '';
    status = 'connecting';
    target = t;
    targetInfo = infoFor(lastView, t);
    roomGroupId = t.legacy && lastView.group ? lastView.group.id : null;
    appliedVoicePrefs = '';
    scheduleRender();

    return before.then(function () {
      return call(function () { return bridge.voiceToken(tokenPayload(t)); });
    }).then(function (res) {
      if (seq !== joinSeq || status !== 'connecting' || room) return null;
      if (!res || !res.ok || typeof res.url !== 'string' || typeof res.token !== 'string') {
        status = 'off';
        target = null;
        targetInfo = null;
        setError((res && res.error) || 'Não deu para entrar na voz. Tente de novo.');
        return null;
      }
      var p = vp();
      var r;
      try {
        // webAudioMix: volume por pessoa acima de 100% e processador de entrada (volume/detecção de voz).
        var opts = {
          adaptiveStream: false, dynacast: true, webAudioMix: true,
          audioCaptureDefaults: micConstraints(),
          videoCaptureDefaults: cameraConstraints()
        };
        if (p.outputDeviceId && p.outputDeviceId !== 'default') opts.audioOutput = { deviceId: p.outputDeviceId };
        r = new LK.Room(opts);
      } catch (e) {
        status = 'off';
        target = null;
        targetInfo = null;
        setError('A biblioteca de voz não abriu. Rode npm install e abra o Ghost Rank de novo.');
        return null;
      }
      room = r;
      leavingOnPurpose = false;
      wire(r);
      return r.connect(res.url, res.token).then(function () {
        if (r !== room) return null;
        status = 'connected';
        // quem já estava transmitindo: só assina ao clicar em "Assistir"
        participantsList().forEach(function (pp) {
          if (isLocal(pp)) return;
          unsubscribeIfNotWatching(publication(pp, SRC().screen), pp);
          unsubscribeIfNotWatching(publication(pp, SRC().screenAudio), pp);
          applyVolumes(pp);
        });
        appliedVoicePrefs = JSON.stringify(vp());
        appliedVoiceObj = vp();
        SOUND.join();
        announce(target && target.dmId ? 'Você entrou na chamada.' : 'Você entrou no canal de voz.');
        startPing();
        scheduleRender();
        if (!prefMuted) return applyMic();
        return null;
      });
    }).catch(function (err) {
      if (seq !== joinSeq) return;
      var r = room;
      room = null;
      roomGroupId = null;
      target = null;
      targetInfo = null;
      status = 'off';
      if (r) { leavingOnPurpose = true; try { r.disconnect(); } catch (e) { /* ignora */ } }
      cleanupMedia();
      stopPing();
      setError('Não deu para conectar à voz. Verifique a internet e tente de novo.' + techDetail(err));
    });
  }

  // switching = true: saída silenciosa para entrar em outra sala logo em seguida.
  function leave(switching) {
    var r = room;
    var silent = switching === true;
    closeShareDialog();
    if (!silent) joinSeq++;
    if (!r) {
      if (status === 'connecting') status = 'off';
      if (!silent) { target = null; targetInfo = null; }
      scheduleRender();
      return Promise.resolve();
    }
    leavingOnPurpose = true;
    room = null;
    roomGroupId = null;
    status = 'off';
    if (!silent) { target = null; targetInfo = null; }
    cleanupMedia();
    stopPing();
    if (!silent) {
      SOUND.leave();
      announce('Você saiu da voz.');
    }
    scheduleRender();
    return Promise.resolve().then(function () { return r.disconnect(); }).catch(function () { /* ignora */ });
  }

  // Liga/desliga o microfone conforme prefMuted (só conectado). PTT e detecção de voz não passam
  // por aqui: eles só abrem/fecham o "portão" do áudio já publicado (rápido e sem avisar a sala).
  function applyMic() {
    if (!inRoom()) { scheduleRender(); return Promise.resolve(); }
    var lp = room.localParticipant;
    var want = !prefMuted;
    if (!!lp.isMicrophoneEnabled === want) { scheduleRender(); return Promise.resolve(); }
    micBusy = true;
    scheduleRender();
    var r = room;
    return Promise.resolve().then(function () { return lp.setMicrophoneEnabled(want, want ? micConstraints() : undefined); }).then(function () {
      micBusy = false;
      if (want) setupMicPipeline();
      if (r === room && !!lp.isMicrophoneEnabled !== !prefMuted) return applyMic();
      scheduleRender();
      return null;
    }, function (err) {
      micBusy = false;
      if (want) prefMuted = true;
      setError(mediaErrorMessage(err, 'mic') + techDetail(err));
    });
  }

  function toggleMute() {
    errorText = '';
    if (deafened) {
      // como no Discord: ligar o microfone também tira o ensurdecer
      deafened = false;
      prefMuted = false;
      applyAllVolumes();
      SOUND.undeafen();
    } else {
      prefMuted = !prefMuted;
      if (prefMuted) SOUND.mute(); else SOUND.unmute();
    }
    announce(prefMuted ? 'Microfone desligado.' : 'Microfone ligado.');
    return applyMic();
  }

  function toggleDeafen() {
    errorText = '';
    if (!deafened) {
      mutedBeforeDeafen = prefMuted;
      deafened = true;
      prefMuted = true;
      SOUND.deafen();
    } else {
      deafened = false;
      prefMuted = mutedBeforeDeafen;
      SOUND.undeafen();
    }
    applyAllVolumes();
    announce(deafened ? 'Ensurdecido: você não ouve ninguém e seu microfone está desligado.' : 'Áudio ligado.');
    return applyMic();
  }

  /* ---------- câmera ---------- */

  function videoOn() {
    var lp = room && room.localParticipant;
    return !!(inRoom() && lp && (lp.isCameraEnabled || publication(lp, SRC().camera)));
  }

  function toggleVideo() {
    if (!inRoom() || cameraBusy) return Promise.resolve();
    var lp = room.localParticipant;
    if (typeof lp.setCameraEnabled !== 'function') { setError('Câmera indisponível nesta versão.'); return Promise.resolve(); }
    var want = !videoOn();
    errorText = '';
    cameraBusy = true;
    scheduleRender();
    var r = room;
    var publish = { videoEncoding: { maxBitrate: 1700000, maxFramerate: 30 }, simulcast: true };
    return Promise.resolve().then(function () {
      return want ? lp.setCameraEnabled(true, cameraConstraints(), publish) : lp.setCameraEnabled(false);
    }).then(function () {
      cameraBusy = false;
      if (r !== room) return;
      if (!want) dropLocalCamera();
      announce(want ? 'Câmera ligada.' : 'Câmera desligada.');
      scheduleRender();
    }, function (err) {
      cameraBusy = false;
      setError(mediaErrorMessage(err, 'camera') + techDetail(err));
    });
  }

  /* ---------- entrada: volume, detecção de voz e apertar-para-falar ---------- */

  // Medidor: devolve o nível em dB (-100..0) de um AnalyserNode.
  function readDb(analyser, buf) {
    try {
      analyser.getFloatTimeDomainData(buf);
      var sum = 0;
      for (var i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      var rms = Math.sqrt(sum / buf.length);
      var db = rms > 0 ? 20 * Math.log10(rms) : -100;
      return Math.max(-100, Math.min(0, db));
    } catch (e) { return -100; }
  }

  var mic = null; // { ctx, src, gain, analyser, gate, dest, buf, mode, raw, clone, timer, level, floor, above }
  var micLevel = -100;
  var autoThreshold = -50;

  function ctxFor() {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume().catch(function () {});
    return audioCtx;
  }

  function localMicTrack() {
    var lp = room && room.localParticipant;
    var pub = lp ? publication(lp, SRC().mic) : null;
    return pub && pub.track ? pub.track : null;
  }

  // Grafo: fonte → ganho (volume de entrada) → medidor; ganho → portão → saída publicada.
  function buildGraph(rawTrack, ctx) {
    var g = { ctx: ctx };
    g.source = ctx.createMediaStreamSource(new MediaStream([rawTrack]));
    g.gain = ctx.createGain();
    g.gain.gain.value = vp().inputVolume / 100;
    g.analyser = ctx.createAnalyser();
    g.analyser.fftSize = 1024;
    g.buf = new Float32Array(g.analyser.fftSize);
    g.gate = ctx.createGain();
    g.gate.gain.value = 1;
    g.dest = ctx.createMediaStreamDestination();
    g.source.connect(g.gain);
    g.gain.connect(g.analyser);
    g.gain.connect(g.gate);
    g.gate.connect(g.dest);
    return g;
  }

  function destroyGraph(g) {
    if (!g) return;
    ['source', 'gain', 'analyser', 'gate'].forEach(function (k) { try { g[k].disconnect(); } catch (e) { /* ignora */ } });
    try { g.dest.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { /* ignora */ }
  }

  function teardownMicPipeline() {
    if (!mic) return;
    if (mic.timer) window.clearInterval(mic.timer);
    if (mic.mode === 'processor' && mic.track && typeof mic.track.stopProcessor === 'function') {
      try { Promise.resolve(mic.track.stopProcessor()).catch(function () {}); } catch (e) { /* ignora */ }
    }
    destroyGraph(mic.graph);
    if (mic.clone) { try { mic.clone.stop(); } catch (e) { /* ignora */ } }
    if (mic.raw && mic.mode === 'enabled') { try { mic.raw.enabled = true; } catch (e) { /* ignora */ } }
    mic = null;
    micLevel = -100;
    gateOpen = true;
  }

  // Liga o processamento na faixa do microfone publicada. Tenta o processador do LiveKit
  // (volume de entrada + portão sem avisar a sala); sem ele, mede uma cópia e liga/desliga a faixa.
  function setupMicPipeline() {
    var lt = localMicTrack();
    var raw = lt && lt.mediaStreamTrack;
    // com processador, mediaStreamTrack passa a ser a faixa processada: não é troca de microfone
    if (mic && mic.track === lt && (mic.raw === raw || (mic.proc && mic.proc.processedTrack === raw))) return;
    teardownMicPipeline();
    if (!lt) return;
    var ctx = ctxFor();
    var state = { track: lt, raw: raw || null, mode: 'none', graph: null, clone: null, above: 0, floor: -60, timer: null };
    mic = state;
    var startMeter = function () {
      state.timer = window.setInterval(tickGate, 50);
    };
    if (ctx && raw && typeof lt.setProcessor === 'function') {
      var proc = {
        name: 'ghost-rank-entrada',
        init: function (o) {
          destroyGraph(state.graph);
          state.graph = buildGraph(o.track, o.audioContext || ctx);
          proc.processedTrack = state.graph.dest.stream.getAudioTracks()[0];
          return Promise.resolve();
        },
        restart: function (o) { return proc.init(o); },
        destroy: function () { destroyGraph(state.graph); state.graph = null; return Promise.resolve(); }
      };
      state.proc = proc;
      Promise.resolve().then(function () { return lt.setProcessor(proc); }).then(function () {
        if (mic !== state) return;
        state.mode = 'processor';
        startMeter();
      }).catch(function () {
        if (mic !== state) return;
        state.proc = null;
        fallbackPipeline(state, ctx, raw);
        startMeter();
      });
      return;
    }
    if (ctx && raw) { fallbackPipeline(state, ctx, raw); startMeter(); }
  }

  function fallbackPipeline(state, ctx, raw) {
    try {
      state.clone = raw.clone();
      state.graph = buildGraph(state.clone, ctx);
      state.graph.gate.disconnect(); // só medimos; o portão é raw.enabled
      state.mode = 'enabled';
    } catch (e) {
      state.mode = 'none';
    }
  }

  function wantGateOpen(level) {
    var p = vp();
    if (p.mode === 'ptt') return pttHeld;
    var now = Date.now();
    var threshold = p.autoSensitivity ? autoThreshold : p.sensitivity;
    if (level >= threshold) { if (mic) mic.above = now; return true; }
    return !!(mic && now - mic.above < 300); // segura 300 ms depois da última fala
  }

  function tickGate() {
    if (!mic || !mic.graph) return;
    var level = readDb(mic.graph.analyser, mic.graph.buf);
    micLevel = level;
    // automático: piso de ruído que sobe devagar e desce rápido; limiar 14 dB acima dele
    if (level < mic.floor) mic.floor = level; else mic.floor = Math.min(-20, mic.floor + 0.04);
    autoThreshold = Math.max(-70, Math.min(-25, mic.floor + 14));
    setGate(wantGateOpen(level));
    if (settingsUi) settingsUi.onLevel(level);
  }

  function setGate(open) {
    if (!mic) return;
    if (mic.mode === 'processor' && mic.graph) {
      try { mic.graph.gate.gain.setTargetAtTime(open ? 1 : 0, mic.graph.ctx.currentTime, 0.012); } catch (e) { mic.graph.gate.gain.value = open ? 1 : 0; }
    } else if (mic.mode === 'enabled' && mic.raw) {
      if (mic.raw.enabled !== open) mic.raw.enabled = open;
    }
    if (open !== gateOpen) { gateOpen = open; scheduleRender(); }
  }

  // Apertar-para-falar: só com o Ghost Rank em foco (o navegador não vê teclas de fora da janela).
  var capturingKey = false;
  function isTextField(t) {
    if (!t || !t.tagName) return false;
    if (t.isContentEditable) return true;
    var tag = t.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') return !/^(button|checkbox|radio|range|submit|reset|color|file)$/i.test(t.type || '');
    return tag === 'SELECT';
  }
  function typesCharacter(code) { return /^(Key[A-Z]|Digit[0-9]|Space|Numpad[0-9]|Minus|Equal|Bracket|Semicolon|Quote|Backquote|Backslash|Comma|Period|Slash|IntlBackslash)/.test(code); }

  function pttKeyEvent(e, down) {
    if (capturingKey) return;
    var p = vp();
    if (p.mode !== 'ptt' || !inRoom() || e.code !== p.pttKey) return;
    if (down && e.repeat) { if (pttHeld) e.preventDefault(); return; }
    if (down && isTextField(e.target) && typesCharacter(e.code)) return; // digitando no chat
    if (down) e.preventDefault();
    if (pttHeld === down) return;
    pttHeld = down;
    setGate(wantGateOpen(micLevel));
    scheduleRender();
  }
  document.addEventListener('keydown', function (e) { pttKeyEvent(e, true); }, true);
  document.addEventListener('keyup', function (e) { pttKeyEvent(e, false); }, true);
  window.addEventListener('blur', function () {
    if (pttHeld) { pttHeld = false; setGate(wantGateOpen(micLevel)); scheduleRender(); }
  });

  /* ---------- aplicar preferências de voz ao vivo ---------- */

  var appliedVoiceObj = null;

  function applyVoicePrefs() {
    var p = vp();
    var sig = JSON.stringify(p);
    if (sig === appliedVoicePrefs) return;
    var prev = appliedVoiceObj || p;
    appliedVoicePrefs = sig;
    appliedVoiceObj = p;
    if (p.mode !== 'ptt') pttHeld = false;
    if (!inRoom()) { scheduleRender(); return; }
    var r = room;
    var sw = function (kind, id) {
      if (typeof r.switchActiveDevice !== 'function') return Promise.resolve();
      return Promise.resolve().then(function () { return r.switchActiveDevice(kind, id || 'default'); }).catch(function (err) {
        setError(mediaErrorMessage(err, kind === 'videoinput' ? 'camera' : 'mic') + techDetail(err));
      });
    };
    if (p.inputDeviceId !== prev.inputDeviceId) sw('audioinput', p.inputDeviceId).then(function () { if (r === room) { teardownMicPipeline(); setupMicPipeline(); } });
    if (p.outputDeviceId !== prev.outputDeviceId) {
      sw('audiooutput', p.outputDeviceId);
      setSinkAll(p.outputDeviceId);
    }
    if (p.cameraDeviceId !== prev.cameraDeviceId && videoOn()) sw('videoinput', p.cameraDeviceId);
    if (p.noiseSuppression !== prev.noiseSuppression || p.echoCancellation !== prev.echoCancellation) {
      var lt = localMicTrack();
      if (lt && typeof lt.restartTrack === 'function') {
        Promise.resolve().then(function () { return lt.restartTrack(micConstraints()); })
          .then(function () { if (r === room) { teardownMicPipeline(); setupMicPipeline(); } })
          .catch(function (err) { setError(mediaErrorMessage(err, 'mic') + techDetail(err)); });
      }
    }
    if (mic && mic.graph && mic.mode === 'processor') {
      try { mic.graph.gain.gain.value = p.inputVolume / 100; } catch (e) { /* ignora */ }
    }
    if (p.outputVolume !== prev.outputVolume) applyAllVolumes();
    if (mic) setGate(wantGateOpen(micLevel));
    scheduleRender();
  }

  function setSinkAll(deviceId) {
    var id = deviceId && deviceId !== 'default' ? deviceId : '';
    Object.keys(audioEls).forEach(function (sid) {
      audioEls[sid].forEach(function (m) {
        if (typeof m.setSinkId === 'function') m.setSinkId(id).catch(function () {});
      });
    });
    Object.keys(streamMedia).forEach(function (k) {
      var m = streamMedia[k] && streamMedia[k].el;
      if (m && typeof m.setSinkId === 'function') m.setSinkId(id).catch(function () {});
    });
  }

  /* ---------- estado para os outros (barra lateral) ---------- */

  function publishVoiceState() {
    if (!bridge || typeof bridge.setVoiceState !== 'function') return;
    var connected = inRoom() && status === 'connected';
    var lp = room && room.localParticipant;
    var vs = connected ? {
      channelId: target && target.channelId ? target.channelId : null,
      dmId: target && target.dmId ? target.dmId : null,
      muted: !!(prefMuted || deafened),
      deafened: !!deafened,
      streaming: !!(lp && lp.isScreenShareEnabled),
      video: videoOn()
    } : { channelId: null, dmId: null, muted: !!(prefMuted || deafened), deafened: !!deafened, streaming: false, video: false };
    if (!connected && status === 'reconnecting') return;
    var sig = JSON.stringify(vs);
    if (sig === lastVoiceSig) return;
    // fora de qualquer sala, sem nunca ter entrado: não precisa avisar
    if (!lastVoiceSig && !connected) { lastVoiceSig = sig; return; }
    lastVoiceSig = sig;
    call(function () { return bridge.setVoiceState(vs); });
  }

  /* ---------- ping ---------- */

  function readPing() {
    try {
      var c = room && room.engine && room.engine.client;
      var rtt = c && Number(c.rtt);
      return rtt > 0 && rtt < 10000 ? Math.round(rtt) : null;
    } catch (e) { return null; }
  }
  function startPing() {
    stopPing();
    pingTimer = window.setInterval(function () { if (ui) renderConnection(); }, 3000);
  }
  function stopPing() { if (pingTimer) { window.clearInterval(pingTimer); pingTimer = null; } }

  /* ---------- tela cheia / ampliar ---------- */

  function isBig(tile) { return document.fullscreenElement === tile.root || expanded === tile; }

  function leaveBig(tile) {
    if (expanded === tile) { tile.root.classList.remove('is-expanded'); expanded = null; }
    if (document.fullscreenElement === tile.root && document.exitFullscreen) document.exitFullscreen().catch(function () {});
  }

  function toggleBig(tile) {
    if (isBig(tile)) { leaveBig(tile); scheduleRender(); return; }
    var inside = function () {
      if (expanded && expanded !== tile) expanded.root.classList.remove('is-expanded');
      expanded = tile;
      tile.root.classList.add('is-expanded');
      scheduleRender();
    };
    if (tile.root.requestFullscreen) {
      tile.root.requestFullscreen({ navigationUI: 'hide' }).then(scheduleRender, inside);
    } else inside();
  }

  function pipAvailable(media) {
    return !!(media && media.tagName === 'VIDEO' && typeof media.requestPictureInPicture === 'function' && document.pictureInPictureEnabled !== false);
  }

  function togglePip(identity) {
    var m = streamMedia[identity];
    if (!m || !pipAvailable(m.el)) return;
    if (document.pictureInPictureElement === m.el) {
      document.exitPictureInPicture().catch(function () {}).then(scheduleRender);
    } else {
      m.el.requestPictureInPicture().then(scheduleRender, function () {
        setError('Não deu para abrir a janela flutuante.');
      });
    }
  }

  /* ---------- menu por pessoa (volume / mutar para mim) ---------- */

  var menu = null; // { root, identity, opener, range, out, muteBtn, title }

  function buildMenu() {
    var root = el('div', 'vc-menu');
    root.setAttribute('role', 'dialog');
    root.hidden = true;
    var title = el('p', 'vc-menu-title');
    title.id = 'vc-menu-title';
    root.setAttribute('aria-labelledby', title.id);
    root.appendChild(title);

    var label = el('label', 'vc-menu-volume');
    var top = el('span', 'vc-menu-row');
    top.appendChild(el('span', null, 'Volume do usuário'));
    var out = el('output', 'vc-menu-out', '100%');
    top.appendChild(out);
    label.appendChild(top);
    var range = document.createElement('input');
    range.type = 'range';
    range.min = '0';
    range.max = '200';
    range.step = '5';
    range.className = 'vc-range';
    label.appendChild(range);
    root.appendChild(label);

    var muteBtn = button('vc-menu-item', 'Mutar para mim', 'volumeOff');
    pressed(muteBtn, false);
    root.appendChild(muteBtn);

    range.addEventListener('input', function () {
      if (!menu.identity) return;
      var pr = prefsFor(menu.identity);
      pr.volume = Math.max(0, Math.min(200, Number(range.value) || 0)) / 100;
      out.textContent = Math.round(pr.volume * 100) + '%';
      applyVolumes(findParticipant(menu.identity));
      scheduleRender();
    });
    muteBtn.addEventListener('click', function () {
      if (!menu.identity) return;
      var pr = prefsFor(menu.identity);
      pr.mutedForMe = !pr.mutedForMe;
      pressed(muteBtn, pr.mutedForMe);
      applyVolumes(findParticipant(menu.identity));
      var p = findParticipant(menu.identity);
      announce(nameFor(p) + (pr.mutedForMe ? ' mutado para você.' : ' não está mais mutado para você.'));
      scheduleRender();
    });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(true); return; }
      if (e.key === 'Tab') {
        // mantém o foco dentro do menu
        var items = [range, muteBtn];
        var i = items.indexOf(document.activeElement);
        e.preventDefault();
        items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
      }
    });
    menu = { root: root, identity: null, opener: null, range: range, out: out, muteBtn: muteBtn, title: title };
  }

  function openMenu(identity, tile) {
    if (!menu) buildMenu();
    var p = findParticipant(identity);
    if (!p || isLocal(p)) return;
    closeMenu(false);
    var pr = prefsFor(identity);
    menu.identity = identity;
    menu.opener = tile.moreBtn;
    menu.title.textContent = nameFor(p);
    menu.range.value = String(Math.round(pr.volume * 100));
    menu.range.setAttribute('aria-label', 'Volume de ' + nameFor(p));
    menu.out.textContent = Math.round(pr.volume * 100) + '%';
    pressed(menu.muteBtn, pr.mutedForMe);
    tile.root.appendChild(menu.root);
    tile.root.classList.add('has-menu');
    menu.root.hidden = false;
    if (tile.moreBtn) tile.moreBtn.setAttribute('aria-expanded', 'true');
    menu.range.focus();
  }

  function closeMenu(returnFocus) {
    if (!menu || menu.root.hidden) return;
    menu.root.hidden = true;
    var host = menu.root.parentNode;
    if (host && host.classList) host.classList.remove('has-menu');
    if (menu.opener) {
      menu.opener.setAttribute('aria-expanded', 'false');
      if (returnFocus && document.body.contains(menu.opener)) menu.opener.focus();
    }
    menu.identity = null;
    menu.opener = null;
  }

  document.addEventListener('pointerdown', function (e) {
    if (menu && !menu.root.hidden && !menu.root.contains(e.target) && !(menu.opener && menu.opener.contains(e.target))) closeMenu(false);
  });

  /* ---------- cartões do palco ---------- */

  function createPersonTile(identity) {
    var root = el('div', 'vc-tile vc-tile-person');
    root.tabIndex = 0;
    root.setAttribute('role', 'group');
    root.dataset.key = 'p:' + identity;
    var body = el('div', 'vc-tile-body');
    root.appendChild(body);
    var nameBox = el('div', 'vc-tile-label');
    var name = el('span', 'vc-tile-name');
    nameBox.appendChild(name);
    root.appendChild(nameBox);
    var badges = el('div', 'vc-tile-badges');
    root.appendChild(badges);
    var moreBtn = button('vc-icon-btn vc-tile-more', 'Opções', 'more', { iconOnly: true });
    moreBtn.setAttribute('aria-haspopup', 'dialog');
    moreBtn.setAttribute('aria-expanded', 'false');
    root.appendChild(moreBtn);
    var tile = { key: 'p:' + identity, identity: identity, kind: 'person', root: root, body: body, name: name, badges: badges, moreBtn: moreBtn, sig: '' };
    moreBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (menu && !menu.root.hidden && menu.identity === identity) closeMenu(true); else openMenu(identity, tile);
    });
    wireTileKeys(tile);
    return tile;
  }

  function wireTileKeys(tile) {
    tile.root.addEventListener('click', function (e) {
      if (e.target.closest('button, input, label, .vc-menu')) return;
      if (tile.kind === 'stream' && !tile.watchingNow && !tile.isMine) return;
      toggleFocus(tile.key);
    });
    tile.root.addEventListener('dblclick', function (e) {
      if (e.target.closest('button, input, label')) return;
      if (tile.kind === 'person') { if (tile.root.classList.contains('has-video')) toggleBig(tile); return; }
      if (tile.watchingNow || tile.isMine) toggleBig(tile);
    });
    tile.root.addEventListener('contextmenu', function (e) {
      if (tile.kind !== 'person' || !tile.moreBtn || tile.moreBtn.hidden) return;
      e.preventDefault();
      openMenu(tile.identity, tile);
    });
    tile.root.addEventListener('keydown', function (e) {
      if (e.target !== tile.root) return;
      if ((e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) && tile.kind === 'person' && tile.moreBtn && !tile.moreBtn.hidden) {
        e.preventDefault();
        openMenu(tile.identity, tile);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (tile.kind === 'stream' && !tile.watchingNow && !tile.isMine) watch(tile.identity);
        else toggleFocus(tile.key);
      }
    });
  }

  function toggleFocus(key) {
    focusKey = focusKey === key ? null : key;
    scheduleRender();
  }

  function badge(iconName, text, cls) {
    var b = el('span', 'vc-badge ' + (cls || ''));
    b.appendChild(icon(iconName, 16));
    b.appendChild(el('span', 'visually-hidden', text));
    b.title = text;
    return b;
  }

  function liveBadge() { return el('span', 'vc-live', 'AO VIVO'); }

  function updatePersonTile(tile, p) {
    var mine = isLocal(p);
    var name = nameFor(p);
    var muted = !micOn(p);
    var deaf = mine && deafened;
    var sharing = isSharing(p);
    var pr = mine ? null : prefsFor(p.identity);
    var talking = isSpeaking(p);
    var cam = mine ? localCamera : cameraMedia[p.identity];
    var camEl = cam && cam.el ? cam.el : null;
    var ptt = mine && vp().mode === 'ptt';
    tile.root.classList.toggle('is-speaking', talking);
    tile.root.classList.toggle('is-focused', focusKey === tile.key);
    tile.root.classList.toggle('has-video', !!camEl);
    tile.root.classList.toggle('is-ptt-open', ptt && pttHeld && !muted);
    var states = [];
    if (deaf) states.push('ensurdecido'); else if (muted) states.push('mutado');
    if (camEl) states.push('câmera ligada');
    if (sharing) states.push('transmitindo');
    if (pr && pr.mutedForMe) states.push('mutado para você');
    tile.root.setAttribute('aria-label', name + (mine ? ' (você)' : '') + (states.length ? ', ' + states.join(', ') : ''));

    if (camEl) {
      if (camEl.parentNode !== tile.body || tile.body.childNodes.length !== 1) { tile.body.textContent = ''; tile.body.appendChild(camEl); }
    }
    var sig = [name, mine, muted, deaf, sharing, !!camEl, pr ? pr.mutedForMe : '', pr ? pr.volume : '', hueFor(p.identity)].join('|');
    if (sig === tile.sig) return;
    tile.sig = sig;
    if (!camEl) { tile.body.textContent = ''; tile.body.appendChild(avatar(name, p.identity, false)); }
    setText(tile.name, mine ? name + ' (você)' : name);
    tile.badges.textContent = '';
    if (sharing) tile.badges.appendChild(liveBadge());
    if (camEl) tile.badges.appendChild(badge('camera', 'Câmera ligada', 'vc-badge-on'));
    if (deaf) tile.badges.appendChild(badge('headphonesOff', 'Ensurdecido', 'vc-badge-off'));
    else if (muted) tile.badges.appendChild(badge('micOff', 'Mutado', 'vc-badge-off'));
    if (pr && pr.mutedForMe) tile.badges.appendChild(badge('volumeOff', 'Mutado para você', 'vc-badge-warn'));
    else if (pr && pr.volume !== 1) tile.badges.appendChild(el('span', 'vc-badge vc-badge-text', Math.round(pr.volume * 100) + '%'));
    show(tile.moreBtn, !mine);
    tile.moreBtn.setAttribute('aria-label', 'Opções de ' + name);
    tile.moreBtn.title = 'Volume e opções de ' + name;
  }

  function createStreamTile(identity) {
    var root = el('div', 'vc-tile vc-tile-stream');
    root.tabIndex = 0;
    root.setAttribute('role', 'group');
    root.dataset.key = 's:' + identity;
    var mediaBox = el('div', 'vc-stream-media');
    root.appendChild(mediaBox);
    var cover = el('div', 'vc-stream-cover');
    root.appendChild(cover);
    var top = el('div', 'vc-tile-badges vc-stream-top');
    top.appendChild(liveBadge());
    root.appendChild(top);
    var nameBox = el('div', 'vc-tile-label');
    var name = el('span', 'vc-tile-name');
    nameBox.appendChild(icon('screen', 16));
    nameBox.appendChild(name);
    root.appendChild(nameBox);

    var center = el('div', 'vc-stream-center');
    var avatarSlot = el('div', 'vc-stream-avatar');
    center.appendChild(avatarSlot);
    var watchBtn = button('btn vc-watch', 'Assistir transmissão', 'eye');
    watchBtn.dataset.vcAction = 'watch';
    center.appendChild(watchBtn);
    var loading = el('p', 'vc-stream-loading', 'Carregando transmissão…');
    center.appendChild(loading);
    var stopShareBtn = button('btn btn-danger-solid vc-stop-share', 'Parar transmissão', 'stop');
    center.appendChild(stopShareBtn);
    root.appendChild(center);

    var controls = el('div', 'vc-stream-controls');
    var bigBtn = button('vc-icon-btn', 'Tela cheia', 'expand', { iconOnly: true });
    pressed(bigBtn, false);
    var pipBtn = button('vc-icon-btn', 'Picture-in-picture (janela flutuante)', 'pip', { iconOnly: true });
    pressed(pipBtn, false);
    var volLabel = el('label', 'vc-stream-volume');
    volLabel.appendChild(icon('volume', 18));
    var volRange = document.createElement('input');
    volRange.type = 'range';
    volRange.min = '0';
    volRange.max = '100';
    volRange.step = '5';
    volRange.value = '100';
    volRange.className = 'vc-range';
    volLabel.appendChild(volRange);
    var stopBtn = button('btn btn-small vc-stop-watch', 'Parar de assistir', 'close', { size: 16 });
    controls.appendChild(bigBtn);
    controls.appendChild(pipBtn);
    controls.appendChild(volLabel);
    controls.appendChild(stopBtn);
    root.appendChild(controls);

    var tile = {
      key: 's:' + identity, identity: identity, kind: 'stream', root: root, mediaBox: mediaBox, cover: cover, avatarSlot: avatarSlot, name: name,
      watchBtn: watchBtn, loading: loading, stopShareBtn: stopShareBtn, controls: controls, bigBtn: bigBtn, pipBtn: pipBtn,
      volRange: volRange, stopBtn: stopBtn, sig: '', watchingNow: false, isMine: false
    };
    watchBtn.addEventListener('click', function () { watch(identity); });
    stopBtn.addEventListener('click', function () { stopWatching(identity); });
    stopShareBtn.addEventListener('click', stopShare);
    bigBtn.addEventListener('click', function () { toggleBig(tile); });
    pipBtn.addEventListener('click', function () { togglePip(identity); });
    volRange.addEventListener('input', function () {
      streamVolume[identity] = Math.max(0, Math.min(100, Number(volRange.value) || 0)) / 100;
      applyVolumes(findParticipant(identity));
    });
    wireTileKeys(tile);
    return tile;
  }

  function placeMedia(box, media) {
    if (media && media.parentNode === box && box.childNodes.length === 1) return;
    if (media && media.parentNode !== box) { box.textContent = ''; box.appendChild(media); return; }
    if (!media && box.childNodes.length) box.textContent = '';
  }

  function updateStreamTile(tile, p) {
    var mine = isLocal(p);
    var name = nameFor(p);
    var w = !mine && !!watching[p.identity];
    var media = mine ? (localPreview && localPreview.el) : (w ? (streamMedia[p.identity] && streamMedia[p.identity].el) : snapshots[p.identity]);
    tile.isMine = mine;
    tile.watchingNow = w;
    tile.root.classList.toggle('is-mine', mine);
    tile.root.classList.toggle('is-watching', w);
    tile.root.classList.toggle('is-focused', focusKey === tile.key);
    tile.root.classList.toggle('has-media', !!media);
    placeMedia(tile.mediaBox, media || null);
    tile.mediaBox.classList.toggle('is-snapshot', !w && !mine && !!media);

    var sig = [name, mine, w, !!media].join('|');
    if (sig !== tile.sig) {
      tile.sig = sig;
      tile.avatarSlot.textContent = '';
      if (!media) tile.avatarSlot.appendChild(avatar(name, p.identity, false));
      setText(tile.name, mine ? 'Sua transmissão' : 'Tela de ' + name);
      tile.root.setAttribute('aria-label', (mine ? 'Sua transmissão' : 'Transmissão de ' + name) + ', ao vivo' + (w ? ', assistindo' : ''));
      tile.watchBtn.setAttribute('aria-label', 'Assistir transmissão de ' + name);
      tile.volRange.setAttribute('aria-label', 'Volume da transmissão de ' + name);
      tile.stopBtn.setAttribute('aria-label', 'Parar de assistir a transmissão de ' + name);
    }
    show(tile.watchBtn, !mine && !w);
    show(tile.loading, w && !media);
    show(tile.stopShareBtn, mine);
    show(tile.controls, w || mine);
    show(tile.volRange.parentNode, w);
    show(tile.stopBtn, w);
    var live = w ? streamMedia[p.identity] : (mine ? localPreview : null);
    show(tile.pipBtn, !!(live && pipAvailable(live.el)));
    pressed(tile.pipBtn, !!(live && document.pictureInPictureElement === live.el));
    var big = isBig(tile);
    pressed(tile.bigBtn, big);
    tile.bigBtn.setAttribute('aria-label', big ? 'Sair da tela cheia' : 'Tela cheia');
    tile.bigBtn.title = big ? 'Sair da tela cheia (Esc)' : 'Tela cheia (duplo clique)';
    setIcon(tile.bigBtn, big ? 'shrink' : 'expand');
    var sv = streamVolume[p.identity];
    var want = String(Math.round((sv == null ? 1 : sv) * 100));
    if (tile.volRange.value !== want && document.activeElement !== tile.volRange) tile.volRange.value = want;
  }

  /* ---------- montagem da interface ---------- */

  function buildUi() {
    var live = el('div', 'visually-hidden');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('role', 'status');
    var audioSink = el('div', 'vc-audio-sink');
    audioSink.hidden = true;
    document.body.appendChild(live);
    document.body.appendChild(audioSink);

    // Palco
    var stageRoot = el('section', 'vc-stage');
    stageRoot.setAttribute('aria-label', 'Sala de voz');
    var idle = el('div', 'vc-idle');
    var idleIcon = el('span', 'vc-idle-icon');
    idleIcon.appendChild(icon('speaker', 40));
    idle.appendChild(idleIcon);
    var idleTitle = el('h2', 'vc-idle-title', 'Sala de voz');
    idle.appendChild(idleTitle);
    var idleText = el('p', 'vc-idle-text', 'Converse por voz e transmita sua tela para o grupo.');
    idle.appendChild(idleText);
    var idlePeople = el('ul', 'vc-idle-people');
    idlePeople.setAttribute('aria-label', 'Quem está aqui');
    idlePeople.hidden = true;
    idle.appendChild(idlePeople);
    var idleJoin = button('btn btn-primary vc-idle-join', 'Entrar na voz', 'speaker');
    idle.appendChild(idleJoin);
    var stageError = el('p', 'vc-error');
    stageError.hidden = true;
    idle.appendChild(stageError);
    stageRoot.appendChild(idle);

    var room_ = el('div', 'vc-room');
    var main = el('div', 'vc-main');
    var grid = el('div', 'vc-grid');
    var focus = el('div', 'vc-focus');
    var strip = el('div', 'vc-strip');
    strip.setAttribute('role', 'list');
    strip.setAttribute('aria-label', 'Outros na sala');
    main.appendChild(grid);
    main.appendChild(focus);
    room_.appendChild(main);
    room_.appendChild(strip);
    var roomError = el('p', 'vc-error vc-room-error');
    roomError.hidden = true;
    room_.appendChild(roomError);

    var bar = el('div', 'vc-bar');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Controles da voz');
    var barMic = button('vc-ctl vc-ctl-lg', 'Mutar', 'mic', { iconOnly: true });
    var barDeaf = button('vc-ctl vc-ctl-lg', 'Ensurdecer', 'headphones', { iconOnly: true });
    var barCam = button('vc-ctl vc-ctl-lg', 'Ligar câmera', 'cameraOff', { iconOnly: true });
    var barShare = button('vc-ctl vc-ctl-lg vc-ctl-share', 'Compartilhar tela', 'screenUp', { iconOnly: true });
    var barAudio = button('btn btn-small vc-audio-btn', 'Ativar som', 'volume');
    var barLeave = button('vc-ctl vc-ctl-lg vc-ctl-leave', 'Desconectar', 'phoneDown', { iconOnly: true });
    [barMic, barDeaf, barCam].forEach(function (b) { pressed(b, false); });
    pressed(barShare, false);
    bar.appendChild(barMic);
    bar.appendChild(barDeaf);
    bar.appendChild(barCam);
    bar.appendChild(barShare);
    bar.appendChild(barAudio);
    bar.appendChild(barLeave);
    room_.appendChild(bar);
    stageRoot.appendChild(room_);

    // Barra lateral: quem está na voz
    var chRoot = el('div', 'vc-channel');
    var chList = el('ul', 'vc-ch-list');
    chList.setAttribute('aria-label', 'Na sala de voz');
    chRoot.appendChild(chList);
    var chError = el('p', 'vc-error vc-ch-error');
    chError.setAttribute('role', 'alert');
    chError.hidden = true;
    chRoot.appendChild(chError);

    // Painel de conexão
    var conn = el('div', 'vc-conn');
    conn.setAttribute('role', 'group');
    conn.setAttribute('aria-label', 'Conexão de voz');
    var connTop = el('div', 'vc-conn-top');
    var connInfo = el('div', 'vc-conn-info');
    var connStatus = el('p', 'vc-conn-status');
    connStatus.appendChild(icon('signal', 16));
    var connStatusText = el('span', null, 'Voz conectada');
    connStatus.appendChild(connStatusText);
    var connPing = el('span', 'vc-conn-ping');
    connStatus.appendChild(connPing);
    connInfo.appendChild(connStatus);
    var connWhere = el('p', 'vc-conn-where');
    connInfo.appendChild(connWhere);
    connTop.appendChild(connInfo);
    var connLeave = button('vc-icon-btn vc-conn-leave', 'Desconectar', 'phoneDown', { iconOnly: true });
    connTop.appendChild(connLeave);
    conn.appendChild(connTop);
    var connActions = el('div', 'vc-conn-actions');
    var connCam = button('vc-conn-btn', 'Vídeo', 'camera', { size: 16 });
    pressed(connCam, false);
    var connShare = button('vc-conn-btn', 'Compartilhar tela', 'screenUp', { size: 16 });
    pressed(connShare, false);
    connActions.appendChild(connCam);
    connActions.appendChild(connShare);
    conn.appendChild(connActions);
    var connPtt = el('p', 'vc-conn-ptt');
    connPtt.hidden = true;
    conn.appendChild(connPtt);

    // Controles do usuário
    var uc = el('div', 'vc-user-controls');
    var ucMic = button('vc-ctl', 'Mutar', 'mic', { iconOnly: true });
    var ucDeaf = button('vc-ctl', 'Ensurdecer', 'headphones', { iconOnly: true });
    var ucGear = button('vc-ctl vc-ctl-gear', 'Configurações de usuário', 'gear', { iconOnly: true });
    pressed(ucMic, false);
    pressed(ucDeaf, false);
    uc.appendChild(ucMic);
    uc.appendChild(ucDeaf);
    uc.appendChild(ucGear);

    ui = {
      live: live, audioSink: audioSink,
      stageRoot: stageRoot, idle: idle, idleTitle: idleTitle, idleText: idleText, idlePeople: idlePeople, idlePeopleSig: '',
      idleJoin: idleJoin, stageError: stageError,
      room: room_, main: main, grid: grid, focus: focus, strip: strip, roomError: roomError,
      bar: bar, barMic: barMic, barDeaf: barDeaf, barCam: barCam, barShare: barShare, barAudio: barAudio, barLeave: barLeave,
      chRoot: chRoot, chList: chList, chError: chError, chSig: '',
      conn: conn, connStatus: connStatus, connStatusText: connStatusText, connPing: connPing, connWhere: connWhere,
      connLeave: connLeave, connShare: connShare, connCam: connCam, connPtt: connPtt,
      uc: uc, ucMic: ucMic, ucDeaf: ucDeaf, ucGear: ucGear
    };

    idleJoin.addEventListener('click', function () { join(selectedTarget(lastView) || undefined); });
    [barMic, ucMic].forEach(function (b) { b.addEventListener('click', toggleMute); });
    [barDeaf, ucDeaf].forEach(function (b) { b.addEventListener('click', toggleDeafen); });
    [barCam, connCam].forEach(function (b) { b.addEventListener('click', toggleVideo); });
    ucGear.addEventListener('click', function () {
      if (typeof onOpenSettings === 'function') { try { onOpenSettings('voice'); } catch (e) { /* ignora */ } }
    });
    [barShare, connShare].forEach(function (b) { b.addEventListener('click', function () { openShareDialog(b); }); });
    [barLeave, connLeave].forEach(function (b) { b.addEventListener('click', function () { leave(); }); });
    barAudio.addEventListener('click', function () {
      if (room && typeof room.startAudio === 'function') Promise.resolve().then(function () { return room.startAudio(); }).then(scheduleRender, scheduleRender);
    });

    if (els.stage) { els.stage.textContent = ''; els.stage.appendChild(stageRoot); }
    if (els.channelMembers) { els.channelMembers.textContent = ''; els.channelMembers.appendChild(chRoot); }
    if (els.connection) { els.connection.textContent = ''; els.connection.appendChild(conn); }
    if (els.userControls) { els.userControls.textContent = ''; els.userControls.appendChild(uc); }
  }

  /* ---------- renderização ---------- */

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    Promise.resolve().then(function () { renderQueued = false; render(); });
  }

  function syncMicButton(btn) {
    var muted = deafened || prefMuted;
    pressed(btn, muted);
    btn.classList.toggle('is-off', muted);
    var ptt = vp().mode === 'ptt' && inRoom() && !muted;
    btn.classList.toggle('is-ptt', ptt);
    btn.classList.toggle('is-ptt-open', ptt && pttHeld);
    btn.setAttribute('aria-label', 'Mutar');
    btn.title = muted ? 'Ligar microfone (Ctrl+Shift+M)' : 'Mutar (Ctrl+Shift+M)';
    setIcon(btn, muted ? 'micOff' : 'mic', btn.classList.contains('vc-ctl-lg') ? 22 : 18);
    btn.disabled = micBusy;
  }

  function syncDeafButton(btn) {
    pressed(btn, deafened);
    btn.classList.toggle('is-off', deafened);
    btn.setAttribute('aria-label', 'Ensurdecer');
    btn.title = deafened ? 'Parar de ensurdecer (Ctrl+Shift+D)' : 'Ensurdecer (Ctrl+Shift+D)';
    setIcon(btn, deafened ? 'headphonesOff' : 'headphones', btn.classList.contains('vc-ctl-lg') ? 22 : 18);
  }

  function syncCamButton(btn) {
    var on = videoOn();
    pressed(btn, on);
    btn.classList.toggle('is-active', on);
    var label = on ? 'Desligar câmera' : 'Ligar câmera';
    if (btn.getAttribute('aria-label') !== null) { btn.setAttribute('aria-label', label); btn.title = label; }
    var t = btn.querySelector('.vc-btn-text');
    if (t) setText(t, 'Vídeo');
    setIcon(btn, on ? 'camera' : 'cameraOff', btn.classList.contains('vc-ctl-lg') ? 22 : 16);
    btn.disabled = !inRoom() || cameraBusy;
  }

  function syncShareButton(btn, sharing) {
    pressed(btn, sharing);
    btn.classList.toggle('is-active', sharing);
    var label = sharing ? 'Parar transmissão' : 'Compartilhar tela';
    if (btn.getAttribute('aria-label') !== null) { btn.setAttribute('aria-label', label); btn.title = label; }
    var t = btn.querySelector('.vc-btn-text');
    if (t) setText(t, sharing ? 'Parar' : 'Tela');
    btn.disabled = !inRoom();
  }

  function renderConnection() {
    var connected = inRoom();
    var visible = connected || status === 'connecting';
    if (els.connection) show(els.connection, visible);
    show(ui.conn, visible);
    var label = status === 'connecting' ? 'Conectando…' : status === 'reconnecting' ? 'Reconectando…' : 'Voz conectada';
    setText(ui.connStatusText, label);
    ui.connStatus.dataset.state = status;
    var ping = status === 'connected' ? readPing() : null;
    setText(ui.connPing, ping ? ping + ' ms' : '');
    show(ui.connPing, !!ping);
    if (ping) ui.connPing.title = 'Ping: ' + ping + ' ms';
    setText(ui.connWhere, whereLabel());
    ui.connWhere.title = whereLabel();
    var p = vp();
    var ptt = connected && p.mode === 'ptt' && !(prefMuted || deafened);
    show(ui.connPtt, ptt);
    if (ptt) {
      setText(ui.connPtt, pttHeld ? 'Falando… (' + keyLabel(p.pttKey) + ')' : 'Aperte ' + keyLabel(p.pttKey) + ' para falar');
      ui.connPtt.classList.toggle('is-open', pttHeld);
    }
  }

  // Compatibilidade: lista antiga de quem está na sala (só se a tela ainda passar els.channelMembers).
  function renderChannel(list) {
    if (!els.channelMembers) { return; }
    var connected = inRoom();
    var sig = connected ? list.map(function (p) {
      return [p.identity, nameFor(p), isSpeaking(p), micOn(p), isLocal(p) && deafened, isSharing(p)].join(':');
    }).join('|') : '';
    if (sig !== ui.chSig) {
      ui.chSig = sig;
      ui.chList.textContent = '';
      if (connected) list.forEach(function (p) {
        var li = el('li', 'vc-ch-member');
        var talking = isSpeaking(p);
        li.classList.toggle('is-speaking', talking);
        li.appendChild(avatar(nameFor(p), p.identity, true));
        li.appendChild(el('span', 'vc-ch-name', nameFor(p)));
        var icons = el('span', 'vc-ch-icons');
        if (isSharing(p)) icons.appendChild(liveBadge());
        if (isLocal(p) && deafened) icons.appendChild(badge('headphonesOff', 'ensurdecido', 'vc-badge-off'));
        else if (!micOn(p)) icons.appendChild(badge('micOff', 'mutado', 'vc-badge-off'));
        if (talking) icons.appendChild(el('span', 'visually-hidden', 'falando'));
        li.appendChild(icons);
        ui.chList.appendChild(li);
      });
    }
    show(ui.chList, connected && list.length > 0);
    setText(ui.chError, errorText);
    show(ui.chError, !!errorText);
  }

  // Alvo que o palco mostra: o selecionado na tela; sem seleção de voz, a sala em que está.
  function stageTarget() {
    return selectedTarget(lastView) || target || (legacyAvailable(lastView) ? { legacy: true } : null);
  }

  function voiceStatesFor(t) {
    var vs = lastView && lastView.voiceStates;
    if (!vs || !t) return [];
    var key = t.channelId ? t.channelId : (t.dmId ? 'dm:' + t.dmId : null);
    var list = key && Array.isArray(vs[key]) ? vs[key] : [];
    return list.filter(function (s) { return s && typeof s.userId === 'string'; });
  }

  function renderIdle(st, reason) {
    var info = infoFor(lastView, st);
    var title = 'Sala de voz';
    var text = 'Converse por voz e transmita sua tela para o grupo.';
    var joinLabel = 'Entrar na voz';
    var elsewhere = !!(target && (room || status === 'connecting') && !sameTarget(target, st));
    if (st && st.channelId) {
      title = info.channelName || 'Canal de voz';
      text = 'Ninguém está aqui ainda. Entre e chame o pessoal.';
    } else if (st && st.dmId) {
      var dm = findDm(lastView, st.dmId);
      var nm = dm && dm.user && dm.user.displayName ? String(dm.user.displayName) : 'esta pessoa';
      title = 'Chamada com ' + nm;
      text = 'Ligue para conversar por voz, com câmera ou tela.';
      joinLabel = 'Iniciar chamada';
    }
    var people = voiceStatesFor(st);
    if (people.length) {
      text = people.length === 1 ? '1 pessoa está aqui agora.' : people.length + ' pessoas estão aqui agora.';
      if (st && st.dmId) joinLabel = 'Entrar na chamada';
    }
    if (elsewhere) { joinLabel = st && st.dmId ? 'Mudar para esta chamada' : 'Mudar para este canal'; }
    if (status === 'connecting' && target && sameTarget(target, st)) { text = 'Conectando…'; joinLabel = 'Conectando…'; }
    if (reason) text = reason;
    if (!st && !reason) text = 'Escolha um canal de voz na barra lateral para entrar.';
    setText(ui.idleTitle, title);
    setText(ui.idleText, text);
    show(ui.idleJoin, !reason && !!st);
    ui.idleJoin.disabled = status === 'connecting' && !!target && sameTarget(target, st);
    setText(ui.idleJoin.querySelector('.vc-btn-text'), joinLabel);
    setText(ui.stageError, errorText);
    show(ui.stageError, !!errorText);

    var sig = people.map(function (s) { return [s.userId, s.muted, s.deafened, s.streaming, s.video, displayNameOf(s.userId), hueFor(s.userId)].join(':'); }).join('|');
    if (sig !== ui.idlePeopleSig) {
      ui.idlePeopleSig = sig;
      ui.idlePeople.textContent = '';
      people.forEach(function (s) {
        var li = el('li', 'vc-idle-person');
        var nm = displayNameOf(s.userId);
        li.appendChild(avatar(nm, s.userId, false));
        li.appendChild(el('span', 'vc-idle-person-name', nm));
        var icons = el('span', 'vc-ch-icons');
        if (s.streaming) icons.appendChild(liveBadge());
        if (s.video) icons.appendChild(badge('camera', 'câmera ligada', 'vc-badge-on'));
        if (s.deafened) icons.appendChild(badge('headphonesOff', 'ensurdecido', 'vc-badge-off'));
        else if (s.muted) icons.appendChild(badge('micOff', 'mutado', 'vc-badge-off'));
        li.appendChild(icons);
        ui.idlePeople.appendChild(li);
      });
    }
    show(ui.idlePeople, people.length > 0);
  }

  function renderStage(list) {
    var st = stageTarget();
    var connected = inRoom() && !!target && (!st || sameTarget(st, target));
    var reason = unavailableReason(lastView);
    show(ui.idle, !connected);
    show(ui.room, connected);
    ui.stageRoot.setAttribute('aria-label', connected ? (whereLabel() || 'Voz') : 'Voz');
    if (!connected) {
      renderIdle(st, reason);
      Object.keys(tiles).forEach(function (k) { removeTile(k); });
      return;
    }
    setText(ui.roomError, errorText);
    show(ui.roomError, !!errorText);

    // cartões: transmissões primeiro, depois pessoas
    var order = [];
    list.forEach(function (p) { if (isSharing(p)) order.push({ key: 's:' + p.identity, p: p, kind: 'stream' }); });
    list.forEach(function (p) { order.push({ key: 'p:' + p.identity, p: p, kind: 'person' }); });
    var keep = {};
    order.forEach(function (o) {
      keep[o.key] = true;
      var t = tiles[o.key];
      if (!t) t = tiles[o.key] = (o.kind === 'stream' ? createStreamTile(o.p.identity) : createPersonTile(o.p.identity));
      if (o.kind === 'stream') updateStreamTile(t, o.p); else updatePersonTile(t, o.p);
    });
    Object.keys(tiles).forEach(function (k) { if (!keep[k]) removeTile(k); });
    if (focusKey && !tiles[focusKey]) focusKey = null;

    var focusMode = !!focusKey;
    ui.room.classList.toggle('vc-mode-focus', focusMode);
    show(ui.grid, !focusMode);
    show(ui.focus, focusMode);
    show(ui.strip, focusMode && order.length > 1);
    var n = order.length;
    ui.grid.className = 'vc-grid ' + (n <= 1 ? 'vc-n1' : n === 2 ? 'vc-n2' : n <= 4 ? 'vc-n4' : n <= 6 ? 'vc-n6' : 'vc-nmany');
    var idx = { grid: 0, focus: 0, strip: 0 };
    order.forEach(function (o) {
      var t = tiles[o.key];
      var where = !focusMode ? 'grid' : (o.key === focusKey ? 'focus' : 'strip');
      var tgt = ui[where];
      var thumb = focusMode && o.key !== focusKey;
      t.root.classList.toggle('is-thumb', thumb);
      var role = thumb ? 'listitem' : 'group';
      if (t.root.getAttribute('role') !== role) t.root.setAttribute('role', role);
      var at = tgt.children[idx[where]] || null;
      idx[where]++;
      if (at !== t.root) {
        // só move quando a posição muda (mover o vídeo a cada fala seria desperdício)
        var hadFocus = t.root.contains(document.activeElement) ? document.activeElement : null;
        tgt.insertBefore(t.root, at);
        if (hadFocus && document.activeElement !== hadFocus) hadFocus.focus();
      }
    });

    var lp = room.localParticipant;
    var sharing = !!(lp && lp.isScreenShareEnabled);
    syncMicButton(ui.barMic);
    syncDeafButton(ui.barDeaf);
    syncCamButton(ui.barCam);
    syncShareButton(ui.barShare, sharing);
    show(ui.barAudio, room.canPlaybackAudio === false);
  }

  function removeTile(key) {
    var t = tiles[key];
    if (!t) return;
    if (menu && menu.root.parentNode === t.root) closeMenu(false);
    leaveBig(t);
    if (t.root.parentNode) t.root.parentNode.removeChild(t.root);
    delete tiles[key];
  }

  function currentState() {
    var connected = inRoom();
    var lp = room && room.localParticipant;
    var muted = deafened || prefMuted;
    var list = connected ? participantsList() : [];
    return {
      // formato da Etapa 6
      status: connected ? 'connected' : (status === 'connecting' || status === 'reconnecting' ? 'connecting' : 'idle'),
      channelId: target && target.channelId ? target.channelId : null,
      dmId: target && target.dmId ? target.dmId : null,
      video: videoOn(),
      streaming: !!(connected && lp && lp.isScreenShareEnabled),
      speaking: list.filter(isSpeaking).map(function (p) { return p.identity; }),
      ptt: vp().mode === 'ptt',
      pttActive: !!pttHeld,
      // formato antigo (app.js da Etapa 5)
      connected: connected,
      connecting: status === 'connecting' || status === 'reconnecting',
      muted: !!muted,
      deafened: deafened,
      sharing: !!(connected && lp && lp.isScreenShareEnabled),
      participants: list.map(function (p) {
        var mine = isLocal(p);
        return {
          userId: p.identity,
          name: nameFor(p),
          speaking: isSpeaking(p),
          muted: mine ? !!muted : !micOn(p),
          deafened: mine ? deafened : false,
          sharing: isSharing(p),
          video: mine ? videoOn() : !!cameraMedia[p.identity]
        };
      })
    };
  }

  function render() {
    if (!ui) return;
    var list = inRoom() ? participantsList() : [];
    renderStage(list);
    renderChannel(list);
    renderConnection();
    syncMicButton(ui.ucMic);
    syncDeafButton(ui.ucDeaf);
    syncCamButton(ui.connCam);
    var lp = room && room.localParticipant;
    syncShareButton(ui.connShare, !!(inRoom() && lp && lp.isScreenShareEnabled));
    ui.ucMic.disabled = micBusy;
    ui.uc.classList.toggle('is-ptt-open', vp().mode === 'ptt' && pttHeld && inRoom());
    publishVoiceState();
    if (typeof onState === 'function') {
      var st = currentState();
      var sig = JSON.stringify(st);
      if (sig !== lastStateSig) {
        lastStateSig = sig;
        try { onState(st); } catch (e) { /* ignora erro de quem escuta */ }
      }
    }
  }

  /* ---------- compartilhar tela: seletor ---------- */

  var dlg = null;
  var dlgSources = [];
  var dlgTab = 'screen';
  var dlgSelected = null;
  var dlgOpener = null;
  var dlgBrowserPicker = false;

  function radioGroup(legendText, name, options, current, onPick) {
    var fs = el('fieldset', 'vc-seg');
    fs.appendChild(el('legend', 'vc-seg-legend', legendText));
    var row = el('div', 'vc-seg-row');
    options.forEach(function (o) {
      var label = el('label', 'vc-seg-opt');
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = name;
      input.value = o.value;
      input.className = 'vc-seg-input';
      input.checked = String(current) === String(o.value);
      input.addEventListener('change', function () { if (input.checked) onPick(o.value); });
      label.appendChild(input);
      var face = el('span', 'vc-seg-face');
      face.appendChild(el('span', 'vc-seg-main', o.label));
      if (o.hint) face.appendChild(el('span', 'vc-seg-hint', o.hint));
      label.appendChild(face);
      row.appendChild(label);
    });
    fs.appendChild(row);
    return fs;
  }

  function bitrateFor(choice) {
    var q = QUALITY[choice.res] || QUALITY['1080'];
    return Math.round(q.bitrate * (Number(choice.fps) === 60 ? 1.5 : 1));
  }

  function buildDialog() {
    var d = el('dialog', 'vc-dialog');
    var title = el('h2', 'vc-dialog-title', 'Compartilhar tela');
    title.id = 'vc-share-title';
    d.setAttribute('aria-labelledby', title.id);
    var head = el('div', 'vc-dialog-head');
    head.appendChild(title);
    var closeBtn = button('vc-icon-btn', 'Fechar', 'close', { iconOnly: true });
    head.appendChild(closeBtn);
    d.appendChild(head);

    var tablist = el('div', 'vc-tabs');
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', 'Tipo de fonte');
    var tabScreen = el('button', 'vc-tab', 'Telas');
    var tabWindow = el('button', 'vc-tab', 'Janelas');
    var panel = el('div', 'vc-tabpanel');
    panel.id = 'vc-share-panel';
    panel.setAttribute('role', 'tabpanel');
    [tabScreen, tabWindow].forEach(function (t, i) {
      t.type = 'button';
      t.id = 'vc-tab-' + (i === 0 ? 'screen' : 'window');
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-controls', panel.id);
      tablist.appendChild(t);
    });
    d.appendChild(tablist);
    var loading = el('p', 'vc-dialog-status');
    loading.setAttribute('aria-live', 'polite');
    panel.appendChild(loading);
    var grid = el('ul', 'vc-source-grid');
    grid.setAttribute('aria-label', 'Fontes');
    panel.appendChild(grid);
    d.appendChild(panel);

    var quality = el('div', 'vc-quality');
    var resGroup = radioGroup('Resolução', 'vc-res', [
      { value: '720', label: '720p' }, { value: '1080', label: '1080p' }, { value: 'source', label: 'Fonte', hint: 'até 1440p' }
    ], shareChoice.res, function (v) { shareChoice.res = v; syncDialog(); });
    var fpsGroup = radioGroup('Taxa de quadros', 'vc-fps', [
      { value: 30, label: '30 qps' }, { value: 60, label: '60 qps' }
    ], shareChoice.fps, function (v) { shareChoice.fps = Number(v); syncDialog(); });
    quality.appendChild(resGroup);
    quality.appendChild(fpsGroup);
    d.appendChild(quality);
    var hint = el('p', 'vc-dialog-hint');
    d.appendChild(hint);

    var err = el('p', 'vc-error');
    err.setAttribute('role', 'alert');
    err.hidden = true;
    d.appendChild(err);

    var foot = el('div', 'vc-dialog-foot');
    var cancel = button('btn', 'Cancelar');
    var go = button('btn btn-primary', 'Transmitir', 'screenUp');
    foot.appendChild(cancel);
    foot.appendChild(go);
    d.appendChild(foot);
    document.body.appendChild(d);

    closeBtn.addEventListener('click', closeShareDialog);
    cancel.addEventListener('click', closeShareDialog);
    go.addEventListener('click', goLive);
    d.addEventListener('close', function () {
      if (dlgOpener && document.body.contains(dlgOpener) && !dlgOpener.disabled) dlgOpener.focus();
      dlgOpener = null;
    });
    tabScreen.addEventListener('click', function () { setTab('screen'); });
    tabWindow.addEventListener('click', function () { setTab('window'); });
    tablist.addEventListener('keydown', function (e) {
      var keys = { ArrowLeft: 1, ArrowRight: 1, Home: 1, End: 1 };
      if (!keys[e.key]) return;
      e.preventDefault();
      var next = (e.key === 'Home') ? 'screen' : (e.key === 'End') ? 'window' : (dlgTab === 'screen' ? 'window' : 'screen');
      setTab(next);
      (next === 'screen' ? tabScreen : tabWindow).focus();
    });

    dlg = { root: d, tabScreen: tabScreen, tabWindow: tabWindow, panel: panel, loading: loading, grid: grid, hint: hint, err: err, go: go, cancel: cancel, busy: false };
  }

  function setTab(t) {
    dlgTab = t;
    dlgSelected = null;
    syncDialog();
    renderSources();
  }

  function syncDialog() {
    if (!dlg) return;
    var onScreen = dlgTab === 'screen';
    dlg.tabScreen.setAttribute('aria-selected', onScreen ? 'true' : 'false');
    dlg.tabWindow.setAttribute('aria-selected', onScreen ? 'false' : 'true');
    dlg.tabScreen.tabIndex = onScreen ? 0 : -1;
    dlg.tabWindow.tabIndex = onScreen ? -1 : 0;
    dlg.panel.setAttribute('aria-labelledby', onScreen ? dlg.tabScreen.id : dlg.tabWindow.id);
    var q = QUALITY[shareChoice.res] || QUALITY['1080'];
    var mbps = bitrateFor(shareChoice) / 1000000;
    dlg.hint.textContent = q.label + ' a ' + shareChoice.fps + ' quadros por segundo · até ' + String(mbps).replace('.', ',') + ' Mbps' +
      (shareChoice.res === 'source' ? ' · resolução nativa da tela, limitada a 2560×1440' : '') + '. O som do jogo vai junto quando possível.';
    dlg.go.disabled = !dlgSelected || dlg.busy;
    Array.prototype.forEach.call(dlg.root.querySelectorAll('.vc-seg-input'), function (i) { i.disabled = dlg.busy; });
  }

  function renderSources() {
    if (!dlg) return;
    dlg.grid.textContent = '';
    var list = dlgSources.filter(function (s) { return (s.kind === 'window' ? 'window' : 'screen') === dlgTab; });
    if (dlgSources.length) {
      dlg.loading.textContent = list.length ? '' : (dlgTab === 'screen' ? 'Nenhuma tela encontrada.' : 'Nenhuma janela encontrada.');
    }
    list.forEach(function (s, i) {
      var li = el('li', 'vc-source-item');
      var btn = el('button', 'vc-source');
      btn.type = 'button';
      pressed(btn, dlgSelected === s.id);
      var thumb = el('span', 'vc-source-thumb');
      var src = typeof s.thumbnail === 'string' ? s.thumbnail : '';
      if (src.indexOf('data:image/') === 0) {
        var img = document.createElement('img');
        img.alt = '';
        setImageSrc(img, src);
        img.decoding = 'async';
        thumb.appendChild(img);
      } else {
        thumb.appendChild(icon(s.kind === 'window' ? 'window' : 'screen', 32));
      }
      btn.appendChild(thumb);
      var label = typeof s.name === 'string' && s.name ? s.name : (s.kind === 'window' ? 'Janela sem nome' : 'Tela ' + (i + 1));
      btn.appendChild(el('span', 'vc-source-name', label));
      btn.addEventListener('click', function () {
        dlgSelected = s.id;
        Array.prototype.forEach.call(dlg.grid.querySelectorAll('.vc-source'), function (b) { pressed(b, b === btn); });
        syncDialog();
      });
      btn.addEventListener('dblclick', function () { dlgSelected = s.id; syncDialog(); goLive(); });
      li.appendChild(btn);
      dlg.grid.appendChild(li);
    });
  }

  function openShareDialog(opener) {
    if (!inRoom()) return;
    if (room.localParticipant.isScreenShareEnabled) { stopShare(); return; }
    if (!dlg) buildDialog();
    dlgOpener = opener || null;
    errorText = '';
    dlgSources = [];
    dlgSelected = null;
    dlg.busy = false;
    dlg.grid.textContent = '';
    dlg.loading.textContent = 'Procurando telas e janelas…';
    dlg.err.textContent = '';
    show(dlg.err, false);
    syncDialog();
    if (typeof dlg.root.showModal === 'function') { if (!dlg.root.open) dlg.root.showModal(); } else dlg.root.setAttribute('open', '');
    (dlgTab === 'screen' ? dlg.tabScreen : dlg.tabWindow).focus();

    dlgBrowserPicker = false;
    dlg.root.classList.remove('is-browser-picker');
    call(function () { return bridge.listScreenSources(); }).then(function (res) {
      if (!dlg.root.open) return;
      if (res && res.ok && res.browserPicker) {
        // versão web: o próprio navegador mostra a lista de telas ao transmitir
        dlgBrowserPicker = true;
        dlg.root.classList.add('is-browser-picker');
        dlg.loading.textContent = 'Escolha a qualidade e clique em Transmitir: o navegador vai perguntar qual tela, janela ou aba compartilhar. Para levar o som, marque "compartilhar áudio".';
        dlgSelected = 'browser';
        syncDialog();
        dlg.go.focus();
        return;
      }
      if (!res || !res.ok || !Array.isArray(res.sources)) {
        dlg.loading.textContent = '';
        dlg.err.textContent = (res && res.error) || 'Não deu para listar as telas. Tente de novo.';
        show(dlg.err, true);
        return;
      }
      dlgSources = res.sources.filter(function (s) { return s && typeof s.id === 'string' && s.id.length <= 200; });
      if (!dlgSources.length) dlg.loading.textContent = 'Nenhuma tela ou janela encontrada.';
      renderSources();
    });
  }

  function closeShareDialog() {
    if (!dlg) return;
    if (dlg.root.open && typeof dlg.root.close === 'function') dlg.root.close();
    else dlg.root.removeAttribute('open');
  }

  function stopShare() {
    if (!room) return;
    errorText = '';
    var r = room;
    Promise.resolve().then(function () { return r.localParticipant.setScreenShareEnabled(false); })
      .then(function () { announce('Você parou de transmitir.'); scheduleRender(); },
        function () { setError('Não deu para parar a transmissão. Tente de novo.'); });
  }

  function dlgError(text) {
    dlg.err.textContent = text;
    show(dlg.err, true);
  }

  function goLive() {
    if (!dlg || dlg.busy || !dlgSelected) return;
    if (!room) { closeShareDialog(); return; }
    var sourceId = dlgSelected;
    var choice = { res: shareChoice.res, fps: Number(shareChoice.fps) === 60 ? 60 : 30 };
    var q = QUALITY[choice.res] || QUALITY['1080'];
    var bitrate = bitrateFor(choice);
    dlg.busy = true;
    dlg.go.setAttribute('aria-busy', 'true');
    syncDialog();
    var done = function () { dlg.busy = false; dlg.go.removeAttribute('aria-busy'); syncDialog(); };

    var browser = dlgBrowserPicker;
    var pick = function () { return browser ? Promise.resolve({ ok: true }) : call(function () { return bridge.pickScreenSource(sourceId); }); };
    pick().then(function (res) {
      if (!res || !res.ok) {
        done();
        dlgError((res && res.error) || 'Essa tela não está mais disponível. Escolha de novo.');
        return null;
      }
      var r = room;
      done();
      closeShareDialog();
      if (!r) return null;
      var resolution = { width: q.width, height: q.height, frameRate: choice.fps };
      var hint = choice.fps === 60 ? 'motion' : 'detail';
      var PUBLISH = {
        screenShareEncoding: { maxBitrate: bitrate, maxFramerate: choice.fps, priority: 'high' },
        degradationPreference: 'maintain-resolution'
      };
      // Áudio do jogo sem processamento de voz (o Electron falha no loopback com ele ligado).
      var withAudio = {
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        systemAudio: 'include',
        selfBrowserSurface: 'exclude',
        resolution: resolution,
        contentHint: hint
      };
      var noAudio = false;
      return Promise.resolve()
        .then(function () { return r.localParticipant.setScreenShareEnabled(true, withAudio, PUBLISH); })
        .catch(function (err) {
          var n = err && err.name;
          if (n !== 'NotReadableError' && n !== 'AbortError' && n !== 'NotSupportedError') throw err;
          // Tenta de novo só com a imagem (a escolha da tela é de uso único).
          noAudio = true;
          return pick().then(function (res2) {
            if (!res2 || !res2.ok) throw err;
            return r.localParticipant.setScreenShareEnabled(true, { audio: false, selfBrowserSurface: 'exclude', resolution: resolution, contentHint: hint }, PUBLISH);
          });
        })
        .then(function () {
          if (noAudio) setError('Transmitindo só a imagem: o som do jogo não pôde ser capturado neste computador.');
          announce('Você começou a transmitir a tela.');
          scheduleRender();
        }, function (err) {
          setError(mediaErrorMessage(err, 'screen') + techDetail(err));
        });
    });
  }

  /* ---------- configurações: aba "Voz e vídeo" ---------- */

  var settingsUi = null;
  var vsSeq = 0;

  function vsId(name) { return 'vs-' + name + '-' + vsSeq; }

  function vsSection(root, titleText) {
    var s = el('section', 'vs-section');
    var h = el('h3', 'vs-h3', titleText);
    h.id = vsId(titleText.replace(/[^a-z]/gi, '').toLowerCase());
    s.setAttribute('aria-labelledby', h.id);
    s.appendChild(h);
    root.appendChild(s);
    return s;
  }

  function vsSelect(labelText, id) {
    var wrap = el('div', 'vs-field');
    var label = el('label', 'vs-label', labelText);
    var sel = document.createElement('select');
    sel.className = 'vs-select';
    sel.id = vsId(id);
    label.htmlFor = sel.id;
    wrap.appendChild(label);
    wrap.appendChild(sel);
    var note = el('p', 'vs-note');
    note.hidden = true;
    wrap.appendChild(note);
    return { wrap: wrap, select: sel, note: note };
  }

  function vsRange(labelText, id, min, max, step, fmt) {
    var wrap = el('div', 'vs-field');
    var top = el('div', 'vs-range-top');
    var label = el('label', 'vs-label', labelText);
    var input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.className = 'vc-range vs-range';
    input.id = vsId(id);
    label.htmlFor = input.id;
    var out = el('output', 'vs-out');
    out.htmlFor = input.id;
    top.appendChild(label);
    top.appendChild(out);
    wrap.appendChild(top);
    wrap.appendChild(input);
    var set = function (v) { input.value = String(v); out.textContent = fmt(Number(v)); };
    return { wrap: wrap, input: input, out: out, set: set, fmt: fmt };
  }

  function vsSwitch(labelText, descText, id) {
    var row = el('div', 'vs-switch-row');
    var text = el('div', 'vs-switch-text');
    var label = el('label', 'vs-switch-label', labelText);
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'vs-switch';
    input.setAttribute('role', 'switch');
    input.id = vsId(id);
    label.htmlFor = input.id;
    text.appendChild(label);
    if (descText) {
      var d = el('p', 'vs-desc', descText);
      d.id = vsId(id + '-desc');
      input.setAttribute('aria-describedby', d.id);
      text.appendChild(d);
    }
    row.appendChild(text);
    row.appendChild(input);
    return { row: row, input: input };
  }

  function vsMeter(withThreshold) {
    var m = el('div', 'vs-meter' + (withThreshold ? ' has-threshold' : ''));
    m.setAttribute('aria-hidden', 'true');
    var fill = el('div', 'vs-meter-fill');
    m.appendChild(fill);
    var mark = null;
    if (withThreshold) { mark = el('div', 'vs-meter-mark'); m.appendChild(mark); }
    return {
      root: m,
      level: function (db) { m.style.setProperty('--vs-level', String(Math.max(0, Math.min(1, (db + 100) / 100)))); },
      threshold: function (db) { m.style.setProperty('--vs-threshold', String(Math.max(0, Math.min(1, (db + 100) / 100)))); },
      active: function (on) { m.classList.toggle('is-open', !!on); }
    };
  }

  function stopStream(s) { if (s) { try { s.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { /* ignora */ } } }

  function renderSettings(container) {
    destroySettings();
    if (!container || !container.appendChild) return;
    vsSeq++;
    var root = el('div', 'vs-root');
    var s = { root: root, container: container, test: null, camStream: null, dragging: false, listeners: [] };
    settingsUi = s;

    var title = el('h2', 'vs-h2', 'Voz e vídeo');
    root.appendChild(title);
    var live = el('p', 'visually-hidden');
    live.setAttribute('aria-live', 'polite');
    root.appendChild(live);
    s.say = function (t) { live.textContent = ''; window.setTimeout(function () { live.textContent = t; }, 40); };

    // --- Configurações de voz
    var secVoice = vsSection(root, 'Configurações de voz');
    var grid1 = el('div', 'vs-grid2');
    var inSel = vsSelect('Dispositivo de entrada', 'input');
    var outSel = vsSelect('Dispositivo de saída', 'output');
    grid1.appendChild(inSel.wrap);
    grid1.appendChild(outSel.wrap);
    secVoice.appendChild(grid1);
    var grid2 = el('div', 'vs-grid2');
    var pct = function (v) { return Math.round(v) + '%'; };
    var inVol = vsRange('Volume de entrada', 'invol', 0, 200, 5, pct);
    var outVol = vsRange('Volume de saída', 'outvol', 0, 200, 5, pct);
    grid2.appendChild(inVol.wrap);
    grid2.appendChild(outVol.wrap);
    secVoice.appendChild(grid2);
    var inVolNote = el('p', 'vs-note');
    inVolNote.hidden = true;
    inVol.wrap.appendChild(inVolNote);

    var testBox = el('div', 'vs-test');
    var testText = el('div', 'vs-test-text');
    testText.appendChild(el('p', 'vs-label', 'Teste de microfone'));
    testText.appendChild(el('p', 'vs-desc', 'Problemas com o microfone? Comece um teste e fale alguma coisa: vamos tocar sua voz de volta para você ouvir como está saindo.'));
    testBox.appendChild(testText);
    var testRow = el('div', 'vs-test-row');
    var testBtn = button('btn btn-primary vs-test-btn', 'Vamos verificar', 'mic', { size: 16 });
    pressed(testBtn, false);
    var testMeter = vsMeter(false);
    testRow.appendChild(testBtn);
    testRow.appendChild(testMeter.root);
    testBox.appendChild(testRow);
    var testErr = el('p', 'vc-error');
    testErr.setAttribute('role', 'alert');
    testErr.hidden = true;
    testBox.appendChild(testErr);
    secVoice.appendChild(testBox);

    // --- Modo de entrada
    var secMode = vsSection(root, 'Modo de entrada');
    var modeFs = el('fieldset', 'vs-radios');
    modeFs.appendChild(el('legend', 'visually-hidden', 'Modo de entrada'));
    var modeName = vsId('mode');
    var mkRadio = function (value, text, desc) {
      var lab = el('label', 'vs-radio');
      var r = document.createElement('input');
      r.type = 'radio';
      r.name = modeName;
      r.value = value;
      r.className = 'vs-radio-input';
      lab.appendChild(r);
      var face = el('span', 'vs-radio-face');
      face.appendChild(el('span', 'vs-radio-main', text));
      face.appendChild(el('span', 'vs-radio-desc', desc));
      lab.appendChild(face);
      modeFs.appendChild(lab);
      return r;
    };
    var rVad = mkRadio('vad', 'Detecção de voz', 'O microfone abre sozinho quando você fala.');
    var rPtt = mkRadio('ptt', 'Apertar para falar', 'Segure uma tecla para o pessoal ouvir você.');
    secMode.appendChild(modeFs);

    var pttBox = el('div', 'vs-ptt');
    var pttRow = el('div', 'vs-ptt-row');
    var pttLabel = el('span', 'vs-label', 'Atalho');
    pttLabel.id = vsId('pttlabel');
    var keyCap = el('kbd', 'vs-key');
    var keyBtn = button('btn vs-key-btn', 'Gravar atalho', 'keyboard', { size: 16 });
    keyBtn.setAttribute('aria-describedby', pttLabel.id);
    pttRow.appendChild(pttLabel);
    pttRow.appendChild(keyCap);
    pttRow.appendChild(keyBtn);
    pttBox.appendChild(pttRow);
    pttBox.appendChild(el('p', 'vs-desc vs-warn', 'O apertar-para-falar funciona enquanto a janela do Ghost Rank está em foco. Se você estiver em outro programa (como o jogo em tela cheia), a tecla não é vista.'));
    secMode.appendChild(pttBox);

    // --- Sensibilidade
    var secSens = vsSection(root, 'Sensibilidade de entrada');
    var autoSw = vsSwitch('Determinar automaticamente a sensibilidade de entrada', 'O Ghost Rank ajusta o limite conforme o ruído do seu ambiente.', 'auto');
    secSens.appendChild(autoSw.row);
    var sensWrap = el('div', 'vs-sens');
    var sensMeter = vsMeter(true);
    sensWrap.appendChild(sensMeter.root);
    var sensRange = document.createElement('input');
    sensRange.type = 'range';
    sensRange.min = '-100';
    sensRange.max = '0';
    sensRange.step = '1';
    sensRange.className = 'vs-sens-range';
    sensRange.id = vsId('sens');
    sensRange.setAttribute('aria-label', 'Limite de sensibilidade');
    sensWrap.appendChild(sensRange);
    var sensOut = el('p', 'vs-desc vs-sens-out');
    sensOut.setAttribute('aria-live', 'off');
    sensWrap.appendChild(sensOut);
    var sensHint = el('p', 'vs-desc');
    sensWrap.appendChild(sensHint);
    secSens.appendChild(sensWrap);

    // --- Vídeo
    var secVideo = vsSection(root, 'Configurações de vídeo');
    var camBox = el('div', 'vs-cam');
    var camPreview = el('div', 'vs-cam-preview');
    var camEmpty = el('div', 'vs-cam-empty');
    camEmpty.appendChild(icon('camera', 40));
    camEmpty.appendChild(el('p', 'vs-desc', 'A prévia da câmera aparece aqui.'));
    camPreview.appendChild(camEmpty);
    camBox.appendChild(camPreview);
    var camSide = el('div', 'vs-cam-side');
    var camSel = vsSelect('Câmera', 'camera');
    camSide.appendChild(camSel.wrap);
    var camBtn = button('btn btn-primary vs-cam-btn', 'Testar vídeo', 'camera', { size: 16 });
    pressed(camBtn, false);
    camSide.appendChild(camBtn);
    camSide.appendChild(el('p', 'vs-desc', 'Sua câmera é enviada em até 720p a 30 quadros por segundo.'));
    var camErr = el('p', 'vc-error');
    camErr.setAttribute('role', 'alert');
    camErr.hidden = true;
    camSide.appendChild(camErr);
    camBox.appendChild(camSide);
    secVideo.appendChild(camBox);

    // --- Processamento
    var secProc = vsSection(root, 'Processamento de voz');
    var nsSw = vsSwitch('Supressão de ruído', 'Corta ventilador, teclado e outros barulhos de fundo.', 'ns');
    var ecSw = vsSwitch('Cancelamento de eco', 'Evita que o pessoal ouça a si mesmo pelo seu microfone (útil sem fone).', 'ec');
    secProc.appendChild(nsSw.row);
    secProc.appendChild(ecSw.row);

    container.appendChild(root);

    /* ----- dispositivos ----- */
    var sinkOk = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
    function fillSelect(sel, devices, kind, current, nounBase) {
      var keepFocus = document.activeElement === sel;
      sel.textContent = '';
      var def = document.createElement('option');
      def.value = 'default';
      def.textContent = 'Padrão do sistema';
      sel.appendChild(def);
      var n = 0;
      var found = current === 'default';
      devices.filter(function (d) { return d.kind === kind && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications'; })
        .forEach(function (d) {
          n++;
          var o = document.createElement('option');
          o.value = d.deviceId;
          o.textContent = d.label || (nounBase + ' ' + n);
          if (d.deviceId === current) found = true;
          sel.appendChild(o);
        });
      if (!found) {
        var miss = document.createElement('option');
        miss.value = current;
        miss.textContent = 'Dispositivo desconectado';
        sel.appendChild(miss);
      }
      sel.value = current;
      if (keepFocus) sel.focus();
      return n;
    }
    s.refreshDevices = function () {
      var md = navigator.mediaDevices;
      if (!md || typeof md.enumerateDevices !== 'function') {
        [inSel, outSel, camSel].forEach(function (x) { x.select.disabled = true; x.note.textContent = 'Lista de dispositivos indisponível.'; x.note.hidden = false; });
        return;
      }
      md.enumerateDevices().then(function (list) {
        if (settingsUi !== s) return;
        var p = vp();
        var nIn = fillSelect(inSel.select, list, 'audioinput', p.inputDeviceId, 'Microfone');
        fillSelect(outSel.select, list, 'audiooutput', p.outputDeviceId, 'Saída');
        var nCam = fillSelect(camSel.select, list, 'videoinput', p.cameraDeviceId, 'Câmera');
        var noLabels = list.some(function (d) { return d.kind !== 'audiooutput' && !d.label; });
        inSel.note.textContent = nIn === 0 ? 'Nenhum microfone encontrado.' : (noLabels ? 'Os nomes aparecem depois que você permitir o microfone (use "Vamos verificar").' : '');
        inSel.note.hidden = !inSel.note.textContent;
        outSel.select.disabled = !sinkOk;
        outSel.note.textContent = sinkOk ? '' : 'Este navegador não deixa escolher a saída: o som sai no dispositivo padrão.';
        outSel.note.hidden = sinkOk;
        camSel.note.textContent = nCam === 0 ? 'Nenhuma câmera encontrada.' : '';
        camSel.note.hidden = nCam !== 0;
      }).catch(function () { /* ignora */ });
    };
    var onDeviceChange = function () { if (settingsUi === s) s.refreshDevices(); };
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
      s.listeners.push(function () { navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange); });
    }

    /* ----- sincronizar com as prefs ----- */
    s.sync = function () {
      var p = vp();
      if (document.activeElement !== inVol.input) inVol.set(p.inputVolume); else inVol.out.textContent = pct(Number(inVol.input.value));
      if (document.activeElement !== outVol.input) outVol.set(p.outputVolume); else outVol.out.textContent = pct(Number(outVol.input.value));
      var processorOk = !inRoom() || !mic || mic.mode === 'processor';
      inVolNote.textContent = processorOk ? '' : 'Nesta conexão o volume de entrada não pôde ser aplicado; use o volume do microfone no sistema.';
      inVolNote.hidden = processorOk;
      rVad.checked = p.mode === 'vad';
      rPtt.checked = p.mode === 'ptt';
      show(pttBox, p.mode === 'ptt');
      if (!capturingKey) setText(keyCap, keyLabel(p.pttKey));
      autoSw.input.checked = p.autoSensitivity;
      show(sensWrap, p.mode === 'vad');
      show(autoSw.row, p.mode === 'vad');
      sensRange.disabled = p.autoSensitivity;
      if (!s.dragging && document.activeElement !== sensRange) sensRange.value = String(p.sensitivity);
      var thr = p.autoSensitivity ? autoThreshold : Number(sensRange.value);
      sensMeter.threshold(thr);
      sensMeter.root.classList.toggle('is-auto', p.autoSensitivity);
      sensRange.setAttribute('aria-valuetext', Math.round(Number(sensRange.value)) + ' dB');
      sensOut.textContent = p.autoSensitivity ? 'Limite automático: ' + Math.round(autoThreshold) + ' dB' : 'Limite: ' + Math.round(Number(sensRange.value)) + ' dB';
      sensHint.textContent = (inRoom() && mic) || s.test ? 'A barra fica verde quando o microfone abre.' : 'Comece um teste de microfone ou entre num canal de voz para ver o nível.';
      nsSw.input.checked = p.noiseSuppression;
      ecSw.input.checked = p.echoCancellation;
      if (document.activeElement !== inSel.select && inSel.select.value !== p.inputDeviceId && inSel.select.querySelector('option')) s.refreshDevices();
    };

    s.onLevel = function (db) {
      var p = vp();
      var thr = p.autoSensitivity ? autoThreshold : Number(sensRange.value);
      sensMeter.level(db);
      sensMeter.threshold(thr);
      var open = p.mode === 'vad' ? (s.test ? db >= thr : gateOpen) : db > -60;
      sensMeter.active(open);
      if (s.test) testMeter.level(db);
      testMeter.active(open);
      if (p.autoSensitivity) sensOut.textContent = 'Limite automático: ' + Math.round(autoThreshold) + ' dB';
    };

    /* ----- eventos ----- */
    inSel.select.addEventListener('change', function () { savePrefs({ inputDeviceId: inSel.select.value }); if (s.test) restartTest(); });
    outSel.select.addEventListener('change', function () {
      savePrefs({ outputDeviceId: outSel.select.value });
      if (s.test && s.test.audio && typeof s.test.audio.setSinkId === 'function') s.test.audio.setSinkId(outSel.select.value === 'default' ? '' : outSel.select.value).catch(function () {});
    });
    camSel.select.addEventListener('change', function () { savePrefs({ cameraDeviceId: camSel.select.value }); if (s.camStream) startCam(); });
    inVol.input.addEventListener('input', function () {
      inVol.out.textContent = pct(Number(inVol.input.value));
      if (s.test && s.test.gain) s.test.gain.gain.value = Number(inVol.input.value) / 100;
    });
    inVol.input.addEventListener('change', function () { savePrefs({ inputVolume: Number(inVol.input.value) }); });
    outVol.input.addEventListener('input', function () { outVol.out.textContent = pct(Number(outVol.input.value)); });
    outVol.input.addEventListener('change', function () { savePrefs({ outputVolume: Number(outVol.input.value) }); });
    [rVad, rPtt].forEach(function (r) {
      r.addEventListener('change', function () {
        if (!r.checked) return;
        savePrefs({ mode: r.value });
        s.say(r.value === 'ptt' ? 'Apertar para falar ativado. Atalho: ' + keyLabel(vp().pttKey) + '.' : 'Detecção de voz ativada.');
      });
    });
    autoSw.input.addEventListener('change', function () { savePrefs({ autoSensitivity: autoSw.input.checked }); });
    sensRange.addEventListener('pointerdown', function () { s.dragging = true; });
    sensRange.addEventListener('input', function () {
      sensMeter.threshold(Number(sensRange.value));
      sensOut.textContent = 'Limite: ' + Math.round(Number(sensRange.value)) + ' dB';
      sensRange.setAttribute('aria-valuetext', Math.round(Number(sensRange.value)) + ' dB');
    });
    sensRange.addEventListener('change', function () { s.dragging = false; savePrefs({ sensitivity: Number(sensRange.value) }); });
    nsSw.input.addEventListener('change', function () { savePrefs({ noiseSuppression: nsSw.input.checked }); if (s.test) restartTest(); });
    ecSw.input.addEventListener('change', function () { savePrefs({ echoCancellation: ecSw.input.checked }); if (s.test) restartTest(); });

    // gravar atalho do apertar-para-falar
    var onCapture = function (e) {
      if (!capturingKey) return;
      e.preventDefault();
      e.stopPropagation();
      capturingKey = false;
      document.removeEventListener('keydown', onCapture, true);
      keyBtn.classList.remove('is-recording');
      pressed(keyBtn, false);
      setText(keyBtn.querySelector('.vc-btn-text'), 'Gravar atalho');
      if (e.code === 'Escape' || !e.code) { setText(keyCap, keyLabel(vp().pttKey)); s.say('Gravação cancelada.'); return; }
      savePrefs({ pttKey: e.code });
      setText(keyCap, keyLabel(e.code));
      s.say('Atalho de apertar para falar: ' + keyLabel(e.code) + '.');
      keyBtn.focus();
    };
    s.listeners.push(function () { document.removeEventListener('keydown', onCapture, true); capturingKey = false; });
    pressed(keyBtn, false);
    keyBtn.addEventListener('click', function () {
      if (capturingKey) return;
      capturingKey = true;
      keyBtn.classList.add('is-recording');
      pressed(keyBtn, true);
      setText(keyBtn.querySelector('.vc-btn-text'), 'Aperte uma tecla… (Esc cancela)');
      setText(keyCap, '…');
      s.say('Aperte a tecla que você quer usar. Esc cancela.');
      window.setTimeout(function () { document.addEventListener('keydown', onCapture, true); }, 0);
    });

    /* ----- teste de microfone (retorno) ----- */
    function stopTest(silent) {
      var t = s.test;
      if (!t) return;
      s.test = null;
      if (t.timer) window.clearInterval(t.timer);
      try { t.source.disconnect(); t.gain.disconnect(); } catch (e) { /* ignora */ }
      if (t.audio) { try { t.audio.pause(); t.audio.srcObject = null; } catch (e) { /* ignora */ } if (t.audio.parentNode) t.audio.parentNode.removeChild(t.audio); }
      stopStream(t.stream);
      stopStream(t.dest && t.dest.stream);
      pressed(testBtn, false);
      testBtn.classList.remove('is-active');
      setText(testBtn.querySelector('.vc-btn-text'), 'Vamos verificar');
      testMeter.level(-100);
      testMeter.active(false);
      if (!silent) s.say('Teste de microfone encerrado.');
      s.sync();
    }
    function startTest() {
      var md = navigator.mediaDevices;
      var ctx = ctxFor();
      show(testErr, false);
      if (!md || !md.getUserMedia || !ctx) { testErr.textContent = 'O teste de microfone não funciona aqui.'; show(testErr, true); return; }
      var seq = (s.testSeq = (s.testSeq || 0) + 1);
      setText(testBtn.querySelector('.vc-btn-text'), 'Abrindo microfone…');
      testBtn.disabled = true;
      md.getUserMedia({ audio: micConstraints(), video: false }).then(function (stream) {
        testBtn.disabled = false;
        if (settingsUi !== s || seq !== s.testSeq) { stopStream(stream); return; }
        var t = { stream: stream };
        t.source = ctx.createMediaStreamSource(stream);
        t.gain = ctx.createGain();
        t.gain.gain.value = Number(inVol.input.value) / 100;
        t.analyser = ctx.createAnalyser();
        t.analyser.fftSize = 1024;
        t.buf = new Float32Array(t.analyser.fftSize);
        t.dest = ctx.createMediaStreamDestination();
        t.source.connect(t.gain);
        t.gain.connect(t.analyser);
        t.gain.connect(t.dest);
        t.audio = document.createElement('audio');
        t.audio.hidden = true;
        t.audio.autoplay = true;
        t.audio.srcObject = t.dest.stream;
        var outId = vp().outputDeviceId;
        if (outId !== 'default' && typeof t.audio.setSinkId === 'function') t.audio.setSinkId(outId).catch(function () {});
        t.audio.volume = Math.min(1, vp().outputVolume / 100);
        root.appendChild(t.audio);
        if (t.audio.play) t.audio.play().catch(function () {});
        t.timer = window.setInterval(function () {
          var db = readDb(t.analyser, t.buf);
          if (!mic) {
            // fora de chamada: o medidor do teste também alimenta o limite automático
            if (db < (s.floor == null ? -60 : s.floor)) s.floor = db; else s.floor = Math.min(-20, (s.floor == null ? -60 : s.floor) + 0.04);
            autoThreshold = Math.max(-70, Math.min(-25, s.floor + 14));
          }
          s.onLevel(db);
        }, 50);
        s.test = t;
        pressed(testBtn, true);
        testBtn.classList.add('is-active');
        setText(testBtn.querySelector('.vc-btn-text'), 'Parar teste');
        s.say('Teste de microfone começou. Fale algo para ouvir o retorno.');
        s.refreshDevices();
        s.sync();
      }, function (err) {
        testBtn.disabled = false;
        setText(testBtn.querySelector('.vc-btn-text'), 'Vamos verificar');
        testErr.textContent = mediaErrorMessage(err, 'mic');
        show(testErr, true);
      });
    }
    function restartTest() { stopTest(true); startTest(); }
    testBtn.addEventListener('click', function () { if (s.test) stopTest(); else startTest(); });
    s.stopTest = stopTest;

    /* ----- prévia da câmera ----- */
    function stopCam() {
      stopStream(s.camStream);
      s.camStream = null;
      camPreview.textContent = '';
      camPreview.appendChild(camEmpty);
      pressed(camBtn, false);
      camBtn.classList.remove('is-active');
      setText(camBtn.querySelector('.vc-btn-text'), 'Testar vídeo');
    }
    function startCam() {
      var md = navigator.mediaDevices;
      show(camErr, false);
      if (!md || !md.getUserMedia) { camErr.textContent = 'A prévia da câmera não funciona aqui.'; show(camErr, true); return; }
      stopStream(s.camStream);
      s.camStream = null;
      var c = cameraConstraints();
      var v = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
      if (c.deviceId) v.deviceId = { exact: c.deviceId };
      var seq = (s.camSeq = (s.camSeq || 0) + 1);
      md.getUserMedia({ video: v, audio: false }).then(function (stream) {
        if (settingsUi !== s || seq !== s.camSeq) { stopStream(stream); return; }
        s.camStream = stream;
        var video = document.createElement('video');
        video.className = 'vc-media vc-camera is-mirrored';
        video.muted = true;
        video.autoplay = true;
        video.playsInline = true;
        video.srcObject = stream;
        camPreview.textContent = '';
        camPreview.appendChild(video);
        if (video.play) video.play().catch(function () {});
        pressed(camBtn, true);
        camBtn.classList.add('is-active');
        setText(camBtn.querySelector('.vc-btn-text'), 'Parar vídeo');
        s.refreshDevices();
      }, function (err) {
        camErr.textContent = mediaErrorMessage(err, 'camera');
        show(camErr, true);
      });
    }
    camBtn.addEventListener('click', function () { if (s.camStream) stopCam(); else startCam(); });
    s.stopCam = stopCam;

    // já mostra "Padrão do sistema" enquanto a lista de dispositivos não chega
    fillSelect(inSel.select, [], 'audioinput', vp().inputDeviceId, 'Microfone');
    fillSelect(outSel.select, [], 'audiooutput', vp().outputDeviceId, 'Saída');
    fillSelect(camSel.select, [], 'videoinput', vp().cameraDeviceId, 'Câmera');
    s.refreshDevices();
    s.sync();
    return root;
  }

  function destroySettings() {
    var s = settingsUi;
    if (!s) return;
    settingsUi = null;
    try { if (s.stopTest) s.stopTest(true); } catch (e) { /* ignora */ }
    try { if (s.stopCam) s.stopCam(); } catch (e) { /* ignora */ }
    stopStream(s.camStream);
    s.listeners.forEach(function (off) { try { off(); } catch (e) { /* ignora */ } });
    if (s.root && s.root.parentNode) s.root.parentNode.removeChild(s.root);
  }

  /* ---------- teclas globais ---------- */

  document.addEventListener('fullscreenchange', scheduleRender);
  document.addEventListener('enterpictureinpicture', scheduleRender, true);
  document.addEventListener('leavepictureinpicture', scheduleRender, true);
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !expanded) return;
    expanded.root.classList.remove('is-expanded');
    expanded = null;
    scheduleRender();
  });

  /* ---------- API ---------- */

  function init(opts) {
    opts = opts || {};
    bridge = opts.bridge || null;
    onState = typeof opts.onState === 'function' ? opts.onState : null;
    onOpenSettings = typeof opts.onOpenSettings === 'function' ? opts.onOpenSettings : null;
    getViewFn = typeof opts.getView === 'function' ? opts.getView : null;
    LK = window.LivekitClient || null;
    els = opts.els || {};
    if (!lastView && getViewFn) { try { lastView = getViewFn() || null; } catch (e) { lastView = null; } }
    if (ui) return;
    buildUi();
    window.addEventListener('beforeunload', function () {
      if (room) { leavingOnPurpose = true; try { room.disconnect(); } catch (e) { /* ignora */ } }
    });
    render();
  }

  // A sala some quando deixa de existir para você: saiu da conta, saiu/foi expulso do servidor,
  // o canal foi apagado. Navegar para outro servidor NÃO tira da voz (como no Discord).
  function targetGone(view) {
    if (!target) return false;
    if (target.legacy) {
      var gid = view && view.group ? view.group.id : null;
      return gid !== roomGroupId;
    }
    if (target.channelId && targetInfo && targetInfo.serverId) {
      if (view && Array.isArray(view.servers)) {
        var still = view.servers.some(function (sv) { return sv && sv.id === targetInfo.serverId; });
        if (!still) return true;
      }
      if (view && view.server && view.server.id === targetInfo.serverId && Array.isArray(view.server.channels)) {
        if (!findChannel(view, target.channelId)) return true;
      }
    }
    return false;
  }

  function update(view) {
    lastView = view || null;
    var reason = unavailableReason(view);
    if ((room || status === 'connecting') && (reason || targetGone(view))) leave();
    // completa nome do canal/servidor guardados ao entrar
    if (target && targetInfo && target.channelId && view && view.server) {
      var ch = findChannel(view, target.channelId);
      if (ch) { targetInfo.channelName = String(ch.name || targetInfo.channelName); targetInfo.serverId = view.server.id; targetInfo.serverName = String(view.server.name || ''); }
    }
    // a mensagem "entre na conta" etc. some quando deixa de valer
    if (errorText && errorText === lastReason && reason !== lastReason) errorText = '';
    lastReason = reason;
    applyVoicePrefs();
    if (settingsUi) settingsUi.sync();
    scheduleRender();
  }

  window.GhostVoice = {
    init: init,
    update: update,
    join: join,
    leave: function () { return leave(); },
    toggleMute: toggleMute,
    toggleDeafen: toggleDeafen,
    toggleVideo: toggleVideo,
    getState: currentState,
    renderSettings: renderSettings,
    destroySettings: destroySettings,
    playSound: playSound
  };
})();
