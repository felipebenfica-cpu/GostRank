'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createController, UserInputError } = require('../../src/main/controller');
const { OpenDotaError } = require('../../src/main/opendota');
const { createStore } = require('../../src/main/store');

const T0 = 1_800_000_000; // segundos

function raw(id, startTime, win, extra = {}) {
  return { match_id: id, hero_id: 1, start_time: startTime, duration: 1800, lobby_type: 7, player_slot: 0, radiant_win: win, party_size: 1, ...extra };
}

function fakeClient(overrides = {}) {
  const c = {
    matches: [],
    calls: { getPlayer: 0, getRecentMatches: 0, getHeroes: 0 },
    player: { personaName: 'Fulano', found: true },
    failWith: null,
    async getPlayer() { c.calls.getPlayer++; return c.player; },
    async getRecentMatches() {
      c.calls.getRecentMatches++;
      if (c.failWith) throw c.failWith;
      return c.matches;
    },
    async getHeroes() { c.calls.getHeroes++; return { 1: 'Anti-Mage' }; },
    ...overrides,
  };
  return c;
}

function setupEnv(clientOverrides, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-ctl-'));
  const store = createStore({ filePath: path.join(dir, 'state.bin') });
  const client = fakeClient(clientOverrides);
  const clock = { t: T0 * 1000 };
  const updates = [];
  const mk = () => createController({
    client, store, now: () => clock.t, onUpdate: (v) => updates.push(v), ...opts,
  });
  return { dir, store, client, clock, updates, ctl: mk(), mk };
}

const SETUP = { accountInput: '123456', startMmr: 3000, goalMmr: 4000, gainPerMatch: 25 };

test('estado inicial não configurado', () => {
  const { ctl } = setupEnv();
  const v = ctl.getView();
  assert.equal(v.configured, false);
  assert.equal(v.profile, null);
  assert.equal(v.summary, null);
  assert.equal(v.sync.status, 'idle');
});

test('setup valida entradas com mensagens em português', async () => {
  const { ctl, client } = setupEnv();
  await assert.rejects(ctl.setup({ ...SETUP, accountInput: 'abc' }), UserInputError);
  await assert.rejects(ctl.setup({ ...SETUP, startMmr: -5 }), UserInputError);
  await assert.rejects(ctl.setup({ ...SETUP, goalMmr: 'x' }), UserInputError);
  await assert.rejects(ctl.setup({ ...SETUP, gainPerMatch: 500 }), UserInputError);
  await assert.rejects(ctl.setup(null), UserInputError);
  assert.equal(client.calls.getPlayer, 0);
  assert.equal(ctl.getView().configured, false);
});

test('setup: jogador inexistente e erro de rede viram UserInputError', async () => {
  let env = setupEnv();
  env.client.player = { personaName: null, found: false };
  await assert.rejects(env.ctl.setup(SETUP), (e) => e instanceof UserInputError && /não encontrado/i.test(e.message));
  env = setupEnv();
  env.client.failWith = new OpenDotaError('network');
  await assert.rejects(env.ctl.setup(SETUP), (e) => e instanceof UserInputError && /conexão/i.test(e.message));
  assert.equal(env.ctl.getView().configured, false);
});

