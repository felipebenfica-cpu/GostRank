'use strict';

const { normalizeSupabaseUrl, isValidAnonKey } = require('./supabase-url');

const MESSAGES = Object.freeze({
  invalid_credentials: 'E-mail ou senha incorretos.',
  email_not_confirmed: 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.',
  weak_password: 'Senha fraca demais. Escolha uma senha mais longa e menos comum.',
  rate_limited: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  network: 'Sem conexão com o servidor de contas. Verifique sua internet.',
  timeout: 'O servidor de contas demorou demais para responder. Tente novamente.',
  bad_response: 'O servidor de contas enviou uma resposta inesperada. Tente novamente.',
  unconfigured: 'Contas indisponíveis neste computador.',
  unauthenticated: 'Sua sessão expirou. Entre novamente.',
  same_password: 'A nova senha precisa ser diferente da atual.',
  link_invalid: 'Este link é inválido, já foi usado ou expirou. Peça um novo.',
  invalid: 'Dados inválidos.',
});

const MAX_BODY_CHARS = 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class AuthError extends Error {
  constructor(code) {
    super(MESSAGES[code] || MESSAGES.bad_response);
    this.name = 'AuthError';
    this.code = code;
  }
}

/** base64url → texto UTF-8 (Node com Buffer; navegador com atob, para a versão web). */
function base64UrlToText(s) {
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'base64url').toString('utf8');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Decodifica o campo `sub` do JWT (sem verificar assinatura: o servidor valida; aqui só lemos o id). */
function userIdFromToken(token) {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(base64UrlToText(parts[1]));
    const sub = payload && payload.sub;
    return typeof sub === 'string' && UUID_RE.test(sub) ? sub.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Requisição JSON com timeout, só https. Lança AuthError para rede, timeout e 429. */
function createRequester({ fetchImpl, supabaseUrl, anonKey, timeoutMs = 10000 } = {}) {
  const base = normalizeSupabaseUrl(supabaseUrl);
  const fetchFn = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!base || !isValidAnonKey(anonKey) || typeof fetchFn !== 'function') {
    throw new AuthError('unconfigured');
  }

  return async function request(pathAndQuery, { method = 'GET', token = null, body, headers = {} } = {}) {
    const url = base + pathAndQuery;
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
    try {
      const h = {
        apikey: anonKey,
        Authorization: `Bearer ${token || anonKey}`,
        Accept: 'application/json',
        ...headers,
      };
      const init = { method, headers: h, signal: ctrl.signal, redirect: 'error' };
      if (body !== undefined) {
        h['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      const res = await fetchFn(url, init);
      const text = await res.text();
      if (typeof text !== 'string' || text.length > MAX_BODY_CHARS) throw new AuthError('bad_response');
      let data = null;
      if (text.length > 0) {
        try { data = JSON.parse(text); } catch { data = null; }
      }
      if (res.status === 429) throw new AuthError('rate_limited');
      return { status: res.status, data };
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw new AuthError(timedOut || (err && err.name === 'AbortError') ? 'timeout' : 'network');
    } finally {
      clearTimeout(timer);
    }
  };
}

function errorCodeOf(data) {
  if (!data || typeof data !== 'object') return '';
  const c = data.error_code || data.code || data.error;
  return typeof c === 'string' ? c : '';
}

function createAuthClient({ fetchImpl, supabaseUrl, anonKey, now = () => Date.now(), timeoutMs = 10000, recoveryRedirectUrl = null } = {}) {
  const request = createRequester({ fetchImpl, supabaseUrl, anonKey, timeoutMs });

  function toSession(data) {
    if (!data || typeof data !== 'object') throw new AuthError('bad_response');
    const { access_token: accessToken, refresh_token: refreshToken, user } = data;
    if (typeof accessToken !== 'string' || typeof refreshToken !== 'string'
      || !accessToken || !refreshToken || !user || typeof user !== 'object') {
      throw new AuthError('bad_response');
    }
    const id = userIdFromToken(accessToken);
    if (!id) throw new AuthError('bad_response');
    let expiresAt = Number(data.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
      const inSec = Number(data.expires_in);
      if (!Number.isFinite(inSec) || inSec <= 0) throw new AuthError('bad_response');
      expiresAt = Math.floor(now() / 1000) + Math.floor(inSec);
    }
    return {
      accessToken,
      refreshToken,
      expiresAt: Math.floor(expiresAt),
      user: {
        id,
        email: typeof user.email === 'string' ? user.email : '',
        emailConfirmed: Boolean(user.email_confirmed_at || user.confirmed_at),
      },
    };
  }

  function mapTokenFailure(data, refreshing = false) {
    const code = errorCodeOf(data);
    if (code === 'email_not_confirmed') return new AuthError('email_not_confirmed');
    if (code === 'weak_password') return new AuthError('weak_password');
    if (code === 'invalid_credentials' || code === 'invalid_grant'
        || (refreshing && ['refresh_token_not_found', 'refresh_token_already_used', 'session_not_found', 'session_expired'].includes(code))) {
      return new AuthError('invalid_credentials');
    }
    return new AuthError('bad_response');
  }

  async function signUp({ email, password }) {
    const { status, data } = await request('/auth/v1/signup', { method: 'POST', body: { email, password } });
    if (status >= 200 && status < 300) return { needsConfirmation: true };
    const code = errorCodeOf(data);
    if (code === 'weak_password') throw new AuthError('weak_password');
    // Conta já existente: mesma resposta de um cadastro novo (não revela quem tem conta).
    if (code === 'user_already_exists' || code === 'email_exists') return { needsConfirmation: true };
    throw new AuthError('bad_response');
  }

  async function signIn({ email, password }) {
    const { status, data } = await request('/auth/v1/token?grant_type=password', {
      method: 'POST', body: { email, password },
    });
    if (status === 200) return toSession(data);
    throw mapTokenFailure(data);
  }

  async function refresh(refreshToken) {
    if (typeof refreshToken !== 'string' || !refreshToken) throw new AuthError('invalid_credentials');
    const { status, data } = await request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', body: { refresh_token: refreshToken },
    });
    if (status === 200) return toSession(data);
    throw mapTokenFailure(data, true);
  }

  async function recover({ email }) {
    try {
      // redirect_to precisa estar na lista "Redirect URLs" do Supabase; fora dela, vale o "Site URL".
      const q = recoveryRedirectUrl ? `?redirect_to=${encodeURIComponent(recoveryRedirectUrl)}` : '';
      await request(`/auth/v1/recover${q}`, { method: 'POST', body: { email } });
    } catch (err) {
      // Só falha de conexão aparece; respostas do servidor nunca revelam se a conta existe.
      if (err instanceof AuthError && (err.code === 'network' || err.code === 'timeout')) throw err;
    }
    return { ok: true };
  }

  async function signOut(accessToken) {
    if (typeof accessToken !== 'string' || !accessToken) return { ok: true };
    await request('/auth/v1/logout?scope=local', { method: 'POST', token: accessToken });
    return { ok: true };
  }

  // ---------------- Redefinição de senha (o token de recuperação nunca vai para o disco) ----------------
  /** 4xx num passo da recuperação = link que não vale mais; o resto é falha temporária. */
  function recoveryFailure(status, data) {
    const code = errorCodeOf(data);
    if (code === 'same_password') return new AuthError('same_password');
    if (code === 'weak_password') return new AuthError('weak_password');
    if (status === 401 || status === 403 || ['otp_expired', 'session_not_found', 'session_expired', 'bad_jwt'].includes(code)) {
      return new AuthError('link_invalid');
    }
    return new AuthError('bad_response');
  }

  /** Link no formato token_hash: só é consumido aqui, quando a pessoa envia a senha nova. */
  async function verifyRecovery(tokenHash) {
    const { status, data } = await request('/auth/v1/verify', {
      method: 'POST', body: { type: 'recovery', token_hash: tokenHash },
    });
    if (status === 200) return toSession(data);
    throw recoveryFailure(status, data);
  }

  /** Confere no servidor o token do link e devolve o e-mail da conta. */
  async function getUser(accessToken) {
    const { status, data } = await request('/auth/v1/user', { token: accessToken });
    if (status === 200 && data && typeof data === 'object') {
      return { email: typeof data.email === 'string' ? data.email : '' };
    }
    throw recoveryFailure(status, data);
  }

  async function updatePassword(accessToken, password) {
    const { status, data } = await request('/auth/v1/user', { method: 'PUT', token: accessToken, body: { password } });
    if (status !== 200) throw recoveryFailure(status, data);
    return { ok: true };
  }

  /** Revoga os refresh tokens de todos os aparelhos. */
  async function signOutEverywhere(accessToken) {
    const { status } = await request('/auth/v1/logout?scope=global', { method: 'POST', token: accessToken });
    if (status < 200 || status >= 300) throw new AuthError('bad_response');
    return { ok: true };
  }

  return { signUp, signIn, refresh, recover, signOut, verifyRecovery, getUser, updatePassword, signOutEverywhere };
}

module.exports = { createAuthClient, createRequester, AuthError, userIdFromToken, MESSAGES };
