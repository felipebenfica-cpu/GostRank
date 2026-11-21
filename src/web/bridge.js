'use strict';

const config = require('../../config.public.json');
const { createAuthClient } = require('../main/auth');
const { createSessionManager } = require('../main/session');
const { createAccountService } = require('../main/account');
const { createProfileClient } = require('../main/profile');
const { createGroupClient, createGroupService } = require('../main/group');
const { createChatClient, createChatFeed } = require('../main/chat');
const { createSocialClient } = require('../main/social');
const { createSteamClient } = require('../main/steam');
const { createVoiceClient } = require('../main/voice');
const { createController } = require('../main/controller');
const { createOpenDotaClient } = require('../main/opendota');

function browserStore(storage, name) {
  const key = 'ghostrank.' + name;
  return {
    load: () => JSON.parse(storage.getItem(key)),
    save: (value) => storage.setItem(key, JSON.stringify(value)),
    clear: () => storage.removeItem(key),
  };
}

const listeners = new Set();
const auth = createAuthClient(config);
const session = createSessionManager({ store: browserStore(sessionStorage, 'session'), auth });
const common = { ...config, getAccessToken: async () => (await session.get())?.accessToken };
const social = createSocialClient(common);
const chat = createChatFeed({ client: createChatClient(common), onChange: emit });
const group = createGroupService({
  client: createGroupClient(common), isSignedIn: () => !!session.peek(),
  chatFeed: chat, onChange: emit, getSummary: () => controller.getSummary(),
});
const account = createAccountService({
  config, auth, session, profile: createProfileClient(common), onChange: emit,
  onSessionChange: (signedIn) => signedIn ? group.refresh({ quiet: true }) : group.clear(),
});
const steam = createSteamClient({ ...common, openExternal: (url) => window.location.assign(url) });
const voice = createVoiceClient(common);
const controller = createController({
  client: createOpenDotaClient(), store: browserStore(localStorage, 'tracker'),
  heroesStore: browserStore(localStorage, 'heroes'),
  getAuthView: account.getAuthView, getGroupView: group.getView, getChatView: chat.getView,
  getVoiceView: () => ({ available: !!window.LivekitClient && group.hasGroup() }),
  publishSnapshot: group.publishSnapshot, onUpdate: emit,
});

function emit() {
  const view = controller.getView();
  for (const listener of listeners) listener(view);
}

function action(fn, raw = false) {
  return async (...args) => {
    try {
      const result = await fn(...args);
      return raw ? { ...result, ok: true } : { ok: true, view: controller.getView() };
    } catch (error) {
      const safe = ['UserInputError', 'AuthError'].includes(error.name);
      return { ok: false, error: safe ? error.message : 'Não foi possível concluir. Tente novamente.' };
    }
  };
}

window.ghostRank = Object.freeze({
  getView: action(() => {}), signUp: action(account.signUp), signIn: action(account.signIn),
  signOut: action(account.signOut), recover: action(account.recover),
  deleteAccount: action(async () => { await account.deleteAccount(); controller.reset(); }),
  updateProfile: action(account.updateProfile), linkSteam: action(steam.startLink),
  setup: action(controller.setup), sync: action(() => controller.sync({ manual: true })),
  correctMmr: action((mmr) => controller.correctMmr({ mmr })),
  updateSettings: action(controller.updateSettings), reset: action(controller.reset),
  createGroup: action(group.create), joinGroup: action(group.join), leaveGroup: action(group.leave),
  refreshGroup: action(group.refresh), removeMember: action(group.remove), createInvite: action(group.invite, true),
  social: action(social, true), sendMessage: action(chat.send), voiceToken: action(voice.getToken, true),
  listScreenSources: action(() => ({ sources: [{ id: 'screen:browser', name: 'Escolher tela ou janela no navegador', thumbnail: null }] }), true),
  pickScreenSource: action(() => ({}), true),
  onUpdate(listener) { listeners.add(listener); return () => listeners.delete(listener); },
});

function refresh() {
  if (document.hidden || !session.peek()) return;
  group.refresh({ quiet: true });
  account.refreshProfile();
}
document.addEventListener('visibilitychange', () => { chat.setFocused(!document.hidden); refresh(); });
setInterval(refresh, 30000);
chat.setFocused(!document.hidden);
controller.start();
refresh();
