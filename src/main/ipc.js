'use strict';

const { isAppUrl } = require('./security');
const { UserInputError } = require('./controller');
const { API, wrapCall } = require('./api');

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
  groupCreate: 'gr:group:create',
  groupJoin: 'gr:group:join',
  groupLeave: 'gr:group:leave',
  groupInvite: 'gr:group:invite',
  groupRemove: 'gr:group:remove',
  groupRefresh: 'gr:group:refresh',
  chatSend: 'gr:chat:send',
  voiceToken: 'gr:voice:token',
  voiceListSources: 'gr:voice:listSources',
  voicePickSource: 'gr:voice:pickSource',
  steamLink: 'gr:steam:link',
  // Etapa 6: ações novas (tabela em api.js)
  ...Object.fromEntries(API.map((e) => [e.method, e.channel])),
});

const GENERIC_ERROR = 'Ocorreu um erro inesperado. Tente novamente.';
const INVALID_ERROR = 'Dados inválidos.';
const MAX_STRING = 200;
const MAX_EMAIL = 254;
const MAX_PASSWORD = 128;
const UNAVAILABLE_ERROR = 'Contas indisponíveis neste computador.';
const SIGNED_OUT_ERROR = 'Entre na sua conta primeiro.';
const GROUP_UNAVAILABLE_ERROR = 'Grupos indisponíveis neste computador.';
const VOICE_UNAVAILABLE_ERROR = 'Voz indisponível neste computador.';
const PICK_SOURCE_ERROR = 'Escolha uma tela ou janela da lista.';
const GROUP_NAME_MIN = 2;
const GROUP_NAME_MAX = 32;
const CHAT_BODY_MAX = 1000;
const CHAT_BODY_RAW_MAX = 4000;
const INVITE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SOURCE_ID = 200;

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
  // Etapa 6: username, about (texto ou null) e avatarColor (0..7) também.
  if (!isPlainObject(p) || Object.getOwnPropertySymbols(p).length > 0) return null;
  const allowed = ['displayName', 'mmrVisibility', 'username', 'about', 'avatarColor'];
  const keys = Object.keys(p);
  if (keys.length === 0 || keys.some((k) => !allowed.includes(k))) return null;
  const out = {};
  if ('username' in p) {
    if (typeof p.username !== 'string' || p.username.length > 64) return null;
    out.username = p.username;
  }
  if ('about' in p) {
    if (p.about !== null && (typeof p.about !== 'string' || p.about.length > 400)) return null;
    out.about = p.about;
  }
  if ('avatarColor' in p) {
    if (!Number.isInteger(p.avatarColor) || p.avatarColor < 0 || p.avatarColor > 7) return null;
    out.avatarColor = p.avatarColor;
  }
  if (('displayName' in p && !isInputValue(p.displayName)) || ('mmrVisibility' in p && !isInputValue(p.mmrVisibility))) return null;
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

/** Canais novos sem dados: aceitam `{}` (o que o preload envia), `undefined` ou `null`. */
function validateNoArgsPayload(p) {
  if (p === undefined || p === null) return {};
  if (!isPlainObject(p) || Object.keys(p).length > 0 || Object.getOwnPropertySymbols(p).length > 0) return null;
  return {};
}

function validateGroupNamePayload(p) {
  if (!checkObject(p, ['name'], [], { name: 200 })) return null;
  if (typeof p.name !== 'string') return null;
  const name = p.name.trim();
  const len = [...name].length;
  if (len < GROUP_NAME_MIN || len > GROUP_NAME_MAX) return null;
  return { name };
}

function validateJoinPayload(p) {
  if (!checkObject(p, ['code'], [], { code: 64 })) return null;
  if (typeof p.code !== 'string') return null;
  const code = p.code.trim().toUpperCase();
  return INVITE_RE.test(code) ? { code } : null;
}

function validateUserIdPayload(p) {
  if (!checkObject(p, ['userId'], [], { userId: 36 })) return null;
  if (typeof p.userId !== 'string' || !UUID_RE.test(p.userId)) return null;
  return { userId: p.userId.toLowerCase() };
}

function validateChatPayload(p) {
  if (!checkObject(p, ['body'], [], { body: CHAT_BODY_RAW_MAX })) return null;
  if (typeof p.body !== 'string') return null;
  const body = p.body.trim();
  const len = [...body].length;
  if (len < 1 || len > CHAT_BODY_MAX) return null;
  return { body };
}

