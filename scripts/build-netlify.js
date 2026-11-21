#!/usr/bin/env node
/**
 * build-netlify.js — monta dist/ para o deploy da prévia no Netlify.
 *
 * Gera dist/index.html a partir do mesmo build da prévia (scripts/build-preview.js), com todos os
 * arquivos em uma pasta só:
 *   dist/index.html, dist/*.css e dist/*.js da tela (src/renderer/) e da prévia (mock-bridge, fake-livekit).
 * A lista de arquivos vem de build-preview.js, então arquivo novo da tela entra aqui sozinho.
 * Uso: node scripts/build-netlify.js
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { build, RENDERER_CSS, RENDERER_JS } = require('./build-preview');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const PREVIEW = path.join(ROOT, 'preview');
const PREVIEW_JS = ['fake-livekit.js', 'mock-bridge.js'];

function copy(src, dest) {
  fs.copyFileSync(src, dest);
  console.log('  copiado', path.relative(ROOT, src), '→', path.relative(ROOT, dest));
}

function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  for (const f of [...RENDERER_CSS, ...RENDERER_JS, 'app.js']) copy(path.join(RENDERER, f), path.join(DIST, f));
  for (const f of PREVIEW_JS) copy(path.join(PREVIEW, f), path.join(DIST, f));

  // Mesmo HTML da prévia, com caminhos planos (../src/renderer/x → x).
  let html = build().replace(/\.\.\/src\/renderer\//g, '');
  html = html.replace('<title>Ghost Rank (prévia)</title>', '<title>Ghost Rank — Prévia</title>');

  // Nenhum arquivo referenciado pode faltar no dist/.
  const refs = [...html.matchAll(/(?:src|href)="([^"#:]+\.(?:js|css))"/g)].map((m) => m[1]);
  const missing = refs.filter((r) => !fs.existsSync(path.join(DIST, r)));
  if (missing.length) throw new Error('Arquivos referenciados que faltam no dist/: ' + missing.join(', '));

  fs.writeFileSync(path.join(DIST, 'index.html'), html, 'utf8');
  console.log('  gravado dist/index.html');
  console.log('\n✓ dist/ pronto para o Netlify');
}

if (require.main === module) main();

module.exports = { main };
