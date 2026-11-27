'use strict';

// Gera preview/index.html a partir de src/renderer/index.html.
// Uso: node scripts/build-preview.js          (grava o arquivo)
//      node scripts/build-preview.js --check  (falha se a prévia estiver defasada)

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src', 'renderer', 'index.html');
const out = path.join(root, 'preview', 'index.html');

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'";

function replaceOnce(text, from, to) {
  if (text.split(from).length !== 2) throw new Error('Trecho não encontrado exatamente uma vez: ' + from);
  return text.replace(from, () => to);
}

// Scripts e estilos da tela que a prévia carrega direto de src/renderer/
const RENDERER_CSS = ['styles.css', 'chat.css', 'settings.css', 'voice.css', 'profile-look.css', 'frostivus.css'];
const RENDERER_JS = ['password-strength.js', 'ui.js', 'dnd.js', 'profile-look.js', 'emoji-data.js', 'chat.js', 'settings.js', 'voice.js', 'shell.js'];
// Scripts carregados depois do app.js
const RENDERER_TAIL_JS = ['frostivus.js'];
// Arquivos da tela que não são scripts do app (carregados no <head>) e a pasta da marca
const RENDERER_HEAD_JS = ['themes.js', 'theme-boot.js'];
const RENDERER_ASSETS = ['brand/favicon-32.png', 'brand/lumenex-emblem.webp', 'brand/lumenex-icon-128.webp', 'brand/icon-192.png', 'brand/icon-512.png', 'brand/apple-touch-icon.png', 'manifest.webmanifest', 'frostivus/cena.webp', 'frostivus/cena-960.webp', 'frostivus/frente.webp', 'frostivus/frente-960.webp'];

function build() {
  let html = fs.readFileSync(src, 'utf8');
  html = replaceOnce(html, '  <title>LUMENEX</title>\n', `  <meta http-equiv="Content-Security-Policy" content="${CSP}">\n  <title>LUMENEX (prévia)</title>\n`);
  html = replaceOnce(html, 'href="brand/favicon-32.png"', 'href="../src/renderer/brand/favicon-32.png"');
  html = html.split('src="brand/').join('src="../src/renderer/brand/');
  html = replaceOnce(html, '  <title>LUMENEX (prévia)</title>\n', '  <title>LUMENEX (prévia)</title>\n  <meta name="lx-asset-base" content="../src/renderer/">\n');
  for (const name of RENDERER_HEAD_JS) {
    html = replaceOnce(html, `  <script src="${name}"></script>`, `  <script src="../src/renderer/${name}"></script>`);
  }
  for (const name of RENDERER_CSS) {
    html = replaceOnce(html, `href="${name}"`, `href="../src/renderer/${name}"`);
  }
  // LiveKit de verdade não roda na prévia: entra um falso local (preview/fake-livekit.js), sem rede.
  html = replaceOnce(html, '  <script src="vendor/livekit-client.umd.js"></script>', '  <script src="fake-livekit.js"></script>\n  <script src="mock-bridge.js"></script>');
  for (const name of RENDERER_JS) {
    html = replaceOnce(html, `  <script src="${name}"></script>`, `  <script src="../src/renderer/${name}"></script>`);
  }
  html = replaceOnce(html, '  <script src="app.js"></script>', '  <script src="../src/renderer/app.js"></script>');
  for (const name of RENDERER_TAIL_JS) {
    html = replaceOnce(html, `  <script src="${name}"></script>`, `  <script src="../src/renderer/${name}"></script>`);
  }
  return html;
}

function main() {
const html = build();
if (process.argv.includes('--check')) {
  const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (current !== html) {
    console.error('preview/index.html está defasado. Rode: node scripts/build-preview.js');
    process.exit(1);
  }
} else {
  fs.writeFileSync(out, html);
  console.log('preview/index.html gerado.');
}
}

if (require.main === module) main();

module.exports = { build, RENDERER_CSS, RENDERER_JS, RENDERER_HEAD_JS, RENDERER_TAIL_JS, RENDERER_ASSETS };
