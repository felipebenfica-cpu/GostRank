'use strict';

const { isAppUrl } = require('./security');
const { UserInputError } = require('./controller');

const CHANNELS = Object.freeze({
  getView: 'gr:getView',
  setup: 'gr:setup',
  sync: 'gr:sync',
  correctMmr: 'gr:correctMmr',
  updateSettings: 'gr:updateSettings',
  reset: 'gr:reset',
  signUp: 'gr:auth:signUp',
  signIn: 'gr:auth:signIn',
  signOut: 'gr:auth:signOut',
  recover: 'gr:auth:recover',
  updateProfile: 'gr:profile:update',
  deleteAccount: 'gr:account:delete',
});

const GENERIC_ERROR = 'Ocorreu um erro inesperado. Tente novamente.';
const INVALID_ERROR = 'Dados inválidos.';
const MAX_STRING = 200;
const MAX_EMAIL = 254;
const MAX_PASSWORD = 128;
const UNAVAILABLE_ERROR = 'Contas indisponíveis neste computador.';

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isInputValue(v, max = MAX_STRING) {
  if (typeof v === 'number') return Number.isFinite(v);
  return typeof v === 'string' && v.length <= max;
}

/** Objeto simples, só com chaves permitidas, valores número/string (limites por chave em `limits`). */
function checkObject(value, requiredKeys, optionalKeys = [], limits = {}) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  if (keys.some((k) => !allowed.has(k))) return false;
  if (requiredKeys.some((k) => !keys.includes(k))) return false;
  return keys.every((k) => isInputValue(value[k], limits[k] ?? MAX_STRING));
}

function validateSetupPayload(p) {
  if (!checkObject(p, ['accountInput', 'startMmr', 'goalMmr', 'gainPerMatch'])) return null;
  if (typeof p.accountInput !== 'string') return null;
  return {
    accountInput: p.accountInput,
    startMmr: p.startMmr,
    goalMmr: p.goalMmr,
    gainPerMatch: p.gainPerMatch,
  };
}

function validateCorrectPayload(p) {
  if (!checkObject(p, ['mmr'])) return null;
  return { mmr: p.mmr };
}

function validateSettingsPayload(p) {
  if (!checkObject(p, [], ['goalMmr', 'gainPerMatch'])) return null;
  if (Object.keys(p).length === 0) return null;
  const out = {};
  if ('goalMmr' in p) out.goalMmr = p.goalMmr;
  if ('gainPerMatch' in p) out.gainPerMatch = p.gainPerMatch;
  return out;
}

function validateResetPayload(p) {
  if (!isPlainObject(p) || Object.keys(p).length !== 1 || p.confirm !== true) return null;
  return { confirm: true };
}

function validateCredentialsPayload(p) {
  if (!checkObject(p, ['email', 'password'], [], { email: MAX_EMAIL, password: MAX_PASSWORD })) return null;
  if (typeof p.email !== 'string' || typeof p.password !== 'string') return null;
  return { email: p.email, password: p.password };
}

function validateRecoverPayload(p) {
  if (!checkObject(p, ['email'], [], { email: MAX_EMAIL })) return null;
  if (typeof p.email !== 'string') return null;
  return { email: p.email };
}

function validateProfilePayload(p) {
  if (!checkObject(p, [], ['displayName', 'mmrVisibility'])) return null;
  if (Object.keys(p).length === 0) return null;
  const out = {};
  if ('displayName' in p) {
    if (typeof p.displayName !== 'string') return null;
    out.displayName = p.displayName;
  }
  if ('mmrVisibility' in p) {
    if (typeof p.mmrVisibility !== 'string') return null;
    out.mmrVisibility = p.mmrVisibility;
  }
  return out;
}

function validateEmptyPayload(p) {
  return p === undefined || p === null ? {} : null;
}

function isTrustedSender(event) {
  const url = event && event.senderFrame && event.senderFrame.url;
  return isAppUrl(url);
}

function errorMessage(err) {
  if (err && err.name === 'UserInputError' && typeof err.message === 'string') {
    return err.message;
  }
  return GENERIC_ERROR;
}

/** Cria um handler de invoke seguro. Exportado para teste. */
function wrapHandler(validate, action) {
  return async (event, payload) => {
    if (!isTrustedSender(event)) return { ok: false, error: 'Origem não autorizada.' };
    const clean = validate(payload);
    if (clean === null) return { ok: false, error: INVALID_ERROR };
    try {
      const view = await action(clean);
      return { ok: true, view };
    } catch (err) {
      if (!(err && err.name === 'UserInputError')) {
        console.error('[ipc] erro inesperado:', err && err.name ? err.name : 'Error');
      }
      return { ok: false, error: errorMessage(err) };
    }
  };
}

function buildHandlers(controller, { account = null, session = null } = {}) {
  const viaAccount = (fn) => async (d) => {
    if (!account || !account.available) throw new UserInputError(UNAVAILABLE_ERROR);
    await fn(d);
    return controller.getView();
  };
  return {
    [CHANNELS.getView]: wrapHandler(validateEmptyPayload, () => controller.getView()),
    [CHANNELS.setup]: wrapHandler(validateSetupPayload, (d) => controller.setup(d)),
    [CHANNELS.sync]: wrapHandler(validateEmptyPayload, () => controller.sync({ manual: true })),
    [CHANNELS.correctMmr]: wrapHandler(validateCorrectPayload, (d) => controller.correctMmr(d)),
    [CHANNELS.updateSettings]: wrapHandler(validateSettingsPayload, (d) => controller.updateSettings(d)),
    [CHANNELS.reset]: wrapHandler(validateResetPayload, () => controller.reset()),
    [CHANNELS.signUp]: wrapHandler(validateCredentialsPayload, viaAccount((d) => account.signUp(d))),
    [CHANNELS.signIn]: wrapHandler(validateCredentialsPayload, viaAccount((d) => account.signIn(d))),
    [CHANNELS.signOut]: wrapHandler(validateEmptyPayload, viaAccount(() => account.signOut())),
    [CHANNELS.recover]: wrapHandler(validateRecoverPayload, viaAccount((d) => account.recover(d))),
    [CHANNELS.updateProfile]: wrapHandler(validateProfilePayload, viaAccount((d) => account.updateProfile(d))),
    [CHANNELS.deleteAccount]: wrapHandler(validateResetPayload, viaAccount(async () => {
      await account.deleteAccount();
      if (session) session.clear();
      controller.reset();
    })),
  };
}

function registerIpc(controller, services) {
  const { ipcMain } = require('electron');
  const handlers = buildHandlers(controller, services);
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, handler);
  }
  return () => {
    for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel);
  };
}

module.exports = {
  CHANNELS,
  GENERIC_ERROR,
  isPlainObject,
  validateSetupPayload,
  validateCorrectPayload,
  validateSettingsPayload,
  validateResetPayload,
  validateEmptyPayload,
  validateCredentialsPayload,
  validateRecoverPayload,
  validateProfilePayload,
  isTrustedSender,
  errorMessage,
  wrapHandler,
  buildHandlers,
  registerIpc,
};
