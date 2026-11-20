'use strict';

// Vincular conta Steam (Etapa 1B): pede à Edge Function `steam-link/start` a URL do OpenID
// do Steam e abre no navegador do sistema, só depois de validar a URL.

const { createSupabaseRest } = require('./group');
const { isAllowedExternalUrl } = require('./security');

const STEAM_LOGIN_PREFIX = 'https://steamcommunity.com/openid/login?';
const MAX_URL = 4000;

const STEAM_MESSAGES = Object.freeze({
  bad_response: 'Não foi possível iniciar a vinculação com a Steam. Tente novamente.',
  open_failed: 'Não foi possível abrir o navegador.',
});

/** Só https://steamcommunity.com/openid/login?..., sem credenciais, porta ou fragmento. */
function isValidSteamLoginUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_URL || !value.startsWith(STEAM_LOGIN_PREFIX)) return false;
  let u;
  try { u = new URL(value); } catch { return false; }
  if (u.protocol !== 'https:' || u.hostname !== 'steamcommunity.com') return false;
  if (u.username || u.password || u.port || u.hash) return false;
  if (u.pathname !== '/openid/login' || u.search.length < 2) return false;
  return isAllowedExternalUrl(value);
}

function createSteamClient({ fetchImpl, supabaseUrl, anonKey, getAccessToken, openExternal, timeoutMs = 10000 } = {}) {
  const { identity, call, errorFor } = createSupabaseRest({
    fetchImpl, supabaseUrl, anonKey, getAccessToken, timeoutMs, extraMessages: STEAM_MESSAGES,
  });

  async function startLink() {
    const { token } = await identity();
    const { status, data } = await call('/functions/v1/steam-link/start', { method: 'POST', token, body: {} });
    if (status === 401) throw errorFor('unauthenticated');
    if (status !== 200 || !data || typeof data !== 'object' || !isValidSteamLoginUrl(data.url)) {
      throw errorFor('bad_response');
    }
    if (typeof openExternal !== 'function') throw errorFor('open_failed');
    try {
      await openExternal(data.url);
    } catch {
      throw errorFor('open_failed');
    }
    return data.url;
  }

  return { startLink };
}

module.exports = { createSteamClient, isValidSteamLoginUrl, STEAM_LOGIN_PREFIX };
