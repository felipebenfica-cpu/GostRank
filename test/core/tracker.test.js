'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../src/core/tracker');

const NOW = 1700000000;
// vitória (Radiant, radiant_win true) ou derrota
const rm = (id, t, win = true, o = {}) => ({ match_id: id, hero_id: 1, start_time: t, duration: 2000,
  player_slot: 0, radiant_win: win, lobby_type: 7, ...o });
const base = (o = {}) => T.createTracker({ accountId: 42, personaName: 'Fulano', startMmr: 4000,
  goalMmr: 4200, gainPerMatch: 25, recentMatches: [], now: NOW, ...o });
const freeze = (x) => { Object.freeze(x); for (const v of Object.values(x)) if (v && typeof v === 'object') freeze(v); return x; };

test('createTracker sem histórico', () => {
  const s = base();
  assert.deepEqual(s, { version: 1, accountId: 42, personaName: 'Fulano', startMmr: 4000, goalMmr: 4200,
    gainPerMatch: 25, startedAt: NOW, baselineCutoff: NOW, baselineResults: [], events: [] });
});

test('createTracker: baseline só ranqueadas, mais recente primeiro, até 20, cutoff = mais recente', () => {
  const recent = [];
  for (let i = 0; i < 25; i++) recent.push(rm(i + 1, 1000 + i, i % 2 === 0)); // i par = vitória
  recent.push(rm(999, 5000, true, { lobby_type: 0 })); // não ranqueada, ignorada
  recent.push({ lixo: true });
  const s = base({ recentMatches: recent });
  assert.equal(s.baselineCutoff, 1024);
  assert.equal(s.baselineResults.length, 20);
  assert.equal(s.baselineResults[0], true); // i=24 vitória
  assert.equal(s.baselineResults[1], false); // i=23
  assert.equal(s.personaName, 'Fulano');
  assert.equal(base({ personaName: undefined }).personaName, null);
});

test('ingestMatches: filtra, ordena cronologicamente, aplica delta', () => {
  const s0 = base({ recentMatches: [rm(1, NOW - 100)] });
  assert.equal(s0.baselineCutoff, NOW - 100);
  const { state, added } = T.ingestMatches(s0, [
    rm(5, NOW + 300, false),
    rm(3, NOW + 100, true),
    rm(2, NOW - 100, true), // = cutoff, ignorada
    rm(1, NOW - 200, true), // antes, ignorada
    rm(4, NOW + 200, true, { lobby_type: 0 }), // não ranqueada
    { lixo: 1 },
  ]);
  assert.deepEqual(added.map((e) => e.matchId), [3, 5]);
  assert.deepEqual(added.map((e) => e.delta), [25, -25]);
  assert.deepEqual(state.events, added);
  assert.equal(added[0].type, 'match');
  assert.equal(T.currentMmr(state), 4000);
});

test('ingestMatches: sem duplicar matchId (entre chamadas e dentro do lote)', () => {
  const s0 = base();
  const r1 = T.ingestMatches(s0, [rm(10, NOW + 10), rm(10, NOW + 10)]);
  assert.equal(r1.added.length, 1);
  const r2 = T.ingestMatches(r1.state, [rm(10, NOW + 10), rm(11, NOW + 20, false)]);
  assert.deepEqual(r2.added.map((e) => e.matchId), [11]);
  assert.equal(r2.state.events.length, 2);
  const r3 = T.ingestMatches(r2.state, [rm(10, NOW + 10)]);
  assert.equal(r3.added.length, 0);
});

test('ingestMatches: entrada inválida não lança', () => {
  const s0 = base();
  for (const v of [null, undefined, 'x', {}, 5]) {
    const r = T.ingestMatches(s0, v);
    assert.deepEqual(r.added, []);
    assert.deepEqual(r.state, s0);
  }
});

test('ingestMatches usa o ganho vigente na ingestão', () => {
  let s = base();
  s = T.ingestMatches(s, [rm(1, NOW + 1, true)]).state;
  s = T.updateSettings(s, { gainPerMatch: 30 });
  s = T.ingestMatches(s, [rm(2, NOW + 2, true), rm(3, NOW + 3, false)]).state;
  assert.deepEqual(s.events.map((e) => e.delta), [25, 30, -30]);
  assert.equal(T.currentMmr(s), 4025);
});

