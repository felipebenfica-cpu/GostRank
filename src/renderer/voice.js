/* Ghost Rank - sala de voz do grupo (LiveKit), no modelo de uso do Discord.
   Script clássico em um único IIFE. Carregado depois de vendor/livekit-client.umd.js
   (que define window.LivekitClient, se instalado) e antes de app.js.

   API:
     GhostVoice.init({ bridge, els: { stage, channelMembers, connection, userControls }, onState })
     GhostVoice.update(view)   GhostVoice.join()   GhostVoice.leave()
     GhostVoice.toggleMute()   GhostVoice.toggleDeafen()
     state = { connected, connecting, muted, deafened, sharing,
               participants: [{ userId, name, speaking, muted, deafened, sharing }] }

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
    speaker: [['path', { d: 'M11 5 6 9H3v6h3l5 4V5z' }], ['path', { d: 'M15.5 8.5a5 5 0 0 1 0 7' }]]
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

  var paintPhoto = null;

  function avatar(name, id, small) {
    var a = el('span', 'vc-avatar vc-hue-' + hueOf(id) + (small ? ' vc-avatar-sm' : ''));
    a.setAttribute('aria-hidden', 'true');
    a.appendChild(el('span', 'vc-avatar-text', initials(name)));
    var members = lastView && lastView.group && lastView.group.members;
    var member = Array.isArray(members) && members.find(function (m) { return m.userId === id; });
    if (member && paintPhoto) paintPhoto(a, member.photo);
    return a;
  }

  function mediaErrorMessage(err, what) {
    var name = err && err.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return what === 'screen'
        ? 'O compartilhamento de tela foi cancelado ou bloqueado.'
        : 'O Ghost Rank não recebeu permissão para usar o microfone. Libere o microfone nas configurações de privacidade do sistema.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return what === 'screen' ? 'Não encontramos essa tela ou janela. Escolha de novo.' : 'Nenhum microfone foi encontrado neste computador.';
    }
    if (name === 'NotReadableError') {
      return 'Outro programa está usando o ' + (what === 'screen' ? 'compartilhamento de tela' : 'microfone') + '. Feche-o e tente de novo.';
    }
    return what === 'screen' ? 'Não deu para compartilhar a tela. Tente de novo.' : 'Não deu para ligar o microfone. Tente de novo.';
  }

  /* ---------- estado ---------- */

  var bridge = null;
  var LK = null;
  var els = null;
  var onState = null;
  var lastView = null;

  var room = null;
  var roomGroupId = null;
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

  function unavailableReason(view) {
    var a = view && view.auth;
    if (!a || a.status !== 'signed_in') return 'Entre na sua conta para usar a voz.';
    if (!view.group) return 'Entre em um grupo para usar a voz.';
    if (!LK || typeof LK.Room !== 'function') return 'Voz indisponível neste computador: rode npm install.';
    if (!view.voice || view.voice.available !== true) return 'Voz indisponível neste computador: rode npm install.';
    return null;
  }

  function nameFor(participant) {
    if (!participant) return 'Fantasma';
    var members = (lastView && lastView.group && Array.isArray(lastView.group.members)) ? lastView.group.members : [];
    for (var i = 0; i < members.length; i++) {
      if (members[i] && members[i].userId === participant.identity && members[i].displayName) return String(members[i].displayName);
    }
    return (typeof participant.name === 'string' && participant.name) ? participant.name : 'Fantasma';
  }

  function groupName() {
    return (lastView && lastView.group && lastView.group.name) ? String(lastView.group.name) : 'Grupo';
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
    safeSetVolume(p, (deafened || pr.mutedForMe) ? 0 : pr.volume, SRC().mic);
    var sv = streamVolume[p.identity];
    safeSetVolume(p, deafened ? 0 : (sv == null ? 1 : sv), SRC().screenAudio);
  }

  function applyAllVolumes() { participantsList().forEach(applyVolumes); }

  /* ---------- sons curtos (Web Audio, sem arquivos) ---------- */

  var audioCtx = null;
  function tones(seq, gainLevel) {
    if (deafened) return;
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
    otherLeave: function () { tones([[880, 0, 0.08], [659.25, 0.08, 0.1]], 0.045); }
  };

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

  function onTrackSubscribed(track, pub, participant) {
    var src = (pub && pub.source) || (track && track.source);
    var kind = track && track.kind;
    if (src === SRC().screen && kind === 'video') {
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
    else if (src === SRC().screen && participant) {
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
    if (track && track.kind === 'video' && pub.source === SRC().screen) {
      if (localPreview) { try { localPreview.track.detach(localPreview.el); } catch (e) { /* ignora */ } }
      localPreview = { el: prepareMedia(track.attach(), true), track: track };
    }
    scheduleRender();
  }

  function onLocalUnpublished(pub) {
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
      leavingOnPurpose = false;
      status = 'off';
      cleanupMedia();
      stopPing();
      if (!purposeful) errorText = 'A conexão com a sala de voz caiu. Tente entrar de novo.';
      SOUND.leave();
      announce('Você saiu da sala de voz.');
      scheduleRender();
    }));
  }

  /* ---------- entrar, sair, mutar, ensurdecer ---------- */

  function join() {
    var reason = unavailableReason(lastView);
    if (reason) { setError(reason); return; }
    if (room || status === 'connecting') return;
    errorText = '';
    status = 'connecting';
    scheduleRender();
    var groupId = lastView.group.id;

    call(function () { return bridge.voiceToken(); }).then(function (res) {
      if (status !== 'connecting' || room) return null;
      if (!res || !res.ok || typeof res.url !== 'string' || typeof res.token !== 'string') {
        status = 'off';
        setError((res && res.error) || 'Não deu para entrar na sala de voz. Tente de novo.');
        return null;
      }
      var r;
      try {
        // webAudioMix: permite volume por pessoa acima de 100%.
        r = new LK.Room({ adaptiveStream: false, dynacast: true, webAudioMix: true });
      } catch (e) {
        status = 'off';
        setError('A biblioteca de voz não abriu. Rode npm install e abra o Ghost Rank de novo.');
        return null;
      }
      room = r;
      roomGroupId = groupId;
      leavingOnPurpose = false;
      wire(r);
      return r.connect(res.url, res.token).then(function () {
        if (r !== room) return null;
        status = 'connected';
        // quem já estava transmitindo: só assina ao clicar em "Assistir"
        participantsList().forEach(function (p) {
          if (isLocal(p)) return;
          unsubscribeIfNotWatching(publication(p, SRC().screen), p);
          unsubscribeIfNotWatching(publication(p, SRC().screenAudio), p);
          applyVolumes(p);
        });
        SOUND.join();
        announce('Você entrou na sala de voz.');
        startPing();
        scheduleRender();
        if (!prefMuted) return applyMic();
        return null;
      });
    }).catch(function (err) {
      var r = room;
      room = null;
      roomGroupId = null;
      status = 'off';
      if (r) { leavingOnPurpose = true; try { r.disconnect(); } catch (e) { /* ignora */ } }
      cleanupMedia();
      stopPing();
      setError('Não deu para conectar à sala de voz. Verifique a internet e tente de novo.' + techDetail(err));
    });
  }

  function leave() {
    var r = room;
    closeShareDialog();
    if (!r) {
      if (status === 'connecting') status = 'off';
      scheduleRender();
      return Promise.resolve();
    }
    leavingOnPurpose = true;
    room = null;
    roomGroupId = null;
    status = 'off';
    cleanupMedia();
    stopPing();
    SOUND.leave();
    announce('Você saiu da sala de voz.');
    scheduleRender();
    return Promise.resolve().then(function () { return r.disconnect(); }).catch(function () { /* ignora */ });
  }

  // Liga/desliga o microfone conforme prefMuted (só conectado).
  function applyMic() {
    if (!inRoom()) { scheduleRender(); return Promise.resolve(); }
    var lp = room.localParticipant;
    var want = !prefMuted;
    if (!!lp.isMicrophoneEnabled === want) { scheduleRender(); return Promise.resolve(); }
    micBusy = true;
    scheduleRender();
    var r = room;
    return Promise.resolve().then(function () { return lp.setMicrophoneEnabled(want); }).then(function () {
      micBusy = false;
      if (r === room && !!lp.isMicrophoneEnabled !== !prefMuted) return applyMic();
      scheduleRender();
      return null;
    }, function (err) {
      micBusy = false;
      if (want) prefMuted = true;
      setError(mediaErrorMessage(err, 'mic'));
    });
  }

  function toggleMute() {
    errorText = '';
    if (deafened) {
      // como no Discord: ligar o microfone também tira o ensurdecer
      deafened = false;
      prefMuted = false;
      applyAllVolumes();
    } else {
      prefMuted = !prefMuted;
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
    } else {
      deafened = false;
      prefMuted = mutedBeforeDeafen;
    }
    applyAllVolumes();
    announce(deafened ? 'Ensurdecido: você não ouve ninguém e seu microfone está desligado.' : 'Áudio ligado.');
    return applyMic();
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
      if (tile.kind !== 'stream' || e.target.closest('button, input, label')) return;
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
    tile.root.classList.toggle('is-speaking', talking);
    tile.root.classList.toggle('is-focused', focusKey === tile.key);
    var states = [];
    if (deaf) states.push('ensurdecido'); else if (muted) states.push('mutado');
    if (sharing) states.push('transmitindo');
    if (pr && pr.mutedForMe) states.push('mutado para você');
    tile.root.setAttribute('aria-label', name + (mine ? ' (você)' : '') + (states.length ? ', ' + states.join(', ') : ''));

    var sig = [name, mine, muted, deaf, sharing, pr ? pr.mutedForMe : '', pr ? pr.volume : ''].join('|');
    if (sig === tile.sig) return;
    tile.sig = sig;
    tile.body.textContent = '';
    tile.body.appendChild(avatar(name, p.identity, false));
    setText(tile.name, mine ? name + ' (você)' : name);
    tile.badges.textContent = '';
    if (sharing) tile.badges.appendChild(liveBadge());
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
    idle.appendChild(el('h2', 'vc-idle-title', 'Sala de voz'));
    var idleText = el('p', 'vc-idle-text', 'Converse por voz e transmita sua tela para o grupo.');
    idle.appendChild(idleText);
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
    var barShare = button('vc-ctl vc-ctl-lg vc-ctl-share', 'Compartilhar tela', 'screenUp', { iconOnly: true });
    var barAudio = button('btn btn-small vc-audio-btn', 'Ativar som', 'volume');
    var barLeave = button('vc-ctl vc-ctl-lg vc-ctl-leave', 'Desconectar', 'phoneDown', { iconOnly: true });
    [barMic, barDeaf].forEach(function (b) { pressed(b, false); });
    pressed(barShare, false);
    bar.appendChild(barMic);
    bar.appendChild(barDeaf);
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
    var connShare = button('vc-conn-btn', 'Compartilhar tela', 'screenUp', { size: 16 });
    pressed(connShare, false);
    connActions.appendChild(connShare);
    conn.appendChild(connActions);

    // Controles do usuário
    var uc = el('div', 'vc-user-controls');
    var ucMic = button('vc-ctl', 'Mutar', 'mic', { iconOnly: true });
    var ucDeaf = button('vc-ctl', 'Ensurdecer', 'headphones', { iconOnly: true });
    pressed(ucMic, false);
    pressed(ucDeaf, false);
    uc.appendChild(ucMic);
    uc.appendChild(ucDeaf);

    ui = {
      live: live, audioSink: audioSink,
      stageRoot: stageRoot, idle: idle, idleText: idleText, idleJoin: idleJoin, stageError: stageError,
      room: room_, main: main, grid: grid, focus: focus, strip: strip, roomError: roomError,
      bar: bar, barMic: barMic, barDeaf: barDeaf, barShare: barShare, barAudio: barAudio, barLeave: barLeave,
      chRoot: chRoot, chList: chList, chError: chError, chSig: '',
      conn: conn, connStatus: connStatus, connStatusText: connStatusText, connPing: connPing, connWhere: connWhere,
      connLeave: connLeave, connShare: connShare,
      uc: uc, ucMic: ucMic, ucDeaf: ucDeaf
    };

    idleJoin.addEventListener('click', join);
    [barMic, ucMic].forEach(function (b) { b.addEventListener('click', toggleMute); });
    [barDeaf, ucDeaf].forEach(function (b) { b.addEventListener('click', toggleDeafen); });
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
    var lp = room && room.localParticipant;
    var muted = deafened || prefMuted || (inRoom() && !(lp && lp.isMicrophoneEnabled) && !micBusy);
    pressed(btn, muted);
    btn.classList.toggle('is-off', muted);
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

  function syncShareButton(btn, sharing) {
    pressed(btn, sharing);
    btn.classList.toggle('is-active', sharing);
    var label = sharing ? 'Parar transmissão' : 'Compartilhar tela';
    if (btn.getAttribute('aria-label') !== null) { btn.setAttribute('aria-label', label); btn.title = label; }
    var t = btn.querySelector('.vc-btn-text');
    if (t) setText(t, label);
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
    setText(ui.connWhere, 'Sala de voz / ' + groupName());
  }

  function renderChannel(list) {
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

  function renderStage(list) {
    var connected = inRoom();
    var reason = unavailableReason(lastView);
    show(ui.idle, !connected);
    show(ui.room, connected);
    if (!connected) {
      setText(ui.idleText, reason || (status === 'connecting' ? 'Conectando à sala de voz…' : 'Converse por voz e transmita sua tela para o grupo.'));
      show(ui.idleJoin, !reason);
      ui.idleJoin.disabled = status === 'connecting';
      setText(ui.idleJoin.querySelector('.vc-btn-text'), status === 'connecting' ? 'Conectando…' : 'Entrar na voz');
      setText(ui.stageError, errorText);
      show(ui.stageError, !!errorText);
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
      var target = ui[where];
      var thumb = focusMode && o.key !== focusKey;
      t.root.classList.toggle('is-thumb', thumb);
      var role = thumb ? 'listitem' : 'group';
      if (t.root.getAttribute('role') !== role) t.root.setAttribute('role', role);
      var at = target.children[idx[where]] || null;
      idx[where]++;
      if (at !== t.root) {
        // só move quando a posição muda (mover o vídeo a cada fala seria desperdício)
        var hadFocus = t.root.contains(document.activeElement) ? document.activeElement : null;
        target.insertBefore(t.root, at);
        if (hadFocus && document.activeElement !== hadFocus) hadFocus.focus();
      }
    });

    var lp = room.localParticipant;
    var sharing = !!(lp && lp.isScreenShareEnabled);
    syncMicButton(ui.barMic);
    syncDeafButton(ui.barDeaf);
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
    var muted = deafened || prefMuted || (connected && !(lp && lp.isMicrophoneEnabled));
    return {
      connected: connected,
      connecting: status === 'connecting' || status === 'reconnecting',
      muted: !!muted,
      deafened: deafened,
      sharing: !!(connected && lp && lp.isScreenShareEnabled),
      participants: connected ? participantsList().map(function (p) {
        var mine = isLocal(p);
        return {
          userId: p.identity,
          name: nameFor(p),
          speaking: isSpeaking(p),
          muted: mine ? !!muted : !micOn(p),
          deafened: mine ? deafened : false,
          sharing: isSharing(p)
        };
      }) : []
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
    var lp = room && room.localParticipant;
    syncShareButton(ui.connShare, !!(inRoom() && lp && lp.isScreenShareEnabled));
    ui.ucMic.disabled = micBusy;
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
        img.src = src;
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

    call(function () { return bridge.listScreenSources(); }).then(function (res) {
      if (!dlg.root.open) return;
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

    call(function () { return bridge.pickScreenSource(sourceId); }).then(function (res) {
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
          return call(function () { return bridge.pickScreenSource(sourceId); }).then(function (res2) {
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
    paintPhoto = typeof opts.paintPhoto === 'function' ? opts.paintPhoto : null;
    onState = typeof opts.onState === 'function' ? opts.onState : null;
    LK = window.LivekitClient || null;
    els = opts.els || {};
    if (ui) return;
    buildUi();
    window.addEventListener('beforeunload', function () {
      if (room) { leavingOnPurpose = true; try { room.disconnect(); } catch (e) { /* ignora */ } }
    });
    render();
  }

  function update(view) {
    lastView = view || null;
    var reason = unavailableReason(view);
    var groupId = view && view.group ? view.group.id : null;
    // saiu da conta, do grupo, ou trocou de grupo: sai da sala
    if ((room || status === 'connecting') && (reason || groupId !== roomGroupId) && !(status === 'connecting' && !room && !reason)) leave();
    // a mensagem "entre em um grupo" etc. some quando deixa de valer
    if (errorText && errorText === lastReason && reason !== lastReason) errorText = '';
    lastReason = reason;
    scheduleRender();
  }

  window.GhostVoice = {
    init: init,
    update: update,
    join: join,
    leave: leave,
    toggleMute: toggleMute,
    toggleDeafen: toggleDeafen,
    getState: currentState
  };
})();
