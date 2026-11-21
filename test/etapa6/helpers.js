'use strict';

// Ajudantes dos testes da Etapa 6: REST falso (rotas por função) e WebSocket falso (Phoenix).

const ME = '11111111-1111-4111-8111-111111111111';
const LUA = '22222222-2222-4222-8222-222222222222';
const SOL = '33333333-3333-4333-8333-333333333333';
const G1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const C1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const C2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const V1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const CAT = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const DM1 = '44444444-4444-4444-8444-444444444444';

function b64url(s) {
  return Buffer.from(s).toString('base64url');
}

function token(sub = ME) {
  return `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ sub }))}.sig`;
}

/**
 * REST falso: `handlers` = { select(path), rpc(name,args), insert(table,body,opts), update(path,body), remove(path), upload(...), sign(...) }.
 * Guarda todas as chamadas em `calls`.
 */
function fakeRest(handlers = {}) {
  const calls = [];
  const rec = (kind, ...args) => { calls.push([kind, ...args]); };
  return {
    calls,
    base: 'https://proj.supabase.co',
    identity: async () => ({ token: token(), id: ME }),
    select: async (p) => { rec('select', p); return handlers.select ? handlers.select(p) : []; },
    rpc: async (n, a) => { rec('rpc', n, a); return handlers.rpc ? handlers.rpc(n, a) : null; },
    insert: async (t, b, o) => { rec('insert', t, b, o); return handlers.insert ? handlers.insert(t, b, o) : null; },
    update: async (p, b, o) => { rec('update', p, b, o); return handlers.update ? handlers.update(p, b, o) : []; },
    remove: async (p) => { rec('remove', p); return handlers.remove ? handlers.remove(p) : true; },
    upload: async (bucket, path, bytes, mime) => { rec('upload', bucket, path, mime); return handlers.upload ? handlers.upload(bucket, path, bytes, mime) : path; },
    uploadResumable: async (bucket, path, bytes, mime, opts = {}) => {
      rec('uploadResumable', bucket, path, mime, bytes.length);
      if (handlers.uploadResumable) return handlers.uploadResumable(bucket, path, bytes, mime, opts);
      if (opts.onProgress) { opts.onProgress(0.5); opts.onProgress(1); }
      return path;
    },
    removeObjects: async (bucket, paths) => { rec('removeObjects', bucket, paths); return true; },
    sign: async (bucket, paths) => { rec('sign', bucket, paths); return new Map(paths.map((p) => [p, `https://proj.supabase.co/storage/v1/object/sign/${bucket}/${p}?token=t`])); },
    publicUrl: (bucket, p) => (p ? `https://proj.supabase.co/storage/v1/object/public/${bucket}/${p}` : null),
    hasSchemaV3: async () => (handlers.hasSchemaV3 ? handlers.hasSchemaV3() : true),
  };
}

function profile(id, username, extra = {}) {
  return { id, username, display_name: username[0].toUpperCase() + username.slice(1), avatar_color: 1, avatar_path: null, about: null, custom_status: null, status: 'online', ...extra };
}

/** WebSocket falso: guarda o que o cliente envia; `server(msg)` entrega frames. */
class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; if (this.onclose) this.onclose({}); }
  open() { this.readyState = 1; if (this.onopen) this.onopen({}); }
  server(msg) { if (this.onmessage) this.onmessage({ data: JSON.stringify(msg) }); }
  /** Responde ok a todos os phx_join pendentes. */
  ackJoins(response = {}) {
    for (const m of this.sent.filter((x) => x.event === 'phx_join' && !x._acked)) {
      m._acked = true;
      this.server({ topic: m.topic, event: 'phx_reply', ref: m.ref, payload: { status: 'ok', response } });
    }
  }
}
FakeWebSocket.instances = [];

/** Timers manuais (nada roda sozinho). */
function manualTimers() {
  let id = 0;
  const pending = new Map();
  return {
    pending,
    setTimeout: (fn, ms) => { const k = ++id; pending.set(k, { fn, ms, kind: 'timeout' }); return k; },
    clearTimeout: (k) => { pending.delete(k); },
    setInterval: (fn, ms) => { const k = ++id; pending.set(k, { fn, ms, kind: 'interval' }); return k; },
    clearInterval: (k) => { pending.delete(k); },
    runTimeouts() {
      for (const [k, t] of [...pending]) if (t.kind === 'timeout') { pending.delete(k); t.fn(); }
    },
    runIntervals() {
      for (const t of [...pending.values()]) if (t.kind === 'interval') t.fn();
    },
  };
}

const flush = () => new Promise((r) => setImmediate(r));

module.exports = { ME, LUA, SOL, G1, C1, C2, V1, CAT, DM1, token, fakeRest, profile, FakeWebSocket, manualTimers, flush };
