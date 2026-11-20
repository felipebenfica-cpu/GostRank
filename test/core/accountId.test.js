'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAccountId } = require('../../src/core/accountId');

const ok = (input, id) => assert.deepEqual(parseAccountId(input), { ok: true, accountId: id });
const bad = (input) => {
  const r = parseAccountId(input);
  assert.equal(r.ok, false);
  assert.equal(typeof r.error, 'string');
  assert.ok(r.error.length > 0);
  return r;
};

test('ID de 32 bits válido e limites', () => {
  ok('86745912', 86745912);
  ok('  86745912 ', 86745912);
  ok('1', 1);
  ok('4294967295', 4294967295);
  bad('0');
  bad('4294967296');
});

test('SteamID64 converte com BigInt', () => {
  ok('76561197960265729', 1);
  ok('76561198047011640', 86745912);
  ok('76561202255233023', 4294967295);
  bad('76561197960265728'); // 32 bits = 0
  bad('76561202255233024'); // 32 bits = 4294967296
});

test('URLs aceitas', () => {
  ok('https://steamcommunity.com/profiles/76561198047011640', 86745912);
  ok('steamcommunity.com/profiles/76561198047011640/', 86745912);
  ok('https://www.opendota.com/players/86745912', 86745912);
  ok('https://www.dotabuff.com/players/86745912/matches?x=1', 86745912);
  ok('http://stratz.com/players/86745912', 86745912);
});

test('URL de apelido da Steam é recusada com explicação', () => {
  const r = bad('https://steamcommunity.com/id/meuapelido');
  assert.match(r.error, /número|numéric/i);
});

test('entradas inválidas nunca lançam', () => {
  for (const v of ['', '   ', 'abc', '12abc', '-5', '1.5', '1e3', 'https://exemplo.com/players/123',
    'https://opendota.com/matches/123', null, undefined, 123, {}, []]) {
    assert.doesNotThrow(() => parseAccountId(v));
    assert.equal(parseAccountId(v).ok, false);
  }
});

test('mais de 200 caracteres é recusado', () => {
  bad('1'.repeat(201));
  bad('https://opendota.com/players/' + '1'.repeat(200));
  ok('0'.repeat(150) + '86745912', 86745912); // 158 chars, ainda aceito
});
