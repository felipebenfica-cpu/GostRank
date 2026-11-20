'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedExternalUrl, isAppUrl, isDevToolsAllowed } = require('../../src/main/security');

test('links externos permitidos', () => {
  for (const u of [
    'https://www.opendota.com/players/1',
    'https://opendota.com/',
    'https://steamcommunity.com/profiles/76561197960265729',
    'https://docs.opendota.com/',
  ]) assert.equal(isAllowedExternalUrl(u), true, u);
});

test('links externos negados', () => {
  for (const u of [
    'http://www.opendota.com/',
    'https://evil.com/',
    'https://opendota.com.evil.com/',
    'https://evilopendota.com/',
    'https://user:pw@opendota.com/',
    'https://opendota.com:8443/',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'app://ghost-rank/index.html',
    'ftp://opendota.com/',
    '',
    null,
    undefined,
    42,
  ]) assert.equal(isAllowedExternalUrl(u), false, String(u));
});

test('isAppUrl', () => {
  assert.equal(isAppUrl('app://ghost-rank/index.html'), true);
  assert.equal(isAppUrl('app://ghost-rank.evil/index.html'), false);
  assert.equal(isAppUrl('https://ghost-rank/'), false);
  assert.equal(isAppUrl(undefined), false);
});

test('DevTools só em dev e não empacotado', () => {
  assert.equal(isDevToolsAllowed({ env: { GHOST_RANK_DEV: '1' }, isPackaged: false }), true);
  assert.equal(isDevToolsAllowed({ env: { GHOST_RANK_DEV: '1' }, isPackaged: true }), false);
  assert.equal(isDevToolsAllowed({ env: {}, isPackaged: false }), false);
  assert.equal(isDevToolsAllowed({ env: { GHOST_RANK_DEV: 'true' }, isPackaged: false }), false);
});
