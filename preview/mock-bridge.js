/* Ponte simulada (window.ghostRank) para abrir a tela no navegador.
   Cenários pela query string: ?s=setup | on_track | unreachable | insufficient | goal | empty | error | syncing
   | signed_out | signed_in | unconfigured (estado da conta; o painel usa os dados de on_track)
   | group (dono de um grupo com 4 membros e chat) | no_group (conta sem grupo) | voice (igual a group, com voz)
   Extras só da prévia: ?tab=group|mmr abre a aba direto (os cenários de grupo já abrem em Grupo);
   ?join=1 entra sozinho na sala de voz (use com ?s=voice). Código de convite que funciona: FANTASMA23. */
(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var scenario = params.get('s') || 'on_track';
  var NOW_S = function () { return Math.floor(Date.now() / 1000); };

  var HEROES = {
    1: 'Anti-Mage', 8: 'Juggernaut', 14: 'Pudge', 21: 'Windranger', 26: 'Lion',
    35: 'Sniper', 44: 'Phantom Assassin', 74: 'Invoker', 86: 'Rubick', 114: 'Monkey King'
  };
  var HERO_IDS = [1, 8, 14, 21, 26, 35, 44, 74, 86, 114];

  // results: do mais antigo para o mais novo (true = vitória)
  var SCENARIOS = {
    setup:        { configured: false },
    on_track:     { start: 3000, goal: 3500, results: [1, 1, 0, 1, 1, 1, 0, 1, 1], baseline: [1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0] },
    unreachable:  { start: 3300, goal: 3600, results: [0, 1, 0, 0, 1, 0, 1, 0, 0, 1], baseline: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0] },
    insufficient: { start: 2000, goal: 2500, results: [1, 0, 1], baseline: [] },
    goal:         { start: 3300, goal: 3500, results: [1, 1, 1, 1, 1, 1, 1, 1], baseline: [1, 1, 0, 1, 1, 0, 1, 1] },
    empty:        { start: 2800, goal: 3200, results: [], baseline: [1, 1, 0, 1, 0, 1, 1, 0, 1, 1] },
    error:        { start: 3000, goal: 3500, results: [1, 1, 0, 1, 1, 1, 0, 1, 1], baseline: [1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0], syncError: 'O OpenDota está demorando para responder.' },
    syncing:      { start: 3000, goal: 3500, results: [1, 1, 0, 1, 1, 1, 0, 1, 1], baseline: [1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0], syncing: true }
  };

  // Cenários de conta usam o painel de on_track
  var AUTH_SCENARIOS = { signed_out: 1, signed_in: 1, unconfigured: 1, group: 1, no_group: 1, voice: 1 };
  var GROUP_SCENARIOS = { group: 1, no_group: 1, voice: 1 };
  var SIGNED_IN = { signed_in: 1, group: 1, no_group: 1, voice: 1 };
  if (AUTH_SCENARIOS[scenario]) SCENARIOS[scenario] = SCENARIOS.on_track;

  var cfg = SCENARIOS[scenario] || SCENARIOS.on_track;

  var DEMO_EMAIL = 'fantasma@exemplo.com';
  var DEMO_PASSWORD = 'senha-segura-1';
  var signedIn = !!SIGNED_IN[scenario];
  var auth = {
    status: scenario === 'unconfigured' ? 'unconfigured' : (signedIn ? 'signed_in' : 'signed_out'),
    email: signedIn ? DEMO_EMAIL : null,
    displayName: signedIn ? 'Fantasma Noturno' : null,
    mmrVisibility: signedIn ? 'group' : null,
    steamLinked: false
  };

  var state = {
    configured: cfg.configured !== false,
    profile: { accountId: 123456789, personaName: 'Fantasma<Noturno> & Cia' },
    gain: 25,
    goal: cfg.goal || 0,
    mmr: cfg.start || 0,
    start: cfg.start || 0,
    baseline: (cfg.baseline || []).map(Boolean),
    matches: [], // mais antigo primeiro
    sync: {
      status: cfg.syncing ? 'syncing' : (cfg.syncError ? 'error' : 'idle'),
      lastSyncAt: Date.now() - 4 * 60000,
      nextSyncAt: Date.now() + 120000,
      error: cfg.syncError || null,
      manualAvailableAt: null
    }
  };

  function addMatch(win, minsAgo, heroId, dur) {
    var delta = win ? state.gain : -state.gain;
    state.mmr += delta;
    state.matches.push({
      matchId: 8000000000 + state.matches.length,
      heroId: heroId,
      startTime: NOW_S() - Math.round(minsAgo * 60),
      duration: dur,
      win: !!win,
      delta: delta,
      mmrAfter: state.mmr
    });
  }

  function seedMatches() {
    var n = (cfg.results || []).length;
    (cfg.results || []).forEach(function (w, i) {
      var fromNewest = n - 1 - i;
      var minsAgo = 12 + fromNewest * 55 + (i % 3) * 9;
      addMatch(w, minsAgo, HERO_IDS[(i * 3) % HERO_IDS.length], 1500 + ((i * 337) % 1500));
    });
    if (scenario === 'on_track' || scenario === 'error' || scenario === 'syncing') {
      state.matches[state.matches.length - 1].heroId = 999; // herói desconhecido -> "Herói #999"
    }
  }

  function summarize() {
    var newest = state.matches.slice().reverse();
    var results = newest.map(function (m) { return m.win; }).concat(state.baseline).slice(0, 20);
    var size = results.length;
    var wins = results.filter(Boolean).length;
    var w = size ? wins / size : null;
    var remaining = state.goal - state.mmr;
    var status;
    var needed = null;
    if (remaining <= 0) status = 'goal_reached';
    else if (size < 5) status = 'insufficient_data';
    else if (w <= 0.5) status = 'unreachable';
    else {
      status = 'on_track';
      needed = Math.ceil(remaining / (state.gain * (2 * w - 1)));
    }
    var last = newest[0] || null;
    return {
      startMmr: state.start,
      currentMmr: state.mmr,
      goalMmr: state.goal,
      gainPerMatch: state.gain,
      remaining: remaining,
      lastMatch: last && { matchId: last.matchId, heroId: last.heroId, startTime: last.startTime, win: last.win, delta: last.delta },
      recentWinrate: w,
      sampleSize: size,
      matchesNeeded: needed,
      status: status,
      matches: newest
    };
  }

  /* ---------- grupo, chat e voz simulados ---------- */

  var ME = '11111111-1111-4111-8111-111111111111';
  var LUA = '22222222-2222-4222-8222-222222222222';
  var SOMBRA = '33333333-3333-4333-8333-333333333333';
  var ECO = '44444444-4444-4444-8444-444444444444';
  var INVITE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/;
  var INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var DEMO_INVITE = 'FANTASMA23';
  var MIN = 60000;

  function snap(start, current, goal, wins, losses, status, minsAgo) {
    var span = goal - start;
    var progress = current >= goal ? 1 : (span > 0 ? Math.max(0, Math.min(1, (current - start) / span)) : 0);
    return { current: current, goal: goal, start: start, wins: wins, losses: losses, status: status, progress: progress, updatedAt: Date.now() - minsAgo * MIN };
  }

  function friends() {
    return [
      { userId: LUA, displayName: 'Lua<Cheia>', isOwner: false, mmr: snap(2800, 3260, 3400, 31, 13, 'on_track', 40) },
      { userId: SOMBRA, displayName: 'Sombra', isOwner: false, mmr: snap(4000, 3950, 4500, 9, 11, 'unreachable', 180) },
      { userId: ECO, displayName: 'Eco', isOwner: false, mmr: null }
    ];
  }

  function seedChat() {
    var now = Date.now();
    return [
      { id: 101, userId: SOMBRA, displayName: 'Sombra', body: 'Ontem foi tenso, perdi 3 seguidas de suporte.', createdAt: now - 26 * 60 * MIN },
      { id: 102, userId: LUA, displayName: 'Lua<Cheia>', body: 'Bora uma ranqueada hoje à noite?', createdAt: now - 95 * MIN },
      { id: 103, userId: ME, displayName: 'Fantasma Noturno', body: 'Bora! Às 21h eu entro na sala.', createdAt: now - 90 * MIN },
      { id: 104, userId: ECO, displayName: 'Eco', body: '<b>isto não é HTML</b> e aparece como texto mesmo', createdAt: now - 60 * MIN },
      { id: 105, userId: LUA, displayName: 'Lua<Cheia>', body: 'Subi mais 50 hoje.\nFaltam só 140 para a meta!', createdAt: now - 41 * MIN },
      { id: 106, userId: SOMBRA, displayName: 'Sombra', body: 'Parabéns! Eu vou focar em offlane até subir o winrate, porque de suporte não está rolando. Alguém tem dica de herói?', createdAt: now - 12 * MIN }
    ];
  }

  var grp = null;
  var chatMessages = [];
  var chatSeq = 200;
  var chatStatus = 'idle';
  var voiceOn = scenario === 'voice';
  var sentTimes = [];
  var replies = 0;
  var lastSources = [];

  if (scenario === 'group' || scenario === 'voice') {
    grp = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Os Assombrados', ownerId: ME, others: friends() };
    chatMessages = seedChat();
  }

  function mySnapshot() {
    if (!state.configured) return null;
    var s = summarize();
    var wins = s.matches.filter(function (m) { return m.win; }).length;
    return snap(s.startMmr, s.currentMmr, s.goalMmr, wins, s.matches.length - wins, s.status, 3);
  }

  function groupView() {
    if (auth.status !== 'signed_in' || !grp) return null;
    var me = { userId: ME, displayName: auth.displayName || 'Fantasma Noturno', isMe: true, isOwner: grp.ownerId === ME, mmr: auth.mmrVisibility === 'nobody' ? null : mySnapshot() };
    var others = grp.others.map(function (m) {
      return { userId: m.userId, displayName: m.displayName, isMe: false, isOwner: grp.ownerId === m.userId, mmr: m.mmr };
    });
    return { id: grp.id, name: grp.name, isOwner: grp.ownerId === ME, members: [me].concat(others) };
  }

  function chatView() {
    if (auth.status !== 'signed_in' || !grp) return { messages: [], status: 'idle' };
    return {
      messages: chatMessages.map(function (m) {
        return { id: m.id, userId: m.userId, displayName: m.userId === ME ? (auth.displayName || m.displayName) : m.displayName, body: m.body, createdAt: m.createdAt, mine: m.userId === ME };
      }),
      status: chatStatus
    };
  }

  function getView() {
    var common = {
      heroes: HEROES,
      auth: JSON.parse(JSON.stringify(auth)),
      group: groupView(),
      chat: chatView(),
      voice: { available: voiceOn && auth.status === 'signed_in' && !!grp }
    };
    var base;
    if (!state.configured) {
      base = { configured: false, profile: null, summary: null, sync: { status: 'idle', lastSyncAt: null, nextSyncAt: null, error: null, manualAvailableAt: null } };
    } else {
      base = { configured: true, profile: state.profile, summary: summarize(), sync: JSON.parse(JSON.stringify(state.sync)) };
    }
    Object.keys(common).forEach(function (k) { base[k] = common[k]; });
    return base;
  }

  function needSignedIn() {
    return auth.status === 'signed_in' ? null : fail('Entre na sua conta para usar o grupo.');
  }

  function randomCode() {
    var out = '';
    for (var i = 0; i < 10; i++) out += INVITE_ALPHABET.charAt(Math.floor(Math.random() * INVITE_ALPHABET.length));
    return out;
  }

  // Miniaturas desenhadas localmente (data:image/jpeg); a última é propositalmente inválida
  function thumb(label, hue) {
    var c = document.createElement('canvas');
    c.width = 320;
    c.height = 180;
    var ctx = c.getContext('2d');
    if (!ctx) return '';
    ctx.fillStyle = 'hsl(' + hue + ', 35%, 16%)';
    ctx.fillRect(0, 0, 320, 180);
    ctx.fillStyle = 'hsl(' + hue + ', 45%, 32%)';
    ctx.fillRect(16, 16, 288, 22);
    ctx.fillRect(16, 50, 180, 110);
    ctx.fillStyle = 'hsl(' + hue + ', 60%, 70%)';
    ctx.font = '600 18px system-ui, sans-serif';
    ctx.fillText(label, 210, 110);
    return c.toDataURL('image/jpeg', 0.7);
  }

  var listeners = [];
  function emit() {
    var v = getView();
    listeners.slice().forEach(function (cb) { cb(v); });
  }
  function ok() { return { ok: true, view: getView() }; }
  function fail(msg) { return { ok: false, error: msg }; }
  function delay(fn, ms) {
    return new Promise(function (resolve) { setTimeout(function () { resolve(fn()); }, ms); });
  }

  function intIn(value, min, max) {
    var s = String(value == null ? '' : value).trim();
    if (!/^\d+$/.test(s)) return null;
    var n = Number(s);
    return n >= min && n <= max ? n : null;
  }

  function emailOk(v) { return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

  seedMatches();
  if (cfg.syncing) {
    // simula o fim da sincronização depois de alguns segundos
    setTimeout(function () {
      state.sync.status = 'idle';
      state.sync.lastSyncAt = Date.now();
      emit();
    }, 6000);
  }

  // Só da prévia: abre a aba pedida e, com ?join=1, entra na sala de voz
  var firstViewServed = false;
  function previewExtras() {
    var tab = params.get('tab') || (GROUP_SCENARIOS[scenario] ? 'group' : null);
    var btn = tab === 'group' ? document.getElementById('tab-group') : (tab === 'mmr' ? document.getElementById('tab-mmr') : null);
    if (btn) btn.click();
    if (params.get('join') === '1') {
      var join = document.getElementById('btn-voice-join');
      if (join && !join.closest('[hidden]')) join.click();
    }
  }

  window.ghostRank = {
    getView: function () {
      return delay(ok, 150).then(function (res) {
        if (!firstViewServed) {
          firstViewServed = true;
          setTimeout(previewExtras, 0);
        }
        return res;
      });
    },

    setup: function (data) {
      return delay(function () {
        var acc = String((data && data.accountInput) || '').trim();
        if (!acc) return fail('Informe o seu Account ID, SteamID64 ou o link do seu perfil.');
        if (/steamcommunity\.com\/id\//i.test(acc)) {
          return fail('Esse link usa o apelido do Steam. Preciso do número: abra seu perfil no OpenDota ou Dotabuff e copie o ID da URL.');
        }
        if (!/\d{3,}/.test(acc)) return fail('Não reconheci esse ID. Use só números, um SteamID64 ou o link do perfil.');
        if (intIn(data.startMmr, 0, 20000) === null) return fail('O MMR inicial precisa ser um número inteiro de 0 a 20000.');
        if (intIn(data.goalMmr, 0, 20000) === null) return fail('A meta de MMR precisa ser um número inteiro de 0 a 20000.');
        var gain = intIn(data.gainPerMatch, 1, 100);
        if (gain === null) return fail('O ganho por partida precisa ser um número inteiro de 1 a 100.');
        state.configured = true;
        state.gain = gain;
        state.mmr = intIn(data.startMmr, 0, 20000);
        state.start = state.mmr;
        state.goal = intIn(data.goalMmr, 0, 20000);
        state.baseline = [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1].map(Boolean);
        state.matches = [];
        state.sync = { status: 'idle', lastSyncAt: Date.now(), nextSyncAt: Date.now() + 180000, error: null, manualAvailableAt: Date.now() + 30000 };
        return ok();
      }, 700);
    },

    sync: function () {
      return delay(function () {
        var now = Date.now();
        if (state.sync.manualAvailableAt && state.sync.manualAvailableAt > now) {
          return fail('Aguarde alguns segundos para atualizar de novo.');
        }
        if (scenario === 'error') {
          state.sync.status = 'error';
          state.sync.error = 'O OpenDota está demorando para responder.';
        } else {
          state.sync.status = 'idle';
          state.sync.error = null;
          addMatch(Math.random() < 0.6, 2, HERO_IDS[Math.floor(Math.random() * HERO_IDS.length)], 1800 + Math.floor(Math.random() * 900));
        }
        state.sync.lastSyncAt = now;
        state.sync.nextSyncAt = now + 180000;
        state.sync.manualAvailableAt = now + 30000;
        return ok();
      }, 900);
    },

    correctMmr: function (mmr) {
      return delay(function () {
        var v = intIn(mmr, 0, 20000);
        if (v === null) return fail('O MMR precisa ser um número inteiro de 0 a 20000.');
        state.mmr = v;
        emit();
        return ok();
      }, 200);
    },

    updateSettings: function (data) {
      return delay(function () {
        var goal = intIn(data && data.goalMmr, 0, 20000);
        if (goal === null) return fail('A meta de MMR precisa ser um número inteiro de 0 a 20000.');
        var gain = intIn(data && data.gainPerMatch, 1, 100);
        if (gain === null) return fail('O ganho por partida precisa ser um número inteiro de 1 a 100.');
        state.goal = goal;
        state.gain = gain;
        return ok();
      }, 200);
    },

    reset: function () {
      return delay(function () {
        state.configured = false;
        state.matches = [];
        state.baseline = [];
        return ok();
      }, 300);
    },

    signUp: function (data) {
      return delay(function () {
        if (auth.status === 'unconfigured') return fail('As contas ainda não foram configuradas.');
        var email = String((data && data.email) || '').trim().toLowerCase();
        var pw = String((data && data.password) || '');
        if (!emailOk(email)) return fail('Informe um e-mail válido.');
        if (pw.length < 10) return fail('A senha precisa ter pelo menos 10 caracteres.');
        if (pw.length > 72) return fail('A senha pode ter no máximo 72 caracteres.');
        if (/^(.)\1+$/.test(pw)) return fail('Essa senha é fraca demais. Misture letras, números e símbolos.');
        return ok(); // mesma resposta exista a conta ou não
      }, 700);
    },

    signIn: function (data) {
      return delay(function () {
        if (auth.status === 'unconfigured') return fail('As contas ainda não foram configuradas.');
        var email = String((data && data.email) || '').trim().toLowerCase();
        var pw = String((data && data.password) || '');
        if (!emailOk(email)) return fail('Informe um e-mail válido.');
        if (email !== DEMO_EMAIL || pw !== DEMO_PASSWORD) return fail('E-mail ou senha incorretos.');
        auth.status = 'signed_in';
        auth.email = email;
        auth.displayName = auth.displayName || 'Fantasma Noturno';
        auth.mmrVisibility = auth.mmrVisibility || 'friends';
        return ok();
      }, 700);
    },

    createGroup: function (name) {
      return delay(function () {
        var e = needSignedIn(); if (e) return e;
        if (grp) return fail('Você já está em um grupo. Saia dele antes de criar outro.');
        var n = String(name == null ? '' : name).trim();
        if (n.length < 2 || n.length > 32) return fail('O nome do grupo precisa ter de 2 a 32 caracteres.');
        if (/[<>\u0000-\u001f]/.test(n)) return fail('O nome do grupo não pode ter os caracteres < ou >.');
        grp = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: n, ownerId: ME, others: [] };
        chatMessages = [];
        return ok();
      }, 500);
    },

    joinGroup: function (code) {
      return delay(function () {
        var e = needSignedIn(); if (e) return e;
        if (grp) return fail('Você já está em um grupo. Saia dele antes de entrar em outro.');
        var c = String(code == null ? '' : code).trim().toUpperCase();
        if (!INVITE_RE.test(c)) return fail('O código tem 10 letras e números (sem I, L, O, 0 e 1), como K7M2QX9PTA.');
        if (c !== DEMO_INVITE) return fail('Esse convite não vale: o código está errado, expirou ou já foi usado.');
        grp = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Os Assombrados', ownerId: LUA, others: friends() };
        grp.others[0].isOwner = true;
        chatMessages = seedChat();
        return ok();
      }, 600);
    },

    leaveGroup: function () {
      return delay(function () {
        var e = needSignedIn(); if (e) return e;
        if (!grp) return fail('Você não está em nenhum grupo.');
        grp = null;
        chatMessages = [];
        return ok();
      }, 400);
    },

    createInvite: function () {
      return delay(function () {
        var e = needSignedIn(); if (e) return e;
        if (!grp) return fail('Você não está em nenhum grupo.');
        if (grp.ownerId !== ME) return fail('Só o dono do grupo pode criar convites.');
        return { ok: true, code: randomCode(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * MIN).toISOString() };
      }, 400);
    },

    removeMember: function (userId) {
      return delay(function () {
        var e = needSignedIn(); if (e) return e;
        if (!grp) return fail('Você não está em nenhum grupo.');
        if (grp.ownerId !== ME) return fail('Só o dono do grupo pode remover pessoas.');
        if (typeof userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(userId)) return fail('Pessoa inválida.');
        if (userId === ME) return fail('Você não pode remover a si mesmo. Use "Sair do grupo".');
        var before = grp.others.length;
        grp.others = grp.others.filter(function (m) { return m.userId !== userId; });
        if (grp.others.length === before) return fail('Essa pessoa não está mais no grupo.');
        return ok();
      }, 400);
    },

    refreshGroup: function () {
      return delay(function () {
        var e = needSignedIn(); if (e) return e;
        return ok();
      }, 300);
    },

    sendMessage: function (body) {
      return delay(function () {
        var e = needSignedIn(); if (e) return e;
        if (!grp) return fail('Entre em um grupo para usar o chat.');
        var b = String(body == null ? '' : body).trim();
        if (!b) return fail('Escreva alguma coisa antes de enviar.');
        if (b.length > 1000) return fail('A mensagem pode ter no máximo 1000 caracteres.');
        var now = Date.now();
        sentTimes = sentTimes.filter(function (t) { return now - t < 10000; });
        if (sentTimes.length >= 10) return fail('Calma! Você mandou muitas mensagens seguidas. Espere alguns segundos.');
        sentTimes.push(now);
        chatMessages.push({ id: ++chatSeq, userId: ME, displayName: auth.displayName, body: b, createdAt: now });
        if (chatMessages.length > 200) chatMessages = chatMessages.slice(-200);
        if (replies < 3 && grp.others.length) {
          replies++;
          var who = grp.others[0];
          setTimeout(function () {
            if (!grp) return;
            chatMessages.push({ id: ++chatSeq, userId: who.userId, displayName: who.displayName, body: ['Fechado!', 'Kkkk boa', 'Tô entrando na sala.'][replies - 1] || 'Beleza.', createdAt: Date.now() });
            emit();
          }, 2500);
        }
        return ok();
      }, 250);
    },

    voiceToken: function () {
      return delay(function () {
        var e = needSignedIn(); if (e) return e;
        if (!grp) return fail('Entre em um grupo para usar a voz.');
        if (!voiceOn) return fail('A voz ainda não foi configurada.');
        return { ok: true, url: 'wss://ghost-rank-previa.livekit.cloud', token: 'cabecalho.conteudo.assinatura' };
      }, 300);
    },

    listScreenSources: function () {
      return delay(function () {
        var e = needSignedIn(); if (e) return e;
        lastSources = [
          { id: 'screen:0:0', name: 'Tela inteira 1', kind: 'screen', thumbnail: thumb('Tela 1', 160) },
          { id: 'screen:1:0', name: 'Tela inteira 2', kind: 'screen', thumbnail: thumb('Tela 2', 220) },
          { id: 'window:1234:0', name: 'Dota 2', kind: 'window', thumbnail: thumb('Dota 2', 0) },
          { id: 'window:5678:0', name: 'Navegador com miniatura recusada', kind: 'window', thumbnail: 'https://exemplo.invalid/miniatura.png' }
        ];
        return { ok: true, sources: lastSources };
      }, 500);
    },

    pickScreenSource: function (sourceId) {
      return delay(function () {
        var e = needSignedIn(); if (e) return e;
        if (typeof sourceId !== 'string' || sourceId.length > 200) return fail('Tela inválida.');
        var found = lastSources.some(function (s) { return s.id === sourceId; });
        if (!found) return fail('Essa tela não está mais disponível. Escolha de novo.');
        return { ok: true };
      }, 150);
    },

    linkSteam: function () {
      return delay(function () {
        var e = needSignedIn(); if (e) return e;
        if (auth.steamLinked) return fail('Sua conta Steam já está vinculada.');
        // simula a volta do navegador alguns segundos depois
        setTimeout(function () {
          if (auth.status !== 'signed_in') return;
          auth.steamLinked = true;
          emit();
        }, 3000);
        return { ok: true };
      }, 400);
    },

    signOut: function () {
      return delay(function () {
        auth.status = 'signed_out';
        auth.email = null;
        auth.displayName = null;
        auth.mmrVisibility = null;
        return ok();
      }, 300);
    },

    recover: function (data) {
      return delay(function () {
        var email = String((data && data.email) || '').trim().toLowerCase();
        if (!emailOk(email)) return fail('Informe um e-mail válido.');
        return ok();
      }, 600);
    },

    updateProfile: function (data) {
      return delay(function () {
        if (auth.status !== 'signed_in') return fail('Entre na sua conta para continuar.');
        data = data || {};
        if (data.displayName !== undefined) {
          var n = String(data.displayName).trim();
          if (n.length < 2 || n.length > 24) return fail('O apelido precisa ter de 2 a 24 caracteres.');
          if (/[<>\u0000-\u001f]/.test(n)) return fail('O apelido não pode ter os caracteres < ou >.');
          auth.displayName = n;
        }
        if (data.mmrVisibility !== undefined) {
          if (['friends', 'group', 'nobody'].indexOf(data.mmrVisibility) < 0) return fail('Escolha quem pode ver o seu MMR.');
          auth.mmrVisibility = data.mmrVisibility;
        }
        return ok();
      }, 500);
    },

    deleteAccount: function () {
      return delay(function () {
        if (auth.status !== 'signed_in') return fail('Entre na sua conta para continuar.');
        auth.status = 'signed_out';
        auth.email = null;
        auth.displayName = null;
        auth.mmrVisibility = null;
        return ok();
      }, 800);
    },

    onUpdate: function (cb) {
      listeners.push(cb);
      return function () { listeners = listeners.filter(function (l) { return l !== cb; }); };
    }
  };
})();
