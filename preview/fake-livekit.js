/* LivekitClient falso, só para a prévia no navegador (sem rede, sem mídia real).
   Implementa o mínimo usado por src/renderer/voice.js: Room, RoomEvent, Track,
   connect/disconnect, localParticipant.setMicrophoneEnabled/setScreenShareEnabled
   e participantes falsos que falam, mutam e compartilham a tela.
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
    Source: { Microphone: 'microphone', ScreenShare: 'screen_share', ScreenShareAudio: 'screen_share_audio' }
  };

  var ME = '11111111-1111-4111-8111-111111111111';
  var LUA = '22222222-2222-4222-8222-222222222222';
  var SOMBRA = '33333333-3333-4333-8333-333333333333';
  var ECO = '44444444-4444-4444-8444-444444444444';

  var sidSeq = 0;

  function drawScreen(canvas, title) {
    canvas.width = 640;
    canvas.height = 360;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#0d1a14';
    ctx.fillRect(0, 0, 640, 360);
    // "mapa" simulado
    ctx.fillStyle = '#16301f';
    for (var i = 0; i < 9; i++) ctx.fillRect(40 + i * 64, 60 + ((i * 37) % 120), 48, 48);
    ctx.strokeStyle = '#8fe9d6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(30, 330);
    ctx.lineTo(610, 30);
    ctx.stroke();
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

  function FakeTrack(kind, source, title) {
    this.sid = 'TR_' + (++sidSeq);
    this.kind = kind;
    this.source = source;
    this.title = title || '';
    this.attached = [];
  }
  FakeTrack.prototype.attach = function () {
    var node;
    if (this.kind === 'audio') {
      node = document.createElement('audio');
    } else {
      node = document.createElement('canvas');
      drawScreen(node, this.title);
    }
    this.attached.push(node);
    return node;
  };
  FakeTrack.prototype.detach = function () {
    var list = this.attached;
    this.attached = [];
    list.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
    return list;
  };

  function Participant(identity, name, micOn) {
    this.identity = identity;
    this.name = name;
    this.isMicrophoneEnabled = !!micOn;
    this.isScreenShareEnabled = false;
    this.isSpeaking = false;
    this.tracks = [];
  }

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

  function Room(options) {
    Emitter.call(this);
    this.options = options || {};
    this.state = 'disconnected';
    this.canPlaybackAudio = true;
    this.remoteParticipants = new Map();
    this._timers = [];
    var room = this;

    var local = new Participant(ME, 'Fantasma Noturno', false);
    local.setMicrophoneEnabled = function (on) {
      return wait(150).then(function () {
        if (room.state !== 'connected') throw new Error('desconectado');
        var was = local.isMicrophoneEnabled;
        local.isMicrophoneEnabled = !!on;
        if (on && !local._mic) {
          local._mic = new FakeTrack('audio', Track.Source.Microphone);
          room.emit(RoomEvent.LocalTrackPublished, { track: local._mic, source: Track.Source.Microphone, kind: 'audio' }, local);
        } else if (was !== !!on) {
          room.emit(on ? RoomEvent.TrackUnmuted : RoomEvent.TrackMuted, { source: Track.Source.Microphone }, local);
        }
      });
    };
    local.setScreenShareEnabled = function (on) {
      return wait(300).then(function () {
        if (room.state !== 'connected') throw new Error('desconectado');
        if (on && !local._screen) {
          local._screen = new FakeTrack('video', Track.Source.ScreenShare, 'Sua tela (simulada)');
          local.isScreenShareEnabled = true;
          room.emit(RoomEvent.LocalTrackPublished, { track: local._screen, source: Track.Source.ScreenShare, kind: 'video' }, local);
        } else if (!on && local._screen) {
          var t = local._screen;
          local._screen = null;
          local.isScreenShareEnabled = false;
          room.emit(RoomEvent.LocalTrackUnpublished, { track: t, source: Track.Source.ScreenShare, kind: 'video' }, local);
        }
      });
    };
    this.localParticipant = local;
  }
  Room.prototype = Object.create(Emitter.prototype);
  Room.prototype.constructor = Room;

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  Room.prototype._later = function (ms, fn) {
    var room = this;
    this._timers.push(setTimeout(function () { if (room.state === 'connected') fn(); }, ms));
  };

  Room.prototype._addRemote = function (p, emitJoin) {
    this.remoteParticipants.set(p.identity, p);
    if (emitJoin) this.emit(RoomEvent.ParticipantConnected, p);
    var audio = new FakeTrack('audio', Track.Source.Microphone);
    p.tracks.push(audio);
    this.emit(RoomEvent.TrackSubscribed, audio, { source: Track.Source.Microphone, kind: 'audio', track: audio }, p);
  };

  Room.prototype.connect = function (url, token) {
    var room = this;
    if (typeof url !== 'string' || url.indexOf('wss://') !== 0) return Promise.reject(new Error('url inválida'));
    if (typeof token !== 'string' || token.split('.').length !== 3) return Promise.reject(new Error('token inválido'));
    return wait(500).then(function () {
      room.state = 'connected';
      var lua = new Participant(LUA, 'Lua<Cheia>', true);
      var sombra = new Participant(SOMBRA, 'Sombra', false);
      room._addRemote(lua, false);
      room._addRemote(sombra, false);

      // Lua compartilha a tela
      room._later(900, function () {
        var screen = new FakeTrack('video', Track.Source.ScreenShare, 'Tela de Lua (simulada)');
        lua.isScreenShareEnabled = true;
        lua.tracks.push(screen);
        room.emit(RoomEvent.TrackSubscribed, screen, { source: Track.Source.ScreenShare, kind: 'video', track: screen }, lua);
      });

      // Eco entra depois
      room._later(2500, function () {
        room._addRemote(new Participant(ECO, 'Eco', true), true);
      });

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

  window.LivekitClient = { Room: Room, RoomEvent: RoomEvent, Track: Track, version: 'prévia' };
})();
