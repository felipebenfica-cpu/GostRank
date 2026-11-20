'use strict';

const { parseAccountId } = require('../core/accountId');
const { validateMmr, validateGain, validateGoal } = require('../core/validate');
const tracker = require('../core/tracker');
const { OpenDotaError } = require('./opendota');

class UserInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserInputError';
  }
}

function friendlyError(err) {
  if (err instanceof OpenDotaError) {
    switch (err.code) {
      case 'rate_limited': return 'O OpenDota limitou as consultas. Vamos tentar de novo em alguns minutos.';
      case 'not_found': return 'O OpenDota não encontrou esses dados.';
      case 'timeout': return 'O OpenDota demorou demais para responder. Tentaremos novamente em breve.';
      case 'network': return 'Sem conexão com o OpenDota. Verifique sua internet.';
      case 'bad_response': return 'O OpenDota enviou uma resposta inesperada. Tentaremos novamente em breve.';
      default: return 'O OpenDota está com problemas no momento. Tentaremos novamente em breve.';
    }
  }
  return 'Não foi possível atualizar agora. Tentaremos novamente em breve.';
}

function validState(s) {
  return s && typeof s === 'object' && s.version === 1 && Number.isInteger(s.accountId)
    && Array.isArray(s.events) && Array.isArray(s.baselineResults);
}

