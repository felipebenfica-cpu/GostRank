/* LivekitClient falso, só para a prévia no navegador (sem rede, sem mídia real).
   Implementa o que src/renderer/voice.js usa: Room, RoomEvent, Track.Source, VideoQuality,
   connect/disconnect, localParticipant.setMicrophoneEnabled/setScreenShareEnabled,
   publicações (getTrackPublication, setSubscribed, setVideoQuality), setVolume por
   participante e participantes falsos que falam, mutam e transmitem a tela (a imagem da
   transmissão é um canvas desenhado aqui). requestPictureInPicture não existe no canvas:
   a prévia esconde o botão.
   Etapa 6: câmera (local e do Eco, desenhada em canvas), switchActiveDevice, restartTrack e um
   microfone local com faixa de áudio de verdade (oscilador em rajadas, como fala) para o medidor,
   a detecção de voz e o apertar-para-falar funcionarem na prévia.
   As identidades batem com os membros simulados em preview/mock-bridge.js. */
(function () {
  'use strict';

  var RoomEvent = {
    ParticipantConnected: 'participantConnected',
    ParticipantDisconnected: 'participantDisconnected',
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed',
    TrackMuted: 'trackMuted',
    TrackUnmuted: 'trackUnmuted',
    TrackPublished: 'trackPublished',
    TrackUnpublished: 'trackUnpublished',
    LocalTrackPublished: 'localTrackPublished',
    LocalTrackUnpublished: 'localTrackUnpublished',
    ActiveSpeakersChanged: 'activeSpeakersChanged',
    AudioPlaybackStatusChanged: 'audioPlaybackChanged',
    MediaDevicesError: 'mediaDevicesError',
    Reconnecting: 'reconnecting',
    Reconnected: 'reconnected',
    Disconnected: 'disconnected'
  };

  var Track = {
    Kind: { Audio: 'audio', Video: 'video' },
    Source: { Camera: 'camera', Microphone: 'microphone', ScreenShare: 'screen_share', ScreenShareAudio: 'screen_share_audio', Unknown: 'unknown' }
  };

  var VideoQuality = { LOW: 0, MEDIUM: 1, HIGH: 2 };

  var ME = '11111111-1111-4111-8111-111111111111';
  var LUA = '22222222-2222-4222-8222-222222222222';
  var SOMBRA = '33333333-3333-4333-8333-333333333333';
  var ECO = '44444444-4444-4444-8444-444444444444';

  var sidSeq = 0;

  function drawScreen(canvas, title) {
    canvas.width = 1280;
    canvas.height = 720;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(2, 2);
    ctx.fillStyle = '#0d1a14';
    ctx.fillRect(0, 0, 640, 360);
    // "mapa" simulado
    ctx.fillStyle = '#16301f';
    for (var i = 0; i < 9; i++) ctx.fillRect(40 + i * 64, 60 + ((i * 37) % 120), 48, 48);
    ctx.strokeStyle = '#8fe9d6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(30, 290);
    ctx.lineTo(610, 30);
    ctx.stroke();
    // minimapa
    ctx.fillStyle = '#1a1f33';
    ctx.fillRect(16, 16, 96, 96);
    ctx.fillStyle = '#6be4a6';
    ctx.fillRect(30, 80, 6, 6);
    ctx.fillStyle = '#ff8d9c';
    ctx.fillRect(90, 30, 6, 6);
    ctx.fillStyle = '#131726';
    ctx.fillRect(0, 300, 640, 60);
    ctx.fillStyle = '#eceefa';
    ctx.font = '600 20px system-ui, sans-serif';
    ctx.fillText(title, 20, 337);
    ctx.fillStyle = '#ff8d9c';
    ctx.fillRect(520, 316, 100, 10);
    ctx.fillStyle = '#6be4a6';
    ctx.fillRect(520, 332, 70, 10);
  }

  var CAM_COLORS = { local: ['#1d3a35', '#8fe9d6'], eco: ['#2a2650', '#a798ff'] };

  function drawCamera(canvas, title, who) {
    canvas.width = 1280;
    canvas.height = 720;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var c = CAM_COLORS[who] || CAM_COLORS.eco;
    var g = ctx.createLinearGradient(0, 0, 1280, 720);
    g.addColorStop(0, c[0]);
    g.addColorStop(1, '#0a0c14');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1280, 720);
    // "pessoa" (silhueta de fantasma)
    ctx.fillStyle = c[1];
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(640, 330, 150, Math.PI, 0);
    ctx.lineTo(790, 600);
    for (var i = 0; i < 5; i++) ctx.lineTo(790 - (i + 0.5) * 60, i % 2 ? 600 : 560);
    ctx.lineTo(490, 600);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#0a0c14';
    ctx.beginPath(); ctx.arc(585, 330, 18, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(695, 330, 18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(10,12,20,0.6)';
    ctx.fillRect(0, 660, 1280, 60);
    ctx.fillStyle = '#eceefa';
    ctx.font = '600 30px system-ui, sans-serif';
    ctx.fillText(title, 24, 700);
  }

  // Microfone simulado: oscilador ligado em rajadas (parece fala no medidor).
  var fakeMicCtx = null;
  function fakeMicTrack() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      if (!fakeMicCtx) fakeMicCtx = new Ctx();
      if (fakeMicCtx.state === 'suspended' && fakeMicCtx.resume) fakeMicCtx.resume().catch(function () {});
      var osc = fakeMicCtx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 180;
      var amp = fakeMicCtx.createGain();
      amp.gain.value = 0;
      var dest = fakeMicCtx.createMediaStreamDestination();
      osc.connect(amp);
      amp.connect(dest);
      osc.start();
      var t = 0;
      var timer = setInterval(function () {
        t++;
        // 1,5 s falando, 1,5 s em silêncio (com um chiado baixinho)
        var talking = Math.floor(t / 15) % 2 === 0;
        var level = talking ? 0.12 + Math.random() * 0.25 : 0.002 + Math.random() * 0.003;
        try { amp.gain.setTargetAtTime(level, fakeMicCtx.currentTime, 0.02); } catch (e) { amp.gain.value = level; }
        osc.frequency.value = 140 + Math.random() * 120;
      }, 100);
      var track = dest.stream.getAudioTracks()[0];
      var stop = track.stop.bind(track);
      track.stop = function () { clearInterval(timer); try { osc.stop(); } catch (e) { /* ignora */ } stop(); };
      return track;
    } catch (e) { return null; }
  }

  function FakeTrack(kind, source, title, who) {
    this.sid = 'TR_' + (++sidSeq);
    this.kind = kind;
    this.source = source;
    this.title = title || '';
    this.who = who || '';
    this.attached = [];
    this.mediaStreamTrack = null;
  }
  FakeTrack.prototype.attach = function () {
    var node;
    if (this.kind === 'audio') {
      node = document.createElement('audio');
    } else {
      node = document.createElement('canvas');
      if (this.source === Track.Source.Camera) drawCamera(node, this.title, this.who);
      else drawScreen(node, this.title);
    }
    this.attached.push(node);
    return node;
  };
  FakeTrack.prototype.restartTrack = function () { return wait(120); };
  FakeTrack.prototype.stop = function () { if (this.mediaStreamTrack) { try { this.mediaStreamTrack.stop(); } catch (e) { /* ignora */ } } };
  FakeTrack.prototype.detach = function (one) {
    var list = one ? this.attached.filter(function (n) { return n === one; }) : this.attached;
    this.attached = one ? this.attached.filter(function (n) { return n !== one; }) : [];
    list.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
    return list;
  };

  /* Publicação: remota começa assinada (assinatura automática) e pode ser desassinada. */
  function Publication(room, participant, kind, source, title, remote, who) {
    this.trackSid = 'PUB_' + (++sidSeq);
    this.kind = kind;
    this.source = source;
    this.isMuted = false;
    this.videoQuality = VideoQuality.HIGH;
    this._room = room;
    this._participant = participant;
    this._title = title;
    this._who = who || '';
    this._remote = !!remote;
    this._desired = true;
    this.track = remote ? null : new FakeTrack(kind, source, title, who);
    this.isSubscribed = !remote;
  }
  Publication.prototype._subscribeNow = function () {
    if (!this._remote || this.track || !this._desired || this._room.state !== 'connected') return;
    if (this._participant._pubs.indexOf(this) < 0) return;
    this.track = new FakeTrack(this.kind, this.source, this._title, this._who);
    this.isSubscribed = true;
    this._room.emit(RoomEvent.TrackSubscribed, this.track, this, this._participant);
  };
  Publication.prototype._unsubscribeNow = function () {
    if (!this.track) return;
    var t = this.track;
    this.track = null;
    this.isSubscribed = false;
    t.detach();
    this._room.emit(RoomEvent.TrackUnsubscribed, t, this, this._participant);
  };
  Publication.prototype.setSubscribed = function (on) {
    var pub = this;
    pub._desired = !!on;
    setTimeout(function () { if (pub._desired) pub._subscribeNow(); else pub._unsubscribeNow(); }, on ? 250 : 20);
  };
  Publication.prototype.setVideoQuality = function (q) { this.videoQuality = q; };
  Publication.prototype.setEnabled = function () {};

  function Participant(identity, name) {
    this.identity = identity;
    this.name = name;
    this.isSpeaking = false;
    this._pubs = [];
    this._volume = {};
    this.trackPublications = new Map();
  }
  Participant.prototype.getTrackPublication = function (source) {
    for (var i = 0; i < this._pubs.length; i++) if (this._pubs[i].source === source) return this._pubs[i];
    return undefined;
  };
  Participant.prototype._add = function (pub) { this._pubs.push(pub); this.trackPublications.set(pub.trackSid, pub); };
  Participant.prototype._remove = function (pub) {
    this._pubs = this._pubs.filter(function (p) { return p !== pub; });
    this.trackPublications.delete(pub.trackSid);
  };
  Object.defineProperty(Participant.prototype, 'isMicrophoneEnabled', {
    get: function () { var p = this.getTrackPublication(Track.Source.Microphone); return !!p && !p.isMuted; }
  });
  Object.defineProperty(Participant.prototype, 'isCameraEnabled', {
    get: function () { var p = this.getTrackPublication(Track.Source.Camera); return !!p && !p.isMuted; }
  });
  Object.defineProperty(Participant.prototype, 'isScreenShareEnabled', {
    get: function () { return !!this.getTrackPublication(Track.Source.ScreenShare); }
  });
  // Como no livekit-client: volume 0..1 (acima de 1 só com webAudioMix).
  Participant.prototype.setVolume = function (v, source) {
    if (typeof v !== 'number' || !isFinite(v) || v < 0) throw new TypeError('volume inválido');
    this._volume[source || Track.Source.Microphone] = v;
  };
  Participant.prototype.getVolume = function (source) {
    var v = this._volume[source || Track.Source.Microphone];
    return v == null ? 1 : v;
  };

  function Emitter() { this._handlers = {}; }
  Emitter.prototype.on = function (ev, fn) {
    (this._handlers[ev] = this._handlers[ev] || []).push(fn);
    return this;
  };
  Emitter.prototype.off = function (ev, fn) {
    this._handlers[ev] = (this._handlers[ev] || []).filter(function (h) { return h !== fn; });
    return this;
  };
  Emitter.prototype.emit = function (ev) {
    var args = Array.prototype.slice.call(arguments, 1);
    (this._handlers[ev] || []).slice().forEach(function (h) { h.apply(null, args); });
  };

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function Room(options) {
    Emitter.call(this);
    this.options = options || {};
    this.state = 'disconnected';
    this.canPlaybackAudio = true;
    this.remoteParticipants = new Map();
    this.engine = { client: { rtt: 0 } };
    this.lastScreenShare = null; // opções da última transmissão (para conferir na prévia)
    this._timers = [];
    var room = this;

    var local = new Participant(ME, 'Fantasma Noturno');
    local.setMicrophoneEnabled = function (on) {
      return wait(150).then(function () {
        if (room.state !== 'connected') throw new Error('desconectado');
        var pub = local.getTrackPublication(Track.Source.Microphone);
        if (on && !pub) {
          pub = new Publication(room, local, 'audio', Track.Source.Microphone, '', false);
          pub.track.mediaStreamTrack = fakeMicTrack();
          local._add(pub);
          room.emit(RoomEvent.LocalTrackPublished, pub, local);
        } else if (pub && pub.isMuted === !!on) {
          pub.isMuted = !on;
          room.emit(on ? RoomEvent.TrackUnmuted : RoomEvent.TrackMuted, pub, local);
        }
      });
    };
    local.setScreenShareEnabled = function (on, captureOptions, publishOptions) {
      return wait(300).then(function () {
        if (room.state !== 'connected') throw new Error('desconectado');
        var pub = local.getTrackPublication(Track.Source.ScreenShare);
        if (on && !pub) {
          room.lastScreenShare = { captureOptions: captureOptions || null, publishOptions: publishOptions || null };
          pub = new Publication(room, local, 'video', Track.Source.ScreenShare, 'Sua tela (simulada)', false);
          local._add(pub);
          room.emit(RoomEvent.LocalTrackPublished, pub, local);
        } else if (!on && pub) {
          local._remove(pub);
          room.emit(RoomEvent.LocalTrackUnpublished, pub, local);
        }
      });
    };
    local.setCameraEnabled = function (on, captureOptions, publishOptions) {
      return wait(250).then(function () {
        if (room.state !== 'connected') throw new Error('desconectado');
        var pub = local.getTrackPublication(Track.Source.Camera);
        if (on && !pub) {
          room.lastCamera = { captureOptions: captureOptions || null, publishOptions: publishOptions || null };
          pub = new Publication(room, local, 'video', Track.Source.Camera, 'Sua câmera (simulada)', false, 'local');
          local._add(pub);
          room.emit(RoomEvent.LocalTrackPublished, pub, local);
        } else if (!on && pub) {
          local._remove(pub);
          pub.track.detach();
          room.emit(RoomEvent.LocalTrackUnpublished, pub, local);
        }
      });
    };
    this.localParticipant = local;
    this.activeDevices = { audioinput: 'default', audiooutput: 'default', videoinput: 'default' };
  }
  Room.prototype = Object.create(Emitter.prototype);
  Room.prototype.constructor = Room;

  Room.prototype.switchActiveDevice = function (kind, deviceId) {
    var room = this;
    return wait(80).then(function () { room.activeDevices[kind] = deviceId; return true; });
  };
  Room.prototype.getActiveDevice = function (kind) { return this.activeDevices[kind]; };

  Room.prototype._later = function (ms, fn) {
    var room = this;
    this._timers.push(setTimeout(function () { if (room.state === 'connected') fn(); }, ms));
  };

  // Publicação remota: avisa e, como a assinatura automática, assina logo em seguida.
  Room.prototype._publish = function (p, kind, source, title, muted, announce, who) {
    var pub = new Publication(this, p, kind, source, title, true, who);
    pub.isMuted = !!muted;
    p._add(pub);
    if (announce) this.emit(RoomEvent.TrackPublished, pub, p);
    var room = this;
    setTimeout(function () { pub._subscribeNow(); }, announce ? 60 : 0);
    if (!announce && room.state === 'connected') pub._subscribeNow();
    return pub;
  };

  Room.prototype._unpublish = function (p, pub) {
    pub._unsubscribeNow();
    p._remove(pub);
    this.emit(RoomEvent.TrackUnpublished, pub, p);
  };

  Room.prototype._addRemote = function (p, micOn, emitJoin) {
    this.remoteParticipants.set(p.identity, p);
    if (emitJoin) this.emit(RoomEvent.ParticipantConnected, p);
    this._publish(p, 'audio', Track.Source.Microphone, '', !micOn, emitJoin);
  };

  Room.prototype._startScreen = function (p, title, announce) {
    this._publish(p, 'video', Track.Source.ScreenShare, title, false, announce);
    this._publish(p, 'audio', Track.Source.ScreenShareAudio, '', false, announce);
  };

  Room.prototype.connect = function (url, token) {
    var room = this;
    if (typeof url !== 'string' || url.indexOf('wss://') !== 0) return Promise.reject(new Error('url inválida'));
    if (typeof token !== 'string' || token.split('.').length !== 3) return Promise.reject(new Error('token inválido'));
    return wait(500).then(function () {
      room.state = 'connected';
      room.engine.client.rtt = 38;
      var lua = new Participant(LUA, 'Lua<Cheia>');
      var sombra = new Participant(SOMBRA, 'Sombra');
      room._addRemote(lua, true, false);
      room._addRemote(sombra, false, false);

      // Lua começa a transmitir a tela
      room._later(900, function () { room._startScreen(lua, 'Tela de Lua (simulada)', true); });

      // Eco entra depois e liga a câmera
      room._later(2500, function () {
        var eco = new Participant(ECO, 'Eco');
        room._addRemote(eco, true, true);
        room._later(700, function () { room._publish(eco, 'video', Track.Source.Camera, 'Câmera do Eco (simulada)', false, true, 'eco'); });
      });

      // o ping varia um pouco
      room._timers.push(setInterval(function () { room.engine.client.rtt = 30 + Math.round(Math.random() * 25); }, 3000));

      // quem está falando muda a cada pouco
      var turn = 0;
      var cycle = function () {
        var order = [[lua], [lua, room.localParticipant], [], [room.remoteParticipants.get(ECO)].filter(Boolean)];
        var speakers = order[turn % order.length].filter(function (p) { return p.isMicrophoneEnabled; });
        room.remoteParticipants.forEach(function (p) { p.isSpeaking = speakers.indexOf(p) >= 0; });
        room.localParticipant.isSpeaking = speakers.indexOf(room.localParticipant) >= 0;
        room.emit(RoomEvent.ActiveSpeakersChanged, speakers);
        turn++;
      };
      room._later(1200, cycle);
      room._timers.push(setInterval(function () { if (room.state === 'connected') cycle(); }, 2200));
    });
  };

  Room.prototype.disconnect = function () {
    var room = this;
    if (room.state === 'disconnected') return Promise.resolve();
    room.state = 'disconnected';
    var mp = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (mp && mp.track) mp.track.stop();
    room._timers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
    room._timers = [];
    room.remoteParticipants.clear();
    room.emit(RoomEvent.Disconnected, 'CLIENT_INITIATED');
    return Promise.resolve();
  };

  Room.prototype.startAudio = function () {
    this.canPlaybackAudio = true;
    this.emit(RoomEvent.AudioPlaybackStatusChanged, true);
    return Promise.resolve();
  };

  window.LivekitClient = { Room: Room, RoomEvent: RoomEvent, Track: Track, VideoQuality: VideoQuality, version: 'prévia' };
})();