test('fluxo completo: setup -> nova partida -> MMR -> correção -> meta inalcançável', async () => {
  const env = setupEnv();
  const { ctl, client, clock } = env;
  // 20 ranqueadas anteriores: 6 vitórias e 14 derrotas (winrate 30%)
  client.matches = Array.from({ length: 20 }, (_, i) => raw(100 + i, T0 - 10000 + i, i < 6));

  let v = await ctl.setup(SETUP);
  assert.equal(v.configured, true);
  assert.deepEqual(v.profile, { accountId: 123456, personaName: 'Fulano' });
  assert.equal(v.summary.currentMmr, 3000);
  assert.equal(v.summary.matches.length, 0);
  assert.equal(v.heroes[1], 'Anti-Mage');
  assert.equal(v.summary.status, 'unreachable');

  // persistido
  assert.equal(env.store.load().accountId, 123456);

  // sync sem novidade
  v = await ctl.sync({ manual: false });
  assert.equal(v.summary.matches.length, 0);
  assert.equal(v.sync.status, 'idle');

  // nova partida (vitória) aparece e o MMR atualiza
  client.matches = [raw(999, T0 + 100, true), ...client.matches];
  v = await ctl.sync({ manual: false });
  assert.equal(v.summary.matches.length, 1);
  assert.equal(v.summary.currentMmr, 3025);
  assert.equal(v.summary.lastMatch.matchId, 999);
  assert.equal(v.sync.lastSyncAt, clock.t);
  assert.equal(env.store.load().events.length, 1);

  // sync repetido não duplica
  v = await ctl.sync({ manual: false });
  assert.equal(v.summary.matches.length, 1);

  // correção manual
  v = ctl.correctMmr({ mmr: 3500 });
  assert.equal(v.summary.currentMmr, 3500);
  assert.equal(v.summary.remaining, 500);
  assert.equal(v.summary.status, 'unreachable');
  assert.equal(env.store.load().events.at(-1).type, 'correction');

  // mudar ganho vale só para o futuro
  v = ctl.updateSettings({ goalMmr: 3600, gainPerMatch: 30 });
  assert.equal(v.summary.goalMmr, 3600);
  assert.equal(v.summary.currentMmr, 3500);
  client.matches = [raw(1000, T0 + 200, true), ...client.matches];
  v = await ctl.sync({ manual: false });
  assert.equal(v.summary.currentMmr, 3530);

  // meta atingida
  v = ctl.correctMmr({ mmr: 3700 });
  assert.equal(v.summary.status, 'goal_reached');
});

test('correctMmr e updateSettings validam e exigem configuração', async () => {
  const { ctl, client } = setupEnv();
  assert.throws(() => ctl.correctMmr({ mmr: 3000 }), UserInputError);
  assert.throws(() => ctl.updateSettings({ goalMmr: 3000 }), UserInputError);
  await ctl.setup(SETUP);
  assert.throws(() => ctl.correctMmr({ mmr: 99999 }), UserInputError);
  assert.throws(() => ctl.correctMmr({ mmr: 'x' }), UserInputError);
  assert.throws(() => ctl.correctMmr(undefined), UserInputError);
  assert.throws(() => ctl.updateSettings({}), UserInputError);
  assert.throws(() => ctl.updateSettings({ gainPerMatch: 0 }), UserInputError);
  assert.throws(() => ctl.updateSettings({ goalMmr: 1.5 }), UserInputError);
  assert.equal(ctl.getView().summary.currentMmr, 3000);
  assert.ok(client);
});

test('sync manual respeita cooldown; automático não', async () => {
  const { ctl, client, clock } = setupEnv(undefined, { manualCooldownMs: 30000 });
  await ctl.setup(SETUP);
  const base = client.calls.getRecentMatches;
  let v = await ctl.sync({ manual: true });
  assert.equal(client.calls.getRecentMatches, base + 1);
  assert.equal(v.sync.manualAvailableAt, clock.t + 30000);
  clock.t += 10000;
  v = await ctl.sync({ manual: true });
  assert.equal(client.calls.getRecentMatches, base + 1);
  await ctl.sync({ manual: false });
  assert.equal(client.calls.getRecentMatches, base + 2);
  clock.t += 20000;
  v = await ctl.sync({ manual: true });
  assert.equal(client.calls.getRecentMatches, base + 3);
});

