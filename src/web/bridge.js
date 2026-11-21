'use strict';

// Versão web do Ghost Rank (Netlify): monta no navegador a MESMA fiação do app Electron
// (services.js + controller + handlers validados do ipc.js) e expõe window.ghostRank com o MESMO
// preload.js — o esbuild troca 'electron' por ./electron-shim.js. Assim a tela não sabe se está no
// Electron ou no navegador, e a lista de métodos nunca diverge.
//
// Diferenças da plataforma: armazenamento em localStorage, notificação pela Notification API,
// links em nova aba, compartilhar tela pelo seletor do próprio navegador, ausente por inatividade.

const shim = require('./electron-shim');
const config = require('../../config.public.json');
const { createAppServices } = require('../main/services');
const { createController } = require('../main/controller');
const { createOpenDotaClient } = require('../main/opendota');
const { buildHandlers } = require('../main/ipc');
const { normalizeSupabaseUrl, isValidAnonKey } = require('../main/supabase-url');

const PREFIX = 'ghostrank.';

/** Store {load, save, clear} em localStorage; nunca lança (modo privado/cheio fica em memória). */
function browserStore(name) {
  const key = PREFIX + name;
  let memory = null;
  return {
    load() {
      try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : memory;
      } catch { return memory; }
    },
    save(value) {
      memory = value;
      try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* fica em memória */ }
    },
    clear() {
      memory = null;
      try { window.localStorage.removeItem(key); } catch { /* ignora */ }
    },
  };
}

function safeConfig(c) {
  if (!c || !normalizeSupabaseUrl(c.supabaseUrl) || !isValidAnonKey(c.anonKey)) return null;
  return { supabaseUrl: normalizeSupabaseUrl(c.supabaseUrl), anonKey: c.anonKey };
}

// ---------------- Inatividade (status "ausente" automático) ----------------
let lastInput = Date.now();
const markInput = () => { lastInput = Date.now(); };
for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) {
  window.addEventListener(ev, markInput, { passive: true, capture: true });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) markInput(); });
const getIdleSeconds = () => Math.max(0, Math.floor((Date.now() - lastInput) / 1000));
const isFocused = () => !document.hidden && document.hasFocus();

// ---------------- Links externos (nova aba, sem acesso a esta página) ----------------
function openExternal(url) {
  const w = window.open('', '_blank');
  if (!w) return Promise.reject(new Error('Permita pop-ups deste site para abrir o link.'));
  try { w.opener = null; } catch { /* ignora */ }
  w.location.href = url;
  return Promise.resolve();
}

// ---------------- Notificações ----------------
let services = null;
function askNotificationPermissionOnce() {
  const ask = () => {
    window.removeEventListener('pointerdown', ask, true);
    try {
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
    } catch { /* navegador sem suporte */ }
  };
  window.addEventListener('pointerdown', ask, true);
}
function notify({ title, body, target, silent }) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const n = new Notification(String(title).slice(0, 120), { body: String(body).slice(0, 200), silent: Boolean(silent), tag: 'ghostrank' });
    n.onclick = () => {
      try { window.focus(); } catch { /* ignora */ }
      n.close();
      if (services) {
        services.openTarget(target).finally(() => shim.send('gr:notificationClick', target));
      }
    };
  } catch { /* notificação é opcional */ }
}

// ---------------- Contador de não lidas (título da aba + badge do PWA) ----------------
const BASE_TITLE = document.title || 'Ghost Rank';
let lastBadge = -1;
function updateBadge() {
  if (!services) return;
  let n = 0;
  try { n = services.badgeCount(); } catch { n = 0; }
  if (n === lastBadge) return;
  lastBadge = n;
  document.title = n > 0 ? `(${n}) ${BASE_TITLE}` : BASE_TITLE;
  try {
    if (n > 0 && navigator.setAppBadge) navigator.setAppBadge(n).catch(() => {});
    else if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  } catch { /* ignora */ }
}

// ---------------- Montagem ----------------
let controller = null;
const pushUpdate = () => { if (controller) shim.send('gr:update', controller.getView()); };

const cfg = safeConfig(config);
try {
  services = createAppServices({
    config: cfg,
    fetchImpl: (...a) => window.fetch(...a),
    WebSocketImpl: typeof window.WebSocket === 'function' ? window.WebSocket : null,
    sessionStore: browserStore('session'),
    prefsStore: browserStore('prefs'),
    notify,
    openExternal,
    getIdleSeconds,
    isFocused,
    getSummary: () => (controller ? controller.getSummary() : null),
    onChange: () => { pushUpdate(); updateBadge(); },
  });
} catch {
  services = createAppServices({ config: null, onChange: () => pushUpdate() });
}

controller = createController({
  client: createOpenDotaClient({ fetchImpl: (...a) => window.fetch(...a) }),
  store: browserStore('tracker'),
  heroesStore: browserStore('heroes'),
  getAuthView: () => services.account.getAuthView(),
  getGroupView: () => services.group.getView(),
  getChatView: () => (services.chatFeed ? services.chatFeed.getView() : null),
  getVoiceView: () => ({ available: Boolean(window.LivekitClient && services.voiceAvailable()) }),
  publishSnapshot: (summary) => services.group.publishSnapshot(summary),
  getExtraView: () => services.getExtraView(),
  onUpdate: (view) => shim.send('gr:update', view),
});

const steamService = services.steam ? { startLink: () => services.steam.startLink() } : null;
// O seletor de tela é o do navegador (getDisplayMedia); a lista do Electron não existe aqui.
const picker = { listSources: async () => [], pick: () => true };

shim.setHandlers(buildHandlers(controller, {
  account: services.account,
  session: services.session,
  group: services.group,
  chatFeed: services.chatFeed,
  voice: services.voice,
  picker,
  steam: steamService,
  app: services.available ? services.app : null,
  getMode: () => services.getMode(),
}));

shim.setExposeHook((api) => ({
  ...api,
  listScreenSources: async () => ({ ok: true, browserPicker: true, sources: [] }),
  pickScreenSource: async () => ({ ok: true }),
}));

// O mesmo preload do Electron: define window.ghostRank com todos os métodos.
require('../preload/preload');

// ---------------- Ciclo de vida ----------------
askNotificationPermissionOnce();
document.addEventListener('visibilitychange', () => {
  try { if (services.chatFeed && services.chatFeed.setFocused) services.chatFeed.setFocused(!document.hidden); } catch { /* ignora */ }
  if (!document.hidden) pushUpdate();
});
window.addEventListener('focus', () => {
  try { if (services.account && services.account.isSignedIn && services.account.isSignedIn()) services.account.refreshProfile().catch(() => {}); } catch { /* ignora */ }
});
window.addEventListener('beforeunload', () => {
  try { services.stop(); } catch { /* ignora */ }
});

// Grupo antigo (banco sem a 0003) e perfil: recarrega a cada 30 s com a aba visível.
function refreshQuiet() {
  if (document.hidden) return;
  try {
    if (services.account.isSignedIn && services.account.isSignedIn()) services.group.refresh({ quiet: true }).catch(() => {});
  } catch { /* ignora */ }
}
setInterval(refreshQuiet, 30000);
try { if (services.chatFeed && services.chatFeed.setFocused) services.chatFeed.setFocused(!document.hidden); } catch { /* ignora */ }

controller.start();
try { if (services.account.refreshProfile) services.account.refreshProfile().catch(() => {}); } catch { /* sem conta */ }
services.start();
refreshQuiet();
