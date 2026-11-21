// @ts-nocheck
// ARQUIVO GERADO por supabase/functions/build-bundles.js a partir de steam-link/index.ts e _shared/*.js.
// Nao edite a mao: altere os originais e rode o script de novo.

// ---- _shared/steam_openid.js (embutido) ----
const __shared_steam_openid = (() => {
  // Login pela Steam (OpenID 2.0): funcoes puras para montar a URL e validar a resposta.
  // Sem dependencias: so URL, URLSearchParams, fetch e WebCrypto (Deno e Node 22).

  const STEAM_OP_ENDPOINT = 'https://steamcommunity.com/openid/login';
  const OPENID_NS = 'http://specs.openid.net/auth/2.0';
  const OPENID_IDENTIFIER_SELECT = 'http://specs.openid.net/auth/2.0/identifier_select';
  const STEAM_CLAIMED_ID_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})$/;
  const STATE_RE = /^[A-Za-z0-9_-]{43}$/;
  const STEAM_ID64_BASE = 76561197960265728n;

  // Campos que a Steam precisa ter assinado para a resposta valer.
  const REQUIRED_SIGNED = ['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce', 'assoc_handle'];

  function toParams(input) {
    if (input instanceof URLSearchParams) return input;
    return new URLSearchParams(input || {});
  }

  /** state aleatorio: 32 bytes em base64url (43 caracteres). */
  function randomState() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /** Endereco de retorno que a Steam deve devolver para este state. */
  function callbackUrl(functionUrl, state) {
    return `${functionUrl}/callback?state=${encodeURIComponent(state)}`;
  }

  function checkFunctionUrl(functionUrl) {
    if (typeof functionUrl !== 'string' || !/^https:\/\/[^/?#]+(\/[^?#]*)?$/.test(functionUrl) || functionUrl.endsWith('/')) {
      throw new TypeError('steam: functionUrl invalida');
    }
  }

  /** URL do login da Steam (openid.mode=checkid_setup). */
  function buildSteamLoginUrl({ functionUrl, state } = {}) {
    checkFunctionUrl(functionUrl);
    if (typeof state !== 'string' || !STATE_RE.test(state)) throw new TypeError('steam: state invalido');
    const url = new URL(STEAM_OP_ENDPOINT);
    url.searchParams.set('openid.ns', OPENID_NS);
    url.searchParams.set('openid.mode', 'checkid_setup');
    url.searchParams.set('openid.claimed_id', OPENID_IDENTIFIER_SELECT);
    url.searchParams.set('openid.identity', OPENID_IDENTIFIER_SELECT);
    url.searchParams.set('openid.return_to', callbackUrl(functionUrl, state));
    url.searchParams.set('openid.realm', functionUrl);
    return url.toString();
  }

  /**
   * Confere os campos da resposta da Steam (sem rede).
   * @returns {{ok: true, steamId64: string} | {ok: false, reason: string}}
   */
  function verifyAssertionParams(input, { expectedReturnTo } = {}) {
    const p = toParams(input);
    const get = (k) => p.get('openid.' + k);
    if (typeof expectedReturnTo !== 'string' || !expectedReturnTo) return { ok: false, reason: 'no_expected_return_to' };
    if (get('ns') !== OPENID_NS) return { ok: false, reason: 'bad_ns' };
    if (get('mode') !== 'id_res') return { ok: false, reason: 'bad_mode' };
    if (get('op_endpoint') !== STEAM_OP_ENDPOINT) return { ok: false, reason: 'bad_op_endpoint' };
    if (get('return_to') !== expectedReturnTo) return { ok: false, reason: 'bad_return_to' };
    const claimed = get('claimed_id') || '';
    const m = STEAM_CLAIMED_ID_RE.exec(claimed);
    if (!m) return { ok: false, reason: 'bad_claimed_id' };
    if (get('identity') !== claimed) return { ok: false, reason: 'bad_identity' };
    if (!get('sig') || !get('response_nonce') || !get('assoc_handle')) return { ok: false, reason: 'missing_fields' };
    const signed = (get('signed') || '').split(',');
    for (const f of REQUIRED_SIGNED) {
      if (!signed.includes(f)) return { ok: false, reason: 'unsigned_' + f };
    }
    return { ok: true, steamId64: m[1] };
  }

  /** Corpo do POST check_authentication: mesmos campos openid.*, com mode trocado. */
  function buildCheckAuthBody(input) {
    const p = toParams(input);
    const body = new URLSearchParams();
    for (const [k, v] of p) {
      if (k.startsWith('openid.')) body.append(k, v);
    }
    body.set('openid.mode', 'check_authentication');
    return body;
  }

  /** Le a resposta da Steam ("chave:valor" por linha). So vale com is_valid:true. */
  function parseCheckAuthResponse(text) {
    if (typeof text !== 'string') return false;
    const fields = {};
    for (const line of text.split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i <= 0) continue;
      fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    if (fields.ns !== undefined && fields.ns !== OPENID_NS) return false;
    return fields.is_valid === 'true';
  }

  /** Pergunta a Steam se a resposta e autentica. */
  async function checkAuthentication(input, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(STEAM_OP_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: buildCheckAuthBody(input).toString(),
        redirect: 'error',
        signal: ctrl.signal,
      });
      if (!res.ok) return false;
      return parseCheckAuthResponse(await res.text());
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /** SteamID64 (texto) -> account id de 32 bits (o mesmo do OpenDota/Dota 2). */
  function steamId64ToAccountId(steamId64) {
    if (typeof steamId64 !== 'string' || !/^7656119\d{10}$/.test(steamId64)) {
      throw new TypeError('steam: SteamID64 invalido');
    }
    const id = BigInt(steamId64) - STEAM_ID64_BASE;
    if (id <= 0n || id > 0xffffffffn) throw new RangeError('steam: SteamID64 fora da faixa');
    return Number(id);
  }
  return { STEAM_OP_ENDPOINT, OPENID_NS, OPENID_IDENTIFIER_SELECT, STEAM_CLAIMED_ID_RE, STATE_RE, randomState, callbackUrl, buildSteamLoginUrl, verifyAssertionParams, buildCheckAuthBody, parseCheckAuthResponse, checkAuthentication, steamId64ToAccountId };
})();

