'use strict';

// Versão web (Netlify): o build gera só os arquivos esperados, com CSP sem inline, e o bridge.js
// empacotado expõe window.ghostRank com EXATAMENTE os métodos do preload do Electron.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..', '..');
const LIVEKIT = path.join(ROOT, 'node_modules', 'livekit-client', 'dist', 'livekit-client.umd.js');
let esbuildOk = true;
try { require.resolve('esbuild'); } catch { esbuildOk = false; }
const canBuild = esbuildOk && fs.existsSync(LIVEKIT);
const skip = canBuild ? false : 'precisa de npm install (esbuild e livekit-client)';

const { buildWeb, cspFor, APP_FILES } = require('../../scripts/build-netlify');

let outDir = null;
function built() {
  if (!outDir) {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-web-'));
    buildWeb({ outDir, log: () => {} });
  }
  return outDir;
}
test.after(() => { if (outDir) fs.rmSync(outDir, { recursive: true, force: true }); });

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? listFiles(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  });
}

/** Métodos que o preload do Electron expõe (fonte da verdade). */
function preloadKeys() {
  const exposed = {};
  const fake = {
    contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api; } },
    ipcRenderer: { invoke: () => Promise.resolve({ ok: true }), on() {}, removeListener() {} },
  };
  const orig = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'electron') return fake;
    return orig.call(this, request, ...rest);
  };
  const file = path.join(ROOT, 'src', 'preload', 'preload.js');
  delete require.cache[file];
  try { require(file); } finally { Module._load = orig; delete require.cache[file]; }
  return Object.keys(exposed.ghostRank).sort();
}

/** Roda o bridge.js empacotado num "navegador" falso; fetch responde com `respond(url, init)`. */
function runBundle(respond) {
  const code = fs.readFileSync(path.join(built(), 'bridge.js'), 'utf8');
  const storage = new Map();
  const timers = [];
  const noop = () => {};
  const unref = (t) => { if (t && t.unref) t.unref(); timers.push(t); return t; };
  const fetches = [];
  const win = {
    addEventListener: noop, removeEventListener: noop, focus: noop, open: () => null,
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    fetch: async (url, init) => {
      fetches.push(String(url));
      const r = respond(String(url), init || {});
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
    },
    WebSocket: function FakeWebSocket() { this.readyState = 0; this.send = noop; this.close = noop; },
  };
  const context = {
    window: win,
    document: { title: 'Ghost Rank', hidden: false, hasFocus: () => true, addEventListener: noop },
    navigator: {},
    console: { log: noop, warn: noop, error: noop, info: noop, debug: noop },
    setTimeout: (...a) => unref(setTimeout(...a)),
    clearTimeout,
    setInterval: (...a) => unref(setInterval(...a)),
    clearInterval,
    queueMicrotask, Promise, URL, URLSearchParams, Response, Headers, AbortController, TextEncoder, TextDecoder,
    atob, btoa, Blob, Uint8Array, ArrayBuffer, DataView, JSON, Math, Date, crypto: globalThis.crypto,
  };
  for (const k of ['fetch', 'localStorage', 'WebSocket', 'addEventListener', 'removeEventListener', 'open', 'focus']) context[k] = win[k];
  win.window = win;
  vm.createContext(context);
  // window e globalThis são o mesmo objeto no navegador: copiamos o que o bundle define em window.
  vm.runInContext(code, context, { filename: 'bridge.js' });
  const cleanup = () => { for (const t of timers) { clearTimeout(t); clearInterval(t); } };
  // Objetos criados no "navegador" (o ipc.js confere o protótipo, como no mesmo realm da página).
  const obj = (o) => vm.runInContext('(' + JSON.stringify(o) + ')', context);
  return { api: win.ghostRank, storage, fetches, cleanup, obj };
}