test('erro de rede no sync vira sync.error em português, sem lançar, e se recupera', async () => {
  const { ctl, client } = setupEnv();
  await ctl.setup(SETUP);
  const casos = {
    rate_limited: /limitou/, timeout: /demorou/, network: /conexão/, bad_response: /inesperada/, http_error: /problemas/, not_found: /encontrou/,
  };
  for (const [code, re] of Object.entries(casos)) {
    client.failWith = new OpenDotaError(code);
    const v = await ctl.sync({ manual: false });
    assert.equal(v.sync.status, 'error');
    assert.match(v.sync.error, re);
  }
  client.failWith = new Error('boom interno 123456');
  let v = await ctl.sync({ manual: false });
  assert.equal(v.sync.status, 'error');
  assert.ok(!v.sync.error.includes('boom'));
  client.failWith = null;
  v = await ctl.sync({ manual: false });
  assert.equal(v.sync.status, 'idle');
  assert.equal(v.sync.error, null);
});

test('nunca há duas sincronizações simultâneas', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { ctl, client } = setupEnv();
  await ctl.setup(SETUP);
  const base = client.calls.getRecentMatches;
  let active = 0; let maxActive = 0;
  client.getRecentMatches = async () => {
    client.calls.getRecentMatches++;
    active++; maxActive = Math.max(maxActive, active);
    await gate;
    active--;
    return [];
  };
  const p1 = ctl.sync({ manual: false });
  const p2 = ctl.sync({ manual: false });
  assert.equal(ctl.getView().sync.status, 'syncing');
  const v2 = await p2;
  assert.equal(v2.sync.status, 'syncing');
  release();
  await p1;
  assert.equal(maxActive, 1);
  assert.equal(client.calls.getRecentMatches, base + 1);
  assert.equal(ctl.getView().sync.status, 'idle');
});

test('sync sem configuração não chama a rede', async () => {
  const { ctl, client } = setupEnv();
  const v = await ctl.sync({ manual: true });
  assert.equal(v.configured, false);
  assert.equal(client.calls.getRecentMatches, 0);
});

test('reset apaga dados; novo controlador carrega dados salvos', async () => {
  const env = setupEnv();
  await env.ctl.setup(SETUP);
  const ctl2 = env.mk();
  assert.equal(ctl2.getView().configured, true);
  assert.equal(ctl2.getView().summary.currentMmr, 3000);
  const v = env.ctl.reset();
  assert.equal(v.configured, false);
  assert.equal(env.store.load(), null);
  assert.equal(env.mk().getView().configured, false);
});

test('dados salvos inválidos são ignorados', () => {
  const env = setupEnv();
  env.store.save({ version: 7, lixo: true });
  assert.equal(env.mk().getView().configured, false);
});

test('start/stop com timers falsos e onUpdate', async () => {
  const fired = [];
  let cleared = 0;
  const timers = {
    setInterval: (fn, ms) => { fired.push({ fn, ms }); return { id: 1 }; },
    clearInterval: () => { cleared++; },
  };
  const env = setupEnv(undefined, { timers, syncIntervalMs: 180000 });
  await env.ctl.setup(SETUP);
  env.ctl.start();
  env.ctl.start(); // idempotente
  assert.equal(fired.length, 1);
  assert.equal(fired[0].ms, 180000);
  assert.equal(env.ctl.getView().sync.nextSyncAt, env.clock.t + 180000);
  await new Promise((r) => setImmediate(r)); // sync imediato do start
  env.client.matches = [raw(555, T0 + 50, false)];
  env.updates.length = 0;
  fired[0].fn();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.ok(env.updates.length >= 2);
  assert.equal(env.updates.at(-1).summary.currentMmr, 2975);
  env.ctl.stop();
  assert.equal(cleared, 1);
  assert.equal(env.ctl.getView().sync.nextSyncAt, null);
});

test('onUpdate que lança não quebra o sync', async () => {
  const env = setupEnv(undefined, { onUpdate: () => { throw new Error('x'); } });
  await env.ctl.setup(SETUP);
  const v = await env.ctl.sync({ manual: false });
  assert.equal(v.sync.status, 'idle');
});

test('falha ao buscar heróis não impede o sync', async () => {
  const env = setupEnv({ async getHeroes() { throw new OpenDotaError('network'); } });
  const v = await env.ctl.setup(SETUP);
  assert.deepEqual(v.heroes, {});
  assert.equal(v.configured, true);
});
