'use strict';

// Integração: handlers do IPC (reais) + controller (real) + store (real, em disco temporário)
// + cliente OpenDota falso. Simula o que a tela faz, com os mesmos payloads (números como texto).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildHandlers, CHANNELS } = require('../../src/main/ipc');
const { createController } = require('../../src/main/controller');
const { createStore } = require('../../src/main/store');

const TRUSTED = { senderFrame: { url: 'app://ghost-rank/index.html' } };
const UNTRUSTED = { senderFrame: { url: 'https://evil.example/' } };

const T0 = 1_800_000_000; // segundos Unix

function raw(matchId, startTime, win) {
  return {
    match_id: matchId,
    hero_id: 1,
    start_time: startTime,
    duration: 2400,
    player_slot: 0,
    radiant_win: win,
    lobby_type: 7,
    party_size: 1,
  };
}

function setupEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-rank-int-'));
  let matches = [raw(1, T0 - 7200, true), raw(2, T0 - 9000, false)];
  let clock = T0 * 1000;
  const client = {
    getPlayer: async () => ({ found: true, personaName: '<b>Fantasma</b>' }),
    getRecentMatches: async () => matches.slice(),
    getHeroes: async () => ({ 1: 'Anti-Mage' }),
  };
  const store = createStore({ filePath: path.join(dir, 'ghost-rank.dat') });
  const controller = createController({
    client,
    store,
    now: () => clock,
    manualCooldownMs: 30_000,
    syncIntervalMs: 180_000,
  });
  const handlers = buildHandlers(controller);
  return {
    dir,
    handlers,
    controller,
    addMatch: (m) => { matches = [m, ...matches]; },
    advance: (ms) => { clock += ms; },
    invoke: (channel, payload, event = TRUSTED) => handlers[channel](event, payload),
  };
}

test('fluxo completo: cadastro, partida nova, correção, ajustes e reset', async () => {
  const env = setupEnv();

  let r = await env.invoke(CHANNELS.getView);
  assert.equal(r.ok, true);
  assert.equal(r.view.configured, false);

  // A tela envia tudo como texto.
  r = await env.invoke(CHANNELS.setup, {
    accountInput: 'https://www.opendota.com/players/123456',
    startMmr: '3000',
    goalMmr: '3200',
    gainPerMatch: '25',
  });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.view.configured, true);
  assert.equal(r.view.profile.accountId, 123456);
  assert.equal(r.view.profile.personaName, '<b>Fantasma</b>'); // sem sanitização: a tela usa textContent
  assert.equal(r.view.summary.currentMmr, 3000);
  assert.equal(r.view.summary.remaining, 200);
  assert.deepEqual(r.view.summary.matches, []); // partidas antigas não contam
  assert.equal(r.view.heroes[1], 'Anti-Mage');

  // Partida nova aparece na sincronização e o MMR muda.
  env.addMatch(raw(3, T0 + 600, true));
  env.advance(31_000);
  r = await env.invoke(CHANNELS.sync);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.view.summary.currentMmr, 3025);
  assert.equal(r.view.summary.matches.length, 1);
  assert.equal(r.view.summary.lastMatch.matchId, 3);
  assert.equal(r.view.summary.lastMatch.delta, 25);

  // Mesma partida de novo não duplica.
  env.advance(31_000);
  r = await env.invoke(CHANNELS.sync);
  assert.equal(r.view.summary.matches.length, 1);

  // Correção manual.
  r = await env.invoke(CHANNELS.correctMmr, { mmr: '3110' });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.view.summary.currentMmr, 3110);
  assert.equal(r.view.summary.remaining, 90);

  // Ajustes (meta) e valor inválido vira erro amigável, sem lançar.
  r = await env.invoke(CHANNELS.updateSettings, { goalMmr: '3500' });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.view.summary.goalMmr, 3500);
  r = await env.invoke(CHANNELS.updateSettings, { gainPerMatch: '500' });
  assert.equal(r.ok, false);
  assert.match(r.error, /[a-zà-ú]/i);

  // Os dados sobrevivem a um novo controller (arquivo local).
  const store2 = createStore({ filePath: path.join(env.dir, 'ghost-rank.dat') });
  const again = createController({ client: { getPlayer: async () => ({ found: true, personaName: null }), getRecentMatches: async () => [], getHeroes: async () => ({}) }, store: store2 });
  assert.equal(again.getView().summary.currentMmr, 3110);

  // Reset exige confirmação explícita.
  r = await env.invoke(CHANNELS.reset, {});
  assert.equal(r.ok, false);
  r = await env.invoke(CHANNELS.reset, { confirm: true });
  assert.equal(r.ok, true);
  assert.equal(r.view.configured, false);
  assert.equal(fs.existsSync(path.join(env.dir, 'ghost-rank.dat')), false);
});

test('entradas inválidas viram erro em português, sem lançar', async () => {
  const env = setupEnv();
  const base = { accountInput: '123456', startMmr: '3000', goalMmr: '3200', gainPerMatch: '25' };

  let r = await env.invoke(CHANNELS.setup, { ...base, accountInput: 'https://steamcommunity.com/id/apelido' });
  assert.equal(r.ok, false);
  assert.match(r.error, /número|ID/i);

  r = await env.invoke(CHANNELS.setup, { ...base, startMmr: '-5' });
  assert.equal(r.ok, false);

  r = await env.invoke(CHANNELS.setup, { ...base, goalMmr: 'abc' });
  assert.equal(r.ok, false);

  r = await env.invoke(CHANNELS.setup, { ...base, extra: 'x' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'Dados inválidos.');

  r = await env.invoke(CHANNELS.setup, { ...base, accountInput: 'x'.repeat(500) });
  assert.equal(r.ok, false);

  assert.equal((await env.invoke(CHANNELS.getView)).view.configured, false);
});

test('remetente não confiável é recusado em todos os canais', async () => {
  const env = setupEnv();
  for (const channel of Object.values(CHANNELS)) {
    const r = await env.invoke(channel, undefined, UNTRUSTED);
    assert.equal(r.ok, false, channel);
  }
  const r = await env.invoke(CHANNELS.getView, undefined, { senderFrame: null });
  assert.equal(r.ok, false);
});

test('winrate de 50% ou menos avisa que a meta não chega', async () => {
  const env = setupEnv();
  const r = await env.invoke(CHANNELS.setup, {
    accountInput: '123456',
    startMmr: '3000',
    goalMmr: '3400',
    gainPerMatch: '25',
  });
  assert.equal(r.ok, true, r.error);
  // 2 antigas (1 vitória, 1 derrota) + novas: 1 vitória e 3 derrotas -> abaixo de 50%
  env.addMatch(raw(10, T0 + 100, true));
  env.addMatch(raw(11, T0 + 200, false));
  env.addMatch(raw(12, T0 + 300, false));
  env.addMatch(raw(13, T0 + 400, false));
  env.advance(31_000);
  const s = await env.invoke(CHANNELS.sync);
  assert.equal(s.ok, true, s.error);
  assert.equal(s.view.summary.status, 'unreachable');
  assert.equal(s.view.summary.matchesNeeded, null);
});