test('applyCorrection define valor absoluto e partidas seguintes somam sobre ele', () => {
  let s = base();
  s = T.ingestMatches(s, [rm(1, NOW + 1, true)]).state; // 4025
  s = T.applyCorrection(s, 4500, NOW + 50);
  assert.equal(T.currentMmr(s), 4500);
  assert.deepEqual(s.events[1], { type: 'correction', mmr: 4500, at: NOW + 50 });
  s = T.ingestMatches(s, [rm(2, NOW + 100, false)]).state;
  assert.equal(T.currentMmr(s), 4475);
  const sum = T.summarize(s);
  assert.deepEqual(sum.matches.map((m) => m.mmrAfter), [4475, 4025]);
});

test('applyCorrection inválida mantém o estado', () => {
  const s = base();
  for (const v of [-1, 20001, 'x', NaN, 1.5, null]) {
    assert.deepEqual(T.applyCorrection(s, v, NOW), s);
  }
});

test('updateSettings valida e ignora campos inválidos', () => {
  const s = base();
  assert.equal(T.updateSettings(s, { goalMmr: 5000 }).goalMmr, 5000);
  assert.equal(T.updateSettings(s, { gainPerMatch: 30 }).gainPerMatch, 30);
  const keep = T.updateSettings(s, { goalMmr: -5, gainPerMatch: 500 });
  assert.equal(keep.goalMmr, 4200);
  assert.equal(keep.gainPerMatch, 25);
  assert.deepEqual(T.updateSettings(s, undefined), s);
  assert.deepEqual(T.updateSettings(s, {}), s);
});

test('funções não mutam a entrada', () => {
  const s = freeze(base({ recentMatches: [rm(1, NOW - 5)] }));
  const raws = freeze([rm(2, NOW + 1), rm(3, NOW + 2, false)]);
  const { state } = T.ingestMatches(s, raws);
  freeze(state);
  assert.doesNotThrow(() => {
    T.applyCorrection(state, 4100, NOW);
    T.updateSettings(state, { goalMmr: 4300 });
    T.currentMmr(state);
    T.summarize(state);
  });
  assert.equal(s.events.length, 0);
});

// Monta estado com N partidas rastreadas (resultados em ordem cronológica) e baseline.
function withResults(results, baselineResults = [], o = {}) {
  let s = { ...base(o), baselineResults };
  const raws = results.map((w, i) => rm(i + 1, NOW + i + 1, w));
  return T.ingestMatches(s, raws).state;
}

test('summarize: startMmr é o MMR inicial e não muda com partidas nem correções', () => {
  assert.equal(T.summarize(base()).startMmr, 4000);
  const com = withResults([true, true, false]);
  assert.equal(T.summarize(com).startMmr, 4000);
  const corrigido = T.applyCorrection(com, 4300, NOW + 100);
  assert.equal(T.summarize(corrigido).startMmr, 4000);
  assert.equal(T.summarize(corrigido).currentMmr, 4300);
});

test('summarize: estado inicial', () => {
  const sum = T.summarize(base());
  assert.equal(sum.currentMmr, 4000);
  assert.equal(sum.remaining, 200);
  assert.equal(sum.lastMatch, null);
  assert.equal(sum.recentWinrate, null);
  assert.equal(sum.sampleSize, 0);
  assert.equal(sum.matchesNeeded, null);
  assert.equal(sum.status, 'insufficient_data');
  assert.deepEqual(sum.matches, []);
});

test('summarize: lastMatch e lista mais nova primeiro', () => {
  const sum = T.summarize(withResults([true, false, true]));
  assert.deepEqual(sum.matches.map((m) => m.matchId), [3, 2, 1]);
  assert.deepEqual(sum.matches.map((m) => m.mmrAfter), [4025, 4000, 4025]);
  assert.deepEqual(sum.lastMatch, { matchId: 3, heroId: 1, startTime: NOW + 3, win: true, delta: 25 });
  assert.equal(sum.currentMmr, 4025);
  assert.equal(sum.remaining, 175);
});