test('build gera só os arquivos da versão web, sem config local nem prévia', { skip }, () => {
  const files = listFiles(built()).sort();
  const expected = [...APP_FILES, 'bridge.js', 'index.html', '_headers', 'favicon.png', 'vendor/livekit-client.umd.js'].sort();
  assert.deepEqual(files, expected);
  const bundle = fs.readFileSync(path.join(built(), 'bridge.js'), 'utf8');
  for (const bad of ['config.local', 'mock-bridge', 'service_role', 'LIVEKIT_API_SECRET']) {
    assert.ok(!bundle.includes(bad), `bridge.js não pode conter ${bad}`);
  }
  const html = fs.readFileSync(path.join(built(), 'index.html'), 'utf8');
  assert.ok(html.indexOf('vendor/livekit-client.umd.js') < html.indexOf('src="bridge.js"'));
  assert.ok(html.indexOf('src="bridge.js"') < html.indexOf('src="app.js"'));
  assert.doesNotMatch(html, /<script>|\sstyle="|\son[a-z]+="/i);
});

test('_headers tem a CSP da versão web, sem inline e só com as origens do app', { skip }, () => {
  const headers = fs.readFileSync(path.join(built(), '_headers'), 'utf8');
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.public.json'), 'utf8'));
  const origin = new URL(cfg.supabaseUrl).origin;
  const csp = headers.match(/Content-Security-Policy: (.*)/)[1];
  assert.equal(csp, cspFor(origin));
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*\s|https:\s|\bdata:\s.*script/);
  const dir = (name) => (csp.split('; ').find((d) => d.startsWith(name + ' ')) || '').split(' ').slice(1);
  assert.deepEqual(dir('script-src'), ["'self'"]);
  assert.deepEqual(dir('style-src'), ["'self'"]);
  for (const o of [origin, origin.replace('https:', 'wss:'), 'https://api.opendota.com', 'https://*.livekit.cloud', 'wss://*.livekit.cloud']) {
    assert.ok(dir('connect-src').includes(o), 'connect-src sem ' + o);
  }
  for (const o of ["'self'", 'data:', 'blob:', origin]) assert.ok(dir('img-src').includes(o), 'img-src sem ' + o);
  assert.deepEqual(dir('media-src'), ["'self'", 'blob:', 'mediastream:']);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
});

test('bridge.js expõe exatamente os métodos do preload e responde pelos mesmos handlers', { skip }, async () => {
  const env = runBundle((url) => {
    if (url.includes('/auth/v1/token')) return { status: 400, body: { error_code: 'invalid_credentials', msg: 'Invalid login credentials' } };
    return { status: 404, body: {} };
  });
  try {
    assert.equal(typeof env.api, 'object');
    assert.ok(Object.isFrozen(env.api));
    assert.deepEqual(Object.keys(env.api).sort(), preloadKeys());

    const v = await env.api.getView();
    assert.equal(v.ok, true);
    assert.equal(v.view.configured, false);

    // Login vai ao Supabase real do config público e erro vira português.
    const r = await env.api.signIn(env.obj({ email: 'ana@example.com', password: 'senha-errada-123' }));
    assert.deepEqual({ ...r }, { ok: false, error: 'E-mail ou senha incorretos.' });
    assert.ok(env.fetches.some((u) => u.startsWith('https://') && u.includes('.supabase.co/auth/v1/token')));

    // Validação do ipc.js vale aqui também.
    assert.deepEqual({ ...(await env.api.joinServer('')) }, { ok: false, error: 'Dados inválidos.' });

    // Compartilhar tela usa o seletor do navegador.
    const s = await env.api.listScreenSources();
    assert.equal(s.ok, true);
    assert.equal(s.browserPicker, true);

    // onUpdate devolve função de cancelar.
    const off = env.api.onUpdate(() => {});
    assert.equal(typeof off, 'function');
    off();
  } finally { env.cleanup(); }
});

test('falha de rede no login vira mensagem amigável (sem quebrar a tela)', { skip }, async () => {
  const env = runBundle(() => { throw new TypeError('Failed to fetch'); });
  try {
    const r = await env.api.signIn(env.obj({ email: 'ana@example.com', password: 'senha-certa-123' }));
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, 'string');
    assert.ok(r.error.length > 5 && !/TypeError|fetch|Dados inválidos/i.test(r.error), r.error);
  } finally { env.cleanup(); }
});
