#!/usr/bin/env node
/**
 * build-netlify.js — monta dist/ para deploy no Netlify.
 *
 * Estrutura gerada:
 *   dist/index.html          ← preview/index.html com caminhos ajustados
 *   dist/app.js              ← src/renderer/app.js
 *   dist/styles.css          ← src/renderer/styles.css
 *   dist/voice.js            ← src/renderer/voice.js
 *   dist/voice.css           ← src/renderer/voice.css
 *   dist/mock-bridge.js      ← preview/mock-bridge.js
 *   dist/fake-livekit.js     ← preview/fake-livekit.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// Limpa dist
if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true });
fs.mkdirSync(DIST, { recursive: true });

function copy(src, dest) {
  fs.copyFileSync(src, dest);
  console.log('  copied', path.relative(ROOT, src), '→', path.relative(ROOT, dest));
}

// Arquivos do renderer
const renderer = path.join(ROOT, 'src', 'renderer');
for (const f of ['app.js', 'styles.css', 'voice.js', 'voice.css']) {
  copy(path.join(renderer, f), path.join(DIST, f));
}

// Arquivos da preview
const preview = path.join(ROOT, 'preview');
for (const f of ['mock-bridge.js', 'fake-livekit.js']) {
  copy(path.join(preview, f), path.join(DIST, f));
}

// index.html: ajusta caminhos relativos para flat
let html = fs.readFileSync(path.join(preview, 'index.html'), 'utf8');

// Troca ../src/renderer/X por ./X
html = html.replace(/\.\.\/src\/renderer\//g, './');

// Troca ./mock-bridge.js e ./fake-livekit.js (já são relativos, ok)
// Garante que os scripts da preview também apontem para ./
html = html.replace(/(?:\.\.\/)?preview\/(mock-bridge|fake-livekit)\.js/g, './$1.js');

// Remove CSP restritiva do preview (Netlify não é Electron, não tem app://)
// Mantém a tag mas abre connect-src para Supabase/LiveKit usados no mock
html = html.replace(
  /content="default-src[^"]*"/,
  "content=\"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'\""
);

// Título mais amigável
html = html.replace('<title>Ghost Rank (prévia)</title>', '<title>Ghost Rank — Prévia</title>');

fs.writeFileSync(path.join(DIST, 'index.html'), html, 'utf8');
console.log('  wrote  dist/index.html');

console.log('\n✓ dist/ pronto para o Netlify');
