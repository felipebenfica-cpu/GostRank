// @ts-nocheck
// ARQUIVO GERADO por supabase/functions/build-bundles.js a partir de livekit-token/index.ts e _shared/*.js.
// Nao edite a mao: altere os originais e rode o script de novo.

// ---- _shared/livekit_token.js (embutido) ----
const __shared_livekit_token = (() => {
  // Gera o token de acesso (JWT HS256) da sala de voz do LiveKit.
  // Sem dependencias: usa so WebCrypto e TextEncoder (Deno e Node 22).

  const encoder = new TextEncoder();

  function base64UrlFromBytes(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlJson(obj) {
    return base64UrlFromBytes(encoder.encode(JSON.stringify(obj)));
  }

  function requireText(value, field, max) {
    if (typeof value !== 'string' || value.length === 0 || value.length > max) {
      throw new TypeError(`livekit: campo invalido: ${field}`);
    }
  }

  /**
   * Cria o JWT do LiveKit.
   * @returns {Promise<string>}
   */
  async function createLiveKitToken({
    apiKey, apiSecret, identity, name, room, ttlSeconds = 3600, now = Date.now(), canPublishData = true,
  } = {}) {
    requireText(apiKey, 'apiKey', 256);
    requireText(apiSecret, 'apiSecret', 1024);
    requireText(identity, 'identity', 128);
    requireText(room, 'room', 128);
    if (name !== undefined && name !== null) requireText(name, 'name', 128);
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 86400) {
      throw new TypeError('livekit: ttlSeconds invalido');
    }
    if (!Number.isFinite(now)) throw new TypeError('livekit: now invalido');

    const nowSec = Math.floor(now / 1000);
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = {
      iss: apiKey,
      sub: identity,
      nbf: nowSec - 60, // margem para diferenca de relogio entre servidores
      exp: nowSec + ttlSeconds,
      video: {
        room,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: canPublishData === true,
      },
    };
    if (name) payload.name = name;

    const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(apiSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput)));
    return `${signingInput}.${base64UrlFromBytes(sig)}`;
  }

  /** Nome da sala de voz de um grupo (app antigo, sem canais de voz). */
  function roomForGroup(groupId) {
    return 'grupo-' + groupId;
  }

  /** Nome da sala de um canal de voz. */
  function roomForChannel(channelId) {
    return 'vc_' + channelId;
  }

  /** Nome da sala de chamada de uma DM. */
  function roomForDm(dmId) {
    return 'dm_' + dmId;
  }
  return { createLiveKitToken, roomForGroup, roomForChannel, roomForDm };
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

const { createLiveKitToken, roomForChannel, roomForDm, roomForGroup } = __shared_livekit_token;
const { UUID_RE, bearerToken, getUserFromToken, jsonResponse, preflightResponse, restCall, supabaseConfig } = __shared_http;

// Edge Function "livekit-token": entrega o token de uma sala de voz.
// POST com "Authorization: Bearer <access_token do usuario>" e corpo JSON:
//   {"channelId": "<uuid>"}  canal de voz de um servidor (precisa ser membro)      -> sala vc_<id>
//   {"dmId": "<uuid>"}       chamada numa DM (precisa participar, sem bloqueio)    -> sala dm_<id>
//   {} ou sem corpo          app antigo: primeiro canal de voz do primeiro servidor
// Publicar com "Verify JWT" DESLIGADO: a funcao valida o token ela mesma em /auth/v1/user.

