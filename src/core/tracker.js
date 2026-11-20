'use strict';

const { isRanked, normalizeMatch } = require('./matches');
const { validateMmr, validateGain, validateGoal } = require('./validate');

const BASELINE_SIZE = 20;
const MIN_SAMPLE = 5;

const nowSeconds = (now) => (Number.isFinite(now) ? Math.floor(now) : Math.floor(Date.now() / 1000));

function rankedNormalized(rawMatches) {
  if (!Array.isArray(rawMatches)) return [];
  const out = [];
  for (const raw of rawMatches) {
    if (!isRanked(raw)) continue;
    const m = normalizeMatch(raw);
    if (m) out.push(m);
  }
  return out;
}

function cloneState(state, patch) {
  return { ...state, baselineResults: [...state.baselineResults], events: state.events.map((e) => ({ ...e })), ...patch };
}

// `now` em segundos Unix.
function createTracker({ accountId, personaName, startMmr, goalMmr, gainPerMatch, recentMatches, now } = {}) {
  const startedAt = nowSeconds(now);
  const ranked = rankedNormalized(recentMatches);
  const byNewest = [...ranked].sort((a, b) => b.startTime - a.startTime || b.matchId - a.matchId);
  return {
    version: 1,
    accountId,
    personaName: typeof personaName === 'string' ? personaName : null,
    startMmr,
    goalMmr,
    gainPerMatch: gainPerMatch === undefined ? 25 : gainPerMatch,
    startedAt,
    baselineCutoff: byNewest.length > 0 ? byNewest[0].startTime : startedAt,
    baselineResults: byNewest.slice(0, BASELINE_SIZE).map((m) => m.win),
    events: [],
  };
}

function ingestMatches(state, rawMatches) {
  const seen = new Set();
  for (const e of state.events) if (e.type === 'match') seen.add(e.matchId);
  const fresh = [];
  for (const m of rankedNormalized(rawMatches)) {
    if (m.startTime <= state.baselineCutoff || seen.has(m.matchId)) continue;
    seen.add(m.matchId);
    fresh.push(m);
  }
  fresh.sort((a, b) => a.startTime - b.startTime || a.matchId - b.matchId);
  const added = fresh.map((m) => ({
    type: 'match',
    matchId: m.matchId,
    heroId: m.heroId,
    startTime: m.startTime,
    duration: m.duration,
    win: m.win,
    delta: m.win ? state.gainPerMatch : -state.gainPerMatch,
  }));
  if (added.length === 0) return { state: cloneState(state), added: [] };
  return { state: cloneState(state, { events: [...state.events.map((e) => ({ ...e })), ...added] }), added };
}

// `now` em segundos Unix.
function applyCorrection(state, mmr, now) {
  const v = validateMmr(mmr);
  if (!v.ok) return cloneState(state);
  const s = cloneState(state);
  s.events.push({ type: 'correction', mmr: v.value, at: nowSeconds(now) });
  return s;
}

function updateSettings(state, settings) {
  const patch = {};
  const src = settings && typeof settings === 'object' ? settings : {};
  if (src.goalMmr !== undefined) {
    const g = validateGoal(src.goalMmr);
    if (g.ok) patch.goalMmr = g.value;
  }
  if (src.gainPerMatch !== undefined) {
    const g = validateGain(src.gainPerMatch);
    if (g.ok) patch.gainPerMatch = g.value;
  }
  return cloneState(state, patch);
}

function currentMmr(state) {
  let mmr = state.startMmr;
  for (const e of state.events) {
    if (e.type === 'correction') mmr = e.mmr;
    else if (e.type === 'match') mmr += e.delta;
  }
  return mmr;
}

function summarize(state) {
  const matchesOldestFirst = [];
  let mmr = state.startMmr;
  for (const e of state.events) {
    if (e.type === 'correction') {
      mmr = e.mmr;
    } else if (e.type === 'match') {
      mmr += e.delta;
      matchesOldestFirst.push({
        matchId: e.matchId,
        heroId: e.heroId,
        startTime: e.startTime,
        duration: e.duration,
        win: e.win,
        delta: e.delta,
        mmrAfter: mmr,
      });
    }
  }
  const matches = matchesOldestFirst.reverse();
  const current = mmr;
  const remaining = state.goalMmr - current;

  const last = matches[0] || null;
  const lastMatch = last
    ? { matchId: last.matchId, heroId: last.heroId, startTime: last.startTime, win: last.win, delta: last.delta }
    : null;

  const results = [...matches.map((m) => m.win), ...state.baselineResults].slice(0, BASELINE_SIZE);
  const sampleSize = results.length;
  const wins = results.filter(Boolean).length;
  const recentWinrate = sampleSize > 0 ? wins / sampleSize : null;

  // Aritmética inteira: w = wins/n, então 2w-1 = (2*wins-n)/n.
  let matchesNeeded = null;
  if (sampleSize > 0 && 2 * wins > sampleSize && remaining > 0) {
    matchesNeeded = Math.ceil((remaining * sampleSize) / (state.gainPerMatch * (2 * wins - sampleSize)));
  }

  let status;
  if (remaining <= 0) status = 'goal_reached';
  else if (sampleSize < MIN_SAMPLE) status = 'insufficient_data';
  else if (recentWinrate > 0.5) status = 'on_track';
  else status = 'unreachable';

  return {
    startMmr: state.startMmr,
    currentMmr: current,
    goalMmr: state.goalMmr,
    gainPerMatch: state.gainPerMatch,
    remaining,
    lastMatch,
    recentWinrate,
    sampleSize,
    matchesNeeded,
    status,
    matches,
  };
}

module.exports = { createTracker, ingestMatches, applyCorrection, updateSettings, currentMmr, summarize };
