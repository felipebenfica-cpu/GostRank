'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig, normalizeSupabaseUrl } = require('../../src/main/config');
const { URL_OK, KEY } = require('./helpers');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gr-cfg-'));

test('normalizeSupabaseUrl aceita só https://*.supabase.co', () => {
  assert.equal(normalizeSupabaseUrl(URL_OK), URL_OK);
  assert.equal(normalizeSupabaseUrl(URL_OK + '/'), URL_OK);
  for (const bad of [
    'http://abc.supabase.co', 'https://supabase.co', 'https://evil.com', 'https://abc.supabase.co.evil.com',
    'https://evilsupabase.co', 'https://abc.supabase.co:8443', 'https://u:p@abc.supabase.co',
    'https://abc.supabase.co/x', 'https://abc.supabase.co/?a=1', 'ftp://abc.supabase.co', 'lixo', '', null, 5,
    'https://x.evil.com/.supabase.co',
  ]) assert.equal(normalizeSupabaseUrl(bad), null, String(bad));
});

test('loadConfig: variáveis de ambiente', () => {
  const dir = tmp();
  const cfg = loadConfig({ env: { GHOST_RANK_SUPABASE_URL: URL_OK, GHOST_RANK_SUPABASE_ANON_KEY: KEY }, dir });
  assert.deepEqual(cfg, { supabaseUrl: URL_OK, anonKey: KEY });
});

test('loadConfig: arquivo config.local.json', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'config.local.json'), JSON.stringify({ supabaseUrl: URL_OK, anonKey: KEY }));
  assert.deepEqual(loadConfig({ env: {}, dir }), { supabaseUrl: URL_OK, anonKey: KEY });
});

test('loadConfig: sem config, chave vazia, URL ruim, JSON quebrado -> null', () => {
  const dir = tmp();
  assert.equal(loadConfig({ env: {}, dir }), null);
  fs.writeFileSync(path.join(dir, 'config.local.json'), JSON.stringify({ supabaseUrl: URL_OK, anonKey: '' }));
  assert.equal(loadConfig({ env: {}, dir }), null);
  fs.writeFileSync(path.join(dir, 'config.local.json'), JSON.stringify({ supabaseUrl: 'https://evil.com', anonKey: KEY }));
  assert.equal(loadConfig({ env: {}, dir }), null);
  fs.writeFileSync(path.join(dir, 'config.local.json'), '{quebrado');
  assert.equal(loadConfig({ env: {}, dir }), null);
  assert.equal(loadConfig({ env: { GHOST_RANK_SUPABASE_URL: 'http://x.supabase.co', GHOST_RANK_SUPABASE_ANON_KEY: KEY }, dir }), null);
});

test('config.example.json tem a URL do projeto e chave vazia; .gitignore ignora config.local.json', () => {
  const root = path.join(__dirname, '..', '..');
  const ex = JSON.parse(fs.readFileSync(path.join(root, 'config.example.json'), 'utf8'));
  assert.equal(ex.supabaseUrl, 'https://jdipignyikikagjvynve.supabase.co');
  assert.equal(ex.anonKey, '');
  assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /^config\.local\.json$/m);
});
