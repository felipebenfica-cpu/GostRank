'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createController } = require('../../src/main/controller');
const { createStore } = require('../../src/main/store');
const { createAccountService } = require('../../src/main/account');
const { spyConsole } = require('../auth/helpers');

const T0 = 1_800_000_000;
const SETUP = { accountInput: '123456', startMmr: 3000, goalMmr: 4000, gainPerMatch: 25 };
const raw = (id, t, win) => ({ match_id: id, hero_id: 1, start_time: t, duration: 1800, lobby_type: 7, player_slot: 0, radiant_win: win, party_size: 1 });

function env({ groupView = { id: 'g' }, publish } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-ctlg-'));
  let matches = [];
  const client = {
    getPlayer: async () => ({ found: true, personaName: 'X' }),
    getRecentMatches: async () => matches,
    getHeroes: async () => ({}),
  };
  const published = [];
  const state = { groupView };
  const ctl = createController({
    client,
    store: createStore({ filePath: path.join(dir, 's.dat') }),
    now: () => T0 * 1000,
    getGroupView: () => state.groupView,
    publishSnapshot: publish || (async (s) => { published.push(s); }),
  });
  return { ctl, published, state, addMatch: (m) => { matches = [m, ...matches]; } };
}

test('View traz group, chat e voice com padrões seguros', () => {
  const c = createController({ client: {}, store: { load: () => null, save() {}, clear() {} } });
  const v = c.getView();
  assert.equal(v.group, null);
  assert.deepEqual(v.chat, { messages: [], status: 'idle' });
  assert.deepEqual(v.voice, { available: false });
  assert.equal(v.auth.steamLinked, false);
  const broken = createController({
    client: {}, store: { load: () => null, save() {}, clear() {} },
    getGroupView: () => { throw new Error('x'); }, getChatView: () => ({ messages: 'x' }), getVoiceView: () => ({ available: 'sim' }),
  });
  const b = broken.getView();
  assert.equal(b.group, null);
  assert.deepEqual(b.chat, { messages: [], status: 'idle' });
  assert.deepEqual(b.voice, { available: false });
});

test('publica o snapshot depois de setup, sync, correctMmr e mudança de meta', async () => {
  const e = env();
  await e.ctl.setup(SETUP);
  assert.equal(e.published.length, 1);
  assert.equal(e.published[0].currentMmr, 3000);
  assert.equal(e.published[0].goalMmr, 4000);
  e.addMatch(raw(10, T0 + 10, true));
  await e.ctl.sync({ manual: false });
  assert.equal(e.published.length, 2);
  assert.equal(e.published[1].currentMmr, 3025);
  e.ctl.correctMmr({ mmr: 3500 });
  assert.equal(e.published.length, 3);
  assert.equal(e.published[2].currentMmr, 3500);
  e.ctl.updateSettings({ goalMmr: 5000 });
  assert.equal(e.published[3].goalMmr, 5000);
  e.ctl.updateSettings({ gainPerMatch: 30 });
  assert.equal(e.published.length, 4); // ganho por partida não muda o snapshot
});

test('sem grupo (ou sem sessão) não publica', async () => {
  const e = env({ groupView: null });
  await e.ctl.setup(SETUP);
  e.ctl.correctMmr({ mmr: 3100 });
  assert.equal(e.published.length, 0);
});

test('falha ao publicar não bloqueia nem quebra o rastreador e só registra código genérico', async () => {
  const spy = spyConsole();
  let release;
  try {
    const slow = env({ publish: () => new Promise((r) => { release = r; }) });
    const v = await slow.ctl.setup(SETUP); // não espera o publish
    assert.equal(v.configured, true);
    release();
    const failing = env({ publish: async () => { throw Object.assign(new Error('token eyJsegredo mensagem'), { code: 'network' }); } });
    await failing.ctl.setup(SETUP);
    const sync = env({ publish: () => { throw new Error('síncrono eyJx'); } });
    await sync.ctl.setup(SETUP);
    assert.equal(sync.ctl.correctMmr({ mmr: 3200 }).summary.currentMmr, 3200);
    await new Promise((r) => setImmediate(r));
  } finally { spy.restore(); }
  const all = spy.out.join('\n');
  assert.ok(all.includes('network'));
  assert.ok(!all.includes('eyJ'));
  assert.ok(!all.includes('mensagem'));
});

test('getSummary: null sem configuração', async () => {
  const e = env();
  assert.equal(e.ctl.getSummary(), null);
  await e.ctl.setup(SETUP);
  assert.equal(e.ctl.getSummary().currentMmr, 3000);
});

test('account: steamLinked vem do perfil (steam_account_id não nulo) e onSessionChange avisa entrada/saída', async () => {
  let current = null;
  const session = { peek: () => current, set: (s) => { current = s; }, clear: () => { current = null; } };
  const auth = { signIn: async () => ({ user: { id: 'u1', email: 'a@b.co' } }), signOut: async () => ({}) };
  let steam = null;
  const profile = { get: async () => ({ displayName: 'Ab', mmrVisibility: 'group', steamAccountId: steam }) };
  const events = [];
  const acc = createAccountService({ config: {}, auth, session, profile, onSessionChange: (s) => events.push(s) });
  assert.equal(acc.isSignedIn(), false);
  await acc.signIn({ email: 'a@b.co', password: 'x' });
  assert.equal(acc.getAuthView().steamLinked, false);
  assert.equal(acc.isSignedIn(), true);
  steam = 123456;
  await acc.refreshProfile();
  assert.equal(acc.getAuthView().steamLinked, true);
  await acc.signOut();
  assert.equal(acc.getAuthView().steamLinked, false);
  assert.deepEqual(events, [true, false]);
});
