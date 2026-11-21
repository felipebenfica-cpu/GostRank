'use strict';

/**
 * Atualização automática do .exe.
 *
 * - Instalado (instalador NSIS "LUMENEX-Setup-x.y.z.exe"): electron-updater baixa a versão nova em segundo
 *   plano a partir do GitHub Releases; quando termina, a tela mostra "Reiniciar e atualizar". Se a pessoa
 *   não clicar, a atualização é instalada sozinha ao fechar o app.
 * - Portátil (GhostRank-x.y.z.exe): não dá para se substituir sozinho; o app consulta a última versão no
 *   GitHub e mostra "Nova versão disponível — baixar o instalador".
 * - Rodando pelo código (`npm start`): desligado.
 *
 * Sem dependência do Electron aqui: tudo entra por injeção, para dar para testar.
 */

const RELEASES_API = 'https://api.github.com/repos/felipebenfica-cpu/GostRank/releases/latest';
const RELEASES_PAGE = 'https://github.com/felipebenfica-cpu/GostRank/releases/latest';
const FIRST_CHECK_MS = 20 * 1000;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function isNewer(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

function createUpdater({
  autoUpdater = null,       // instância do electron-updater (só no modo instalado)
  mode = 'off',             // 'installed' | 'portable' | 'off'
  currentVersion = '0.0.0',
  fetchImpl = null,
  openExternal = () => {},
  onChange = () => {},
  timers = { setTimeout, setInterval, clearTimeout, clearInterval },
} = {}) {
  let state = { status: 'idle', version: null, progress: 0, error: null };
  let manualUrl = RELEASES_PAGE;
  let firstTimer = null;
  let loop = null;

  function set(patch) {
    state = { ...state, ...patch };
    onChange();
  }

  function getView() {
    if (mode === 'off') return null;
    return { mode, current: currentVersion, ...state };
  }

  if (mode === 'installed' && autoUpdater) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.on('checking-for-update', () => {
      if (state.status !== 'ready' && state.status !== 'downloading') set({ status: 'checking', error: null });
    });
    autoUpdater.on('update-available', (info) => set({ status: 'downloading', version: info && info.version ? String(info.version) : null, progress: 0 }));
    autoUpdater.on('update-not-available', () => { if (state.status === 'checking') set({ status: 'idle' }); });
    autoUpdater.on('download-progress', (p) => {
      const pct = p && Number.isFinite(p.percent) ? Math.max(0, Math.min(100, p.percent)) / 100 : state.progress;
      set({ status: 'downloading', progress: pct });
    });
    autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', progress: 1, version: info && info.version ? String(info.version) : state.version }));
    autoUpdater.on('error', () => {
      // Sem internet ou GitHub fora do ar: tenta de novo na próxima rodada, sem incomodar a pessoa.
      if (state.status !== 'ready') set({ status: 'idle', error: 'Não deu para procurar atualizações agora.' });
    });
  }

  async function checkPortable() {
    if (typeof fetchImpl !== 'function') return;
    set({ status: 'checking', error: null });
    try {
      const res = await fetchImpl(RELEASES_API, { headers: { accept: 'application/vnd.github+json' } });
      if (!res.ok) throw new Error('http ' + res.status);
      const data = await res.json();
      const tag = data && typeof data.tag_name === 'string' ? data.tag_name : '';
      if (!isNewer(tag, currentVersion)) { set({ status: 'idle' }); return; }
      const setup = Array.isArray(data.assets)
        ? data.assets.find((a) => a && /^LUMENEX-Setup-[\d.]+\.exe$/.test(String(a.name)) && typeof a.browser_download_url === 'string')
        : null;
      const url = setup && /^https:\/\/github\.com\//.test(setup.browser_download_url) ? setup.browser_download_url : RELEASES_PAGE;
      manualUrl = url;
      set({ status: 'available', version: tag.replace(/^v/, '') });
    } catch {
      set({ status: 'idle', error: 'Não deu para procurar atualizações agora.' });
    }
  }

  async function check() {
    if (mode === 'installed' && autoUpdater) {
      if (state.status === 'ready' || state.status === 'downloading') return getView();
      try { await autoUpdater.checkForUpdates(); } catch { /* evento 'error' já trata */ }
    } else if (mode === 'portable') {
      if (state.status !== 'available') await checkPortable();
    }
    return getView();
  }

  function install() {
    if (mode === 'installed' && autoUpdater && state.status === 'ready') {
      // isSilent=true (sem telas do instalador), isForceRunAfter=true (reabre o app sozinho)
      autoUpdater.quitAndInstall(true, true);
      return true;
    }
    if (mode === 'portable' && state.status === 'available') {
      openExternal(manualUrl);
      return true;
    }
    return false;
  }

  function start() {
    if (mode === 'off') return;
    firstTimer = timers.setTimeout(() => { check(); }, FIRST_CHECK_MS);
    loop = timers.setInterval(() => { check(); }, CHECK_EVERY_MS);
  }

  function stop() {
    if (firstTimer) timers.clearTimeout(firstTimer);
    if (loop) timers.clearInterval(loop);
    firstTimer = null;
    loop = null;
  }

  return { getView, check, install, start, stop };
}

module.exports = { createUpdater, isNewer, parseVersion, RELEASES_API, RELEASES_PAGE };
