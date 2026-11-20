'use strict';

// Voz (Etapa 4): pede à Edge Function `livekit-token` um token LiveKit para a sala do grupo.
// O token e a URL só passam pela resposta do IPC; nunca vão para log.

const { createSupabaseRest } = require('./group');

const TOKEN_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MAX_TOKEN = 8192;
const LIVEKIT_SUFFIX = '.livekit.cloud';
const HOST_LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

const VOICE_MESSAGES = Object.freeze({
  voice_unconfigured: 'Voz ainda não configurada no servidor.',
  not_in_group: 'Entre em um grupo para usar a sala de voz.',
  bad_response: 'O servidor de voz enviou uma resposta inesperada. Tente novamente.',
});

/** URL do LiveKit: wss://, sem credenciais/porta estranha, host *.livekit.cloud ou na lista extra. */
function isValidLiveKitUrl(value, extraHosts = []) {
  if (typeof value !== 'string' || value.length > 500) return false;
  let u;
  try { u = new URL(value); } catch { return false; }
  if (u.protocol !== 'wss:') return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== '443') return false;
  if (u.search || u.hash) return false;
  const host = u.hostname.toLowerCase();
  const extra = Array.isArray(extraHosts) ? extraHosts.map((h) => String(h).toLowerCase()) : [];
  if (extra.includes(host)) return true;
  if (!host.endsWith(LIVEKIT_SUFFIX)) return false;
  const sub = host.slice(0, -LIVEKIT_SUFFIX.length);
  return sub.length > 0 && sub.split('.').every((l) => HOST_LABEL_RE.test(l));
}

/** JWT de 3 partes base64url (o LiveKit valida a assinatura; aqui só o formato). */
function isValidJwtShape(token) {
  return typeof token === 'string' && token.length <= MAX_TOKEN && TOKEN_RE.test(token);
}

function createVoiceClient({ fetchImpl, supabaseUrl, anonKey, getAccessToken, livekitHosts = [], timeoutMs = 10000 } = {}) {
  const rest = createSupabaseRest({
    fetchImpl, supabaseUrl, anonKey, getAccessToken, timeoutMs, extraMessages: VOICE_MESSAGES,
  });
  const { identity, call, errorFor } = rest;

  async function getToken() {
    const { token } = await identity();
    const { status, data } = await call('/functions/v1/livekit-token', { method: 'POST', token, body: {} });
    const code = data && typeof data === 'object' && typeof data.error === 'string' ? data.error : '';
    if (status === 503 && code === 'voice_unconfigured') throw errorFor('voice_unconfigured');
    if (status === 403 && code === 'not_in_group') throw errorFor('not_in_group');
    if (status === 401) throw errorFor('unauthenticated');
    if (status !== 200 || !data || typeof data !== 'object') throw errorFor('bad_response');
    if (!isValidLiveKitUrl(data.url, livekitHosts) || !isValidJwtShape(data.token)) throw errorFor('bad_response');
    return { url: data.url, token: data.token };
  }

  return { getToken };
}

module.exports = { createVoiceClient, isValidLiveKitUrl, isValidJwtShape, VOICE_MESSAGES };
