'use strict';

// Orquestra auth + sessão + perfil e entrega a parte `auth` da View.
// Converte erros de conta em UserInputError (mensagens em português, seguras para a tela).

const { validateEmail, validatePassword } = require('../core/credentials');
const { UserInputError } = require('./controller');
const { userIdFromToken } = require('./auth');

const MAX_LOGIN_PASSWORD = 128;
const RECOVER_COOLDOWN_MS = 60 * 1000;
const TOKEN_RE = /^[A-Za-z0-9._~+/=-]{6,4096}$/;

function toUserError(err) {
  if (err && err.name === 'UserInputError') return err;
  if (err && err.name === 'AuthError' && typeof err.message === 'string') return new UserInputError(err.message);
  return err;
}

function createAccountService({
  config = null, auth = null, session = null, profile = null, onChange = () => {}, onSessionChange = () => {},
  now = () => Date.now(),
} = {}) {
  const available = Boolean(config && auth && session && profile);
  let cache = null; // { userId, displayName, mmrVisibility, steamLinked }
  // Link de recuperação aberto. Fica só em memória: nunca é salvo nem enviado para a tela.
  let recovery = null; // { status: 'checking'|'ready'|'invalid'|'done', email, accessToken, tokenHash, sessionsRevoked }
  const lastRecover = new Map(); // e-mail -> instante do último pedido

  function emit() {
    try { onChange(); } catch { /* o consumidor não pode quebrar o serviço */ }
  }

  /** Avisa grupo/chat que a sessão mudou (true = entrou, false = saiu). */
  function sessionChanged(signedIn) {
    try {
      const r = onSessionChange(signedIn);
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch { /* o consumidor não pode quebrar o serviço */ }
  }

  function toCache(userId, p) {
    return {
      userId,
      displayName: p.displayName,
      mmrVisibility: p.mmrVisibility,
      steamLinked: p.steamAccountId !== null && p.steamAccountId !== undefined,
    };
  }

  function need() {
    if (!available) throw new UserInputError('Contas indisponíveis neste computador.');
  }

  /** Parte pública do estado de recuperação (sem tokens). */
  function recoveryView() {
    if (!recovery) return {};
    return {
      recovery: {
        status: recovery.status,
        email: recovery.email || null,
        sessionsRevoked: Boolean(recovery.sessionsRevoked),
      },
    };
  }

  function getAuthView() {
    return { ...baseAuthView(), ...recoveryView() };
  }

  function baseAuthView() {
    if (!available) return { status: 'unconfigured', email: null, displayName: null, mmrVisibility: null, steamLinked: false };
    const s = session.peek();
    if (!s) return { status: 'signed_out', email: null, displayName: null, mmrVisibility: null, steamLinked: false };
    const mine = cache && cache.userId === s.user.id ? cache : null;
    return {
      status: 'signed_in',
      email: s.user.email || null,
      displayName: mine ? mine.displayName : null,
      mmrVisibility: mine ? mine.mmrVisibility : null,
      steamLinked: mine ? mine.steamLinked : false,
    };
  }

  async function refreshProfile() {
    if (!available) return;
    const s = session.peek();
    if (!s) return;
    try {
      const p = await profile.get();
      const cur = session.peek();
      if (cur && cur.user.id === s.user.id) {
        cache = toCache(cur.user.id, p);
      }
    } catch { /* perfil é opcional na tela */ }
    emit();
  }

  async function run(fn) {
    try { return await fn(); } catch (err) { throw toUserError(err); }
  }

  function isSignedIn() {
    return available && Boolean(session.peek());
  }

  function needEmail(v) {
    const e = validateEmail(v);
    if (!e.ok) throw new UserInputError(e.error);
    return e.value;
  }

  async function signUp({ email, password }) {
    need();
    const e = needEmail(email);
    const p = validatePassword(password);
    if (!p.ok) throw new UserInputError(p.error);
    return run(() => auth.signUp({ email: e, password }));
  }

  async function signIn({ email, password }) {
    need();
    const e = needEmail(email);
    if (typeof password !== 'string' || password.length === 0 || password.length > MAX_LOGIN_PASSWORD) {
      throw new UserInputError('E-mail ou senha incorretos.');
    }
    const s = await run(() => auth.signIn({ email: e, password }));
    session.set(s);
    cache = null;
    await refreshProfile();
    sessionChanged(true);
    return { ok: true };
  }

  async function signOut() {
    need();
    const s = session.peek();
    session.clear();
    cache = null;
    sessionChanged(false);
    if (s) {
      try { await auth.signOut(s.accessToken); } catch { /* a sessão local já foi apagada */ }
    }
    return { ok: true };
  }

  async function recover({ email }) {
    need();
    const e = needEmail(email);
    // Contra reenvio em sequência. Vale igual para e-mail com ou sem conta (não revela nada);
    // o limite que protege de verdade é o do servidor.
    const wait = (lastRecover.get(e) ?? -Infinity) + RECOVER_COOLDOWN_MS - now();
    if (wait > 0) throw new UserInputError(`Aguarde ${Math.ceil(wait / 1000)} s antes de pedir outro link.`);
    const result = await run(() => auth.recover({ email: e }));
    lastRecover.set(e, now());
    return result;
  }

  /**
   * Chamado quando o app é aberto por um link de recuperação.
   * `link`: { accessToken } (modelo padrão do Supabase), { tokenHash } (modelo do LUMENEX) ou { error: true }.
   */
  async function beginRecovery(link = {}) {
    if (!available) return;
    const accessToken = TOKEN_RE.test(link.accessToken || '') ? link.accessToken : null;
    const tokenHash = TOKEN_RE.test(link.tokenHash || '') ? link.tokenHash : null;
    if (link.error || (!accessToken && !tokenHash)) {
      recovery = { status: 'invalid' };
      emit();
      return;
    }
    // token_hash só é consumido no envio da senha (leitores de e-mail que abrem links não o gastam).
    const mine = { status: accessToken ? 'checking' : 'ready', accessToken, tokenHash };
    recovery = mine;
    emit();
    if (!accessToken) return;
    try {
      const u = await auth.getUser(accessToken);
      if (recovery !== mine) return;
      mine.email = u.email;
      mine.status = 'ready';
    } catch (err) {
      if (recovery !== mine) return;
      // Falha de rede não condena o link: o envio da senha confere de novo.
      mine.status = err && err.code === 'link_invalid' ? 'invalid' : 'ready';
    }
    emit();
  }

  async function resetPassword({ password } = {}) {
    need();
    const mine = recovery;
    if (!mine || mine.status !== 'ready') throw new UserInputError('Este link não vale mais. Peça um novo.');
    const p = validatePassword(password);
    if (!p.ok) throw new UserInputError(p.error);
    try {
      if (!mine.accessToken) {
        const s = await auth.verifyRecovery(mine.tokenHash);
        mine.accessToken = s.accessToken;
        mine.email = s.user.email;
        mine.tokenHash = null;
      }
      await auth.updatePassword(mine.accessToken, password);
    } catch (err) {
      if (err && err.code === 'link_invalid' && recovery === mine) {
        recovery = { status: 'invalid' };
        emit();
      }
      throw toUserError(err);
    }
    let sessionsRevoked = true;
    try { await auth.signOutEverywhere(mine.accessToken); } catch { sessionsRevoked = false; }
    // Sai também deste navegador, mas só se a sessão aberta for da MESMA conta do link.
    const open = session.peek();
    if (open && open.user.id === userIdFromToken(mine.accessToken)) {
      session.clear();
      cache = null;
      sessionChanged(false);
    }
    // Se a pessoa fechou a tela no meio, não reabre.
    if (recovery === mine) recovery = { status: 'done', email: mine.email, sessionsRevoked };
    emit();
    return { ok: true };
  }

  async function dismissRecovery() {
    recovery = null;
    emit();
    return { ok: true };
  }

  async function updateProfile(patch) {
    need();
    if (!session.peek()) throw new UserInputError('Entre na sua conta primeiro.');
    const p = await run(() => profile.update(patch));
    const s = session.peek();
    if (s) cache = toCache(s.user.id, p);
    return p;
  }

  async function deleteAccount() {
    need();
    if (!session.peek()) throw new UserInputError('Entre na sua conta primeiro.');
    await run(() => profile.deleteAccount());
    session.clear();
    cache = null;
    sessionChanged(false);
    return { ok: true };
  }

  return {
    available, isSignedIn, getAuthView, refreshProfile, signUp, signIn, signOut, recover, updateProfile, deleteAccount,
    beginRecovery, resetPassword, dismissRecovery,
  };
}

module.exports = { createAccountService };
