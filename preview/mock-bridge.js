/* Ponte simulada (window.ghostRank) para abrir a tela no navegador, sem rede.
   Simula TODA a ponte da Etapa 6 (docs/plans/etapa-6-discord-completo.md): vários servidores, categorias,
   canais, cargos, amigos, busca de pessoas, DMs, mensagens com respostas/reações/anexos/fixadas/menções,
   "digitando…", presença, quem está na voz, preferências e convites ilimitados com prévia.
   Cenários pela query string (?s=):
     MMR: setup | on_track | unreachable | insufficient | goal | empty | error | syncing (sem conta)
     Conta: signed_out | signed_in | unconfigured | no_group (logado sem servidores)
     Discord: home (amigos e pedidos) | server (servidor aberto) | dm (conversa aberta) | group (= server)
              voice (servidor com gente na voz) | settings (abre as configurações) | server_settings | invite
   Extras: ?join=1 entra no canal de voz (com ?s=voice ou server) e assiste à transmissão.
   Login de demonstração: qualquer e-mail válido e qualquer senha entram.
   Convite: qualquer código válido (10 letras/números sem I, L, O, 0, 1) funciona; FANTASMA23 = "Os Assombrados". */
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
  var AUTH_SCENARIOS = { signed_out: 1, signed_in: 1, unconfigured: 1, group: 1, no_group: 1, voice: 1, home: 1, server: 1, dm: 1, settings: 1, server_settings: 1, invite: 1 };
  var SIGNED_IN = { signed_in: 1, group: 1, no_group: 1, voice: 1, home: 1, server: 1, dm: 1, settings: 1, server_settings: 1, invite: 1 };
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
    username: signedIn ? 'fantasma.noturno' : null,
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

  /* ---------- Etapa 6: social, servidores, mensagens e voz simulados ---------- */

  var MIN = 60000;
  var NOW = Date.now();
  var INVITE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/;
  var INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var DEMO_INVITE = 'FANTASMA23';

  var seq = 1000;
  function uuid() {
    seq++;
    var hex = ('00000000' + seq.toString(16)).slice(-8);
    return hex + '-0000-4000-8000-' + ('000000000000' + (seq * 7919).toString(16)).slice(-12);
  }

  var ME = '11111111-1111-4111-8111-111111111111';
  var LUA = '22222222-2222-4222-8222-222222222222';
  var SOMBRA = '33333333-3333-4333-8333-333333333333';
  var ECO = '44444444-4444-4444-8444-444444444444';
  var NEBULA = '55555555-5555-4555-8555-555555555555';
  var VULTO = '66666666-6666-4666-8666-666666666666';
  var ASSOMBRO = '77777777-7777-4777-8777-777777777777';
  var BRUMA = '88888888-8888-4888-8888-888888888888';
  var CORVO = '99999999-9999-4999-8999-999999999999';
  var ESPECTRO = 'aaaaaaaa-0000-4000-8000-00000000000a';

  // Avatares e anexos desenhados localmente (data:image/png)
  function drawAvatar(hue, letter) {
    try {
      var c = document.createElement('canvas');
      c.width = 128;
      c.height = 128;
      var ctx = c.getContext('2d');
      if (!ctx) return null;
      var g = ctx.createLinearGradient(0, 0, 128, 128);
      g.addColorStop(0, 'hsl(' + hue + ', 70%, 55%)');
      g.addColorStop(1, 'hsl(' + ((hue + 60) % 360) + ', 60%, 30%)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = '700 64px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letter, 64, 70);
      return c.toDataURL('image/png');
    } catch (e) { return null; }
  }

  function drawShot(label, hue, w, h) {
    try {
      var c = document.createElement('canvas');
      c.width = w || 480;
      c.height = h || 270;
      var ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = 'hsl(' + hue + ', 30%, 14%)';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = 'hsl(' + hue + ', 45%, 28%)';
      for (var i = 0; i < 6; i++) ctx.fillRect(20 + i * 74, c.height - 40 - (i * 37 % 150), 52, 40 + (i * 37 % 150));
      ctx.strokeStyle = 'hsl(' + hue + ', 80%, 70%)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(20, c.height - 60);
      ctx.lineTo(140, c.height - 120);
      ctx.lineTo(260, c.height - 100);
      ctx.lineTo(400, c.height - 200);
      ctx.stroke();
      ctx.fillStyle = 'hsl(' + hue + ', 70%, 85%)';
      ctx.font = '600 22px system-ui, sans-serif';
      ctx.fillText(label, 20, 36);
      return c.toDataURL('image/png');
    } catch (e) { return null; }
  }

  // Miniaturas do seletor de tela (data:image/jpeg); a última é propositalmente inválida
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

  function snap(start, current, goal, wins, losses, status, minsAgo) {
    var span = goal - start;
    var progress = current >= goal ? 1 : (span > 0 ? Math.max(0, Math.min(1, (current - start) / span)) : 0);
    return { current: current, goal: goal, start: start, wins: wins, losses: losses, status: status, progress: progress, updatedAt: Date.now() - minsAgo * MIN };
  }

  var users = {};
  function addUser(id, username, displayName, color, extra) {
    var u = { id: id, username: username, displayName: displayName, avatarColor: color, avatarUrl: null, about: '', customStatus: null, status: 'online' };
    Object.keys(extra || {}).forEach(function (k) { u[k] = extra[k]; });
    users[id] = u;
    return u;
  }

  addUser(ME, 'fantasma.noturno', 'Fantasma Noturno', 0, { about: 'Suporte de coração. Subindo de MMR uma partida por vez.' });
  addUser(LUA, 'luacheia', 'Lua<Cheia>', 1, { about: 'Mid ou nada. Invoker main desde 2014.', customStatus: 'Faltam 140 para a meta!' });
  addUser(SOMBRA, 'sombra', 'Sombra', 2, { about: 'Offlane agora. Mars > todos.', customStatus: 'Treinando Mars' });
  addUser(ECO, 'eco', 'Eco', 3, {});
  addUser(NEBULA, 'nebulosa', 'Nebulosa', 5, { about: 'Pos 5 que compra ward.' });
  addUser(VULTO, 'vulto_br', 'Vulto', 4, { customStatus: 'Jogando Dota 2' });
  addUser(ASSOMBRO, 'assombro', 'Assombro', 6, {});
  addUser(BRUMA, 'bruma.sp', 'Bruma', 7, { about: 'Calibrando de novo :(' });
  addUser(CORVO, 'corvo', 'Corvo', 2, {});
  addUser(ESPECTRO, 'espectro', 'Espectro', 1, {});
  users[LUA].avatarUrl = drawAvatar(270, 'L');
  users[NEBULA].avatarUrl = drawAvatar(320, 'N');

  var presence = {};
  presence[LUA] = 'online';
  presence[SOMBRA] = 'dnd';
  presence[ECO] = 'idle';
  presence[NEBULA] = 'online';
  presence[VULTO] = 'online';
  presence[ASSOMBRO] = 'offline';
  presence[BRUMA] = 'offline';
  presence[CORVO] = 'online';
  presence[ESPECTRO] = 'offline';

  var MMRS = {};
  MMRS[LUA] = snap(2800, 3260, 3400, 31, 13, 'on_track', 40);
  MMRS[SOMBRA] = snap(4000, 3950, 4500, 9, 11, 'unreachable', 180);
  MMRS[NEBULA] = snap(1800, 2100, 2500, 14, 9, 'on_track', 300);
  MMRS[VULTO] = snap(5200, 5600, 5600, 22, 10, 'goal_reached', 20);
  MMRS[BRUMA] = snap(2400, 2380, 3000, 3, 4, 'insufficient_data', 900);

  // relação do ponto de vista de ME
  var relations = {};
  function rel(id, kind, minsAgo) { relations[id] = { relation: kind, since: Date.now() - (minsAgo || 0) * MIN }; }
  rel(LUA, 'friend', 60 * 24 * 40);
  rel(SOMBRA, 'friend', 60 * 24 * 12);
  rel(ECO, 'friend', 60 * 24 * 3);
  rel(VULTO, 'friend', 60 * 24 * 90);
  rel(NEBULA, 'pending_in', 25);
  rel(BRUMA, 'pending_in', 300);
  rel(CORVO, 'pending_out', 60);
  rel(ESPECTRO, 'blocked', 60 * 24 * 7);
  var autoAccept = {}; // quem aceita sozinho na prévia (alguns segundos depois)
  autoAccept[ASSOMBRO] = true;
  autoAccept[CORVO] = true;

  /* servidores */
  var servers = [];
  function makeServer(id, name, color, ownerId, members) {
    var s = { id: id, name: name, iconColor: color, iconUrl: null, ownerId: ownerId, members: members, categories: [], channels: [], invites: [], bans: [] };
    servers.push(s);
    return s;
  }
  function addCategory(s, name) {
    var c = { id: uuid(), name: name, position: s.categories.length };
    s.categories.push(c);
    return c;
  }
  function addChannel(s, kind, name, categoryId, topic) {
    var c = { id: uuid(), kind: kind, name: name, topic: topic || null, categoryId: categoryId || null, position: s.channels.length };
    s.channels.push(c);
    return c;
  }

  var SRV1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  var SRV2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  var SRV3 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  var s1 = makeServer(SRV1, 'Os Assombrados', 0, ME, [
    { userId: ME, role: 'owner', nickname: null },
    { userId: LUA, role: 'admin', nickname: null },
    { userId: SOMBRA, role: 'member', nickname: 'Sombra do Offlane' },
    { userId: ECO, role: 'member', nickname: null },
    { userId: VULTO, role: 'member', nickname: null },
    { userId: ASSOMBRO, role: 'member', nickname: null },
    { userId: BRUMA, role: 'member', nickname: null }
  ]);
  var catInfo = addCategory(s1, 'Informações');
  var chRegras = addChannel(s1, 'text', 'regras', catInfo.id, 'Leia antes de chamar para a ranqueada.');
  var catText = addCategory(s1, 'Canais de texto');
  var chGeral = addChannel(s1, 'text', 'geral', catText.id, 'Conversa livre dos fantasmas. Sejam legais!');
  var chRank = addChannel(s1, 'text', 'ranqueadas', catText.id, 'Marque horário e chame o time.');
  var chClips = addChannel(s1, 'text', 'jogadas-e-clipes', catText.id, null);
  var catVoice = addCategory(s1, 'Canais de voz');
  var vcGeral = addChannel(s1, 'voice', 'Geral', catVoice.id);
  var vcRank = addChannel(s1, 'voice', 'Ranqueada 5x5', catVoice.id);
  var vcAfk = addChannel(s1, 'voice', 'AFK', catVoice.id);
  s1.invites.push({ code: 'FANTASMA23', createdBy: ME, expiresAt: null, maxUses: null, uses: 4 });
  s1.bans.push({ userId: ESPECTRO, bannedAt: Date.now() - 60 * 24 * 7 * MIN });

  var s2 = makeServer(SRV2, 'Liga do Ancient', 2, LUA, [
    { userId: LUA, role: 'owner', nickname: null },
    { userId: ME, role: 'member', nickname: 'Fantasminha' },
    { userId: NEBULA, role: 'admin', nickname: null },
    { userId: CORVO, role: 'member', nickname: null }
  ]);
  var c2t = addCategory(s2, 'Texto');
  var c2geral = addChannel(s2, 'text', 'bate-papo', c2t.id, 'Campeonato amador de sábado.');
  var c2tab = addChannel(s2, 'text', 'tabela', c2t.id);
  var c2v = addCategory(s2, 'Voz');
  addChannel(s2, 'voice', 'Sala do time', c2v.id);

  var s3 = makeServer(SRV3, 'Patch Notes BR', 5, VULTO, [
    { userId: VULTO, role: 'owner', nickname: null },
    { userId: ME, role: 'member', nickname: null },
    { userId: SOMBRA, role: 'member', nickname: null }
  ]);
  var s3geral = addChannel(s3, 'text', 'novidades', null, 'O que mudou no último patch.');
  addChannel(s3, 'voice', 'Discussão', null);

  /* mensagens: alvo -> lista (antiga -> nova) */
  var messages = {};
  var reads = {};
  var msgSeq = 100;

  function addMsg(target, authorId, body, minsAgo, extra) {
    var m = { id: ++msgSeq, authorId: authorId, body: body, createdAt: Date.now() - minsAgo * MIN, editedAt: null, replyTo: null, attachments: [], reactions: {}, pinned: false, mentions: [] };
    Object.keys(extra || {}).forEach(function (k) { m[k] = extra[k]; });
    var at = String(body).match(/<@([0-9a-f-]{36})>/gi) || [];
    at.forEach(function (h) {
      var id = h.slice(2, -1).toLowerCase();
      if (users[id] && m.mentions.indexOf(id) < 0) m.mentions.push(id);
    });
    (messages[target] = messages[target] || []).push(m);
    return m;
  }

  var T_GERAL = 'c:' + chGeral.id;
  addMsg('c:' + chRegras.id, ME, '**Regras dos Assombrados**\n1. Sem flame no chat.\n2. Chamou para ranqueada, aparece.\n3. Clipes bons vão em #jogadas-e-clipes.', 60 * 24 * 20, { pinned: true });
  addMsg(T_GERAL, SOMBRA, 'Ontem foi tenso, perdi 3 seguidas de suporte.', 26 * 60);
  var mBora = addMsg(T_GERAL, LUA, 'Bora uma ranqueada hoje à noite?', 95);
  addMsg(T_GERAL, ME, 'Bora! Às 21h eu entro na sala.', 90, { replyTo: mBora.id, reactions: (function () { var r = {}; r['🔥'] = [LUA, SOMBRA]; r['👍'] = [ECO]; return r; })() });
  addMsg(T_GERAL, ECO, '<b>isto não é HTML</b> e aparece como texto mesmo', 60);
  var mMeta = addMsg(T_GERAL, LUA, 'Subi mais 50 hoje.\nFaltam só **140** para a meta!', 41, { pinned: true, attachments: [{ url: drawShot('Lua — MMR 3260', 270), name: 'mmr-hoje.png', size: 48211, mime: 'image/png', width: 480, height: 270, isImage: true }] });
  addMsg(T_GERAL, SOMBRA, 'Parabéns! Eu vou focar em offlane até subir o winrate, porque de suporte não está rolando. Alguém tem dica de herói?', 12, { reactions: (function () { var r = {}; r['💪'] = [LUA]; return r; })() });
  addMsg(T_GERAL, SOMBRA, 'Pensei em ~~Bristleback~~ Mars ou Primal Beast.', 11);
  addMsg(T_GERAL, SOMBRA, 'Ou Underlord, que segura bem a lane.', 10, { editedAt: Date.now() - 9 * MIN });
  addMsg(T_GERAL, ECO, '`Mars` é ótimo nesse patch. Confia.', 6, { replyTo: mMeta.id });
  addMsg(T_GERAL, LUA, '<@' + ME + '> você leva o Lion hoje? ||eu vou de Invoker de novo||', 4);
  addMsg(T_GERAL, VULTO, 'Planilha das ranqueadas: https://exemplo.com/planilha-dos-fantasmas', 3, { attachments: [{ url: '', name: 'replay-8000000123.dem', size: 52428800, mime: 'application/octet-stream', isImage: false }] });
  reads[T_GERAL] = messages[T_GERAL][7].id;

  addMsg('c:' + chRank.id, LUA, 'Sábado 20h: 5x5 contra o pessoal da Liga do Ancient. Quem topa?', 300);
  addMsg('c:' + chRank.id, VULTO, 'Eu topo, levo meu carry.', 280);
  addMsg('c:' + chRank.id, LUA, '<@' + ME + '> confirma o suporte?', 30);
  reads['c:' + chRank.id] = messages['c:' + chRank.id][1].id;

  addMsg('c:' + chClips.id, SOMBRA, 'Olha esse Black Hole de 5 que eu tomei kkk', 60 * 30, { attachments: [{ url: drawShot('Enigma 5-man', 200), name: 'clipe-enigma.png', size: 91234, mime: 'image/png', width: 480, height: 270, isImage: true }] });
  reads['c:' + chClips.id] = messages['c:' + chClips.id][0].id;

  addMsg('c:' + c2geral.id, NEBULA, 'Tabela atualizada! Somos o 3º lugar.', 120);
  addMsg('c:' + c2geral.id, LUA, '<@' + ME + '> sábado tem jogo, não esquece.', 50);
  addMsg('c:' + c2tab.id, NEBULA, '1. Ancient Legends — 9 pts\n2. Roshan Hunters — 7 pts\n3. **Fantasmas** — 6 pts', 200, { pinned: true });
  addMsg('c:' + s3geral.id, VULTO, 'Patch novo: Mars levou nerf no Spear. RIP Sombra.', 200);
  ['c:' + s3geral.id, 'c:' + c2tab.id].forEach(function (t) { reads[t] = messages[t][messages[t].length - 1].id; });

  /* DMs */
  var dms = [];
  function addDm(userId, minsAgo) {
    var d = { id: uuid(), userId: userId, lastMessageAt: Date.now() - minsAgo * MIN };
    dms.push(d);
    return d;
  }
  var dmLua = addDm(LUA, 2);
  var dmSombra = addDm(SOMBRA, 60 * 5);
  var dmVulto = addDm(VULTO, 60 * 24 * 2);
  var T_DMLUA = 'd:' + dmLua.id;
  addMsg(T_DMLUA, LUA, 'E aí, viu o patch?', 60 * 3);
  addMsg(T_DMLUA, ME, 'Vi! Nerfaram o Mars, o Sombra vai chorar.', 60 * 3 - 2);
  addMsg(T_DMLUA, LUA, 'Kkkkk. Bora fazer duo agora?', 5);
  addMsg(T_DMLUA, LUA, 'Te espero na sala de voz 👻', 2);
  reads[T_DMLUA] = messages[T_DMLUA][1].id;
  addMsg('d:' + dmSombra.id, SOMBRA, 'Valeu pela dica de herói ontem!', 60 * 5);
  reads['d:' + dmSombra.id] = messages['d:' + dmSombra.id][0].id;
  addMsg('d:' + dmVulto.id, ME, 'Manda a planilha depois?', 60 * 24 * 2 + 5);
  addMsg('d:' + dmVulto.id, VULTO, 'Mandei no #geral!', 60 * 24 * 2);
  reads['d:' + dmVulto.id] = messages['d:' + dmVulto.id][1].id;

  /* voz: canal -> participantes */
  var voiceStates = {};
  var withVoice = scenario === 'voice' || scenario === 'server' || scenario === 'group';
  if (withVoice) {
    voiceStates[vcGeral.id] = [
      { userId: LUA, muted: false, deafened: false, streaming: true, video: false },
      { userId: SOMBRA, muted: true, deafened: false, streaming: false, video: false },
      { userId: VULTO, muted: false, deafened: false, streaming: false, video: true }
    ];
    voiceStates[vcAfk.id] = [{ userId: ECO, muted: true, deafened: true, streaming: false, video: false }];
  }

  var prefs = {
    notifications: { desktop: true, sounds: true, mentionsOnly: false },
    muted: ['c:' + chClips.id],
    voice: { inputDeviceId: 'default', outputDeviceId: 'default', mode: 'vad', pttKey: 'KeyV', sensitivity: -50, autoSensitivity: true, noiseSuppression: true, echoCancellation: true, inputVolume: 100, outputVolume: 100, cameraDeviceId: 'default' },
    appearance: { theme: 'dark', fontScale: 100, compact: false }
  };
  if (params.get('theme') && { dark: 1, midnight: 1, light: 1 }[params.get('theme')]) prefs.appearance.theme = params.get('theme');

  var myProfile = users[ME];
  myProfile.status = 'online';

  /* seleção inicial por cenário */
  var selection = { mode: 'home', tab: 'mmr' };
  var START_SEL = {
    signed_in: { mode: 'home', tab: 'friends' },
    home: { mode: 'home', tab: 'friends' },
    no_group: { mode: 'home', tab: 'friends' },
    server: { mode: 'server', serverId: SRV1, channelId: chGeral.id },
    group: { mode: 'server', serverId: SRV1, channelId: chGeral.id },
    voice: { mode: 'server', serverId: SRV1, channelId: chGeral.id },
    settings: { mode: 'server', serverId: SRV1, channelId: chGeral.id },
    server_settings: { mode: 'server', serverId: SRV1, channelId: chGeral.id },
    invite: { mode: 'home', tab: 'friends' },
    dm: { mode: 'dm', dmId: dmLua.id }
  };
  if (SIGNED_IN[scenario]) selection = START_SEL[scenario] || { mode: 'home', tab: 'friends' };
  if (scenario === 'no_group') { servers = []; dms = []; }

  var typing = {}; // alvo -> { userId: até }
  var pagesLoaded = {}; // alvo -> quantas mensagens antigas extras já foram "carregadas"
  var sentTimes = [];
  var replies = 0;
  var lastSources = [];
  var voiceMe = null; // { channelId?, dmId?, muted, deafened, streaming, video }
  var typingSentAt = 0;

  /* ---------- montagem da view ---------- */

  function isSigned() { return auth.status === 'signed_in'; }
  function serverOf(id) { return servers.filter(function (s) { return s.id === id; })[0] || null; }
  function memberIn(s, uid) { return s ? s.members.filter(function (m) { return m.userId === uid; })[0] || null : null; }
  function myRoleIn(s) { var m = memberIn(s, ME); return m ? m.role : null; }
  function isAdminIn(s) { var r = myRoleIn(s); return r === 'owner' || r === 'admin'; }
  function channelOf(id) {
    for (var i = 0; i < servers.length; i++) {
      var c = servers[i].channels.filter(function (x) { return x.id === id; })[0];
      if (c) return { server: servers[i], channel: c };
    }
    return null;
  }
  function dmOf(id) { return dms.filter(function (d) { return d.id === id; })[0] || null; }
  function lite(id) {
    var u = users[id];
    if (!u) return { id: id, username: 'desconhecido', displayName: 'Fantasma desconhecido', avatarColor: 0, avatarUrl: null };
    var out = { id: u.id, username: u.username, displayName: u.displayName, avatarColor: u.avatarColor, avatarUrl: u.avatarUrl };
    if (id === ME) out.displayName = auth.displayName || u.displayName;
    return out;
  }
  function presenceFor(id) {
    if (id === ME) return myProfile.status === 'invisible' ? 'offline' : myProfile.status;
    return presence[id] || 'offline';
  }
  function muted(target) { return prefs.muted.indexOf(target) >= 0; }

  function unreadOf(target) {
    var list = messages[target] || [];
    var last = reads[target] || 0;
    var unread = 0;
    var mentions = 0;
    list.forEach(function (m) {
      if (m.id > last && m.authorId !== ME) {
        unread++;
        if (m.mentions.indexOf(ME) >= 0) mentions++;
      }
    });
    if (target.charAt(0) === 'd') mentions = unread;
    return { unread: Math.min(99, unread), mentions: mentions };
  }

  function mySnapshot() {
    if (!state.configured) return null;
    var s = summarize();
    var wins = s.matches.filter(function (m) { return m.win; }).length;
    return snap(s.startMmr, s.currentMmr, s.goalMmr, wins, s.matches.length - wins, s.status, 3);
  }

  function memberMmr(uid) {
    if (uid === ME) return auth.mmrVisibility === 'nobody' ? null : mySnapshot();
    return MMRS[uid] || null;
  }

  function currentTarget() {
    if (!isSigned()) return null;
    if (selection.mode === 'server' && selection.channelId) {
      var f = channelOf(selection.channelId);
      if (f && f.channel.kind === 'text') return 'c:' + f.channel.id;
    }
    if (selection.mode === 'dm' && dmOf(selection.dmId)) return 'd:' + selection.dmId;
    return null;
  }

  function fixSelection() {
    if (!isSigned()) { selection = { mode: 'home', tab: selection.mode === 'home' && selection.tab ? selection.tab : 'mmr' }; return; }
    if (selection.mode === 'server') {
      var s = serverOf(selection.serverId);
      if (!s) { selection = { mode: 'home', tab: 'friends' }; return; }
      var ok2 = s.channels.some(function (c) { return c.id === selection.channelId; });
      if (!ok2) {
        var firstText = s.channels.slice().sort(byPos).filter(function (c) { return c.kind === 'text'; })[0];
        selection.channelId = firstText ? firstText.id : null;
      }
    }
    if (selection.mode === 'dm' && !dmOf(selection.dmId)) selection = { mode: 'home', tab: 'friends' };
  }

  function byPos(a, b) { return a.position - b.position; }

  function messageView(target) {
    var list = messages[target] || [];
    var extra = pagesLoaded[target] || 0;
    var limit = 30 + extra;
    var items = list.slice(-limit);
    var hasMore = list.length > limit;
    var last = reads[target] || 0;
    var firstUnread = null;
    items.forEach(function (m) { if (!firstUnread && m.id > last && m.authorId !== ME) firstUnread = m.id; });
    var now = Date.now();
    var t = typing[target] || {};
    var typingIds = Object.keys(t).filter(function (id) { return t[id] > now && id !== ME; });
    return {
      target: target,
      status: 'ready',
      error: null,
      hasMore: hasMore,
      firstUnreadId: firstUnread,
      typing: typingIds,
      items: items.map(function (m) {
        var rep = null;
        if (m.replyTo) {
          var orig = list.filter(function (x) { return x.id === m.replyTo; })[0];
          rep = orig ? { id: orig.id, authorId: orig.authorId, body: String(orig.body).slice(0, 120) } : { id: m.replyTo, authorId: null, body: '', missing: true };
        }
        return {
          id: m.id, authorId: m.authorId, body: m.body, createdAt: m.createdAt, editedAt: m.editedAt,
          replyTo: rep,
          attachments: m.attachments.map(function (a) { return { url: a.url, name: a.name, size: a.size, mime: a.mime, width: a.width, height: a.height, isImage: !!a.isImage }; }),
          reactions: Object.keys(m.reactions).filter(function (e) { return m.reactions[e].length; }).map(function (e) { return { emoji: e, count: m.reactions[e].length, me: m.reactions[e].indexOf(ME) >= 0 }; }),
          pinned: !!m.pinned,
          mentionsMe: m.mentions.indexOf(ME) >= 0,
          mentions: m.mentions.slice()
        };
      })
    };
  }

  function socialView(v) {
    var signed = isSigned();
    if (!signed) {
      v.me = null; v.friends = []; v.dms = []; v.servers = []; v.server = null; v.presence = {}; v.voiceStates = {}; v.messages = null; v.users = {};
      v.selection = { mode: 'home', tab: 'mmr' };
      return;
    }
    fixSelection();
    var seen = {};
    function see(id) { if (id && users[id]) seen[id] = true; }
    myProfile.displayName = auth.displayName || myProfile.displayName;
    myProfile.username = auth.username || myProfile.username;
    v.me = { id: ME, username: myProfile.username, displayName: myProfile.displayName, avatarColor: myProfile.avatarColor, avatarUrl: myProfile.avatarUrl, about: myProfile.about, customStatus: myProfile.customStatus, status: myProfile.status, mmrVisibility: auth.mmrVisibility || 'friends' };
    see(ME);
    v.friends = Object.keys(relations).map(function (id) {
      see(id);
      var u = lite(id);
      u.relation = relations[id].relation;
      u.customStatus = users[id].customStatus;
      u.since = relations[id].since;
      return u;
    });
    v.dms = dms.slice().sort(function (a, b) { return b.lastMessageAt - a.lastMessageAt; }).map(function (d) {
      see(d.userId);
      var un = unreadOf('d:' + d.id);
      return { id: d.id, user: lite(d.userId), lastMessageAt: d.lastMessageAt, unread: un.unread, mentions: un.mentions, muted: muted('d:' + d.id) };
    });
    v.servers = servers.map(function (s) {
      var unread = false;
      var mentions = 0;
      s.channels.forEach(function (c) {
        if (c.kind !== 'text') return;
        var u2 = unreadOf('c:' + c.id);
        if (u2.unread && !muted('c:' + c.id)) unread = true;
        mentions += u2.mentions;
      });
      return { id: s.id, name: s.name, iconColor: s.iconColor, iconUrl: s.iconUrl, role: myRoleIn(s), unread: unread, mentions: mentions, muted: muted('s:' + s.id) };
    });
    v.selection = JSON.parse(JSON.stringify(selection));
    var cur = selection.mode === 'server' ? serverOf(selection.serverId) : null;
    v.server = cur ? {
      id: cur.id, name: cur.name, iconColor: cur.iconColor, iconUrl: cur.iconUrl, role: myRoleIn(cur), ownerId: cur.ownerId,
      categories: cur.categories.slice().sort(byPos).map(function (c) { return { id: c.id, name: c.name, position: c.position }; }),
      channels: cur.channels.slice().sort(byPos).map(function (c) {
        var u3 = c.kind === 'text' ? unreadOf('c:' + c.id) : { unread: 0, mentions: 0 };
        return { id: c.id, kind: c.kind, name: c.name, topic: c.topic, categoryId: c.categoryId, position: c.position, unread: u3.unread > 0, mentions: u3.mentions, muted: muted('c:' + c.id) };
      }),
      members: cur.members.map(function (m) {
        see(m.userId);
        var u = lite(m.userId);
        u.role = m.role;
        u.nickname = m.nickname;
        u.mmr = memberMmr(m.userId);
        u.customStatus = users[m.userId] ? users[m.userId].customStatus : null;
        return u;
      })
    } : null;
    v.presence = {};
    Object.keys(seen).forEach(function (id) { v.presence[id] = presenceFor(id); });
    v.voiceStates = {};
    if (cur) {
      cur.channels.forEach(function (c) {
        var list = (voiceStates[c.id] || []).slice();
        if (voiceMe && voiceMe.channelId === c.id) list.push({ userId: ME, muted: voiceMe.muted, deafened: voiceMe.deafened, streaming: voiceMe.streaming, video: voiceMe.video });
        if (list.length) v.voiceStates[c.id] = list;
      });
    }
    dms.forEach(function (d) {
      var list = (voiceStates['dm:' + d.id] || []).slice();
      if (voiceMe && voiceMe.dmId === d.id) list.push({ userId: ME, muted: voiceMe.muted, deafened: voiceMe.deafened, streaming: voiceMe.streaming, video: voiceMe.video });
      if (list.length) v.voiceStates['dm:' + d.id] = list;
    });
    var target = currentTarget();
    v.messages = target ? messageView(target) : null;
    if (v.messages) {
      v.messages.items.forEach(function (m) { see(m.authorId); if (m.replyTo) see(m.replyTo.authorId); m.mentions.forEach(see); });
      v.messages.typing.forEach(see);
    }
    v.users = {};
    Object.keys(seen).forEach(function (id) {
      var u = lite(id);
      u.customStatus = id === ME ? myProfile.customStatus : users[id].customStatus;
      v.users[id] = u;
    });
    v.prefs = JSON.parse(JSON.stringify(prefs));
  }

  // Campos antigos (group/chat) a partir do servidor/canal selecionado
  function legacyView(v) {
    if (!isSigned() || !v.server) { v.group = null; v.chat = { messages: [], status: 'idle' }; return; }
    v.group = {
      id: v.server.id, name: v.server.name, isOwner: v.server.role === 'owner',
      members: v.server.members.map(function (m) { return { userId: m.id, displayName: m.nickname || m.displayName, isMe: m.id === ME, isOwner: m.role === 'owner', mmr: m.mmr }; })
    };
    v.chat = {
      messages: v.messages && v.messages.target.charAt(0) === 'c' ? v.messages.items.map(function (m) {
        var u = v.users[m.authorId] || {};
        return { id: m.id, userId: m.authorId, displayName: u.displayName || 'Fantasma', body: m.body, createdAt: m.createdAt, mine: m.authorId === ME };
      }) : [],
      status: 'idle'
    };
  }

  function getView() {
    var base;
    if (!state.configured) {
      base = { configured: false, profile: null, summary: null, sync: { status: 'idle', lastSyncAt: null, nextSyncAt: null, error: null, manualAvailableAt: null } };
    } else {
      base = { configured: true, profile: state.profile, summary: summarize(), sync: JSON.parse(JSON.stringify(state.sync)) };
    }
    base.heroes = HEROES;
    base.auth = JSON.parse(JSON.stringify(auth));
    base.voice = { available: isSigned() };
    base.prefs = JSON.parse(JSON.stringify(prefs));
    socialView(base);
    legacyView(base);
    return base;
  }

  var listeners = [];
  function emit() {
    var v = getView();
    listeners.slice().forEach(function (cb) { try { cb(v); } catch (e) { /* ignora */ } });
  }
  function ok(extra) {
    var r = { ok: true, view: getView() };
    Object.keys(extra || {}).forEach(function (k) { r[k] = extra[k]; });
    return r;
  }
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
  function needSignedIn() { return isSigned() ? null : fail('Entre na sua conta primeiro.'); }
  function randomCode() {
    var out = '';
    for (var i = 0; i < 10; i++) out += INVITE_ALPHABET.charAt(Math.floor(Math.random() * INVITE_ALPHABET.length));
    return out;
  }
  function cleanName(n, min, max) {
    var s = String(n == null ? '' : n).trim();
    if (s.length < min || s.length > max) return null;
    if (/[<>\u0000-\u001f]/.test(s)) return null;
    return s;
  }
  function textChannelName(n) {
    var s = String(n == null ? '' : n).toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 32);
    return s.length ? s : null;
  }

  seedMatches();
  if (cfg.syncing) {
    setTimeout(function () {
      state.sync.status = 'idle';
      state.sync.lastSyncAt = Date.now();
      emit();
    }, 6000);
  }

  // Alguém do grupo "responde" depois de uma mensagem sua, com "digitando…" antes
  function simulateReply(target) {
    if (replies >= 4) return;
    var who = null;
    if (target.charAt(0) === 'd') { var d = dmOf(target.slice(2)); who = d ? d.userId : null; }
    else {
      var f = channelOf(target.slice(2));
      var cand = f ? f.server.members.filter(function (m) { return m.userId !== ME && presenceFor(m.userId) !== 'offline'; }) : [];
      who = cand.length ? cand[0].userId : null;
    }
    if (!who) return;
    replies++;
    var text = ['Fechado!', 'Kkkk boa 😂', 'Tô entrando na sala.', 'Beleza, combinado.'][replies - 1] || 'Beleza.';
    setTimeout(function () {
      (typing[target] = typing[target] || {})[who] = Date.now() + 6000;
      emit();
    }, 700);
    setTimeout(function () {
      if (typing[target]) delete typing[target][who];
      addMsg(target, who, text, 0);
      if (target === currentTarget()) reads[target] = messages[target][messages[target].length - 1].id;
      if (target.charAt(0) === 'd') { var d2 = dmOf(target.slice(2)); if (d2) d2.lastMessageAt = Date.now(); }
      emit();
    }, 2800);
  }

  // Só da prévia: abre o pedido pela URL depois do primeiro desenho
  var firstViewServed = false;
  function previewExtras() {
    var join = params.get('join') === '1';
    var tab = params.get('tab');
    if (tab === 'mmr') clickIf('nav-mmr');
    else if (tab === 'ranking') clickIf('nav-ranking');
    if (join && withVoice) {
      var vc = document.querySelector('[data-channel-id="' + vcGeral.id + '"]');
      if (vc) vc.click();
      setTimeout(function () {
        var watch = document.querySelector('[data-vc-action="watch"]');
        if (watch) watch.click();
      }, 2000);
    }
    if (scenario === 'settings' && window.GhostSettings && typeof window.GhostSettings.openUser === 'function') {
      try { window.GhostSettings.openUser(params.get('stab') || 'account'); } catch (e) { /* ignora */ }
    }
    if (scenario === 'server_settings' && window.GhostSettings && typeof window.GhostSettings.openServer === 'function') {
      try { window.GhostSettings.openServer(SRV1, params.get('stab') || 'overview'); } catch (e) { /* ignora */ }
    }
    if (scenario === 'invite' && window.GhostShell && typeof window.GhostShell.openServerDialog === 'function') {
      window.GhostShell.openServerDialog('join', params.get('code') || 'K7M2QX9PTA');
    }
    if (params.get('add') === '1') {
      var addTab = document.querySelector('.ftab[data-tab="add"]');
      if (addTab) addTab.click();
      var input = document.getElementById('add-friend-input');
      if (input) { input.value = 'as'; input.dispatchEvent(new Event('input')); }
    }
  }
  function clickIf(id) { var n = document.getElementById(id); if (n && !n.closest('[hidden]')) n.click(); }

  function bytesOf(data) {
    if (!data) return 0;
    if (typeof data.byteLength === 'number') return data.byteLength;
    return 0;
  }
  function dataUrlFrom(att) {
    try {
      var blob = new Blob([att.data], { type: att.mime || 'application/octet-stream' });
      return URL.createObjectURL(blob);
    } catch (e) { return ''; }
  }

  /* ---------- a ponte ---------- */

  var api = {
    getView: function () {
      return delay(ok, 150).then(function (res) {
        if (!firstViewServed) {
          firstViewServed = true;
          setTimeout(previewExtras, 50);
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
        if (pw.length < 1) return fail('Informe uma senha.');
        // Prévia: modo demo — qualquer senha vale, cria a conta e já entra.
        signInAs(email);
        return ok();
      }, 400);
    },

    signIn: function (data) {
      return delay(function () {
        if (auth.status === 'unconfigured') return fail('As contas ainda não foram configuradas.');
        var email = String((data && data.email) || '').trim().toLowerCase();
        var pw = String((data && data.password) || '');
        if (!emailOk(email)) return fail('Informe um e-mail válido.');
        if (pw.length < 1) return fail('Informe uma senha.');
        // Prévia: aceita qualquer e-mail/senha — modo demo para testes.
        signInAs(email);
        return ok();
      }, 400);
    },

    signOut: function () {
      return delay(function () {
        auth.status = 'signed_out';
        auth.email = null;
        auth.displayName = null;
        auth.mmrVisibility = null;
        voiceMe = null;
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
        if (!isSigned()) return fail('Entre na sua conta para continuar.');
        data = data || {};
        if (data.displayName !== undefined) {
          var n = cleanName(data.displayName, 1, 32);
          if (!n) return fail('O nome de exibição precisa ter de 1 a 32 caracteres, sem < ou >.');
          auth.displayName = n;
          myProfile.displayName = n;
        }
        if (data.username !== undefined) {
          var u = String(data.username).trim().toLowerCase().replace(/^@/, '');
          if (!/^[a-z0-9_.]{2,32}$/.test(u)) return fail('O nome de usuário precisa ter de 2 a 32 caracteres: letras minúsculas, números, ponto ou _.');
          var taken = Object.keys(users).some(function (id) { return id !== ME && users[id].username === u; });
          if (taken) return fail('Esse nome de usuário já está em uso. Tente outro.');
          auth.username = u;
          myProfile.username = u;
        }
        if (data.about !== undefined) {
          var a = String(data.about == null ? '' : data.about);
          if (a.length > 190) return fail('O "sobre mim" pode ter no máximo 190 caracteres.');
          myProfile.about = a;
        }
        if (data.avatarColor !== undefined) {
          var c = intIn(data.avatarColor, 0, 7);
          if (c === null) return fail('Cor inválida.');
          myProfile.avatarColor = c;
        }
        if (data.mmrVisibility !== undefined) {
          if (['friends', 'group', 'nobody'].indexOf(data.mmrVisibility) < 0) return fail('Escolha quem pode ver o seu MMR.');
          auth.mmrVisibility = data.mmrVisibility;
        }
        return ok();
      }, 300);
    },

    uploadAvatar: function (data) {
      return delay(function () {
        if (!isSigned()) return fail('Entre na sua conta para continuar.');
        var mime = String((data && data.mime) || '');
        if (!/^image\/(png|jpeg|webp|gif)$/.test(mime)) return fail('Use uma imagem PNG, JPG, WEBP ou GIF.');
        if (bytesOf(data.data) > 2 * 1024 * 1024) return fail('A imagem pode ter no máximo 2 MB.');
        myProfile.avatarUrl = drawAvatar(Math.floor(Math.random() * 360), (auth.displayName || 'F').charAt(0).toUpperCase());
        return ok();
      }, 500);
    },

    removeAvatar: function () {
      return delay(function () {
        if (!isSigned()) return fail('Entre na sua conta para continuar.');
        myProfile.avatarUrl = null;
        return ok();
      }, 200);
    },

    setStatus: function (st) {
      return delay(function () {
        var e = needSignedIn(); if (e) return e;
        if (['online', 'idle', 'dnd', 'invisible'].indexOf(st) < 0) return fail('Status inválido.');
        myProfile.status = st;
        return ok();
      }, 120);
    },

    setCustomStatus: function (text) {
      return delay(function () {
        var e = needSignedIn(); if (e) return e;
        if (text == null || String(text).trim() === '') { myProfile.customStatus = null; return ok(); }
        var t = String(text).trim();
        if (t.length > 128) return fail('O status pode ter no máximo 128 caracteres.');
        myProfile.customStatus = t;
        return ok();
      }, 150);
    },

    deleteAccount: function () {
      return delay(function () {
        if (!isSigned()) return fail('Entre na sua conta para continuar.');
        auth.status = 'signed_out';
        auth.email = null;
        auth.displayName = null;
        auth.mmrVisibility = null;
        return ok();
      }, 800);
    },

    /* navegação */
    select: function (s) {
      return delay(function () {
        if (!s || typeof s !== 'object') return fail('Seleção inválida.');
        if (s.mode === 'home') { selection = { mode: 'home', tab: s.tab === 'mmr' ? 'mmr' : 'friends' }; return ok(); }
        var e = needSignedIn(); if (e) return e;
        if (s.mode === 'server') {
          var srv = serverOf(s.serverId);
          if (!srv) return fail('Você não está mais nesse servidor.');
          var prev = selection.mode === 'server' && selection.serverId === srv.id ? selection.channelId : (srv.lastChannelId || null);
          selection = { mode: 'server', serverId: srv.id, channelId: s.channelId || prev || null };
          fixSelection();
          srv.lastChannelId = selection.channelId;
          var t = currentTarget();
          if (t) markReadTarget(t);
          return ok();
        }
        if (s.mode === 'dm') {
          if (!dmOf(s.dmId)) return fail('Essa conversa não existe mais.');
          selection = { mode: 'dm', dmId: s.dmId };
          markReadTarget('d:' + s.dmId);
          return ok();
        }
        return fail('Seleção inválida.');
      }, 60);
    },

    /* amigos */
    searchUsers: function (query) {
      return delay(function () {
        var e = needSignedIn(); if (e) return e;
        var q = String(query == null ? '' : query).trim().toLowerCase().replace(/^@/, '');
        if (q.length < 2) return { ok: true, users: [] };
        var found = Object.keys(users).filter(function (id) {
          if (id === ME) return false;
          var u = users[id];
          return u.username.indexOf(q) === 0 || u.displayName.toLowerCase().indexOf(q) === 0;
        }).slice(0, 20).map(function (id) {
          var u = lite(id);
          u.relation = relations[id] ? relations[id].relation : 'none';
          return u;
        });
        return { ok: true, users: found };
      }, 250);
    },

    sendFriendRequest: function (username) {
      return delay(function () {
        var e = needSignedIn(); if (e) return e;
        var name = String(username == null ? '' : username).trim().toLowerCase().replace(/^@/, '');
        if (!name) return fail('Digite o nome de usuário de quem você quer adicionar.');
        var id = Object.keys(users).filter(function (k) { return users[k].username === name; })[0];
        if (!id) return fail('Não encontramos ninguém com o nome de usuário "' + name + '". Confira a grafia (maiúsculas não importam).');
        if (id === ME) return fail('Você não pode adicionar a si mesmo.');
        var r = relations[id] ? relations[id].relation : 'none';
        if (r === 'friend') return fail('Vocês já são amigos.');
        if (r === 'pending_out') return fail('Você já mandou um pedido para essa pessoa. Agora é só esperar.');
        if (r === 'blocked') return fail('Você bloqueou essa pessoa. Desbloqueie primeiro.');
        if (r === 'pending_in') { rel(id, 'friend'); return ok({ result: 'accepted' }); }
        rel(id, 'pending_out');
        if (autoAccept[id]) {
          setTimeout(function () {
            if (relations[id] && relations[id].relation === 'pending_out') { rel(id, 'friend'); emit(); }
          }, 5000);
        }
        return ok({ result: 'sent' });
      }, 350);
    },

    acceptFriend: function (userId) { return relChange(userId, function (r) { if (r !== 'pending_in') return 'Esse pedido não existe mais.'; rel(userId, 'friend'); }); },
    declineFriend: function (userId) { return relChange(userId, function (r) { if (r !== 'pending_in' && r !== 'pending_out') return 'Esse pedido não existe mais.'; delete relations[userId]; }); },
    removeFriend: function (userId) { return relChange(userId, function (r) { if (r !== 'friend') return 'Vocês não são amigos.'; delete relations[userId]; }); },
    blockUser: function (userId) { return relChange(userId, function () { rel(userId, 'blocked'); }); },
    unblockUser: function (userId) { return relChange(userId, function (r) { if (r !== 'blocked') return 'Essa pessoa não está bloqueada.'; delete relations[userId]; }); },

    openDm: function (userId) {
      return delay(function () {
        var e = needSignedIn(); if (e) return e;
        if (!users[userId] || userId === ME) return fail('Pessoa inválida.');
        var r = relations[userId] ? relations[userId].relation : 'none';
        if (r === 'blocked') return fail('Você bloqueou essa pessoa.');
        var shares = servers.some(function (s) { return memberIn(s, userId) && memberIn(s, ME); });
        if (r !== 'friend' && !shares) return fail('Vocês precisam ser amigos ou estar no mesmo servidor para conversar.');
        var d = dms.filter(function (x) { return x.userId === userId; })[0] || addDm(userId, 0);
        selection = { mode: 'dm', dmId: d.id };
        return ok();
      }, 150);
    },

    /* servidores */
    createServer: function (data) {
      return delay(function () {
        var e = needSignedIn(); if (e) return e;
        var n = cleanName(data && data.name, 2, 32);
        if (!n) return fail('O nome do servidor precisa ter de 2 a 32 caracteres, sem < ou >.');
        if (servers.length >= 50) return fail('Você já está em 50 servidores, o máximo.');
        var color = intIn(data && data.iconColor, 0, 7);
        var s = makeServer(uuid(), n, color === null ? 0 : color, ME, [{ userId: ME, role: 'owner', nickname: null }]);
        var ct = addCategory(s, 'Canais de texto');
        var g = addChannel(s, 'text', 'geral', ct.id);
        var cv = addCategory(s, 'Canais de voz');
        addChannel(s, 'voice', 'Geral', cv.id);
        selection = { mode: 'server', serverId: s.id, channelId: g.id };
        return ok();
      }, 500);
    },
    createGroup: function (name) { return api.createServer({ name: name }); },

    previewInvite: function (code) {
      return delay(function () {
        var e = needSignedIn(); if (e) return e;
        var c = String(code == null ? '' : code).trim().toUpperCase();
        if (!INVITE_RE.test(c)) return fail('O código tem 10 letras e números (sem I, L, O, 0 e 1), como K7M2QX9PTA.');
        var found = findInvite(c);
        if (found) {
          return { ok: true, invite: { serverId: found.server.id, name: found.server.name, iconColor: found.server.iconColor, iconUrl: found.server.iconUrl, memberCount: found.server.members.length, alreadyMember: !!memberIn(found.server, ME) } };
        }
        return { ok: true, invite: { serverId: null, name: 'Clã dos Espectros', iconColor: 6, iconUrl: null, memberCount: 37, alreadyMember: false } };
      }, 300);
    },

    joinServer: function (code) {
      return delay(function () {
        var e = needSignedIn(); if (e) return e;
        var c = String(code == null ? '' : code).trim().toUpperCase();
        if (!INVITE_RE.test(c)) return fail('O código tem 10 letras e números (sem I, L, O, 0 e 1), como K7M2QX9PTA.');
        var found = findInvite(c);
        var s;
        if (found) {
          s = found.server;
          if (s.bans.some(function (b) { return b.userId === ME; })) return fail('Você foi banido desse servidor.');
          if (!memberIn(s, ME)) {
            s.members.push({ userId: ME, role: 'member', nickname: null });
            found.invite.uses++;
          }
        } else {
          s = servers.filter(function (x) { return x.joinCode === c; })[0];
          if (!s) {
            s = makeServer(uuid(), 'Clã dos Espectros', 6, ASSOMBRO, [{ userId: ASSOMBRO, role: 'owner', nickname: null }, { userId: NEBULA, role: 'member', nickname: null }, { userId: ME, role: 'member', nickname: null }]);
            s.joinCode = c;
            var ct = addCategory(s, 'Canais de texto');
            var g = addChannel(s, 'text', 'boas-vindas', ct.id, 'Apresente-se!');
            addChannel(s, 'text', 'geral', ct.id);
            var cv = addCategory(s, 'Canais de voz');
            addChannel(s, 'voice', 'Lobby', cv.id);
            addMsg('c:' + g.id, ASSOMBRO, 'Boas-vindas ao clã, <@' + ME + '>! 👻', 0);
          }
        }
        selection = { mode: 'server', serverId: s.id, channelId: null };
        fixSelection();
        return ok();
      }, 500);
    },
    joinGroup: function (code) { return api.joinServer(code); },

    leaveServer: function (serverId) {
      return delay(function () {
        var e = needSignedIn(); if (e) return e;
        var s = serverOf(serverId);
        if (!s || !memberIn(s, ME)) return fail('Você não está nesse servidor.');
        var wasOwner = s.ownerId === ME;
        s.members = s.members.filter(function (m) { return m.userId !== ME; });
        if (!s.members.length) servers = servers.filter(function (x) { return x !== s; });
        else if (wasOwner) {
          var heir = s.members.filter(function (m) { return m.role === 'admin'; })[0] || s.members[0];
          heir.role = 'owner';
          s.ownerId = heir.userId;
        }
        servers = servers.filter(function (x) { return memberIn(x, ME); });
        if (voiceMe && voiceMe.channelId && s.channels.some(function (c) { return c.id === voiceMe.channelId; })) voiceMe = null;
        if (selection.mode === 'server' && selection.serverId === serverId) selection = { mode: 'home', tab: 'friends' };
        return ok();
      }, 400);
    },
    leaveGroup: function () {
      return selection.mode === 'server' ? api.leaveServer(selection.serverId) : Promise.resolve(fail('Abra um servidor primeiro.'));
    },

    deleteServer: function (serverId) {
      return adminDo(serverId, true, function (s) {
        servers = servers.filter(function (x) { return x !== s; });
        if (selection.mode === 'server' && selection.serverId === serverId) selection = { mode: 'home', tab: 'friends' };
      });
    },

    updateServer: function (data) {
      return adminDo(data && data.serverId, false, function (s) {
        if (data.name !== undefined) {
          var n = cleanName(data.name, 2, 32);
          if (!n) return 'O nome do servidor precisa ter de 2 a 32 caracteres, sem < ou >.';
          s.name = n;
        }
        if (data.iconColor !== undefined) {
          var c = intIn(data.iconColor, 0, 7);
          if (c === null) return 'Cor inválida.';
          s.iconColor = c;
        }
      });
    },

    uploadServerIcon: function (data) {
      return adminDo(data && data.serverId, false, function (s) {
        if (!/^image\/(png|jpeg|webp|gif)$/.test(String(data.mime || ''))) return 'Use uma imagem PNG, JPG, WEBP ou GIF.';
        if (bytesOf(data.data) > 2 * 1024 * 1024) return 'A imagem pode ter no máximo 2 MB.';
        s.iconUrl = drawAvatar(Math.floor(Math.random() * 360), s.name.charAt(0).toUpperCase());
      });
    },

    createInvite: function (data) {
      return delay(function () {
        var e = needSignedIn(); if (e) return e;
        var serverId = data && data.serverId ? data.serverId : (selection.mode === 'server' ? selection.serverId : null);
        var s = serverOf(serverId);
        if (!s || !memberIn(s, ME)) return fail('Abra um servidor para convidar pessoas.');
        var age = data && data.maxAgeSeconds != null ? Number(data.maxAgeSeconds) : null;
        var uses = data && data.maxUses != null ? Number(data.maxUses) : null;
        if (age !== null && [1800, 3600, 21600, 43200, 86400, 604800].indexOf(age) < 0) return fail('Validade inválida.');
        if (uses !== null && [1, 5, 10, 25, 50, 100].indexOf(uses) < 0) return fail('Número de usos inválido.');
        var inv;
        if (age === null && uses === null) inv = s.invites.filter(function (i) { return !i.expiresAt && !i.maxUses; })[0];
        if (!inv) {
          inv = { code: randomCode(), createdBy: ME, expiresAt: age ? new Date(Date.now() + age * 1000).toISOString() : null, maxUses: uses, uses: 0 };
          s.invites.push(inv);
        }
        var out = { code: inv.code, expiresAt: inv.expiresAt, maxUses: inv.maxUses, uses: inv.uses };
        return { ok: true, invite: out, code: out.code, expiresAt: out.expiresAt };
      }, 300);
    },

    listInvites: function (serverId) {
      return delay(function () {
        var s = serverOf(serverId);
        if (!s || !isAdminIn(s)) return fail('Só admins e o dono veem os convites.');
        return { ok: true, invites: s.invites.map(function (i) { return { code: i.code, createdBy: lite(i.createdBy), expiresAt: i.expiresAt, maxUses: i.maxUses, uses: i.uses }; }) };
      }, 200);
    },

    revokeInvite: function (code) {
      return delay(function () {
        var e = needSignedIn(); if (e) return e;
        var f = findInvite(String(code || '').toUpperCase());
        if (!f) return fail('Esse convite não existe mais.');
        if (!isAdminIn(f.server) && f.invite.createdBy !== ME) return fail('Só admins, o dono ou quem criou o convite podem revogar.');
        f.server.invites = f.server.invites.filter(function (i) { return i !== f.invite; });
        return ok();
      }, 200);
    },

    setMemberRole: function (data) {
      return adminDo(data && data.serverId, true, function (s) {
        var m = memberIn(s, data.userId);
        if (!m || m.role === 'owner') return 'Não dá para mudar o cargo dessa pessoa.';
        if (['admin', 'member'].indexOf(data.role) < 0) return 'Cargo inválido.';
        m.role = data.role;
      });
    },

    transferOwnership: function (data) {
      return adminDo(data && data.serverId, true, function (s) {
        var m = memberIn(s, data.userId);
        if (!m || data.userId === ME) return 'Escolha outra pessoa do servidor.';
        memberIn(s, ME).role = 'admin';
        m.role = 'owner';
        s.ownerId = m.userId;
      });
    },

    kickMember: function (data) {
      return adminDo(data && data.serverId, false, function (s) {
        var m = memberIn(s, data.userId);
        if (!m || m.role === 'owner' || data.userId === ME) return 'Você não pode expulsar essa pessoa.';
        if (m.role === 'admin' && myRoleIn(s) !== 'owner') return 'Só o dono pode expulsar admins.';
        s.members = s.members.filter(function (x) { return x !== m; });
      });
    },
    removeMember: function (userId) {
      return selection.mode === 'server' ? api.kickMember({ serverId: selection.serverId, userId: userId }) : Promise.resolve(fail('Abra um servidor primeiro.'));
    },

    banMember: function (data) {
      return adminDo(data && data.serverId, false, function (s) {
        var m = memberIn(s, data.userId);
        if (!m || m.role === 'owner' || data.userId === ME) return 'Você não pode banir essa pessoa.';
        if (m.role === 'admin' && myRoleIn(s) !== 'owner') return 'Só o dono pode banir admins.';
        s.members = s.members.filter(function (x) { return x !== m; });
        s.bans.push({ userId: data.userId, bannedAt: Date.now() });
      });
    },

    unbanMember: function (data) {
      return adminDo(data && data.serverId, false, function (s) {
        var before = s.bans.length;
        s.bans = s.bans.filter(function (b) { return b.userId !== data.userId; });
        if (before === s.bans.length) return 'Essa pessoa não está banida.';
      });
    },

    listBans: function (serverId) {
      return delay(function () {
        var s = serverOf(serverId);
        if (!s || !isAdminIn(s)) return fail('Só admins e o dono veem os banimentos.');
        return { ok: true, bans: s.bans.map(function (b) { var u = lite(b.userId); u.bannedAt = b.bannedAt; return u; }) };
      }, 200);
    },

    setNickname: function (data) {
      return delay(function () {
        var e = needSignedIn(); if (e) return e;
        var s = serverOf(data && data.serverId);
        var m = memberIn(s, ME);
        if (!m) return fail('Você não está nesse servidor.');
        if (data.nickname == null || String(data.nickname).trim() === '') { m.nickname = null; return ok(); }
        var n = cleanName(data.nickname, 1, 32);
        if (!n) return fail('O apelido precisa ter de 1 a 32 caracteres, sem < ou >.');
        m.nickname = n;
        return ok();
      }, 200);
    },

    /* canais */
    createCategory: function (data) {
      return adminDo(data && data.serverId, false, function (s) {
        var n = cleanName(data.name, 1, 32);
        if (!n) return 'O nome da categoria precisa ter de 1 a 32 caracteres.';
        addCategory(s, n);
      });
    },
    updateCategory: function (data) {
      var f = categoryOf(data && data.categoryId);
      return adminDo(f ? f.server.id : null, false, function () {
        if (data.name !== undefined) {
          var n = cleanName(data.name, 1, 32);
          if (!n) return 'O nome da categoria precisa ter de 1 a 32 caracteres.';
          f.category.name = n;
        }
        if (data.position !== undefined) f.category.position = Number(data.position) || 0;
      });
    },
    deleteCategory: function (categoryId) {
      var f = categoryOf(categoryId);
      return adminDo(f ? f.server.id : null, false, function (s) {
        s.categories = s.categories.filter(function (c) { return c !== f.category; });
        s.channels.forEach(function (c) { if (c.categoryId === categoryId) c.categoryId = null; });
      });
    },
    createChannel: function (data) {
      return adminDo(data && data.serverId, false, function (s) {
        var kind = data.kind === 'voice' ? 'voice' : 'text';
        var n = kind === 'text' ? textChannelName(data.name) : cleanName(data.name, 1, 32);
        if (!n) return 'Dê um nome válido para o canal (até 32 caracteres).';
        if (data.categoryId && !s.categories.some(function (c) { return c.id === data.categoryId; })) return 'Categoria inválida.';
        var c = addChannel(s, kind, n, data.categoryId || null);
        if (kind === 'text') selection = { mode: 'server', serverId: s.id, channelId: c.id };
      });
    },
    updateChannel: function (data) {
      var f = channelOf(data && data.channelId);
      return adminDo(f ? f.server.id : null, false, function () {
        var c = f.channel;
        if (data.name !== undefined) {
          var n = c.kind === 'text' ? textChannelName(data.name) : cleanName(data.name, 1, 32);
          if (!n) return 'Dê um nome válido para o canal (até 32 caracteres).';
          c.name = n;
        }
        if (data.topic !== undefined) {
          var t = data.topic == null ? null : String(data.topic).trim();
          if (t && t.length > 1024) return 'O tópico pode ter no máximo 1024 caracteres.';
          c.topic = t || null;
        }
        if (data.categoryId !== undefined) c.categoryId = data.categoryId || null;
        if (data.position !== undefined) c.position = Number(data.position) || 0;
      });
    },
    deleteChannel: function (channelId) {
      var f = channelOf(channelId);
      return adminDo(f ? f.server.id : null, false, function (s) {
        var texts = s.channels.filter(function (c) { return c.kind === 'text'; });
        if (f.channel.kind === 'text' && texts.length <= 1) return 'O servidor precisa de pelo menos um canal de texto.';
        s.channels = s.channels.filter(function (c) { return c !== f.channel; });
        delete messages['c:' + channelId];
        if (voiceMe && voiceMe.channelId === channelId) voiceMe = null;
        fixSelection();
      });
    },

    /* mensagens */
    sendMessage: function (data) {
      return delay(function () {
        var e = needSignedIn(); if (e) return e;
        var target = currentTarget();
        if (!target) return fail('Abra um canal de texto ou uma conversa para mandar mensagens.');
        var payload = typeof data === 'string' ? { body: data } : (data || {});
        var b = String(payload.body == null ? '' : payload.body).trim();
        var atts = Array.isArray(payload.attachments) ? payload.attachments : [];
        if (!b && !atts.length) return fail('Escreva alguma coisa antes de enviar.');
        if (b.length > 2000) return fail('A mensagem pode ter no máximo 2000 caracteres.');
        if (atts.length > 4) return fail('Dá para mandar no máximo 4 anexos por mensagem.');
        for (var i = 0; i < atts.length; i++) {
          if (bytesOf(atts[i].data) > 8 * 1024 * 1024) return fail('Cada anexo pode ter no máximo 8 MB.');
        }
        var now = Date.now();
        sentTimes = sentTimes.filter(function (t) { return now - t < 10000; });
        if (sentTimes.length >= 10) return fail('Calma! Você mandou muitas mensagens seguidas. Espere alguns segundos.');
        sentTimes.push(now);
        var list = messages[target] || [];
        var replyTo = payload.replyTo && list.some(function (m) { return m.id === payload.replyTo; }) ? payload.replyTo : null;
        var m = addMsg(target, ME, b, 0, {
          replyTo: replyTo,
          attachments: atts.map(function (a) {
            var mime = String(a.mime || 'application/octet-stream');
            var img = /^image\//.test(mime);
            return { url: img ? dataUrlFrom(a) : '', name: String(a.name || 'arquivo').slice(0, 120), size: bytesOf(a.data), mime: mime, isImage: img };
          })
        });
        reads[target] = m.id;
        if (target.charAt(0) === 'd') { var d = dmOf(target.slice(2)); if (d) d.lastMessageAt = now; }
        if (messages[target].length > 500) messages[target] = messages[target].slice(-500);
        if (typing[target]) delete typing[target][ME];
        simulateReply(target);
        return ok();
      }, 200);
    },

    editMessage: function (data) {
      return msgDo(data && data.id, function (m) {
        if (m.authorId !== ME) return 'Você só pode editar as suas mensagens.';
        var b = String(data.body == null ? '' : data.body).trim();
        if (!b && !m.attachments.length) return 'A mensagem não pode ficar vazia. Para apagar, use "Apagar mensagem".';
        if (b.length > 2000) return 'A mensagem pode ter no máximo 2000 caracteres.';
        m.body = b;
        m.editedAt = Date.now();
      });
    },

    deleteMessage: function (id) {
      return msgDo(id, function (m, target, list) {
        var f = target.charAt(0) === 'c' ? channelOf(target.slice(2)) : null;
        if (m.authorId !== ME && !(f && isAdminIn(f.server))) return 'Você só pode apagar as suas mensagens.';
        list.splice(list.indexOf(m), 1);
      });
    },

    toggleReaction: function (data) {
      return msgDo(data && data.id, function (m) {
        var emoji = String(data.emoji || '');
        if (!emoji || emoji.length > 32) return 'Emoji inválido.';
        var r = m.reactions[emoji] || [];
        if (!m.reactions[emoji] && Object.keys(m.reactions).length >= 20) return 'Essa mensagem já tem reações demais.';
        var i = r.indexOf(ME);
        if (i >= 0) r.splice(i, 1); else r.push(ME);
        if (r.length) m.reactions[emoji] = r; else delete m.reactions[emoji];
      });
    },

    pinMessage: function (data) {
      return msgDo(data && data.id, function (m, target, list) {
        var f = target.charAt(0) === 'c' ? channelOf(target.slice(2)) : null;
        if (f && !isAdminIn(f.server)) return 'Só admins e o dono podem fixar mensagens neste servidor.';
        if (data.pinned && list.filter(function (x) { return x.pinned; }).length >= 50) return 'Este canal já tem 50 mensagens fixadas, o máximo.';
        m.pinned = !!data.pinned;
      });
    },

    listPinned: function () {
      return delay(function () {
        var target = currentTarget();
        if (!target) return fail('Abra um canal primeiro.');
        var v = messageView(target);
        var all = (messages[target] || []).filter(function (m) { return m.pinned; }).map(function (m) { return m.id; });
        pagesLoaded[target] = Math.max(pagesLoaded[target] || 0, (messages[target] || []).length);
        var full = messageView(target).items.filter(function (m) { return all.indexOf(m.id) >= 0; }).reverse();
        void v;
        return { ok: true, items: full };
      }, 200);
    },

    loadOlder: function () {
      return delay(function () {
        var target = currentTarget();
        if (!target) return fail('Abra um canal primeiro.');
        pagesLoaded[target] = (pagesLoaded[target] || 0) + 30;
        return ok();
      }, 400);
    },

    markRead: function () {
      return delay(function () {
        var target = currentTarget();
        if (target) markReadTarget(target);
        return ok();
      }, 50);
    },

    searchMessages: function (query) {
      return delay(function () {
        var target = currentTarget();
        if (!target) return fail('Abra um canal primeiro.');
        var q = String(query == null ? '' : query).trim().toLowerCase();
        if (!q) return { ok: true, items: [] };
        pagesLoaded[target] = Math.max(pagesLoaded[target] || 0, (messages[target] || []).length);
        var items = messageView(target).items.filter(function (m) { return String(m.body).toLowerCase().indexOf(q) >= 0; }).reverse().slice(0, 25);
        return { ok: true, items: items };
      }, 300);
    },

    setTyping: function () {
      return delay(function () {
        var now = Date.now();
        if (now - typingSentAt < 3000) return { ok: true };
        typingSentAt = now;
        return { ok: true };
      }, 10);
    },

    openExternal: function (url) {
      return delay(function () {
        if (!/^https?:\/\//i.test(String(url || ''))) return fail('Só links http ou https podem ser abertos.');
        return { ok: true }; // na prévia não abre nada (sem rede)
      }, 50);
    },

    /* preferências */
    updatePrefs: function (partial) {
      return delay(function () {
        if (!partial || typeof partial !== 'object') return fail('Preferências inválidas.');
        ['notifications', 'voice', 'appearance'].forEach(function (k) {
          if (partial[k] && typeof partial[k] === 'object') {
            Object.keys(partial[k]).forEach(function (kk) { if (Object.prototype.hasOwnProperty.call(prefs[k], kk)) prefs[k][kk] = partial[k][kk]; });
          }
        });
        if (Array.isArray(partial.muted)) prefs.muted = partial.muted.filter(function (x) { return typeof x === 'string'; }).slice(0, 500);
        var ap = prefs.appearance;
        if ({ dark: 1, midnight: 1, light: 1 }[ap.theme] !== 1) ap.theme = 'dark';
        ap.fontScale = Math.max(80, Math.min(130, Number(ap.fontScale) || 100));
        ap.compact = !!ap.compact;
        return ok();
      }, 80);
    },

    muteTarget: function (data) {
      return delay(function () {
        var t = String((data && data.target) || '');
        if (!/^[cds]:[0-9a-f-]{36}$/i.test(t)) return fail('Alvo inválido.');
        prefs.muted = prefs.muted.filter(function (x) { return x !== t; });
        if (data.muted) prefs.muted.push(t);
        return ok();
      }, 80);
    },

    /* voz */
    voiceToken: function (target) {
      return delay(function () {
        var e = needSignedIn(); if (e) return e;
        if (target && target.channelId) {
          var f = channelOf(target.channelId);
          if (!f || f.channel.kind !== 'voice' || !memberIn(f.server, ME)) return fail('Esse canal de voz não está disponível.');
        } else if (target && target.dmId) {
          if (!dmOf(target.dmId)) return fail('Essa conversa não existe mais.');
        } else if (!servers.length) {
          return fail('Entre em um servidor para usar a voz.');
        }
        return { ok: true, url: 'wss://ghost-rank-previa.livekit.cloud', token: 'cabecalho.conteudo.assinatura' };
      }, 300);
    },

    setVoiceState: function (data) {
      return delay(function () {
        var e = needSignedIn(); if (e) return e;
        data = data || {};
        if (!data.channelId && !data.dmId) { voiceMe = null; emit(); return { ok: true }; }
        voiceMe = { channelId: data.channelId || null, dmId: data.dmId || null, muted: !!data.muted, deafened: !!data.deafened, streaming: !!data.streaming, video: !!data.video };
        // na DM, a outra pessoa "atende" depois de 2 s
        if (voiceMe.dmId && !voiceStates['dm:' + voiceMe.dmId]) {
          var dmId = voiceMe.dmId;
          setTimeout(function () {
            var d = dmOf(dmId);
            if (!d || !voiceMe || voiceMe.dmId !== dmId) return;
            voiceStates['dm:' + dmId] = [{ userId: d.userId, muted: false, deafened: false, streaming: false, video: false }];
            emit();
          }, 2000);
        }
        emit();
        return { ok: true };
      }, 40);
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
        setTimeout(function () {
          if (!isSigned()) return;
          auth.steamLinked = true;
          emit();
        }, 3000);
        return { ok: true };
      }, 400);
    },

    refreshGroup: function () { return delay(function () { var e = needSignedIn(); if (e) return e; return ok(); }, 200); },

    onUpdate: function (cb) {
      listeners.push(cb);
      return function () { listeners = listeners.filter(function (l) { return l !== cb; }); };
    },

    onNotificationClick: function () { return function () {}; }
  };

  /* ---------- auxiliares das ações ---------- */

  function signInAs(email) {
    auth.status = 'signed_in';
    auth.email = email;
    auth.displayName = auth.displayName || (email.split('@')[0] || 'Fantasma').slice(0, 32);
    auth.username = auth.username || 'fantasma.noturno';
    auth.mmrVisibility = auth.mmrVisibility || 'friends';
    selection = { mode: 'home', tab: 'friends' };
  }

  function markReadTarget(target) {
    var list = messages[target] || [];
    if (list.length) reads[target] = list[list.length - 1].id;
  }

  function findInvite(code) {
    for (var i = 0; i < servers.length; i++) {
      var inv = servers[i].invites.filter(function (x) { return x.code === code; })[0];
      if (inv) {
        if (inv.expiresAt && new Date(inv.expiresAt).getTime() <= Date.now()) return null;
        if (inv.maxUses && inv.uses >= inv.maxUses) return null;
        return { server: servers[i], invite: inv };
      }
    }
    if (code === DEMO_INVITE) {
      // "Os Assombrados" foi apagado ou você saiu: recria o convite permanente
      var s = serverOf(SRV1);
      if (s) { var inv2 = { code: DEMO_INVITE, createdBy: s.ownerId, expiresAt: null, maxUses: null, uses: 0 }; s.invites.push(inv2); return { server: s, invite: inv2 }; }
    }
    return null;
  }

  function categoryOf(id) {
    for (var i = 0; i < servers.length; i++) {
      var c = servers[i].categories.filter(function (x) { return x.id === id; })[0];
      if (c) return { server: servers[i], category: c };
    }
    return null;
  }

  function relChange(userId, fn) {
    return delay(function () {
      var e = needSignedIn(); if (e) return e;
      if (typeof userId !== 'string' || !UUID_RE.test(userId) || !users[userId] || userId === ME) return fail('Pessoa inválida.');
      var r = relations[userId] ? relations[userId].relation : 'none';
      var err = fn(r);
      return err ? fail(err) : ok();
    }, 200);
  }

  function adminDo(serverId, ownerOnly, fn) {
    return delay(function () {
      var e = needSignedIn(); if (e) return e;
      var s = serverOf(serverId);
      if (!s || !memberIn(s, ME)) return fail('Você não está nesse servidor.');
      var role = myRoleIn(s);
      if (ownerOnly && role !== 'owner') return fail('Só o dono do servidor pode fazer isso.');
      if (!ownerOnly && role !== 'owner' && role !== 'admin') return fail('Só admins e o dono podem fazer isso.');
      var err = fn(s);
      return err ? fail(err) : ok();
    }, 250);
  }

  function msgDo(id, fn) {
    return delay(function () {
      var e = needSignedIn(); if (e) return e;
      var target = currentTarget();
      if (!target) return fail('Abra um canal primeiro.');
      var list = messages[target] || [];
      var m = list.filter(function (x) { return x.id === id; })[0];
      if (!m) return fail('Essa mensagem não existe mais.');
      var err = fn(m, target, list);
      return err ? fail(err) : ok();
    }, 150);
  }

  window.ghostRank = api;
})();
