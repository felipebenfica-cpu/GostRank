'use strict';

const path = require('node:path');
const { app, BrowserWindow, safeStorage, shell, desktopCapturer, Notification, powerMonitor } = require('electron');

const protocol = require('./protocol');
const security = require('./security');
const { registerIpc } = require('./ipc');
const { createOpenDotaClient } = require('./opendota');
const { createStore } = require('./store');
const { createController } = require('./controller');
const { loadConfig } = require('./config');
const { normalizeSupabaseUrl } = require('./supabase-url');
const { safeErrorCode } = require('./group');
const { createAppServices } = require('./services');

app.enableSandbox();
protocol.registerScheme();

// LUMENEX: o nome mostrado mudou, mas a pasta de dados continua a antiga ("Ghost Rank"), para manter a
// sessão, o rastreador e as preferências de quem já usava. Precisa vir antes do bloqueio de instância única.
const LEGACY_USER_DATA_DIR = 'Ghost Rank';
app.setName('LUMENEX');
app.setPath('userData', path.join(app.getPath('appData'), LEGACY_USER_DATA_DIR));

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');

let mainWindow = null;
let controller = null;
let unregisterIpc = null;
let chatFeed = null;
let group = null;
let account = null;
let services = null;
let picker = null;
let groupTimer = null;
let steamLinkPending = false;
let lastGroupRefreshAt = 0;

const GROUP_REFRESH_MS = 60000;
const GROUP_FOCUS_MIN_MS = 30000;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  security.applyGlobalSecurity();

  app.whenReady().then(() => {

    const encryptor = {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (s) => safeStorage.encryptString(s),
      decrypt: (b) => safeStorage.decryptString(b),
    };
    const store = createStore({
      filePath: path.join(app.getPath('userData'), 'ghost-rank.dat'),
      encryptor,
    });
    const client = createOpenDotaClient({});
    const pushUpdate = () => {
      if (controller && mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('gr:update', controller.getView());
      }
    };

    // Contas, servidores, amigos, mensagens e presença: tudo em services.js (sem Electron).
    // Qualquer falha deixa só as contas indisponíveis; o rastreador segue normal.
    let config = null;
    try { config = loadConfig({}); } catch { config = null; }
    const sessionFile = createStore({ filePath: path.join(app.getPath('userData'), 'ghost-rank-session.dat'), encryptor });
    // Tokens nunca vão para o disco sem cifra: sem safeStorage a sessão fica só em memória.
    const sessionStore = {
      load: () => sessionFile.load(),
      save: (o) => {
        if (!encryptor.isAvailable()) throw new Error('sem cifra');
        sessionFile.save(o);
      },
      clear: () => sessionFile.clear(),
    };
    const prefsStore = createStore({ filePath: path.join(app.getPath('userData'), 'ghost-rank-prefs.dat'), encryptor });
    services = createAppServices({
      config,
      fetchImpl: (...a) => fetch(...a),
      WebSocketImpl: typeof WebSocket === 'function' ? WebSocket : null,
      sessionStore,
      prefsStore,
      notify: showNotification,
      openExternal: (url) => shell.openExternal(url),
      getIdleSeconds: () => powerMonitor.getSystemIdleTime(),
      isFocused: () => Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()),
      getSummary: () => (controller ? controller.getSummary() : null),
      onChange: () => { pushUpdate(); updateBadge(); },
    });
    account = services.account;
    group = services.group;
    chatFeed = services.chatFeed;
    const session = services.session;
    const voice = services.voice;
    const steam = services.steam;
    picker = security.createScreenPicker({ desktopCapturer });
    protocol.registerHandler(RENDERER_DIR, { imageOrigin: config ? normalizeSupabaseUrl(config.supabaseUrl) : null });

    const livekitVendor = protocol.vendorExists();
    controller = createController({
      client,
      store,
      getAuthView: () => account.getAuthView(),
      getGroupView: () => group.getView(),
      getChatView: () => (chatFeed ? chatFeed.getView() : null),
      getVoiceView: () => ({ available: Boolean(livekitVendor && services.voiceAvailable()) }),
      publishSnapshot: (summary) => group.publishSnapshot(summary),
      getExtraView: () => services.getExtraView(),
      onUpdate: (view) => {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('gr:update', view);
        }
      },
    });
    const steamService = steam ? {
      startLink: async () => {
        await steam.startLink();
        steamLinkPending = true; // ao voltar o foco, relemos o perfil para mostrar "Steam vinculada"
      },
    } : null;
    unregisterIpc = registerIpc(controller, {
      account, session, group, chatFeed, voice, picker, steam: steamService,
      app: services.available ? services.app : null, getMode: () => services.getMode(),
    });

    createWindow();
    controller.start();
    account.refreshProfile().catch(() => {});
    services.start();
    refreshGroup(true);
    groupTimer = setInterval(() => {
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) refreshGroup(true);
    }, GROUP_REFRESH_MS);
    if (typeof groupTimer.unref === 'function') groupTimer.unref();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', () => {
    if (groupTimer) clearInterval(groupTimer);
    groupTimer = null;
    if (services) services.stop();
    if (controller) controller.stop();
    if (unregisterIpc) unregisterIpc();
  });
}

/** Notificação de área de trabalho (menção/DM com a janela sem foco). Clique abre o alvo. */
function showNotification({ title, body, target, silent }) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: String(title).slice(0, 120), body: String(body).slice(0, 200), silent: Boolean(silent) });
  n.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    if (services) {
      services.openTarget(target).finally(() => {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('gr:notificationClick', target);
        }
      });
    }
  });
  n.show();
}

let lastBadge = -1;
function updateBadge() {
  if (!services) return;
  const n = services.badgeCount();
  if (n === lastBadge) return;
  lastBadge = n;
  try { app.setBadgeCount(n); } catch { /* nem todo sistema tem badge */ }
}

/** Recarrega o grupo em segundo plano (falhas só deixam o grupo como estava). */
function refreshGroup(quiet) {
  if (!group || !account || !account.isSignedIn()) return null;
  lastGroupRefreshAt = Date.now();
  return group.refresh({ quiet }).catch((err) => {
    console.warn('[grupo] falha ao carregar:', safeErrorCode(err));
  });
}

function onWindowFocus() {
  if (chatFeed) chatFeed.setFocused(true);
  if (Date.now() - lastGroupRefreshAt >= GROUP_FOCUS_MIN_MS) refreshGroup(true);
  if (steamLinkPending && account) {
    account.refreshProfile()
      .then(() => { if (account.getAuthView().steamLinked) steamLinkPending = false; })
      .catch(() => {});
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 480,
    minHeight: 560,
    show: false,
    title: 'LUMENEX',
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: security.isDevToolsAllowed({ env: process.env, isPackaged: app.isPackaged }),
    },
  });

  const { devTools } = security.applyWindowSecurity(mainWindow, { picker });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (mainWindow.isFocused() && chatFeed) chatFeed.setFocused(true);
  });
  // Sondagem do chat só com a janela focada.
  mainWindow.on('focus', onWindowFocus);
  mainWindow.on('blur', () => { if (chatFeed) chatFeed.setFocused(false); });
  mainWindow.on('closed', () => {
    if (chatFeed) chatFeed.setFocused(false);
    mainWindow = null;
  });

  mainWindow.loadURL(protocol.ORIGIN + 'index.html');
  if (devTools) mainWindow.webContents.openDevTools({ mode: 'detach' });
}
