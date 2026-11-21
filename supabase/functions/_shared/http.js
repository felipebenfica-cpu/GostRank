// Ajudantes HTTP comuns das Edge Functions (Deno e Node 22, sem dependencias).
// Nunca registrar tokens, chaves ou corpo de resposta em log.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BEARER_RE = /^Bearer ([A-Za-z0-9._~+/=-]{20,4096})$/;

const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

// CORS: a versao web (navegador) chama as funcoes de outra origem. A autorizacao continua sendo o
// token do usuario no cabecalho Authorization (sem cookies), entao liberar qualquer origem e seguro.
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

/** Resposta ao preflight (OPTIONS) do navegador. */
export function preflightResponse(extra = {}) {
  return new Response(null, { status: 204, headers: { ...CORS_HEADERS, ...extra } });
}

/** Token do cabecalho Authorization (ou null). */
export function bearerToken(req) {
  const h = req.headers.get('authorization') || '';
  const m = BEARER_RE.exec(h);
  return m ? m[1] : null;
}

export function jsonResponse(status, obj, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...BASE_HEADERS, ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const PAGE_CSP = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/**
 * Pagina minima de resposta para o navegador.
 * html=true gera HTML; senao, texto puro (o Supabase troca text/html por text/plain
 * em respostas GET quando o projeto nao tem dominio proprio).
 */
export function pageResponse(status, message, { html = false } = {}) {
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
export async function getUserFromToken({ supabaseUrl, apiKey, token, fetchImpl = fetch }) {
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
export async function restCall({ supabaseUrl, serviceKey, fetchImpl = fetch }, method, pathAndQuery, { body, prefer } = {}) {
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
export function supabaseConfig(getEnv) {
  const supabaseUrl = (getEnv('SUPABASE_URL') || '').replace(/\/+$/, '');
  const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY') || '';
  const anonKey = getEnv('SUPABASE_ANON_KEY') || serviceKey;
  if (!/^https?:\/\/[^/?#]+$/.test(supabaseUrl) || !serviceKey) return null;
  return { supabaseUrl, serviceKey, anonKey };
}
