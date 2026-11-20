'use strict';

const UID = '0b8f1c52-3a4d-4e6f-9a1b-2c3d4e5f6a7b';
const URL_OK = 'https://abcdefghijklmnop.supabase.co';
const KEY = 'sb_publishable_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';

function jwt(sub = UID, extra = {}) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ sub, ...extra })}.assinatura`;
}

function tokenResponse({ sub = UID, email = 'ana@example.com', expiresAt, expiresIn, confirmed = true, refresh = 'refresh-1' } = {}) {
  const body = {
    access_token: jwt(sub),
    refresh_token: refresh,
    user: { id: sub, email, email_confirmed_at: confirmed ? '2026-01-01T00:00:00Z' : null },
  };
  if (expiresAt !== undefined) body.expires_at = expiresAt;
  if (expiresIn !== undefined) body.expires_in = expiresIn;
  return body;
}

/** fetch falso: responde na ordem; guarda as chamadas. Cada resposta: {status, body} ou Error/função. */
function fakeFetch(...responses) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    const next = responses.length > 1 ? responses.shift() : responses[0];
    const r = typeof next === 'function' ? await next(url, init) : next;
    if (r instanceof Error) throw r;
    return {
      status: r.status,
      text: async () => (r.body === undefined ? '' : (typeof r.body === 'string' ? r.body : JSON.stringify(r.body))),
    };
  };
  fn.calls = calls;
  return fn;
}

/** Espia console.* e devolve tudo o que foi escrito (para provar que nada sensível vaza). */
function spyConsole() {
  const out = [];
  const saved = {};
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) {
    saved[k] = console[k];
    console[k] = (...a) => out.push(a.map(String).join(' '));
  }
  return { out, restore: () => { for (const k of Object.keys(saved)) console[k] = saved[k]; } };
}

module.exports = { UID, URL_OK, KEY, jwt, tokenResponse, fakeFetch, spyConsole };
