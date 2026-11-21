#!/usr/bin/env node
/**
 * build-netlify.js — monta o site do Netlify.
 *
 * Padrão: a VERSÃO WEB REAL em dist/ — a tela de src/renderer/ + vendor/livekit-client.umd.js +
 * bridge.js (src/web/bridge.js empacotado com esbuild; o mesmo services.js/ipc.js/preload.js do
 * app, com 'electron' trocado por src/web/electron-shim.js) + _headers com a CSP.
 *
 * Com GHOST_PREVIEW=1: a prévia com dados falsos (mock-bridge) em dist-preview/, como antes.
 * A lista de arquivos da tela vem de build-preview.js, então arquivo novo da tela entra sozinho.
 * Uso: node scripts/build-netlify.js   |   GHOST_PREVIEW=1 node scripts/build-netlify.js
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { build: buildPreviewHtml, RENDERER_CSS, RENDERER_JS } = require('./build-preview');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const PREVIEW = path.join(ROOT, 'preview');
const PREVIEW_JS = ['fake-livekit.js', 'mock-bridge.js'];
const LIVEKIT_UMD = path.join(ROOT, 'node_modules', 'livekit-client', 'dist', 'livekit-client.umd.js');
const APP_FILES = [...RENDERER_CSS, ...RENDERER_JS, 'app.js'];

// Ícone da aba (o mesmo fantasma do trilho), em SVG sem script.
const FAVICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#141824"/>'
  + '<path fill="#8de8d4" d="M12 3C8 3 5 6.2 5 10.2V20l2.2-1.7L9.3 20l2.7-1.8 2.7 1.8 2.1-1.7L19 20v-9.8C19 6.2 16 3 12 3z"/>'
  + '<circle cx="9.6" cy="10.4" r="1.4" fill="#141824"/><circle cx="14.4" cy="10.4" r="1.4" fill="#141824"/></svg>';

function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function checkRefs(html, dir) {
  const refs = [...html.matchAll(/(?:src|href)="([^"#:]+\.(?:js|css))"/g)].map((m) => m[1]);
  const missing = refs.filter((r) => !fs.existsSync(path.join(dir, r)));
  if (missing.length) throw new Error('Arquivos referenciados que faltam em ' + path.basename(dir) + '/: ' + missing.join(', '));
}

/** Origem https do Supabase a partir do config público (o único arquivo de config que vai junto). */
function supabaseOrigin() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.public.json'), 'utf8'));
  const u = new URL(cfg.supabaseUrl);
  if (u.protocol !== 'https:' || !/\.supabase\.co$/.test(u.hostname)) throw new Error('supabaseUrl inválida em config.public.json');
  return u.origin;
}

/** CSP da versão web: sem inline, só as origens que o app usa. */
function cspFor(origin) {
  const wss = origin.replace(/^https:/, 'wss:');
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    `img-src 'self' data: blob: ${origin}`,
    "font-src 'self'",
    "media-src 'self' blob: mediastream:",
    "worker-src 'self' blob:",
    `connect-src 'self' ${origin} ${wss} https://api.opendota.com https://*.livekit.cloud wss://*.livekit.cloud`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');
}

function headersFile(origin) {
  return [
    '/*',
    `  Content-Security-Policy: ${cspFor(origin)}`,
    '  Referrer-Policy: no-referrer',
    '  X-Content-Type-Options: nosniff',
    '  X-Frame-Options: DENY',
    '  Permissions-Policy: camera=(self), microphone=(self), display-capture=(self), geolocation=()',
    '',
  ].join('\n');
}

/** Versão web real em dist/. */
function buildWeb({ outDir = path.join(ROOT, 'dist'), log = console.log } = {}) {
  const esbuild = require('esbuild');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  for (const f of APP_FILES) copy(path.join(RENDERER, f), path.join(outDir, f));
  if (!fs.existsSync(LIVEKIT_UMD)) throw new Error('livekit-client não instalado: rode npm install');
  copy(LIVEKIT_UMD, path.join(outDir, 'vendor', 'livekit-client.umd.js'));

  esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'src', 'web', 'bridge.js')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    outfile: path.join(outDir, 'bridge.js'),
    alias: { electron: path.join(ROOT, 'src', 'web', 'electron-shim.js') },
    // Módulos do Node que só o Electron usa (store em disco, config local) nunca entram no navegador.
    external: ['node:fs', 'node:path', 'fs', 'path'],
    logLevel: 'silent',
    legalComments: 'none',
  });

  let html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
  const marker = '<script src="vendor/livekit-client.umd.js"></script>';
  if (!html.includes(marker)) throw new Error('index.html sem o script do LiveKit (ponto de injeção)');
  html = html.replace(marker, marker + '\n  <script src="bridge.js"></script>');
  if (!/rel="icon"/.test(html)) html = html.replace('</head>', '  <link rel="icon" href="favicon.svg" type="image/svg+xml">\n</head>');
  fs.writeFileSync(path.join(outDir, 'favicon.svg'), FAVICON_SVG, 'utf8');
  checkRefs(html, outDir);
  fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
  fs.writeFileSync(path.join(outDir, '_headers'), headersFile(supabaseOrigin()), 'utf8');
  log('✓ dist/ pronto (versão web real)');
  return outDir;
}

/** Prévia com dados falsos em dist-preview/. */
function buildPreview({ outDir = path.join(ROOT, 'dist-preview'), log = console.log } = {}) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of APP_FILES) copy(path.join(RENDERER, f), path.join(outDir, f));
  for (const f of PREVIEW_JS) copy(path.join(PREVIEW, f), path.join(outDir, f));
  let html = buildPreviewHtml().replace(/\.\.\/src\/renderer\//g, '');
  html = html.replace('<title>Ghost Rank (prévia)</title>', '<title>Ghost Rank — Prévia</title>');
  checkRefs(html, outDir);
  fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
  log('✓ dist-preview/ pronto (prévia com dados falsos)');
  return outDir;
}

function main() {
  if (process.env.GHOST_PREVIEW === '1') return buildPreview();
  return buildWeb();
}

if (require.main === module) main();

module.exports = { main, buildWeb, buildPreview, cspFor, APP_FILES };
