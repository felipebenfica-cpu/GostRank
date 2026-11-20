'use strict';

const RANKED_LOBBY_TYPE = 7;

const isObj = (x) => x !== null && typeof x === 'object';
const isInt = (x) => typeof x === 'number' && Number.isInteger(x);

function isRanked(raw) {
  return isObj(raw) && raw.lobby_type === RANKED_LOBBY_TYPE;
}

function didWin(raw) {
  if (!isObj(raw) || !isInt(raw.player_slot) || typeof raw.radiant_win !== 'boolean') return false;
  const radiant = raw.player_slot < 128;
  return radiant === raw.radiant_win;
}

function normalizeMatch(raw) {
  if (!isObj(raw)) return null;
  const { match_id, hero_id, start_time, duration, player_slot, radiant_win, party_size } = raw;
  if (!isInt(match_id) || match_id <= 0) return null;
  if (!isInt(hero_id) || hero_id < 0) return null;
  if (!isInt(start_time) || start_time < 0) return null;
  if (!isInt(duration) || duration < 0) return null;
  if (!isInt(player_slot) || player_slot < 0) return null;
  if (typeof radiant_win !== 'boolean') return null;
  return {
    matchId: match_id,
    heroId: hero_id,
    startTime: start_time,
    duration,
    win: didWin(raw),
    partySize: isInt(party_size) && party_size > 0 ? party_size : null,
  };
}

module.exports = { RANKED_LOBBY_TYPE, isRanked, didWin, normalizeMatch };