function validatePickSourcePayload(p) {
  if (!checkObject(p, ['sourceId'], [], { sourceId: MAX_SOURCE_ID })) return null;
  if (typeof p.sourceId !== 'string' || p.sourceId.length === 0) return null;
  return { sourceId: p.sourceId };
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

/**
 * Cria um handler de invoke seguro. Exportado para teste.
 * Com `raw: true` a ação devolve um objeto simples que vira `{ ok: true, ...resultado }`.
 */
function wrapHandler(validate, action, { raw = false } = {}) {
  return async (event, payload) => {
    if (!isTrustedSender(event)) return { ok: false, error: 'Origem não autorizada.' };
    const clean = validate(payload);
    if (clean === null) return { ok: false, error: INVALID_ERROR };
    try {
      const result = await action(clean);
      if (raw) return { ...(isPlainObject(result) ? result : {}), ok: true };
      return { ok: true, view: result };
    } catch (err) {
      if (!(err && err.name === 'UserInputError')) {
        console.error('[ipc] erro inesperado:', err && err.name ? err.name : 'Error');
      }
      return { ok: false, error: errorMessage(err) };
    }
  };
}

function buildHandlers(controller, {
  account = null, session = null, group = null, chatFeed = null, voice = null, picker = null, steam = null,
  app = null, getMode = () => null,
} = {}) {
  const viaAccount = (fn) => async (d) => {
    if (!account || !account.available) throw new UserInputError(UNAVAILABLE_ERROR);
    await fn(d);
    return controller.getView();
  };
  const needSignedIn = () => {
    if (!account || !account.available) throw new UserInputError(UNAVAILABLE_ERROR);
    const signedIn = typeof account.isSignedIn === 'function'
      ? account.isSignedIn() : Boolean(session && session.peek());
    if (!signedIn) throw new UserInputError(SIGNED_OUT_ERROR);
  };
  const viaGroup = (fn) => async (d) => {
    needSignedIn();
    if (!group) throw new UserInputError(GROUP_UNAVAILABLE_ERROR);
    await fn(d);
    return controller.getView();
  };
  const viaGroupRaw = (fn) => async (d) => {
    needSignedIn();
    if (!group) throw new UserInputError(GROUP_UNAVAILABLE_ERROR);
    return fn(d);
  };
  const viaVoice = (fn) => async (d) => {
    needSignedIn();
    if (!group || !group.hasGroup()) throw new UserInputError('Entre em um grupo para usar a sala de voz.');
    return fn(d);
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
    [CHANNELS.updateProfile]: wrapHandler(validateProfilePayload, viaAccount(async (d) => {
      const extended = ['username', 'about', 'avatarColor'].some((k) => k in d);
      if (app && getMode() === 'v3') return app.updateProfile(d);
      if (extended) throw new UserInputError('Atualize o banco (0003): esta função ainda não existe no servidor. Rode o 0003_discord.sql no Supabase.');
      return account.updateProfile(d);
    })),
    [CHANNELS.deleteAccount]: wrapHandler(validateResetPayload, viaAccount(async () => {
      await account.deleteAccount();
      if (session) session.clear();
      controller.reset();
    })),
    [CHANNELS.groupCreate]: wrapHandler(validateGroupNamePayload, viaGroup((d) => group.create(d.name))),
    [CHANNELS.groupJoin]: wrapHandler(validateJoinPayload, viaGroup((d) => group.join(d.code))),
    [CHANNELS.groupLeave]: wrapHandler(validateResetPayload, viaGroup(() => group.leave())),
    [CHANNELS.groupInvite]: wrapHandler(validateNoArgsPayload, viaGroupRaw(async () => {
      const r = await group.invite();
      return { code: r.code, expiresAt: r.expiresAt };
    }), { raw: true }),
    [CHANNELS.groupRemove]: wrapHandler(validateUserIdPayload, viaGroup((d) => group.remove(d.userId))),
    [CHANNELS.groupRefresh]: wrapHandler(validateNoArgsPayload, viaGroup(() => group.refresh())),
    [CHANNELS.chatSend]: wrapHandler(validateChatPayload, viaGroup(async (d) => {
      if (!chatFeed || !group.hasGroup()) throw new UserInputError('Você não está em um grupo.');
      await chatFeed.send(d.body);
    })),
    [CHANNELS.voiceToken]: wrapHandler(validateNoArgsPayload, viaVoice(async () => {
      if (!voice) throw new UserInputError(VOICE_UNAVAILABLE_ERROR);
      const r = await voice.getToken();
      return { url: r.url, token: r.token };
    }), { raw: true }),
    [CHANNELS.voiceListSources]: wrapHandler(validateNoArgsPayload, viaVoice(async () => {
      if (!picker) throw new UserInputError(VOICE_UNAVAILABLE_ERROR);
      return { sources: await picker.listSources() };
    }), { raw: true }),
    [CHANNELS.voicePickSource]: wrapHandler(validatePickSourcePayload, viaVoice(async (d) => {
      if (!picker) throw new UserInputError(VOICE_UNAVAILABLE_ERROR);
      if (!picker.pick(d.sourceId)) throw new UserInputError(PICK_SOURCE_ERROR);
      return {};
    }), { raw: true }),
    [CHANNELS.steamLink]: wrapHandler(validateNoArgsPayload, async () => {
      needSignedIn();
      if (!steam) throw new UserInputError(UNAVAILABLE_ERROR);
      await steam.startLink();
      return {};
    }, { raw: true }),
    ...buildApiHandlers(controller, app),
  };
}

/** Ações da Etapa 6 com a mesma checagem de origem dos canais antigos. */
function buildApiHandlers(controller, app) {
  const out = {};
  for (const entry of API) {
    const call = wrapCall(entry, app, () => controller.getView());
    out[entry.channel] = async (event, payload) => {
      if (!isTrustedSender(event)) return { ok: false, error: 'Origem não autorizada.' };
      return call(payload);
    };
  }
  return out;
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
  validateNoArgsPayload,
  validateGroupNamePayload,
  validateJoinPayload,
  validateUserIdPayload,
  validateChatPayload,
  validatePickSourcePayload,
  validateCredentialsPayload,
  validateRecoverPayload,
  validateProfilePayload,
  isTrustedSender,
  errorMessage,
  wrapHandler,
  buildHandlers,
  buildApiHandlers,
  registerIpc,
};
