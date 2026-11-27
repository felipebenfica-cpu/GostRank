'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../../src/core/themes');
const ui = require('../../src/renderer/themes');
const strength = require('../../src/renderer/password-strength');
const { createPrefs } = require('../../src/main/prefs');

const R = path.join(__dirname, '..', '..', 'src', 'renderer');

test('temas: tela e preferências têm a mesma lista; o preto original continua disponível', () => {
  assert.deepEqual(ui.list.map((t) => t.id).sort(), [...core.THEME_IDS].sort());
  assert.equal(ui.fallback, core.DEFAULT_THEME);
  assert.ok(ui.has('dark') && ui.has('frostivus'));
});

test('temas: escolha explícita do preto original é mantida; padrão antigo gravado vira Frostivus', () => {
  const load = (o) => createPrefs({ store: { load: () => o, save: () => {} } }).get().appearance.theme;
  assert.equal(load({ appearance: { theme: 'dark' }, _themeHere: true }), 'dark');
  assert.equal(load({ appearance: { theme: 'dark' } }), 'frostivus');
  assert.equal(load({ appearance: { theme: 'light' } }), 'light');
});

test('frostivus: CSS tem a paleta, não bloqueia cliques e respeita movimento reduzido', () => {
  const css = fs.readFileSync(path.join(R, 'frostivus.css'), 'utf8');
  for (const c of ['#05070d', '#48bfff', '#e4f4ff', '#ff391c', '#c5a05c']) assert.ok(css.toLowerCase().includes(c), c);
  assert.match(css, /\.lx-scene \{[^}]*pointer-events: none/);
  assert.match(css, /\.lx-canvas-front \{[^}]*pointer-events: none/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  const js = fs.readFileSync(path.join(R, 'frostivus.js'), 'utf8');
  assert.doesNotMatch(js, /innerHTML|\bfetch\(|new WebSocket/);
  for (const n of ['cena', 'cena-960', 'frente', 'frente-960']) {
    assert.ok(fs.statSync(path.join(R, 'frostivus', n + '.webp')).size < 200 * 1024, n);
  }
});

test('medidor de senha: curta, comum e com o e-mail ficam fracas; frase longa fica forte', () => {
  assert.equal(strength('').score, 0);
  assert.equal(strength('Ab1!').score, 0);
  assert.ok(strength('password123456').score <= 1);
  assert.ok(strength('felipebenfica2026!', 'felipebenfica@x.com').score <= 1);
  assert.ok(strength('gelo-Azul-sobre-a-fortaleza-9').score === 4);
});

test('index.html não repete nenhum id (um diálogo não pode abrir no lugar de outro)', () => {
  const ids = [...fs.readFileSync(path.join(R, 'index.html'), 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.filter((v, i) => ids.indexOf(v) !== i), []);
});

test('temas: preto vindo da conta não volta a virar Frostivus ao reabrir', () => {
  const p = createPrefs({ store: { load: () => ({ appearance: { theme: 'dark' }, _themeHere: false, _themeRev: 2 }), save: () => {} } });
  assert.equal(p.get().appearance.theme, 'dark');
});
