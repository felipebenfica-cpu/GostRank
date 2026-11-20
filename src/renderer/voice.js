/* Ghost Rank - sala de voz do grupo (LiveKit). Script clássico em um único IIFE.
   Carregado depois de vendor/livekit-client.umd.js (que define window.LivekitClient, se instalado)
   e antes de app.js. Expõe window.GhostVoice = { init, update, leave }.
   Nunca usa innerHTML: tudo é criado com createElement/textContent. */
(function () {
  'use strict';

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

  function $(id) { return document.getElementById(id); }

  var bridge = null;
  var getView = function () { return null; };
  var LK = null;

  var room = null;
  var roomGroupId = null;
  var state = 'off'; // off | connecting | connected | reconnecting
  var leavingOnPurpose = false;
  var speaking = {}; // identity -> true
  var screenTiles = {}; // trackSid -> elemento do quadro
  var audioEls = {}; // trackSid -> [elementos de áudio]
  var lastSources = [];
  var dom = null;

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var ICONS = {
    mic: [['path', { d: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z' }], ['path', { d: 'M5 11a7 7 0 0 0 14 0' }], ['line', { x1: 12, y1: 18, x2: 12, y2: 21 }]],
    micOff: [['path', { d: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z' }], ['path', { d: 'M5 11a7 7 0 0 0 14 0' }], ['line', { x1: 12, y1: 18, x2: 12, y2: 21 }], ['line', { x1: 3, y1: 3, x2: 21, y2: 21 }]],
    speaking: [['path', { d: 'M11 5 6 9H3v6h3l5 4V5z' }], ['path', { d: 'M15.5 8.5a5 5 0 0 1 0 7' }], ['path', { d: 'M18.5 5.5a9 9 0 0 1 0 13' }]],
    expand: [['path', { d: 'M4 9V4h5' }], ['path', { d: 'M20 9V4h-5' }], ['path', { d: 'M4 15v5h5' }], ['path', { d: 'M20 15v5h-5' }]],
    shrink: [['path', { d: 'M9 4v5H4' }], ['path', { d: 'M15 4v5h5' }], ['path', { d: 'M9 20v-5H4' }], ['path', { d: 'M15 20v-5h5' }]],
    screen: [['rect', { x: 3, y: 4, width: 18, height: 12, rx: 2 }], ['line', { x1: 8, y1: 20, x2: 16, y2: 20 }], ['line', { x1: 12, y1: 16, x2: 12, y2: 20 }]],
    window: [['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }], ['line', { x1: 3, y1: 9, x2: 21, y2: 9 }]]
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

  function show(node, visible) { if (node) node.hidden = !visible; }

  function setError(message) {
    if (!dom) return;
    dom.error.textContent = message || '';
    show(dom.error, !!message);
  }

  function announce(text) {
    if (!dom) return;
    dom.live.textContent = '';
    window.setTimeout(function () { dom.live.textContent = text; }, 50);
  }

  function call(fn) {
    if (!bridge) return Promise.resolve({ ok: false, error: 'A ponte com o aplicativo não está disponível.' });
    return Promise.resolve().then(fn).catch(function () {
      return { ok: false, error: 'Algo deu errado ao falar com o aplicativo. Tente de novo.' };
    });
  }

  function evName(key, fallback) {
    return (LK && LK.RoomEvent && LK.RoomEvent[key]) || fallback;
  }

  function kindOf(track) { return track && track.kind; }
  function sourceOf(pubOrTrack) { return pubOrTrack && pubOrTrack.source; }

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

  /* ---------- disponibilidade ---------- */

  function unavailableReason(view) {
    var a = view && view.auth;
    if (!a || a.status !== 'signed_in') return 'Entre na sua conta para usar a voz.';
    if (!view.group) return 'Entre em um grupo para usar a voz.';
    if (!LK || typeof LK.Room !== 'function') return 'Voz indisponível neste computador: rode npm install.';
    if (!view.voice || view.voice.available !== true) return 'Voz indisponível neste computador: rode npm install.';
    return null;
  }

  /* ---------- nomes ---------- */

  function nameFor(participant) {
    if (!participant) return 'Fantasma';
    var view = getView();
    var members = (view && view.group && Array.isArray(view.group.members)) ? view.group.members : [];
    for (var i = 0; i < members.length; i++) {
      if (members[i].userId === participant.identity && members[i].displayName) return members[i].displayName;
    }
    return (typeof participant.name === 'string' && participant.name) ? participant.name : 'Fantasma';
  }

  /* ---------- renderização ---------- */

  function renderState() {
    if (!dom) return;
    var labels = { off: 'Fora da sala', connecting: 'Entrando…', connected: 'Na sala', reconnecting: 'Reconectando…' };
    var dataState = state === 'reconnecting' ? 'connecting' : state;
    dom.state.dataset.state = dataState;
    dom.stateText.textContent = labels[state] || labels.off;

    var inRoom = state === 'connected' || state === 'reconnecting';
    show(dom.joinRow, !inRoom);
    dom.join.disabled = state === 'connecting';
    dom.joinLabel.textContent = state === 'connecting' ? 'Entrando…' : 'Entrar na sala';
    show(dom.controls, inRoom);
    show(dom.intro, !inRoom);

    var lp = room && room.localParticipant;
    var micOn = !!(lp && lp.isMicrophoneEnabled);
    dom.mute.setAttribute('aria-pressed', micOn ? 'false' : 'true');
    // rótulo fixo + aria-pressed: "Mutar, pressionado" = microfone desligado
    dom.muteLabel.textContent = 'Mutar';
    var sharing = !!(lp && lp.isScreenShareEnabled);
    dom.shareLabel.textContent = sharing ? 'Parar de compartilhar' : 'Compartilhar tela';
    dom.share.dataset.active = sharing ? 'true' : 'false';
    show(dom.audioBtn, inRoom && room && room.canPlaybackAudio === false);

    renderParticipants();
  }

  function participantsList() {
    if (!room) return [];
    var list = [];
    if (room.localParticipant) list.push(room.localParticipant);
    var remotes = room.remoteParticipants || room.participants;
    if (remotes && typeof remotes.forEach === 'function') remotes.forEach(function (p) { list.push(p); });
    return list;
  }

  function renderParticipants() {
    if (!dom) return;
    var inRoom = !!room && (state === 'connected' || state === 'reconnecting');
    show(dom.people, inRoom);
    dom.participants.textContent = '';
    if (!inRoom) return;
    var local = room.localParticipant;
    participantsList().forEach(function (p) {
      var isMe = p === local;
      var li = el('li', 'participant');
      var micOn = !!p.isMicrophoneEnabled;
      var talking = !!(speaking[p.identity] || p.isSpeaking) && micOn;

      var mic = el('span', 'p-mic');
      mic.dataset.on = micOn ? 'true' : 'false';
      mic.appendChild(icon(micOn ? 'mic' : 'micOff', 18));
      li.appendChild(mic);

      var name = el('span', 'p-name', nameFor(p));
      li.appendChild(name);
      if (isMe) li.appendChild(el('span', 'tag tag-me', 'você'));

      var st = el('span', 'p-state');
      if (talking) {
        li.classList.add('is-speaking');
        st.appendChild(icon('speaking', 16));
        st.appendChild(el('span', null, 'falando'));
      } else if (!micOn) {
        st.appendChild(el('span', null, 'mutado'));
      } else {
        st.appendChild(el('span', 'visually-hidden', 'microfone ligado'));
      }
      if (p.isScreenShareEnabled) {
        var sh = el('span', 'p-sharing');
        sh.appendChild(icon('screen', 16));
        sh.appendChild(el('span', null, 'tela'));
        st.appendChild(sh);
      }
      li.appendChild(st);
      dom.participants.appendChild(li);
    });
  }

  /* ---------- faixas ---------- */

  function addScreenTile(track, participant, isLocal) {
    var sid = track.sid || (participant && participant.identity) + ':screen';
    removeScreenTile(sid);
    var fig = el('figure', 'screen-tile' + (isLocal ? ' is-local' : ''));
    var media = track.attach();
    if (media && media.tagName === 'VIDEO') {
      media.controls = false;
      media.muted = !!isLocal;
      media.playsInline = true;
      media.autoplay = true;
    }
    if (media && media.classList) media.classList.add('screen-media');
    var cap = el('figcaption', 'screen-caption');
    cap.appendChild(icon('screen', 16));
    cap.appendChild(el('span', 'screen-name', isLocal ? 'Sua tela (prévia)' : 'Tela de ' + nameFor(participant)));
    if (!isLocal) {
      var big = el('button', 'btn btn-small screen-expand');
      big.type = 'button';
      big.setAttribute('aria-pressed', 'false');
      big.appendChild(icon('expand', 16));
      big.appendChild(el('span', null, 'Tela cheia'));
      big.addEventListener('click', function () { toggleBig(fig); });
      cap.appendChild(big);
      if (media) media.addEventListener('dblclick', function () { toggleBig(fig); });
    }
    fig.appendChild(cap);
    if (media) fig.appendChild(media);
    dom.screens.appendChild(fig);
    screenTiles[sid] = { fig: fig, track: track };
    show(dom.screens, true);
    if (!isLocal) announce(nameFor(participant) + ' começou a compartilhar a tela.');
  }

  /* Tela cheia: usa a tela cheia do sistema; se não der, amplia dentro da janela. */
  function isBig(fig) { return document.fullscreenElement === fig || fig.classList.contains('is-expanded'); }

  function syncBigButton(fig) {
    var btn = fig.querySelector('.screen-expand');
    if (!btn) return;
    var on = isBig(fig);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.textContent = '';
    btn.appendChild(icon(on ? 'shrink' : 'expand', 16));
    btn.appendChild(el('span', null, on ? 'Sair da tela cheia' : 'Tela cheia'));
  }

  function toggleBig(fig) {
    if (isBig(fig)) {
      fig.classList.remove('is-expanded');
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
      syncBigButton(fig);
      return;
    }
    var expandInside = function () { fig.classList.add('is-expanded'); syncBigButton(fig); };
    if (fig.requestFullscreen) {
      fig.requestFullscreen({ navigationUI: 'hide' }).then(function () { syncBigButton(fig); }, expandInside);
    } else {
      expandInside();
    }
  }

  document.addEventListener('fullscreenchange', function () {
    Object.keys(screenTiles).forEach(function (sid) { syncBigButton(screenTiles[sid].fig); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    Object.keys(screenTiles).forEach(function (sid) {
      var f = screenTiles[sid].fig;
      if (f.classList.contains('is-expanded')) { f.classList.remove('is-expanded'); syncBigButton(f); }
    });
  });

  function removeScreenTile(sid) {
    var tile = screenTiles[sid];
    if (!tile) return;
    try { if (tile.track && typeof tile.track.detach === 'function') tile.track.detach(); } catch (e) { /* ignora */ }
    if (tile.fig.parentNode) tile.fig.parentNode.removeChild(tile.fig);
    delete screenTiles[sid];
    show(dom.screens, Object.keys(screenTiles).length > 0);
  }

  function addAudio(track) {
    var media = track.attach();
    if (!media) return;
    media.hidden = true;
    media.controls = false;
    dom.audioSink.appendChild(media);
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

  function onTrackSubscribed(track, publication, participant) {
    if (kindOf(track) === 'audio') addAudio(track);
    else if (kindOf(track) === 'video' && (sourceOf(publication) || sourceOf(track)) === 'screen_share') {
      // Sempre a melhor qualidade disponível da tela compartilhada.
      try { if (publication && publication.setVideoQuality && LK.VideoQuality) publication.setVideoQuality(LK.VideoQuality.HIGH); } catch (e) { /* ignora */ }
      addScreenTile(track, participant, false);
    }
    renderParticipants();
  }

  function onTrackUnsubscribed(track) {
    if (kindOf(track) === 'audio') removeAudio(track);
    else removeScreenTile(track.sid);
    renderParticipants();
  }

  function onLocalPublished(publication) {
    var track = publication && publication.track;
    if (track && kindOf(track) === 'video' && sourceOf(publication) === 'screen_share') {
      addScreenTile(track, room.localParticipant, true);
    }
    renderState();
  }

  function onLocalUnpublished(publication) {
    var track = publication && publication.track;
    if (track && sourceOf(publication) === 'screen_share') removeScreenTile(track.sid);
    renderState();
  }

  /* ---------- sala ---------- */

  function cleanupMedia() {
    Object.keys(screenTiles).forEach(removeScreenTile);
    Object.keys(audioEls).forEach(function (sid) {
      audioEls[sid].forEach(function (m) { if (m.parentNode) m.parentNode.removeChild(m); });
    });
    audioEls = {};
    if (dom) dom.audioSink.textContent = '';
    speaking = {};
  }

  function wire(r) {
    var rerender = function () { renderState(); };
    r.on(evName('ParticipantConnected', 'participantConnected'), function (p) {
      announce(nameFor(p) + ' entrou na sala.');
      renderParticipants();
    });
    r.on(evName('ParticipantDisconnected', 'participantDisconnected'), function (p) {
      if (p) delete speaking[p.identity];
      announce(nameFor(p) + ' saiu da sala.');
      renderParticipants();
    });
    r.on(evName('TrackSubscribed', 'trackSubscribed'), onTrackSubscribed);
    r.on(evName('TrackUnsubscribed', 'trackUnsubscribed'), onTrackUnsubscribed);
    r.on(evName('TrackMuted', 'trackMuted'), rerender);
    r.on(evName('TrackUnmuted', 'trackUnmuted'), rerender);
    r.on(evName('TrackPublished', 'trackPublished'), rerender);
    r.on(evName('TrackUnpublished', 'trackUnpublished'), rerender);
    r.on(evName('LocalTrackPublished', 'localTrackPublished'), onLocalPublished);
    r.on(evName('LocalTrackUnpublished', 'localTrackUnpublished'), onLocalUnpublished);
    r.on(evName('ActiveSpeakersChanged', 'activeSpeakersChanged'), function (speakers) {
      speaking = {};
      (speakers || []).forEach(function (p) { if (p && p.identity) speaking[p.identity] = true; });
      renderParticipants();
    });
    r.on(evName('AudioPlaybackStatusChanged', 'audioPlaybackChanged'), rerender);
    r.on(evName('Reconnecting', 'reconnecting'), function () {
      if (r !== room) return;
      state = 'reconnecting';
      renderState();
    });
    r.on(evName('Reconnected', 'reconnected'), function () {
      if (r !== room) return;
      state = 'connected';
      setError('');
      renderState();
    });
    r.on(evName('MediaDevicesError', 'mediaDevicesError'), function (err) {
      setError(mediaErrorMessage(err, 'mic'));
    });
    r.on(evName('Disconnected', 'disconnected'), function () {
      if (r !== room) return;
      var purposeful = leavingOnPurpose;
      room = null;
      roomGroupId = null;
      leavingOnPurpose = false;
      state = 'off';
      cleanupMedia();
      renderState();
      if (!purposeful) setError('A conexão com a sala de voz caiu. Tente entrar de novo.');
      announce('Você saiu da sala de voz.');
    });
  }

  function join() {
    var view = getView();
    var reason = unavailableReason(view);
    if (reason) { setError(reason); return; }
    if (room || state === 'connecting') return;
    setError('');
    state = 'connecting';
    renderState();
    var groupId = view.group.id;

    call(function () { return bridge.voiceToken(); }).then(function (res) {
      if (!res || !res.ok || typeof res.url !== 'string' || typeof res.token !== 'string') {
        state = 'off';
        renderState();
        setError((res && res.error) || 'Não deu para entrar na sala de voz. Tente de novo.');
        return null;
      }
      var r;
      try {
        r = new LK.Room({ adaptiveStream: false, dynacast: true });
      } catch (e) {
        state = 'off';
        renderState();
        setError('A biblioteca de voz não abriu. Rode npm install e abra o Ghost Rank de novo.');
        return null;
      }
      room = r;
      roomGroupId = groupId;
      leavingOnPurpose = false;
      wire(r);
      return r.connect(res.url, res.token).then(function () {
        if (r !== room) return null;
        state = 'connected';
        renderState();
        announce('Você entrou na sala de voz.');
        dom.mute.focus();
        return r.localParticipant.setMicrophoneEnabled(true).then(renderState, function (err) {
          renderState();
          setError(mediaErrorMessage(err, 'mic'));
        });
      });
    }).catch(function (err) {
      var r = room;
      room = null;
      roomGroupId = null;
      state = 'off';
      if (r) { leavingOnPurpose = true; try { r.disconnect(); } catch (e) { /* ignora */ } }
      cleanupMedia();
      renderState();
      setError('Não deu para conectar à sala de voz. Verifique a internet e tente de novo.' + techDetail(err));
      dom.join.focus();
    });
  }

  function leave() {
    var r = room;
    if (!r) {
      state = 'off';
      renderState();
      return Promise.resolve();
    }
    leavingOnPurpose = true;
    room = null;
    roomGroupId = null;
    state = 'off';
    cleanupMedia();
    renderState();
    return Promise.resolve().then(function () { return r.disconnect(); }).catch(function () { /* ignora */ });
  }

  function toggleMute() {
    if (!room) return;
    var lp = room.localParticipant;
    var next = !lp.isMicrophoneEnabled;
    dom.mute.disabled = true;
    setError('');
    Promise.resolve().then(function () { return lp.setMicrophoneEnabled(next); }).then(function () {
      dom.mute.disabled = false;
      renderState();
    }, function (err) {
      dom.mute.disabled = false;
      renderState();
      setError(mediaErrorMessage(err, 'mic'));
    });
  }

  /* ---------- compartilhar tela ---------- */

  function stopShare() {
    if (!room) return;
    setError('');
    Promise.resolve().then(function () { return room.localParticipant.setScreenShareEnabled(false); })
      .then(renderState, function () { renderState(); setError('Não deu para parar o compartilhamento. Tente de novo.'); });
  }

  function openPicker() {
    if (!room) return;
    if (room.localParticipant.isScreenShareEnabled) { stopShare(); return; }
    setError('');
    dom.screenList.textContent = '';
    dom.screenLoading.textContent = 'Procurando telas e janelas…';
    dom.screenError.textContent = '';
    show(dom.screenError, false);
    if (typeof dom.dlgScreen.showModal === 'function') dom.dlgScreen.showModal();
    else dom.dlgScreen.setAttribute('open', '');

    call(function () { return bridge.listScreenSources(); }).then(function (res) {
      if (!res || !res.ok || !Array.isArray(res.sources)) {
        dom.screenLoading.textContent = '';
        dom.screenError.textContent = (res && res.error) || 'Não deu para listar as telas. Tente de novo.';
        show(dom.screenError, true);
        return;
      }
      lastSources = res.sources.filter(function (s) { return s && typeof s.id === 'string' && s.id.length <= 200; });
      dom.screenLoading.textContent = lastSources.length ? lastSources.length + (lastSources.length === 1 ? ' opção encontrada.' : ' opções encontradas.') : 'Nenhuma tela ou janela encontrada.';
      renderSources();
    });
  }

  function renderSources() {
    dom.screenList.textContent = '';
    lastSources.forEach(function (s, i) {
      var li = el('li', 'screen-option');
      var btn = el('button', 'screen-pick');
      btn.type = 'button';
      var thumb = el('span', 'screen-thumb');
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
      var label = el('span', 'screen-name');
      label.appendChild(el('span', 'screen-kind', s.kind === 'window' ? 'Janela' : 'Tela'));
      label.appendChild(el('span', 'screen-title', typeof s.name === 'string' && s.name ? s.name : (s.kind === 'window' ? 'Janela sem nome' : 'Tela ' + (i + 1))));
      btn.appendChild(label);
      btn.addEventListener('click', function () { pickSource(s, btn); });
      li.appendChild(btn);
      dom.screenList.appendChild(li);
    });
    var first = dom.screenList.querySelector('button');
    if (first) first.focus();
  }

  function pickSource(source, btn) {
    if (!room) { dom.dlgScreen.close(); return; }
    var buttons = dom.screenList.querySelectorAll('button');
    Array.prototype.forEach.call(buttons, function (b) { b.disabled = true; });
    btn.setAttribute('aria-busy', 'true');
    var enable = function () {
      Array.prototype.forEach.call(buttons, function (b) { b.disabled = false; });
      btn.removeAttribute('aria-busy');
    };
    call(function () { return bridge.pickScreenSource(source.id); }).then(function (res) {
      if (!res || !res.ok) {
        enable();
        dom.screenError.textContent = (res && res.error) || 'Essa tela não está mais disponível. Escolha de novo.';
        show(dom.screenError, true);
        return;
      }
      var r = room;
      if (!r) { dom.dlgScreen.close(); return; }
      dom.dlgScreen.close();
      // Áudio do jogo sem processamento de voz (o Electron falha no loopback com ele ligado).
      // Qualidade máxima: até 1440p a 30 quadros (limitado à resolução da tela escolhida).
      var HIGH_RES = { width: 2560, height: 1440, frameRate: 30 };
      var PUBLISH = {
        screenShareEncoding: { maxBitrate: 8000000, maxFramerate: 30, priority: 'high' },
        degradationPreference: 'maintain-resolution',
      };
      var withAudio = {
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        systemAudio: 'include',
        selfBrowserSurface: 'exclude',
        resolution: HIGH_RES,
        contentHint: 'detail',
      };
      var noAudio = false;
      return Promise.resolve()
        .then(function () { return r.localParticipant.setScreenShareEnabled(true, withAudio, PUBLISH); })
        .catch(function (err) {
          var n = err && err.name;
          if (n !== 'NotReadableError' && n !== 'AbortError' && n !== 'NotSupportedError') throw err;
          // Tenta de novo só com a imagem (a escolha da tela é de uso único).
          noAudio = true;
          return call(function () { return bridge.pickScreenSource(source.id); }).then(function (res2) {
            if (!res2 || !res2.ok) throw err;
            return r.localParticipant.setScreenShareEnabled(true, { audio: false, selfBrowserSurface: 'exclude', resolution: HIGH_RES, contentHint: 'detail' }, PUBLISH);
          });
        })
        .then(function () {
          enable();
          renderState();
          if (noAudio) setError('Compartilhando só a imagem: o som do jogo não pôde ser capturado neste computador.');
          announce('Você está compartilhando a tela.');
          dom.share.focus();
        }, function (err) {
          enable();
          renderState();
          setError(mediaErrorMessage(err, 'screen') + techDetail(err));
          dom.share.focus();
        });
    });
  }

  /* ---------- API ---------- */

  function init(opts) {
    bridge = opts && opts.bridge;
    if (opts && typeof opts.getView === 'function') getView = opts.getView;
    LK = window.LivekitClient || null;
    dom = {
      card: $('voice-card'),
      state: $('voice-state'),
      stateText: $('voice-state-text'),
      unavailable: $('voice-unavailable'),
      unavailableText: $('voice-unavailable-text'),
      ready: $('voice-ready'),
      intro: $('voice-intro'),
      joinRow: $('voice-join-row'),
      join: $('btn-voice-join'),
      joinLabel: $('btn-voice-join').querySelector('span'),
      controls: $('voice-controls'),
      mute: $('btn-voice-mute'),
      muteLabel: $('voice-mute-label'),
      share: $('btn-voice-share'),
      shareLabel: $('voice-share-label'),
      audioBtn: $('btn-voice-audio'),
      leave: $('btn-voice-leave'),
      error: $('voice-error'),
      people: $('voice-people'),
      participants: $('voice-participants'),
      screens: $('voice-screens'),
      audioSink: $('voice-audio-sink'),
      live: $('voice-live'),
      dlgScreen: $('dlg-screen'),
      screenList: $('screen-list'),
      screenLoading: $('screen-loading'),
      screenError: $('screen-error')
    };
    if (!dom.card) { dom = null; return; }

    dom.join.addEventListener('click', join);
    dom.leave.addEventListener('click', function () {
      leave().then(function () { announce('Você saiu da sala de voz.'); dom.join.focus(); });
    });
    dom.mute.addEventListener('click', toggleMute);
    dom.share.addEventListener('click', openPicker);
    dom.audioBtn.addEventListener('click', function () {
      if (room && typeof room.startAudio === 'function') {
        Promise.resolve().then(function () { return room.startAudio(); }).then(renderState, renderState);
      }
    });
    window.addEventListener('beforeunload', function () { if (room) { leavingOnPurpose = true; try { room.disconnect(); } catch (e) { /* ignora */ } } });
    renderState();
  }

  function update(view) {
    if (!dom) return;
    var reason = unavailableReason(view);
    var groupId = view && view.group ? view.group.id : null;
    // saiu da conta, do grupo, ou trocou de grupo: sai da sala
    if (room && (reason || groupId !== roomGroupId)) leave();
    show(dom.unavailable, !!reason);
    dom.unavailableText.textContent = reason || '';
    show(dom.ready, !reason);
    if (reason) setError('');
    renderState();
  }

  window.GhostVoice = { init: init, update: update, leave: leave };
})();
