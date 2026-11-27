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
const { build: buildPreviewHtml, RENDERER_CSS, RENDERER_JS, RENDERER_HEAD_JS, RENDERER_ASSETS } = require('./build-preview');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const PREVIEW = path.join(ROOT, 'preview');
const PREVIEW_JS = ['fake-livekit.js', 'mock-bridge.js'];
const LIVEKIT_UMD = path.join(ROOT, 'node_modules', 'livekit-client', 'dist', 'livekit-client.umd.js');
const APP_FILES = [...RENDERER_CSS, ...RENDERER_HEAD_JS, ...RENDERER_JS, 'app.js', ...RENDERER_ASSETS];

// Metadados da versão web (compartilhamento de link e app instalado/PWA). Só a web usa o manifest:
// no Electron a CSP não tem manifest-src e o app já é "instalado".
const WEB_HEAD = [
  '  <link rel="manifest" href="manifest.webmanifest">',
  '  <link rel="apple-touch-icon" href="brand/apple-touch-icon.png">',
  '  <meta name="application-name" content="LUMENEX">',
  '  <meta name="apple-mobile-web-app-title" content="LUMENEX">',
  '  <meta property="og:type" content="website">',
  '  <meta property="og:site_name" content="LUMENEX">',
  '  <meta property="og:title" content="LUMENEX">',
  '  <meta property="og:description" content="MMR de Dota 2, amigos, servidores, chat e voz.">',
  '  <meta property="og:image" content="brand/icon-512.png">',
  '  <meta name="twitter:card" content="summary_large_image">',
].join('\n');

function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function checkRefs(html, dir) {
  const refs = [...html.matchAll(/(?:src|href|content)="([^"#:]+\.(?:js|css|svg|png|webmanifest))"/g)].map((m) => m[1]);
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
    "manifest-src 'self'",
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
  if (!html.includes('</head>')) throw new Error('index.html sem </head>');
  html = html.replace('</head>', WEB_HEAD + '\n</head>');
  // favicon também na raiz (navegadores que pedem /favicon.png direto)
  copy(path.join(RENDERER, 'brand', 'favicon-32.png'), path.join(outDir, 'favicon.png'));
  checkRefs(html, outDir);
  fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
  const publicConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.public.json'), 'utf8'));
  for (const name of ['auth-return.html', 'auth-return.css']) {
    copy(path.join(ROOT, 'src', 'web', name), path.join(outDir, name));
  }
  const authPage = fs.readFileSync(path.join(ROOT, 'src', 'web', 'auth-return.js'), 'utf8');
  if (!authPage.includes("'sb_publishable_'")) throw new Error('Marcador da chave pública ausente');
  fs.writeFileSync(path.join(outDir, 'auth-return.js'), authPage.replace("'sb_publishable_'", JSON.stringify(publicConfig.anonKey)), 'utf8');
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
  html = html.replace('<title>LUMENEX (prévia)</title>', '<title>LUMENEX — Prévia</title>');
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