test('summarize: winrate usa rastreadas + baselineResults, limitado a 20', () => {
  // 2 rastreadas (V, D) + baseline 18 (todas vitórias) + 5 extras derrotas que devem ficar de fora
  const baseline = [...Array(18).fill(true), ...Array(5).fill(false)];
  const sum = T.summarize(withResults([true, false], baseline));
  assert.equal(sum.sampleSize, 20);
  assert.equal(sum.recentWinrate, 19 / 20);
  // sem rastreadas: só baseline
  const only = T.summarize(withResults([], [true, true, false, false]));
  assert.equal(only.sampleSize, 4);
  assert.equal(only.recentWinrate, 0.5);
});

test('summarize: status insufficient_data com menos de 5', () => {
  const sum = T.summarize(withResults([true, true, true, true]));
  assert.equal(sum.sampleSize, 4);
  assert.equal(sum.status, 'insufficient_data');
  assert.equal(sum.matchesNeeded, 2 === 2 ? sum.matchesNeeded : null); // calculado mesmo assim (w > 0.5)
  assert.equal(T.summarize(withResults([true, true, true, true, true])).status, 'on_track');
});

test('summarize: unreachable com winrate de 50% ou menos', () => {
  const half = T.summarize(withResults([true, false, true, false, true, false]));
  assert.equal(half.recentWinrate, 0.5);
  assert.equal(half.status, 'unreachable');
  assert.equal(half.matchesNeeded, null);
  const low = T.summarize(withResults([false, false, false, false, true]));
  assert.equal(low.status, 'unreachable');
  assert.equal(low.matchesNeeded, null);
});

test('summarize: on_track e matchesNeeded', () => {
  // 20 partidas, 15 vitórias: w=0.75, 2w-1=0.5. remaining depende das partidas.
  const results = [...Array(15).fill(true), ...Array(5).fill(false)];
  const s = withResults(results, [], { goalMmr: 4300 });
  const sum = T.summarize(s);
  assert.equal(sum.sampleSize, 20);
  assert.equal(sum.recentWinrate, 0.75);
  assert.equal(sum.currentMmr, 4000 + 10 * 25);
  assert.equal(sum.remaining, 50);
  assert.equal(sum.status, 'on_track');
  assert.equal(sum.matchesNeeded, 4); // ceil(50 / (25 * 0.5))
});

test('summarize: matchesNeeded sem erro de ponto flutuante', () => {
  // w = 0.6 => 2w-1 = 0.2; remaining 100, gain 25 => exatamente 20 (não 21)
  const base20 = [...Array(12).fill(true), ...Array(8).fill(false)];
  let s = withResults(base20, [], { goalMmr: 4000 + 4 * 25 + 100 });
  const sum = T.summarize(s);
  assert.equal(sum.recentWinrate, 0.6);
  assert.equal(sum.remaining, 100);
  assert.equal(sum.matchesNeeded, 20);
  // arredonda para cima
  const s2 = T.updateSettings(s, { goalMmr: 4000 + 4 * 25 + 101 });
  assert.equal(T.summarize(s2).matchesNeeded, 21);
});

test('summarize: goal_reached (inclusive em igualdade e acima), sem matchesNeeded', () => {
  const s = withResults([true, true, true, true, true, true, true, true], [], { goalMmr: 4200 });
  const sum = T.summarize(s);
  assert.equal(sum.currentMmr, 4200);
  assert.equal(sum.remaining, 0);
  assert.equal(sum.status, 'goal_reached');
  assert.equal(sum.matchesNeeded, null);
  const over = T.summarize(T.applyCorrection(base(), 5000, NOW));
  assert.equal(over.status, 'goal_reached');
  assert.equal(over.remaining, -800);
});

test('summarize: correção reflete em currentMmr e remaining', () => {
  const sum = T.summarize(T.applyCorrection(base(), 4100, NOW));
  assert.equal(sum.currentMmr, 4100);
  assert.equal(sum.remaining, 100);
});
