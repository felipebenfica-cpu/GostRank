'use strict';

const REFRESH_MARGIN_SEC = 60;

function validSession(s) {
  return s && typeof s === 'object' && s.version === 1
    && typeof s.accessToken === 'string' && s.accessToken
    && typeof s.refreshToken === 'string' && s.refreshToken
    && Number.isFinite(s.expiresAt)
    && s.user && typeof s.user === 'object' && typeof s.user.id === 'string';
}

function createSessionManager({ store, auth, now = () => Date.now() } = {}) {
  let current = null;
  let loaded = false;
  let inflight = null;

  function load() {
    if (loaded) return;
    loaded = true;
    try {
      const s = store.load();
      if (validSession(s)) {
        current = {
          accessToken: s.accessToken,
          refreshToken: s.refreshToken,
          expiresAt: s.expiresAt,
          user: { id: s.user.id, email: String(s.user.email ?? ''), emailConfirmed: Boolean(s.user.emailConfirmed) },
        };
      }
    } catch { current = null; }
  }

  function persist(session) {
    try { store.save({ version: 1, ...session }); } catch { /* fica só em memória */ }
  }

  /** Sessão atual sem renovar nem tocar na rede. */
  function peek() {
    load();
    return current;
  }

  function set(session) {
    loaded = true;
    current = session;
    persist(session);
  }

  function clear() {
    loaded = true;
    current = null;
    try { store.clear(); } catch { /* ignora */ }
  }

  async function renew(old) {
    try {
      const next = await auth.refresh(old.refreshToken);
      if (current === old) set(next);
      return next;
    } catch (err) {
      const code = err && err.code;
      if (code === 'invalid_credentials') {
        if (current === old) clear();
        return null;
      }
      return old; // rede, timeout, limite ou resposta ruim: mantém a sessão
    }
  }

  async function get() {
    load();
    const s = current;
    if (!s) return null;
    if (s.expiresAt - Math.floor(now() / 1000) >= REFRESH_MARGIN_SEC) return s;
    if (!inflight) {
      inflight = renew(s).finally(() => { inflight = null; });
    }
    return inflight;
  }

  return { get, peek, set, clear };
}

module.exports = { createSessionManager };
