'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { RANKED_LOBBY_TYPE, isRanked, didWin, normalizeMatch } = require('../../src/core/matches');

const raw = (o = {}) => ({ match_id: 100, hero_id: 14, start_time: 1700000000, duration: 2400,
  player_slot: 0, radiant_win: true, lobby_type: 7, party_size: 2, ...o });

test('constante e isRanked', () => {
  assert.equal(RANKED_LOBBY_TYPE, 7);
  assert.equal(isRanked(raw()), true);
  assert.equal(isRanked(raw({ lobby_type: 0 })), false);
  assert.equal(isRanked(raw({ lobby_type: '7' })), false);
  assert.equal(isRanked(null), false);
  assert.equal(isRanked(undefined), false);
});

test('didWin considera o lado', () => {
  assert.equal(didWin(raw({ player_slot: 0, radiant_win: true })), true);
  assert.equal(didWin(raw({ player_slot: 127, radiant_win: true })), true);
  assert.equal(didWin(raw({ player_slot: 127, radiant_win: false })), false);
  assert.equal(didWin(raw({ player_slot: 128, radiant_win: false })), true);
  assert.equal(didWin(raw({ player_slot: 132, radiant_win: true })), false);
  assert.equal(didWin(null), false);
});

test('normalizeMatch válido', () => {
  assert.deepEqual(normalizeMatch(raw()), { matchId: 100, heroId: 14, startTime: 1700000000,
    duration: 2400, win: true, partySize: 2 });
  assert.equal(normalizeMatch(raw({ party_size: null })).partySize, null);
  assert.equal(normalizeMatch(raw({ party_size: undefined })).partySize, null);
  assert.equal(normalizeMatch(raw({ player_slot: 130, radiant_win: false })).win, true);
});

test('normalizeMatch devolve null para dados inválidos sem lançar', () => {
  for (const k of ['match_id', 'hero_id', 'start_time', 'duration', 'player_slot', 'radiant_win']) {
    const r = raw();
    delete r[k];
    assert.equal(normalizeMatch(r), null, k);
  }
  assert.equal(normalizeMatch(raw({ match_id: '100' })), null);
  assert.equal(normalizeMatch(raw({ radiant_win: 1 })), null);
  assert.equal(normalizeMatch(raw({ duration: 1.5 })), null);
  assert.equal(normalizeMatch(null), null);
  assert.equal(normalizeMatch('x'), null);
  assert.equal(normalizeMatch(undefined), null);
});
