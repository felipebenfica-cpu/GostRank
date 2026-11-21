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
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'";

function replaceOnce(text, from, to) {
  if (text.split(from).length !== 2) throw new Error('Trecho não encontrado exatamente uma vez: ' + from);
  return text.replace(from, () => to);
}

function build() {
  let html = fs.readFileSync(src, 'utf8');
  html = replaceOnce(html, '  <title>Ghost Rank</title>\n', `  <meta http-equiv="Content-Security-Policy" content="${CSP}">\n  <title>Ghost Rank (prévia)</title>\n`);
  html = replaceOnce(html, 'href="styles.css"', 'href="../src/renderer/styles.css"');
  html = replaceOnce(html, 'href="voice.css"', 'href="../src/renderer/voice.css"');
  // LiveKit de verdade não roda na prévia: entra um falso local (preview/fake-livekit.js), sem rede.
  html = replaceOnce(html, '  <script src="vendor/livekit-client.umd.js"></script>', '  <script src="fake-livekit.js"></script>');
  html = replaceOnce(html, '  <script src="voice.js"></script>', '  <script src="../src/renderer/voice.js"></script>');
  html = replaceOnce(html, '  <script src="app.js"></script>', '  <script src="mock-bridge.js"></script>\n  <script src="../src/renderer/app.js"></script>');
  return html;
}

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

module.exports = { build };
