'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { createRealtime, applyPresenceDiff } = require('../../src/main/realtime');
const { createPresenceService } = require('../../src/main/presence');
const { FakeWebSocket, manualTimers, flush, token, ME, LUA, SOL, G1, V1, DM1 } = require('./helpers');

function setup() {
  FakeWebSocket.instances = [];
  const timers = manualTimers();
  const rt = createRealtime({
    supabaseUrl: 'https://proj.supabase.co', anonKey: 'anon-key-123456', WebSocketImpl: FakeWebSocket,
    getAccessToken: async () => token(), timers,
  });
  return { rt, timers };
}

test('realtime: conecta com apikey/vsn, entra nos canais com config e token, e heartbeat', async () => {
  const { rt, timers } = setup();
  const ch = rt.channel('db:abc', { postgres: [{ event: '*', schema: 'public', table: 'messages' }] });
  rt.connect();
  await flush();
  const ws = FakeWebSocket.instances[0];
  assert.equal(ws.url, 'wss://proj.supabase.co/realtime/v1/websocket?apikey=anon-key-123456&vsn=1.0.0');
  ws.open();
  const join = ws.sent.find((m) => m.event === 'phx_join');
  assert.equal(join.topic, 'realtime:db:abc');
  assert.deepEqual(join.payload.config.postgres_changes, [{ event: '*', schema: 'public', table: 'messages' }]);
  assert.equal(join.payload.config.private, false);
  assert.equal(join.payload.access_token, token());
  const got = [];
  ch.on('postgres', (e) => got.push(e));
  ws.ackJoins({ postgres_changes: [{ id: 1 }] });
  assert.equal(ch.state, 'joined');
  ws.server({ topic: 'realtime:db:abc', event: 'postgres_changes', payload: { data: { type: 'INSERT', table: 'messages', schema: 'public', record: { id: 5 } } } });
  assert.deepEqual(got, [{ type: 'INSERT', table: 'messages', schema: 'public', record: { id: 5 }, old: null }]);
  timers.runIntervals();
  assert.ok(ws.sent.some((m) => m.topic === 'phoenix' && m.event === 'heartbeat'));
  // frames estranhos não quebram
  ws.onmessage({ data: 'não é json' });
  ws.server({ topic: 'realtime:outro', event: 'broadcast', payload: {} });
});

test('realtime: presence (state + diff), track depois do join, broadcast e reconexão com novo join', async () => {
  const { rt, timers } = setup();
  rt.connect();
  await flush();
  const ws = FakeWebSocket.instances[0];
  ws.open();
  const ch = rt.channel(`server:${G1}`, { private: true, presenceKey: ME });
  ch.track({ status: 'online' });
  assert.equal(ws.sent.filter((m) => m.event === 'presence').length, 0); // ainda não entrou
  ws.ackJoins();
  const track = ws.sent.find((m) => m.event === 'presence');
  assert.deepEqual(track.payload, { type: 'presence', event: 'track', payload: { status: 'online' } });
  const states = [];
  ch.on('presence', (s) => states.push(s));
  ws.server({ topic: `realtime:server:${G1}`, event: 'presence_state', payload: { [LUA]: { metas: [{ phx_ref: 'a', status: 'idle' }] } } });
  ws.server({ topic: `realtime:server:${G1}`, event: 'presence_diff', payload: { joins: { [SOL]: { metas: [{ phx_ref: 'b', status: 'online' }] } }, leaves: { [LUA]: { metas: [{ phx_ref: 'a' }] } } } });
  assert.deepEqual(Object.keys(states.at(-1)), [SOL]);
  const bc = [];
  ch.on('broadcast', (b) => bc.push(b));
  ws.server({ topic: `realtime:server:${G1}`, event: 'broadcast', payload: { type: 'broadcast', event: 'typing', payload: { target: 'x', userId: LUA } } });
  assert.equal(bc[0].event, 'typing');
  assert.equal(ch.broadcast('typing', { a: 1 }), true);
  // cai a conexão: presença zera, reconecta e entra de novo
  ws.close();
  assert.deepEqual(ch.presence, {});
  timers.runTimeouts();
  await flush();
  const ws2 = FakeWebSocket.instances[1];
  assert.ok(ws2);
  ws2.open();
  assert.ok(ws2.sent.some((m) => m.event === 'phx_join' && m.topic === `realtime:server:${G1}`));
  rt.disconnect();
  assert.equal(rt.getStatus(), 'closed');
});

