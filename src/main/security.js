'use strict';

const ALLOWED_EXTERNAL_HOSTS = Object.freeze([
  'opendota.com',
  'www.opendota.com',
  'steamcommunity.com',
  'docs.opendota.com',
]);

const APP_ORIGIN_PREFIX = 'app://ghost-rank/';
const APP_ORIGIN = 'app://ghost-rank';
const SOURCE_TTL_MS = 10000;
const THUMBNAIL_SIZE = Object.freeze({ width: 320, height: 180 });
const THUMBNAIL_QUALITY = 60;
const MAX_THUMBNAIL_CHARS = 300 * 1024;
const MAX_SOURCES = 100;

/** Link externo permitido: https, sem credenciais, host na allowlist. */
function isAllowedExternalUrl(value) {
  if (typeof value !== 'string' || value.length > 2000) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== '443') return false;
  return ALLOWED_EXTERNAL_HOSTS.includes(url.hostname.toLowerCase());
}

/** URL pertence ao protocolo interno do app. */
function isAppUrl(value) {
  return typeof value === 'string' && value.startsWith(APP_ORIGIN_PREFIX);
}

/** Origem/URL do próprio app (app://ghost-rank ou app://ghost-rank/...). */
function isAppOrigin(value) {
  return value === APP_ORIGIN || isAppUrl(value);
}

/**
 * Pedido de permissão: só frames do app. `media` só quando o pedido é exclusivamente de áudio
 * (microfone); `display-capture` liberado (a fonte é escolhida pelo handler de display media).
 */
function decidePermissionRequest(permission, details) {
  const d = details && typeof details === 'object' ? details : {};
  const url = typeof d.requestingUrl === 'string' ? d.requestingUrl : d.securityOrigin;
  if (!isAppOrigin(url)) return false;
  if (permission === 'media') {
    const types = d.mediaTypes;
    return Array.isArray(types) && types.length > 0 && types.every((t) => t === 'audio');
  }
  return permission === 'display-capture';
}

/** Verificação de permissão coerente com o pedido acima. */
function decidePermissionCheck(permission, requestingOrigin, details) {
  const d = details && typeof details === 'object' ? details : {};
  const origin = typeof requestingOrigin === 'string' && requestingOrigin ? requestingOrigin : d.securityOrigin;
  if (!isAppOrigin(origin)) return false;
  if (permission === 'media') return d.mediaType === 'audio';
  return permission === 'display-capture';
}

function sourceKind(id) {
  return typeof id === 'string' && id.startsWith('screen:') ? 'screen' : 'window';
}

function thumbnailDataUrl(img) {
  try {
    if (!img || typeof img.toJPEG !== 'function' || (typeof img.isEmpty === 'function' && img.isEmpty())) return null;
    const buf = img.toJPEG(THUMBNAIL_QUALITY);
    if (!buf || buf.length === 0) return null;
    const url = 'data:image/jpeg;base64,' + Buffer.from(buf).toString('base64');
    return url.length <= MAX_THUMBNAIL_CHARS ? url : null;
  } catch {
    return null;
  }
}

/**
 * Escolha de tela/janela para compartilhar: a tela pede a lista, escolhe um id dela e só então
 * chama getDisplayMedia. A escolha vale uma vez e expira em 10 s.
 */
function createScreenPicker({ desktopCapturer, now = () => Date.now(), ttlMs = SOURCE_TTL_MS } = {}) {
  let listed = new Set();
  let picked = null;

  async function listSources() {
    if (!desktopCapturer || typeof desktopCapturer.getSources !== 'function') return [];
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'], thumbnailSize: THUMBNAIL_SIZE, fetchWindowIcons: false,
    });
    const out = [];
    for (const s of Array.isArray(sources) ? sources.slice(0, MAX_SOURCES) : []) {
      if (!s || typeof s.id !== 'string' || s.id.length === 0 || s.id.length > 200) continue;
      out.push({
        id: s.id,
        name: typeof s.name === 'string' ? s.name.slice(0, 200) : '',
        kind: sourceKind(s.id),
        thumbnail: thumbnailDataUrl(s.thumbnail),
      });
    }
    listed = new Set(out.map((s) => s.id));
    picked = null;
    return out;
  }

  /** Aceita só ids da última lista. */
  function pick(id) {
    if (typeof id !== 'string' || !listed.has(id)) return false;
    picked = { id, at: now() };
    return true;
  }

  /** Consome a escolha (uso único); null se não houver ou se expirou. */
  function take() {
    const p = picked;
    picked = null;
    if (!p || now() - p.at > ttlMs || !listed.has(p.id)) return null;
    return p.id;
  }

  return { listSources, pick, take };
}

/** Handler de session.setDisplayMediaRequestHandler. Sem escolha válida: callback({}) (nega). */
function createDisplayMediaHandler({ picker, desktopCapturer, platform = process.platform } = {}) {
  return async (request, callback) => {
    try {
      const r = request && typeof request === 'object' ? request : {};
      const origin = r.securityOrigin || (r.frame && r.frame.url);
      if (!isAppOrigin(origin) || !picker) return callback({});
      const id = picker.take();
      if (!id) return callback({});
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
      const src = Array.isArray(sources) ? sources.find((s) => s && s.id === id) : null;
      if (!src) return callback({});
      const streams = { video: src };
      // Áudio do sistema só quando a tela pediu áudio (Windows).
      if (platform === 'win32' && r.audioRequested !== false) streams.audio = 'loopback';
      return callback(streams);
    } catch {
      return callback({});
    }
  };
}

/** DevTools só com GHOST_RANK_DEV=1 e app não empacotado. */
function isDevToolsAllowed({ env, isPackaged }) {
  return !isPackaged && !!env && env.GHOST_RANK_DEV === '1';
}

/** Aplica as restrições de segurança a uma janela e à sessão. */
function applyWindowSecurity(win, { picker = null } = {}) {
  const { app, shell, session, desktopCapturer } = require('electron');
  const wc = win.webContents;

  wc.on('will-navigate', (event) => {
    event.preventDefault();
  });
  wc.on('will-redirect', (event) => {
    event.preventDefault();
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });
  wc.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  const ses = wc.session || session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(decidePermissionRequest(permission, details));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => (
    decidePermissionCheck(permission, requestingOrigin, details)
  ));
  if (typeof ses.setDisplayMediaRequestHandler === 'function') {
    ses.setDisplayMediaRequestHandler(createDisplayMediaHandler({ picker, desktopCapturer }));
  }

  const devTools = isDevToolsAllowed({ env: process.env, isPackaged: app.isPackaged });
  if (!devTools) {
    wc.on('devtools-opened', () => wc.closeDevTools());
  }
  return { devTools };
}

/** Bloqueios globais para qualquer webContents criado (inclui webviews e janelas). */
function applyGlobalSecurity() {
  const { app } = require('electron');
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (e) => e.preventDefault());
    contents.on('will-navigate', (e) => e.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
}

module.exports = {
  ALLOWED_EXTERNAL_HOSTS,
  APP_ORIGIN_PREFIX,
  APP_ORIGIN,
  SOURCE_TTL_MS,
  isAllowedExternalUrl,
  isAppUrl,
  isAppOrigin,
  decidePermissionRequest,
  decidePermissionCheck,
  createScreenPicker,
  createDisplayMediaHandler,
  isDevToolsAllowed,
  applyWindowSecurity,
  applyGlobalSecurity,
};
