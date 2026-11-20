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
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
});

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

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

function buildHeaders(ext) {
  return {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
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
function registerHandler(rootDir) {
  const { protocol } = require('electron');
  protocol.handle(SCHEME, async (request) => {
    const resolved = resolveRequestPath(request.url, rootDir);
    if (!resolved.ok) {
      return new Response('Acesso negado', {
        status: resolved.status,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS },
      });
    }
    try {
      const data = await fs.promises.readFile(resolved.filePath);
      return new Response(data, { status: 200, headers: buildHeaders(resolved.ext) });
    } catch {
      return new Response('Não encontrado', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS },
      });
    }
  });
}

module.exports = {
  SCHEME,
  HOST,
  ORIGIN,
  CSP,
  SECURITY_HEADERS,
  MIME_TYPES,
  resolveRequestPath,
  buildHeaders,
  registerScheme,
  registerHandler,
};
