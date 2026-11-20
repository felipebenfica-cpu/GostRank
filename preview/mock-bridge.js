/* Ponte simulada (window.ghostRank) para abrir a tela no navegador.
   Cenários pela query string: ?s=setup | on_track | unreachable | insufficient | goal | empty | error | syncing */
(function () {
  'use strict';

  var scenario = new URLSearchParams(window.location.search).get('s') || 'on_track';
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

  var cfg = SCENARIOS[scenario] || SCENARIOS.on_track;

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

  function getView() {
    if (!state.configured) {
      return { configured: false, profile: null, summary: null, heroes: HEROES, sync: { status: 'idle', lastSyncAt: null, nextSyncAt: null, error: null, manualAvailableAt: null } };
    }
    return {
      configured: true,
      profile: state.profile,
      summary: summarize(),
      heroes: HEROES,
      sync: JSON.parse(JSON.stringify(state.sync))
    };
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

  seedMatches();
  if (cfg.syncing) {
    // simula o fim da sincronização depois de alguns segundos
    setTimeout(function () {
      state.sync.status = 'idle';
      state.sync.lastSyncAt = Date.now();
      emit();
    }, 6000);
  }

  window.ghostRank = {
    getView: function () { return delay(ok, 150); },

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

    onUpdate: function (cb) {
      listeners.push(cb);
      return function () { listeners = listeners.filter(function (l) { return l !== cb; }); };
    }
  };
})();
