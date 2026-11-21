'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { supabaseUrl } = require('../config.public.json');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(root, 'src/renderer'), dist, { recursive: true });
fs.mkdirSync(path.join(dist, 'vendor'), { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules/livekit-client/dist/livekit-client.umd.js'),
  path.join(dist, 'vendor/livekit-client.umd.js'));
buildSync({ entryPoints: [path.join(root, 'src/web/bridge.js')], bundle: true,
  platform: 'browser', outfile: path.join(dist, 'bridge.js'), target: 'es2020' });
const page = path.join(dist, 'index.html');
const html = fs.readFileSync(page, 'utf8').replace('<script src="app.js">',
  '<script src="bridge.js"></script>\n  <script src="app.js">');
fs.writeFileSync(page, html);
const policy = [
  "default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:",
  "font-src 'self'", "media-src 'self' blob: mediastream:", "worker-src 'self' blob:",
  `connect-src ${new URL(supabaseUrl).origin} https://api.opendota.com https://*.livekit.cloud wss://*.livekit.cloud`,
  "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');
fs.writeFileSync(path.join(dist, '_headers'), '/*\n  Content-Security-Policy: ' + policy
  + '\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n');