type Deps = {
  getEnv: (name: string) => string | undefined;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

type Target = { kind: 'legacy' } | { kind: 'channel'; id: string } | { kind: 'dm'; id: string };

const ALLOW = { Allow: 'POST, OPTIONS' };
const MAX_BODY = 1024;

/** Le o corpo: vazio, {} , {channelId} ou {dmId}. Qualquer outra coisa e invalida (null). */
async function readTarget(req: Request): Promise<Target | null> {
  let text = '';
  try { text = await req.text(); } catch { return null; }
  if (text.length > MAX_BODY) return null;
  if (text.trim() === '') return { kind: 'legacy' };
  let body: unknown;
  try { body = JSON.parse(text); } catch { return null; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const keys = Object.keys(b);
  if (keys.some((k) => k !== 'channelId' && k !== 'dmId')) return null;
  const hasChannel = b.channelId !== undefined && b.channelId !== null;
  const hasDm = b.dmId !== undefined && b.dmId !== null;
  if (hasChannel && hasDm) return null;
  if (hasChannel) {
    return typeof b.channelId === 'string' && UUID_RE.test(b.channelId) ? { kind: 'channel', id: b.channelId } : null;
  }
  if (hasDm) {
    return typeof b.dmId === 'string' && UUID_RE.test(b.dmId) ? { kind: 'dm', id: b.dmId } : null;
  }
  return { kind: 'legacy' };
}

const rows = (r: { status: number; data: any }) => (r.status === 200 && Array.isArray(r.data) ? r.data : null);

export function createHandler({ getEnv, fetchImpl = fetch, now = () => Date.now() }: Deps) {
  return async function handler(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return preflightResponse(ALLOW);
    if (req.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' }, ALLOW);

    const cfg = supabaseConfig(getEnv);
    if (!cfg) return jsonResponse(500, { error: 'server_misconfigured' });

    try {
      const user = await getUserFromToken({
        supabaseUrl: cfg.supabaseUrl, apiKey: cfg.anonKey, token: bearerToken(req), fetchImpl,
      });
      if (!user || !UUID_RE.test(user.id)) return jsonResponse(401, { error: 'unauthorized' });

      const target = await readTarget(req);
      if (!target) return jsonResponse(400, { error: 'bad_request' });

      // Tolera espacos, aspas e "NOME=" colados por engano no painel.
      const clean = (name: string) => (getEnv(name) || '').trim()
        .replace(new RegExp('^' + name + '='), '').replace(/^["']|["']$/g, '').trim();
      const lkUrl = clean('LIVEKIT_URL');
      const apiKey = clean('LIVEKIT_API_KEY');
      const apiSecret = clean('LIVEKIT_API_SECRET');
      if (!lkUrl.startsWith('wss://') || !apiKey || !apiSecret) {
        return jsonResponse(503, { error: 'voice_unconfigured' });
      }

      const rest = { supabaseUrl: cfg.supabaseUrl, serviceKey: cfg.serviceKey, fetchImpl };
      const upstream = () => jsonResponse(502, { error: 'upstream_error' });
      let room: string;

      if (target.kind === 'channel') {
        const ch = rows(await restCall(rest, 'GET', `channels?select=id,group_id,kind&id=eq.${target.id}`));
        if (!ch) return upstream();
        const c = ch[0];
        if (!c || c.kind !== 'voice' || typeof c.group_id !== 'string' || !UUID_RE.test(c.group_id)) {
          return jsonResponse(403, { error: 'not_member' });
        }
        const mem = rows(await restCall(rest, 'GET',
          `group_members?select=group_id&group_id=eq.${c.group_id}&user_id=eq.${user.id}`));
        if (!mem) return upstream();
        if (mem.length === 0) return jsonResponse(403, { error: 'not_member' });
        room = roomForChannel(target.id);
      } else if (target.kind === 'dm') {
        const dm = rows(await restCall(rest, 'GET', `dm_channels?select=id,user_a,user_b&id=eq.${target.id}`));
        if (!dm) return upstream();
        const d = dm[0];
        if (!d || (d.user_a !== user.id && d.user_b !== user.id)) return jsonResponse(403, { error: 'not_member' });
        const other = d.user_a === user.id ? d.user_b : d.user_a;
        if (typeof other !== 'string' || !UUID_RE.test(other)) return jsonResponse(403, { error: 'not_member' });
        const blocks = rows(await restCall(rest, 'GET',
          `relationships?select=user_id&kind=eq.blocked&user_id=in.(${user.id},${other})&other_id=in.(${user.id},${other})`));
        if (!blocks) return upstream();
        if (blocks.length > 0) return jsonResponse(403, { error: 'not_member' });
        room = roomForDm(target.id);
      } else {
        // App antigo: primeiro servidor da pessoa, primeiro canal de voz dele.
        const member = rows(await restCall(rest, 'GET',
          `group_members?select=group_id&user_id=eq.${user.id}&order=joined_at.asc&limit=1`));
        if (!member) return upstream();
        const groupId = member[0] && member[0].group_id;
        if (typeof groupId !== 'string' || !UUID_RE.test(groupId)) return jsonResponse(403, { error: 'not_in_group' });
        const vc = await restCall(rest, 'GET',
          `channels?select=id&group_id=eq.${groupId}&kind=eq.voice&order=position.asc,created_at.asc&limit=1`);
        const first = rows(vc);
        const channelId = first && first[0] && first[0].id;
        room = typeof channelId === 'string' && UUID_RE.test(channelId) ? roomForChannel(channelId) : roomForGroup(groupId);
      }

      const profile = await restCall(rest, 'GET', `profiles?select=display_name&id=eq.${user.id}`);
      const displayName = profile.status === 200 && Array.isArray(profile.data) && profile.data[0]
        && typeof profile.data[0].display_name === 'string' ? profile.data[0].display_name : undefined;

      const token = await createLiveKitToken({
        apiKey,
        apiSecret,
        identity: user.id,
        name: displayName,
        room,
        ttlSeconds: 3600,
        now: now(),
        canPublishData: true,
      });
      return jsonResponse(200, { url: lkUrl, token });
    } catch {
      return jsonResponse(502, { error: 'upstream_error' });
    }
  };
}

if (typeof Deno !== 'undefined') {
  Deno.serve(createHandler({ getEnv: (name: string) => Deno.env.get(name) }));
}
