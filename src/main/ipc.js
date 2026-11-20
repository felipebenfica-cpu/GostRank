'use strict';

const { isAppUrl } = require('./security');

const CHANNELS = Object.freeze({
  getView: 'gr:getView',
  setup: 'gr:setup',
  sync: 'gr:sync',
  correctMmr: 'gr:correctMmr',
  updateSettings: 'gr:updateSettings',
  reset: 'gr:reset',
});

const GENERIC_ERROR = 'Ocorreu um erro inesperado. Tente novamente.';
const INVALID_ERROR = 'Dados inválidos.';
const MAX_STRING = 200;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isInputValue(v) {
  if (typeof v === 'number') return Number.isFinite(v);
  return typeof v === 'string' && v.length <= MAX_STRING;
}

/** Objeto simples, só com chaves permitidas, valores número/string. */
function checkObject(value, requiredKeys, optionalKeys = []) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  if (keys.some((k) => !allowed.has(k))) return false;
  if (requiredKeys.some((k) => !keys.includes(k))) return false;
  return keys.every((k) => isInputValue(value[k]));
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

function buildHandlers(controller) {
  return {
    [CHANNELS.getView]: wrapHandler(validateEmptyPayload, () => controller.getView()),
    [CHANNELS.setup]: wrapHandler(validateSetupPayload, (d) => controller.setup(d)),
    [CHANNELS.sync]: wrapHandler(validateEmptyPayload, () => controller.sync({ manual: true })),
    [CHANNELS.correctMmr]: wrapHandler(validateCorrectPayload, (d) => controller.correctMmr(d)),
    [CHANNELS.updateSettings]: wrapHandler(validateSettingsPayload, (d) => controller.updateSettings(d)),
    [CHANNELS.reset]: wrapHandler(validateResetPayload, () => controller.reset()),
  };
}

function registerIpc(controller) {
  const { ipcMain } = require('electron');
  const handlers = buildHandlers(controller);
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
  isTrustedSender,
  errorMessage,
  wrapHandler,
  buildHandlers,
  registerIpc,
};
