'use strict';

const ALLOWED_EXTERNAL_HOSTS = Object.freeze([
  'opendota.com',
  'www.opendota.com',
  'steamcommunity.com',
  'docs.opendota.com',
]);

const APP_ORIGIN_PREFIX = 'app://ghost-rank/';

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

/** DevTools só com GHOST_RANK_DEV=1 e app não empacotado. */
function isDevToolsAllowed({ env, isPackaged }) {
  return !isPackaged && !!env && env.GHOST_RANK_DEV === '1';
}

/** Aplica as restrições de segurança a uma janela e à sessão. */
function applyWindowSecurity(win) {
  const { app, shell, session } = require('electron');
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
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);

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
  isAllowedExternalUrl,
  isAppUrl,
  isDevToolsAllowed,
  applyWindowSecurity,
  applyGlobalSecurity,
};
