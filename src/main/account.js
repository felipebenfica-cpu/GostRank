'use strict';

// Orquestra auth + sessão + perfil e entrega a parte `auth` da View.
// Converte erros de conta em UserInputError (mensagens em português, seguras para a tela).

const { validateEmail, validatePassword } = require('../core/credentials');
const { UserInputError } = require('./controller');

const MAX_LOGIN_PASSWORD = 128;

function toUserError(err) {
  if (err && err.name === 'UserInputError') return err;
  if (err && err.name === 'AuthError' && typeof err.message === 'string') return new UserInputError(err.message);
  return err;
}

function createAccountService({ config = null, auth = null, session = null, profile = null, onChange = () => {} } = {}) {
  const available = Boolean(config && auth && session && profile);
  let cache = null; // { userId, displayName, mmrVisibility }

  function emit() {
    try { onChange(); } catch { /* o consumidor não pode quebrar o serviço */ }
  }

  function need() {
    if (!available) throw new UserInputError('Contas indisponíveis neste computador.');
  }

  function getAuthView() {
    if (!available) return { status: 'unconfigured', email: null, displayName: null, mmrVisibility: null };
    const s = session.peek();
    if (!s) return { status: 'signed_out', email: null, displayName: null, mmrVisibility: null };
    const mine = cache && cache.userId === s.user.id ? cache : null;
    return {
      status: 'signed_in',
      email: s.user.email || null,
      displayName: mine ? mine.displayName : null,
      mmrVisibility: mine ? mine.mmrVisibility : null,
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
        cache = { userId: cur.user.id, displayName: p.displayName, mmrVisibility: p.mmrVisibility };
      }
    } catch { /* perfil é opcional na tela */ }
    emit();
  }

  async function run(fn) {
    try { return await fn(); } catch (err) { throw toUserError(err); }
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
    return { ok: true };
  }

  async function signOut() {
    need();
    const s = session.peek();
    session.clear();
    cache = null;
    if (s) {
      try { await auth.signOut(s.accessToken); } catch { /* a sessão local já foi apagada */ }
    }
    return { ok: true };
  }

  async function recover({ email }) {
    need();
    const e = needEmail(email);
    return run(() => auth.recover({ email: e }));
  }

  async function updateProfile(patch) {
    need();
    if (!session.peek()) throw new UserInputError('Entre na sua conta primeiro.');
    const p = await run(() => profile.update(patch));
    const s = session.peek();
    if (s) cache = { userId: s.user.id, displayName: p.displayName, mmrVisibility: p.mmrVisibility };
    return p;
  }

  async function deleteAccount() {
    need();
    if (!session.peek()) throw new UserInputError('Entre na sua conta primeiro.');
    await run(() => profile.deleteAccount());
    session.clear();
    cache = null;
    return { ok: true };
  }

  return {
    available, getAuthView, refreshProfile, signUp, signIn, signOut, recover, updateProfile, deleteAccount,
  };
}

module.exports = { createAccountService };
