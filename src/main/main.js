'use strict';

const path = require('node:path');
const { app, BrowserWindow, safeStorage } = require('electron');

const protocol = require('./protocol');
const security = require('./security');
const { registerIpc } = require('./ipc');
const { createOpenDotaClient } = require('./opendota');
const { createStore } = require('./store');
const { createController } = require('./controller');
const { loadConfig } = require('./config');
const { createAuthClient } = require('./auth');
const { createSessionManager } = require('./session');
const { createProfileClient } = require('./profile');
const { createAccountService } = require('./account');

app.enableSandbox();
protocol.registerScheme();

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');

let mainWindow = null;
let controller = null;
let unregisterIpc = null;

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
    let account = createAccountService({});
    let session = null;
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
        const profile = createProfileClient({
          supabaseUrl: config.supabaseUrl,
          anonKey: config.anonKey,
          getAccessToken: async () => {
            const s = await session.get();
            return s ? s.accessToken : null;
          },
        });
        account = createAccountService({ config, auth, session, profile, onChange: pushUpdate });
      }
    } catch {
      account = createAccountService({});
      session = null;
    }

    controller = createController({
      client,
      store,
      getAuthView: () => account.getAuthView(),
      onUpdate: (view) => {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('gr:update', view);
        }
      },
    });
    unregisterIpc = registerIpc(controller, { account, session });

    createWindow();
    controller.start();
    account.refreshProfile().catch(() => {});

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', () => {
    if (controller) controller.stop();
    if (unregisterIpc) unregisterIpc();
  });
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

  const { devTools } = security.applyWindowSecurity(mainWindow);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(protocol.ORIGIN + 'index.html');
  if (devTools) mainWindow.webContents.openDevTools({ mode: 'detach' });
}
