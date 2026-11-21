'use strict';

const path = require('node:path');
const fs = require('node:fs');

const SCHEME = 'app';
const HOST = 'ghost-rank';
const ORIGIN = `${SCHEME}://${HOST}/`;

const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
});

const IMAGE_ORIGIN_RE = /^https:\/\/[a-z0-9][a-z0-9-]*\.supabase\.co$/;

/**
 * CSP do app. `imageOrigin` (opcional) libera imagens só da origem do Supabase configurado
 * (avatares, ícones e anexos da Etapa 6) e blob: (prévia local de anexos).
 */
function buildCsp({ imageOrigin = null } = {}) {
  const img = typeof imageOrigin === 'string' && IMAGE_ORIGIN_RE.test(imageOrigin)
    ? `img-src 'self' data: blob: ${imageOrigin}` : "img-src 'self' data:";
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    img,
    "font-src 'self'",
    'connect-src wss://*.livekit.cloud https://*.livekit.cloud',
    "media-src 'self' blob: mediastream:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

const CSP = buildCsp();

// Única rota para node_modules: o build UMD do livekit-client (servido localmente, nunca CDN).
const VENDOR_PREFIX = '/vendor/';
const LIVEKIT_VENDOR_PATH = '/vendor/livekit-client.umd.js';
const LIVEKIT_VENDOR_FILE = path.join(__dirname, '..', '..', 'node_modules', 'livekit-client', 'dist', 'livekit-client.umd.js');
const DEFAULT_VENDOR_FILES = Object.freeze({ [LIVEKIT_VENDOR_PATH]: LIVEKIT_VENDOR_FILE });

const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
});

/**
 * Resolve uma URL app://ghost-rank/... para um arquivo dentro de rootDir.
 * Função pura (não toca no disco).
 * @returns {{ ok: true, filePath: string, ext: string } | { ok: false, status: number }}
 */
function resolveRequestPath(urlString, rootDir) {
  if (typeof urlString !== 'string' || typeof rootDir !== 'string' || urlString.length > 2000) {
    return { ok: false, status: 400 };
  }
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return { ok: false, status: 400 };
  }
  if (url.protocol !== `${SCHEME}:` || url.hostname !== HOST || url.username || url.password || url.port) {
    return { ok: false, status: 403 };
  }

  const rawPath = url.pathname;
  // Rejeita barras invertidas e bytes nulos mesmo codificados.
  if (/%5c|%00|%2e%2e|\\/i.test(rawPath)) return { ok: false, status: 403 };

  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return { ok: false, status: 400 };
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return { ok: false, status: 403 };

  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const segments = relative.split('/');
  if (segments.some((s) => s === '..' || s === '.' || s === '')) {
    return { ok: false, status: 403 };
  }

  const ext = path.extname(relative).toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(MIME_TYPES, ext)) {
    return { ok: false, status: 403 };
  }

  const root = path.resolve(rootDir);
  const filePath = path.resolve(root, ...segments);
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    return { ok: false, status: 403 };
  }
  return { ok: true, filePath, ext };
}

/**
 * Rotas /vendor/: só caminhos exatos da tabela (sem decodificar, sem ".."), qualquer outro → 404.
 * @returns {null | { ok: true, filePath, ext } | { ok: false, status }} null = não é rota vendor.
 */
function resolveVendorPath(urlString, vendorFiles = DEFAULT_VENDOR_FILES) {
  let url;
  try { url = new URL(urlString); } catch { return null; }
  if (url.protocol !== `${SCHEME}:` || url.hostname !== HOST) return null;
  const raw = url.pathname;
  if (!raw.toLowerCase().startsWith(VENDOR_PREFIX) && !/^\/vendor(%2f|$)/i.test(raw)) return null;
  if (url.search || url.hash) return { ok: false, status: 404 };
  if (!Object.prototype.hasOwnProperty.call(vendorFiles, raw)) return { ok: false, status: 404 };
  return { ok: true, filePath: vendorFiles[raw], ext: path.extname(raw).toLowerCase() };
}

/** O arquivo do livekit-client existe (voz disponível)? */
function vendorExists(filePath = LIVEKIT_VENDOR_FILE, fsImpl = fs) {
  try { return fsImpl.statSync(filePath).isFile(); } catch { return false; }
}

function textResponse(body, status) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS },
  });
}

/** Atende uma requisição app://. Exportado para teste. */
async function handleRequest(urlString, rootDir, { vendorFiles = DEFAULT_VENDOR_FILES, readFile = fs.promises.readFile, csp = CSP } = {}) {
  const vendor = resolveVendorPath(urlString, vendorFiles);
  const resolved = vendor || resolveRequestPath(urlString, rootDir);
  if (!resolved.ok) {
    return textResponse(resolved.status === 404 ? 'Não encontrado' : 'Acesso negado', resolved.status);
  }
  try {
    const data = await readFile(resolved.filePath);
    return new Response(data, { status: 200, headers: buildHeaders(resolved.ext, csp) });
  } catch {
    return textResponse('Não encontrado', 404);
  }
}

function buildHeaders(ext, csp = CSP) {
  return {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
    'Content-Security-Policy': csp,
  };
}

/** Deve ser chamado antes de app.whenReady(). */
function registerScheme() {
  const { protocol } = require('electron');
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);
}

/** Registra o handler do protocolo. Chamar depois de app.whenReady(). */
function registerHandler(rootDir, { imageOrigin = null } = {}) {
  const { protocol } = require('electron');
  const csp = buildCsp({ imageOrigin });
  protocol.handle(SCHEME, (request) => handleRequest(request.url, rootDir, { csp }));
}

module.exports = {
  SCHEME,
  HOST,
  ORIGIN,
  CSP,
  buildCsp,
  SECURITY_HEADERS,
  MIME_TYPES,
  VENDOR_PREFIX,
  LIVEKIT_VENDOR_PATH,
  LIVEKIT_VENDOR_FILE,
  DEFAULT_VENDOR_FILES,
  resolveRequestPath,
  resolveVendorPath,
  vendorExists,
  handleRequest,
  buildHeaders,
  registerScheme,
  registerHandler,
};