test('realtime: diff de presença remove só o ref certo', () => {
  const s = applyPresenceDiff({ a: [{ phx_ref: '1' }, { phx_ref: '2' }] }, { leaves: { a: { metas: [{ phx_ref: '1' }] } } });
  assert.deepEqual(s, { a: [{ phx_ref: '2' }] });
});

function fakeRealtime() {
  const chans = new Map();
  return {
    available: true,
    chans,
    channel(topic, opts) {
      const listeners = { presence: [], broadcast: [], status: [] };
      const ch = {
        topic, opts, presence: {}, tracked: null, sent: [],
        on(k, fn) { (listeners[k] = listeners[k] || []).push(fn); return ch; },
        fire(k, d) { for (const fn of listeners[k] || []) fn(d); },
        track(m) { ch.tracked = m; },
        untrack() { ch.tracked = null; },
        broadcast(e, p) { ch.sent.push([e, p]); return true; },
        unsubscribe() { chans.delete(topic); ch.closed = true; },
      };
      chans.set(topic, ch);
      return ch;
    },
  };
}

test('presence: tópicos certos, status efetivo (invisível/ausente), voz e quem está em cada canal', () => {
  const rt = fakeRealtime();
  let idleSecs = 0;
  const typing = [];
  const timers = manualTimers();
  const p = createPresenceService({ realtime: rt, getIdleSeconds: () => idleSecs, timers, onTyping: (t) => typing.push(t) });
  p.setMe(ME);
  p.sync({ serverIds: [G1], friendIds: [LUA], dmIds: [DM1] });
  assert.deepEqual([...rt.chans.keys()].sort(), [`dm:${DM1}`, `server:${G1}`, `user:${LUA}`, `user:${ME}`].sort());
  assert.equal(rt.chans.get(`server:${G1}`).opts.private, true);
  assert.deepEqual(rt.chans.get(`user:${ME}`).tracked, { status: 'online' });
  assert.equal(rt.chans.get(`dm:${DM1}`).tracked, null);
  // ausente automático
  idleSecs = 700;
  timers.runIntervals();
  assert.equal(p.effective(), 'idle');
  assert.equal(rt.chans.get(`user:${ME}`).tracked.status, 'idle');
  idleSecs = 0;
  timers.runIntervals();
  // invisível: some do tópico de usuário, mas continua aparecendo na voz
  p.setPreferred('invisible');
  assert.equal(rt.chans.get(`user:${ME}`).tracked, null);
  p.setVoiceState({ channelId: V1, serverId: G1, muted: true });
  assert.deepEqual(rt.chans.get(`server:${G1}`).tracked, { status: 'offline', voice: V1, muted: true, deafened: false, streaming: false, video: false });
  p.setPreferred('online');
  // presença dos outros
  rt.chans.get(`user:${LUA}`).presence = { [LUA]: [{ status: 'dnd' }], [SOL]: [{ status: 'online' }] };
  rt.chans.get(`server:${G1}`).presence = {
    [SOL]: [{ status: 'online', voice: V1, streaming: true }],
    [LUA]: [{ status: 'idle', voice: null }],
  };
  const pres = p.getPresence();
  assert.equal(pres[LUA], 'dnd'); // dnd vence idle
  assert.equal(pres[SOL], 'online'); // via servidor (no tópico de LUA a chave de SOL é ignorada)
  assert.equal(pres[ME], 'online');
  const vs = p.getVoiceStates();
  assert.deepEqual(vs[V1], [{ userId: SOL, muted: false, deafened: false, streaming: true, video: false }]);
  // chamada em DM
  p.setVoiceState({ dmId: DM1 });
  assert.equal(rt.chans.get(`dm:${DM1}`).tracked.voice, true);
  assert.equal(rt.chans.get(`server:${G1}`).tracked.voice, null);
  // digitando
  assert.equal(p.sendTyping(`c:${V1}`, G1), true);
  assert.deepEqual(rt.chans.get(`server:${G1}`).sent[0], ['typing', { target: `c:${V1}`, userId: ME }]);
  rt.chans.get(`dm:${DM1}`).fire('broadcast', { event: 'typing', payload: { target: `d:${DM1}`, userId: LUA } });
  assert.deepEqual(typing, [{ target: `d:${DM1}`, userId: LUA }]);
  // saiu do servidor: tópico fecha
  p.sync({ serverIds: [], friendIds: [LUA], dmIds: [] });
  assert.equal(rt.chans.has(`server:${G1}`), false);
  p.clear();
  assert.equal(rt.chans.size, 0);
});