function createController({
  client,
  store,
  heroesStore = null,
  now = () => Date.now(),
  syncIntervalMs = 180000,
  manualCooldownMs = 30000,
  onUpdate = () => {},
  timers = { setInterval: (...a) => setInterval(...a), clearInterval: (...a) => clearInterval(...a) },
} = {}) {
  const nowSec = () => Math.floor(now() / 1000);

  let state = null;
  try {
    const loaded = store.load();
    if (validState(loaded)) state = loaded;
  } catch { state = null; }

  let heroes = {};
  try {
    const h = heroesStore && heroesStore.load();
    if (h && typeof h === 'object' && !Array.isArray(h)) heroes = h;
  } catch { heroes = {}; }

  let syncing = false;
  let syncPromise = null;
  let lastSyncAt = null;
  let lastError = null;
  let lastManualAt = null;
  let nextSyncAt = null;
  let timer = null;

  function getView() {
    const manualAvailableAt = lastManualAt !== null && lastManualAt + manualCooldownMs > now()
      ? lastManualAt + manualCooldownMs : null;
    return {
      configured: state !== null,
      profile: state ? { accountId: state.accountId, personaName: state.personaName ?? null } : null,
      summary: state ? tracker.summarize(state) : null,
      heroes: { ...heroes },
      sync: {
        status: syncing ? 'syncing' : (lastError ? 'error' : 'idle'),
        lastSyncAt,
        nextSyncAt: timer ? nextSyncAt : null,
        error: lastError,
        manualAvailableAt,
      },
    };
  }

  function emit() {
    try { onUpdate(getView()); } catch { /* o consumidor não pode quebrar o serviço */ }
  }

  function persist() {
    store.save(state);
  }

  async function ensureHeroes() {
    if (Object.keys(heroes).length > 0) return;
    try {
      const h = await client.getHeroes();
      heroes = h;
      if (heroesStore) {
        try { heroesStore.save(h); } catch { /* opcional */ }
      }
    } catch { /* nomes de heróis são opcionais */ }
  }

  function need(v, label) {
    if (!v.ok) throw new UserInputError(v.error || `${label} inválido.`);
    return v.value;
  }

  async function setup(input) {
    if (!input || typeof input !== 'object') throw new UserInputError('Dados inválidos.');
    const acc = parseAccountId(String(input.accountInput ?? ''));
    if (!acc.ok) throw new UserInputError(acc.error);
    const startMmr = need(validateMmr(input.startMmr), 'MMR inicial');
    const goalMmr = need(validateGoal(input.goalMmr), 'Meta');
    const gainPerMatch = need(validateGain(input.gainPerMatch), 'Ganho por partida');

    if (syncPromise) await syncPromise.catch(() => {});

    let player;
    let recent;
    try {
      player = await client.getPlayer(acc.accountId);
      if (!player.found) {
        throw new UserInputError('Jogador não encontrado no OpenDota. Confira o número informado.');
      }
      recent = await client.getRecentMatches(acc.accountId, 20);
    } catch (err) {
      if (err instanceof UserInputError) throw err;
      throw new UserInputError(friendlyError(err));
    }

    state = tracker.createTracker({
      accountId: acc.accountId,
      personaName: player.personaName,
      startMmr,
      goalMmr,
      gainPerMatch,
      recentMatches: recent,
      now: nowSec(),
    });
    try {
      persist();
    } catch {
      throw new UserInputError('Não foi possível salvar os dados no computador.');
    }
    lastError = null;
    lastSyncAt = now();
    if (timer) nextSyncAt = now() + syncIntervalMs;
    await ensureHeroes();
    return getView();
  }

  async function doSync() {
    syncing = true;
    emit();
    try {
      const recent = await client.getRecentMatches(state.accountId, 20);
      const { state: next, added } = tracker.ingestMatches(state, recent);
      if (added.length > 0) {
        state = next;
        persist();
      }
      await ensureHeroes();
      lastError = null;
      lastSyncAt = now();
    } catch (err) {
      lastError = friendlyError(err);
    } finally {
      syncing = false;
      if (timer) nextSyncAt = now() + syncIntervalMs;
      emit();
    }
  }

  async function sync({ manual = false } = {}) {
    if (!state) return getView();
    if (syncing) return getView();
    if (manual) {
      if (lastManualAt !== null && lastManualAt + manualCooldownMs > now()) return getView();
      lastManualAt = now();
    }
    syncPromise = doSync();
    try { await syncPromise; } finally { syncPromise = null; }
    return getView();
  }

  function correctMmr(input) {
    if (!state) throw new UserInputError('Configure o app antes de corrigir o MMR.');
    const mmr = need(validateMmr(input && input.mmr), 'MMR');
    const next = tracker.applyCorrection(state, mmr, nowSec());
    const prev = state;
    state = next;
    try { persist(); } catch {
      state = prev;
      throw new UserInputError('Não foi possível salvar os dados no computador.');
    }
    return getView();
  }

  function updateSettings(input) {
    if (!state) throw new UserInputError('Configure o app antes de alterar as opções.');
    const patch = {};
    if (input && input.goalMmr !== undefined && input.goalMmr !== null) {
      patch.goalMmr = need(validateGoal(input.goalMmr), 'Meta');
    }
    if (input && input.gainPerMatch !== undefined && input.gainPerMatch !== null) {
      patch.gainPerMatch = need(validateGain(input.gainPerMatch), 'Ganho por partida');
    }
    if (Object.keys(patch).length === 0) throw new UserInputError('Nada para alterar.');
    const next = tracker.updateSettings(state, patch);
    const prev = state;
    state = next;
    try { persist(); } catch {
      state = prev;
      throw new UserInputError('Não foi possível salvar os dados no computador.');
    }
    return getView();
  }

  function reset() {
    store.clear();
    state = null;
    lastError = null;
    lastSyncAt = null;
    lastManualAt = null;
    return getView();
  }

  function start() {
    if (timer) return;
    nextSyncAt = now() + syncIntervalMs;
    timer = timers.setInterval(() => { sync({ manual: false }).catch(() => {}); }, syncIntervalMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
    if (state) sync({ manual: false }).catch(() => {});
  }

  function stop() {
    if (!timer) return;
    timers.clearInterval(timer);
    timer = null;
    nextSyncAt = null;
  }

  return {
    getView, setup, sync, correctMmr, updateSettings, reset, start, stop,
  };
}

module.exports = { createController, UserInputError };
