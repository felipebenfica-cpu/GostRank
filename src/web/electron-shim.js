'use strict';

// Substituto do módulo 'electron' no pacote da versão web (esbuild: alias electron → este arquivo).
// O preload.js roda igual ao do app: `contextBridge.exposeInMainWorld` grava em window e
// `ipcRenderer.invoke` chama direto os mesmos handlers validados do ipc.js (sem processo separado).

const handlers = new Map();
const listeners = new Map();
// Evento "confiável" igual ao que o Electron entrega para a janela do app.
const TRUSTED_EVENT = Object.freeze({ senderFrame: Object.freeze({ url: 'app://ghost-rank/index.html' }) });
let exposeHook = null;

const ipcRenderer = {
  invoke(channel, payload) {
    const h = handlers.get(channel);
    if (!h) return Promise.resolve({ ok: false, error: 'Indisponível na versão web.' });
    return Promise.resolve().then(() => h(TRUSTED_EVENT, payload));
  },
  on(channel, listener) {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel).add(listener);
  },
  removeListener(channel, listener) {
    const set = listeners.get(channel);
    if (set) set.delete(listener);
  },
};

const contextBridge = {
  exposeInMainWorld(key, api) {
    const finalApi = exposeHook ? exposeHook(api) : api;
    Object.defineProperty(window, key, { value: Object.freeze(finalApi), configurable: false, writable: false });
  },
};

/** Liga os handlers do ipc.js (canal → função (event, payload)). */
function setHandlers(map) {
  handlers.clear();
  for (const [channel, h] of Object.entries(map)) handlers.set(channel, h);
}

/** Envia um evento para quem chamou ipcRenderer.on (ex.: 'gr:update'). */
function send(channel, data) {
  const set = listeners.get(channel);
  if (!set) return;
  for (const l of [...set]) {
    try { l({}, data); } catch { /* um ouvinte não derruba os outros */ }
  }
}

/** Ajusta a API antes de expor (troca métodos que só fazem sentido no Electron). */
function setExposeHook(fn) { exposeHook = fn; }

module.exports = { ipcRenderer, contextBridge, setHandlers, send, setExposeHook, TRUSTED_EVENT };
