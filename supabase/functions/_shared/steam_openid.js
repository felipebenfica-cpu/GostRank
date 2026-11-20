// Login pela Steam (OpenID 2.0): funcoes puras para montar a URL e validar a resposta.
// Sem dependencias: so URL, URLSearchParams, fetch e WebCrypto (Deno e Node 22).

export const STEAM_OP_ENDPOINT = 'https://steamcommunity.com/openid/login';
export const OPENID_NS = 'http://specs.openid.net/auth/2.0';
export const OPENID_IDENTIFIER_SELECT = 'http://specs.openid.net/auth/2.0/identifier_select';
export const STEAM_CLAIMED_ID_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})$/;
export const STATE_RE = /^[A-Za-z0-9_-]{43}$/;
const STEAM_ID64_BASE = 76561197960265728n;

// Campos que a Steam precisa ter assinado para a resposta valer.
const REQUIRED_SIGNED = ['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce', 'assoc_handle'];

function toParams(input) {
  if (input instanceof URLSearchParams) return input;
  return new URLSearchParams(input || {});
}

/** state aleatorio: 32 bytes em base64url (43 caracteres). */
export function randomState() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Endereco de retorno que a Steam deve devolver para este state. */
export function callbackUrl(functionUrl, state) {
  return `${functionUrl}/callback?state=${encodeURIComponent(state)}`;
}

function checkFunctionUrl(functionUrl) {
  if (typeof functionUrl !== 'string' || !/^https:\/\/[^/?#]+(\/[^?#]*)?$/.test(functionUrl) || functionUrl.endsWith('/')) {
    throw new TypeError('steam: functionUrl invalida');
  }
}

/** URL do login da Steam (openid.mode=checkid_setup). */
export function buildSteamLoginUrl({ functionUrl, state } = {}) {
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
export function verifyAssertionParams(input, { expectedReturnTo } = {}) {
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
export function buildCheckAuthBody(input) {
  const p = toParams(input);
  const body = new URLSearchParams();
  for (const [k, v] of p) {
    if (k.startsWith('openid.')) body.append(k, v);
  }
  body.set('openid.mode', 'check_authentication');
  return body;
}

/** Le a resposta da Steam ("chave:valor" por linha). So vale com is_valid:true. */
export function parseCheckAuthResponse(text) {
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
export async function checkAuthentication(input, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
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
export function steamId64ToAccountId(steamId64) {
  if (typeof steamId64 !== 'string' || !/^7656119\d{10}$/.test(steamId64)) {
    throw new TypeError('steam: SteamID64 invalido');
  }
  const id = BigInt(steamId64) - STEAM_ID64_BASE;
  if (id <= 0n || id > 0xffffffffn) throw new RangeError('steam: SteamID64 fora da faixa');
  return Number(id);
}
