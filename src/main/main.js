'use strict';

const path = require('node:path');
const { app, BrowserWindow, safeStorage, shell, desktopCapturer } = require('electron');

const protocol = require('./protocol');
const security = require('./security');
const { registerIpc } = require('./ipc');
const { createOpenDotaClient } = require('./opendota');
const { createStore } = require('./store');
const { createController } = require('./controller');
const { loadConfig } = require('./config');
const { createAuthClient } = require('./auth');
const { createSessionManager } = require('./session');
const { createSocialClient } = require('./social');
const { createProfileClient } = require('./profile');
const { createAccountService } = require('./account');
const { createGroupClient, createGroupService, safeErrorCode } = require('./group');
const { createChatClient, createChatFeed } = require('./chat');
const { createVoiceClient } = require('./voice');
const { createSteamClient } = require('./steam');

app.enableSandbox();
protocol.registerScheme();

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');

let mainWindow = null;
let controller = null;
let unregisterIpc = null;
let chatFeed = null;
let group = null;
let account = null;
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
    protocol.registerHandler(RENDERER_DIR);

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

    // Contas: qualquer falha aqui deixa só as contas indisponíveis; o rastreador segue normal.
    account = createAccountService({});
    let session = null;
    let social = null;
    let voice = null;
    let steam = null;
    group = createGroupService({});
    picker = security.createScreenPicker({ desktopCapturer });
    try {
      const config = loadConfig({});
      if (config) {
        const sessionFile = createStore({
          filePath: path.join(app.getPath('userData'), 'ghost-rank-session.dat'),
          encryptor,
        });
        // Tokens nunca vão para o disco sem cifra: sem safeStorage a sessão fica só em memória.
        const sessionStore = {
          load: () => sessionFile.load(),
          save: (o) => {
            if (!encryptor.isAvailable()) throw new Error('sem cifra');
            sessionFile.save(o);
          },
          clear: () => sessionFile.clear(),
        };
        const auth = createAuthClient({ supabaseUrl: config.supabaseUrl, anonKey: config.anonKey });
        session = createSessionManager({ store: sessionStore, auth });
        const getAccessToken = async () => {
          const s = await session.get();
          return s ? s.accessToken : null;
        };
        const common = { supabaseUrl: config.supabaseUrl, anonKey: config.anonKey, getAccessToken };
        const profile = createProfileClient(common);
        social = createSocialClient(common);
        chatFeed = createChatFeed({ client: createChatClient(common), onChange: pushUpdate });
        group = createGroupService({
          client: createGroupClient(common),
          isSignedIn: () => Boolean(session.peek()),
          chatFeed,
          getSummary: () => (controller ? controller.getSummary() : null),
          onChange: pushUpdate,
        });
        voice = createVoiceClient(common);
        steam = createSteamClient({ ...common, openExternal: (url) => shell.openExternal(url) });
        account = createAccountService({
          config,
          auth,
          session,
          profile,
          onChange: pushUpdate,
          onSessionChange: (signedIn) => {
            if (signedIn) return refreshGroup(true);
            steamLinkPending = false;
            group.clear();
            return null;
          },
        });
      }
    } catch {
      account = createAccountService({});
      group = createGroupService({});
      if (chatFeed) chatFeed.stop();
      chatFeed = null;
      session = null;
      social = null;
      voice = null;
      steam = null;
    }

    const livekitVendor = protocol.vendorExists();
    controller = createController({
      client,
      store,
      getAuthView: () => account.getAuthView(),
      getGroupView: () => group.getView(),
      getChatView: () => (chatFeed ? chatFeed.getView() : null),
      getVoiceView: () => ({ available: Boolean(livekitVendor && account.isSignedIn() && group.hasGroup()) }),
      publishSnapshot: (summary) => group.publishSnapshot(summary),
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
      account, session, social, group, chatFeed, voice, picker, steam: steamService,
    });

    createWindow();
    controller.start();
    account.refreshProfile().catch(() => {});
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
    if (chatFeed) chatFeed.stop();
    if (controller) controller.stop();
    if (unregisterIpc) unregisterIpc();
  });
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
    title: 'Ghost Rank',
    backgroundColor: '#0e0f13',
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