// ---- _shared/http.js (embutido) ----
const __shared_http = (() => {
  // Ajudantes HTTP comuns das Edge Functions (Deno e Node 22, sem dependencias).
  // Nunca registrar tokens, chaves ou corpo de resposta em log.

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const BEARER_RE = /^Bearer ([A-Za-z0-9._~+/=-]{20,4096})$/;

  const BASE_HEADERS = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };

  // CORS: a versao web (navegador) chama as funcoes de outra origem. A autorizacao continua sendo o
  // token do usuario no cabecalho Authorization (sem cookies), entao liberar qualquer origem e seguro.
  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };

  /** Resposta ao preflight (OPTIONS) do navegador. */
  function preflightResponse(extra = {}) {
    return new Response(null, { status: 204, headers: { ...CORS_HEADERS, ...extra } });
  }

  /** Token do cabecalho Authorization (ou null). */
  function bearerToken(req) {
    const h = req.headers.get('authorization') || '';
    const m = BEARER_RE.exec(h);
    return m ? m[1] : null;
  }

  function jsonResponse(status, obj, extra = {}) {
    return new Response(JSON.stringify(obj), {
      status,
      headers: { ...BASE_HEADERS, ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...extra },
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const PAGE_CSP = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

  /**
   * Pagina minima de resposta para o navegador.
   * html=true gera HTML; senao, texto puro (o Supabase troca text/html por text/plain
   * em respostas GET quando o projeto nao tem dominio proprio).
   */
  function pageResponse(status, message, { html = false } = {}) {
    const headers = { ...BASE_HEADERS, 'Content-Security-Policy': PAGE_CSP };
    if (html) {
      const body = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Ghost Rank</title></head>'
        + `<body><p>${escapeHtml(message)}</p></body></html>`;
      return new Response(body, { status, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
    }
    return new Response(`Ghost Rank\n\n${message}\n`, { status, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  async function timedFetch(fetchImpl, url, init, timeoutMs = 8000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { ...init, redirect: 'error', signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Valida o token do usuario no proprio Supabase (GET /auth/v1/user).
   * @returns {Promise<{id: string} | null>} null se o token nao vale.
   * Lanca erro se o Supabase nao responder.
   */
  async function getUserFromToken({ supabaseUrl, apiKey, token, fetchImpl = fetch }) {
    if (!token) return null;
    const res = await timedFetch(fetchImpl, `${supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: { apikey: apiKey, Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) throw new Error('auth_unavailable');
    const data = await res.json().catch(() => null);
    const id = data && typeof data.id === 'string' ? data.id : '';
    return UUID_RE.test(id) ? { id } : null;
  }

  /**
   * Chamada ao PostgREST com a chave service_role (so dentro da funcao).
   * @returns {Promise<{status: number, data: any}>}
   */
  async function restCall({ supabaseUrl, serviceKey, fetchImpl = fetch }, method, pathAndQuery, { body, prefer } = {}) {
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    const res = await timedFetch(fetchImpl, `${supabaseUrl}/rest/v1/${pathAndQuery}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = null; }
    }
    return { status: res.status, data };
  }

  /** Le a configuracao basica do Supabase das variaveis de ambiente. */
  function supabaseConfig(getEnv) {
    const supabaseUrl = (getEnv('SUPABASE_URL') || '').replace(/\/+$/, '');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY') || '';
    const anonKey = getEnv('SUPABASE_ANON_KEY') || serviceKey;
    if (!/^https?:\/\/[^/?#]+$/.test(supabaseUrl) || !serviceKey) return null;
    return { supabaseUrl, serviceKey, anonKey };
  }
  return { UUID_RE, CORS_HEADERS, preflightResponse, bearerToken, jsonResponse, PAGE_CSP, pageResponse, getUserFromToken, restCall, supabaseConfig };
})();

const { STATE_RE, buildSteamLoginUrl, callbackUrl, checkAuthentication, randomState, steamId64ToAccountId, verifyAssertionParams } = __shared_steam_openid;
const { UUID_RE, bearerToken, getUserFromToken, jsonResponse, pageResponse, preflightResponse, restCall, supabaseConfig } = __shared_http;

// Edge Function "steam-link": vincula a conta Steam ao perfil do Ghost Rank.
//   POST /steam-link/start    (Authorization: Bearer <access_token>) -> {url}
//   GET  /steam-link/callback (volta da Steam, aberto no navegador)  -> pagina simples
// Publicar com "Verify JWT" DESLIGADO: o callback vem do navegador sem token,
// e o /start valida o token ele mesmo em /auth/v1/user.

type Deps = {
  getEnv: (name: string) => string | undefined;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

const STATE_TTL_MS = 10 * 60 * 1000;

const MSG = {
  ok: 'Steam vinculada. Pode voltar ao Ghost Rank.',
  invalid: 'Nao foi possivel confirmar o login na Steam. Volte ao Ghost Rank e tente de novo.',
  expired: 'Este link expirou ou ja foi usado. Volte ao Ghost Rank e tente de novo.',
  conflict: 'Esta conta Steam ja esta vinculada a outra conta do Ghost Rank.',
  error: 'Algo deu errado ao vincular a Steam. Tente de novo mais tarde.',
};

export function createHandler({ getEnv, fetchImpl = fetch, now = () => Date.now() }: Deps) {
  return async function handler(req: Request): Promise<Response> {
    const cfg = supabaseConfig(getEnv);
    const html = getEnv('STEAM_LINK_HTML') === 'true';
    const path = new URL(req.url).pathname;
    const route = path.endsWith('/start') ? 'start' : path.endsWith('/callback') ? 'callback' : '';

    if (route === 'start') {
      if (req.method === 'OPTIONS') return preflightResponse({ Allow: 'POST, OPTIONS' });
      if (req.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' }, { Allow: 'POST, OPTIONS' });
      if (!cfg) return jsonResponse(500, { error: 'server_misconfigured' });
      try {
        const user = await getUserFromToken({
          supabaseUrl: cfg.supabaseUrl, apiKey: cfg.anonKey, token: bearerToken(req), fetchImpl,
        });
        if (!user || !UUID_RE.test(user.id)) return jsonResponse(401, { error: 'unauthorized' });

        const rest = { supabaseUrl: cfg.supabaseUrl, serviceKey: cfg.serviceKey, fetchImpl };
        const nowIso = encodeURIComponent(new Date(now()).toISOString());
        // Um state ativo por pessoa; aproveita para limpar os vencidos.
        await restCall(rest, 'DELETE', `steam_link_states?or=(user_id.eq.${user.id},expires_at.lt.${nowIso})`,
          { prefer: 'return=minimal' });
        const state = randomState();
        const ins = await restCall(rest, 'POST', 'steam_link_states', {
          body: { state, user_id: user.id, expires_at: new Date(now() + STATE_TTL_MS).toISOString() },
          prefer: 'return=minimal',
        });
        if (ins.status !== 201 && ins.status !== 204) return jsonResponse(502, { error: 'upstream_error' });
        const functionUrl = `${cfg.supabaseUrl}/functions/v1/steam-link`;
        return jsonResponse(200, { url: buildSteamLoginUrl({ functionUrl, state }) });
      } catch {
        return jsonResponse(502, { error: 'upstream_error' });
      }
    }

    if (route === 'callback') {
      if (req.method !== 'GET') return pageResponse(405, MSG.invalid, { html });
      if (!cfg) return pageResponse(500, MSG.error, { html });
      try {
        const params = new URL(req.url).searchParams;
        const state = params.get('state') || '';
        if (!STATE_RE.test(state)) return pageResponse(400, MSG.invalid, { html });
        const functionUrl = `${cfg.supabaseUrl}/functions/v1/steam-link`;
        const check = verifyAssertionParams(params, { expectedReturnTo: callbackUrl(functionUrl, state) });
        if (!check.ok) return pageResponse(400, MSG.invalid, { html });

        // Consome o state (uso unico e dentro da validade).
        const rest = { supabaseUrl: cfg.supabaseUrl, serviceKey: cfg.serviceKey, fetchImpl };
        const nowIso = encodeURIComponent(new Date(now()).toISOString());
        const consumed = await restCall(rest, 'DELETE',
          `steam_link_states?state=eq.${state}&expires_at=gt.${nowIso}&select=user_id`,
          { prefer: 'return=representation' });
        if (consumed.status !== 200 || !Array.isArray(consumed.data)) return pageResponse(502, MSG.error, { html });
        const userId = consumed.data[0] && consumed.data[0].user_id;
        if (typeof userId !== 'string' || !UUID_RE.test(userId)) return pageResponse(400, MSG.expired, { html });

        // Confirma com a propria Steam que a resposta e autentica.
        if (!(await checkAuthentication(params, { fetchImpl }))) return pageResponse(400, MSG.invalid, { html });

        const accountId = steamId64ToAccountId(check.steamId64);
        const upd = await restCall(rest, 'PATCH', `profiles?id=eq.${userId}`, {
          body: { steam_account_id: accountId },
          prefer: 'return=minimal',
        });
        if (upd.status === 409) return pageResponse(409, MSG.conflict, { html });
        if (upd.status !== 204 && upd.status !== 200) return pageResponse(502, MSG.error, { html });
        return pageResponse(200, MSG.ok, { html });
      } catch {
        return pageResponse(502, MSG.error, { html });
      }
    }

    return jsonResponse(404, { error: 'not_found' });
  };
}

if (typeof Deno !== 'undefined') {
  Deno.serve(createHandler({ getEnv: (name: string) => Deno.env.get(name) }));
}
