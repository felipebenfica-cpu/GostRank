'use strict';
// Executa os index.ts (e os bundle.ts gerados) no Node 22 com fetch falso.
// O Node remove os tipos do TypeScript sozinho; sem Deno, o Deno.serve nao e chamado.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const path = require('node:path');

const FN_DIR = path.join(__dirname, '..', '..', 'supabase', 'functions');
const SB = 'https://abc.supabase.co';
const SERVICE = 'service-role-key-SECRETO-0123456789';
const ANON = 'anon-key-publica-0123456789';
const USER = '11111111-1111-1111-1111-111111111111';
const GROUP = '22222222-2222-2222-2222-222222222222';
const GOOD = 'token-do-usuario-valido-0123456789';
const LK = { LIVEKIT_URL: 'wss://ghost.livekit.cloud', LIVEKIT_API_KEY: 'APIkey', LIVEKIT_API_SECRET: 'lk-secret-0123456789' };
const NOW = Date.parse('2026-11-20T12:00:00Z');

let typeStripping = true;
async function loadTs(file) {
  // Evita o aviso de "module type" no meio da saida dos testes.
  const orig = process.emitWarning;
  process.emitWarning = () => {};
  try {
    return await import(path.join(FN_DIR, file));
  } catch (e) {
    if (e && (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || e.code === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX')) {
      typeStripping = false;
      return null;
    }
    throw e;
  } finally {
    process.emitWarning = orig;
  }
}

function env(extra = {}) {
  const all = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON, ...LK, ...extra };
  return (k) => all[k];
}

function json(status, obj) {
  return new Response(obj === undefined ? null : JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

// Supabase falso: auth + PostgREST com uma tabela steam_link_states em memoria.
function fakeSupabase({ inGroup = true, patchStatus = 204, steamValid = true } = {}) {
  const calls = [];
  const states = new Map();
  const profiles = {};
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const h = init.headers || {};
    calls.push({ url, method: init.method, headers: h, body: init.body });
    if (u.origin === 'https://steamcommunity.com') {
      return new Response(`ns:http://specs.openid.net/auth/2.0\nis_valid:${steamValid}\n`, { status: 200 });
    }
    assert.strictEqual(u.origin, SB, 'so chama o proprio Supabase ou a Steam');
    if (u.pathname === '/auth/v1/user') {
      assert.strictEqual(h.apikey, ANON);
      return h.Authorization === `Bearer ${GOOD}` ? json(200, { id: USER, email: 'x@y.com' }) : json(401, { msg: 'bad jwt' });
    }
    assert.strictEqual(h.Authorization, `Bearer ${SERVICE}`);
    assert.strictEqual(h.apikey, SERVICE);
    const q = u.searchParams;
    if (u.pathname === '/rest/v1/group_members') {
      assert.strictEqual(q.get('user_id'), `eq.${USER}`);
      return json(200, inGroup ? [{ group_id: GROUP }] : []);
    }
    if (u.pathname === '/rest/v1/profiles' && init.method === 'GET') return json(200, [{ display_name: 'Ana' }]);
    if (u.pathname === '/rest/v1/profiles' && init.method === 'PATCH') {
      const id = q.get('id').slice(3);
      if (patchStatus === 204) profiles[id] = JSON.parse(init.body);
      return json(patchStatus, patchStatus === 409 ? { code: '23505' } : undefined);
    }
    if (u.pathname === '/rest/v1/steam_link_states') {
      if (init.method === 'POST') {
        const row = JSON.parse(init.body);
        states.set(row.state, row);
        return json(201);
      }
      if (init.method === 'DELETE' && q.get('or')) {
        const m = /^\(user_id\.eq\.([0-9a-f-]+),expires_at\.lt\.(.+)\)$/.exec(q.get('or'));
        assert.ok(m, q.get('or'));
        for (const [k, v] of states) if (v.user_id === m[1] || Date.parse(v.expires_at) < Date.parse(m[2])) states.delete(k);
        return json(204);
      }
      if (init.method === 'DELETE' && q.get('state')) {
        const st = q.get('state').slice(3);
        const t = Date.parse(q.get('expires_at').slice(3));
        const row = states.get(st);
        if (row && Date.parse(row.expires_at) > t) {
          states.delete(st);
          return json(200, [{ user_id: row.user_id }]);
        }
        return json(200, []);
      }
    }
    return json(404, {});
  };
  return { fetchImpl, calls, states, profiles };
}

const post = (url, token) => new Request(url, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} });

for (const variant of ['index.ts', 'bundle.ts']) {
  test(`livekit-token (${variant})`, async (t) => {
    const mod = await loadTs(`livekit-token/${variant}`);
    if (!mod) return t.skip('Node sem suporte a TypeScript');
    const url = `${SB}/functions/v1/livekit-token`;
    const mk = (opts, extraEnv) => {
      const sb = fakeSupabase(opts);
      return { sb, h: mod.createHandler({ getEnv: env(extraEnv), fetchImpl: sb.fetchImpl, now: () => NOW }) };
    };

    await t.test('so POST e OPTIONS', async () => {
      const { h } = mk();
      assert.strictEqual((await h(new Request(url, { method: 'OPTIONS' }))).status, 204);
      const r = await h(new Request(url));
      assert.strictEqual(r.status, 405);
      assert.strictEqual(r.headers.get('allow'), 'POST, OPTIONS');
    });

    await t.test('sem token ou token invalido -> 401', async () => {
      const { h, sb } = mk();
      assert.strictEqual((await h(post(url))).status, 401);
      assert.strictEqual((await h(post(url, 'token-falso-0123456789abcdef'))).status, 401);
      assert.ok(!sb.calls.some((c) => c.url.includes('/rest/v1/')), 'nao consulta o banco sem usuario valido');
    });

    await t.test('sem grupo -> 403 not_in_group', async () => {
      const { h } = mk({ inGroup: false });
      const r = await h(post(url, GOOD));
      assert.strictEqual(r.status, 403);
      assert.deepStrictEqual(await r.json(), { error: 'not_in_group' });
    });

    await t.test('segredos faltando ou URL sem wss -> 503 voice_unconfigured', async () => {
      for (const extra of [{ LIVEKIT_API_SECRET: undefined }, { LIVEKIT_API_KEY: '' }, { LIVEKIT_URL: 'https://ghost.livekit.cloud' }]) {
        const { h } = mk({}, extra);
        const r = await h(post(url, GOOD));
        assert.strictEqual(r.status, 503);
        assert.deepStrictEqual(await r.json(), { error: 'voice_unconfigured' });
      }
    });

    await t.test('sucesso: devolve url e token assinado, sem vazar chaves', async () => {
      const { h } = mk();
      const r = await h(post(url, GOOD));
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.headers.get('cache-control'), 'no-store');
      const text = await r.text();
      assert.ok(!text.includes(SERVICE) && !text.includes(LK.LIVEKIT_API_SECRET) && !text.includes(ANON));
      const body = JSON.parse(text);
      assert.deepStrictEqual(Object.keys(body).sort(), ['token', 'url']);
      assert.strictEqual(body.url, LK.LIVEKIT_URL);
      const [hd, pl, sg] = body.token.split('.');
      assert.strictEqual(sg, crypto.createHmac('sha256', LK.LIVEKIT_API_SECRET).update(`${hd}.${pl}`).digest('base64url'));
      const p = JSON.parse(Buffer.from(pl, 'base64url').toString());
      assert.strictEqual(p.sub, USER);
      assert.strictEqual(p.iss, 'APIkey');
      assert.strictEqual(p.name, 'Ana');
      assert.strictEqual(p.video.room, `grupo-${GROUP}`);
      assert.strictEqual(p.nbf, NOW / 1000 - 60);
      assert.strictEqual(p.exp, NOW / 1000 + 3600);
    });

    await t.test('falha do Supabase -> 502 generico', async () => {
      const h = mod.createHandler({ getEnv: env(), fetchImpl: async () => { throw new Error('rede'); }, now: () => NOW });
      const r = await h(post(url, GOOD));
      assert.strictEqual(r.status, 502);
      assert.deepStrictEqual(await r.json(), { error: 'upstream_error' });
    });

    await t.test('configuracao do Supabase faltando -> 500', async () => {
      const h = mod.createHandler({ getEnv: env({ SUPABASE_SERVICE_ROLE_KEY: undefined }), fetchImpl: async () => json(500), now: () => NOW });
      assert.strictEqual((await h(post(url, GOOD))).status, 500);
    });
  });

  test(`steam-link (${variant})`, async (t) => {
    const mod = await loadTs(`steam-link/${variant}`);
    if (!mod) return t.skip('Node sem suporte a TypeScript');
    const base = `${SB}/functions/v1/steam-link`;
    const STEAM64 = '76561198000000001';
    let clock = NOW;
    const mk = (opts, extraEnv) => {
      const sb = fakeSupabase(opts);
      return { sb, h: mod.createHandler({ getEnv: env(extraEnv), fetchImpl: sb.fetchImpl, now: () => clock }) };
    };
    // Simula a volta da Steam a partir da URL de login devolvida pelo /start.
    function steamReturn(loginUrl, overrides = {}) {
      const q = new URL(loginUrl).searchParams;
      const returnTo = q.get('openid.return_to');
      const cb = new URL(returnTo);
      const claimed = `https://steamcommunity.com/openid/id/${STEAM64}`;
      const p = {
        'openid.ns': 'http://specs.openid.net/auth/2.0',
        'openid.mode': 'id_res',
        'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
        'openid.claimed_id': claimed,
        'openid.identity': claimed,
        'openid.return_to': returnTo,
        'openid.response_nonce': '2026-11-20T12:00:00Zxyz',
        'openid.assoc_handle': '1234567890',
        'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
        'openid.sig': 'c2ln',
        ...overrides,
      };
      for (const [k, v] of Object.entries(p)) cb.searchParams.set(k, v);
      return new Request(cb.toString());
    }
    async function start(h) {
      const r = await h(post(`${base}/start`, GOOD));
      assert.strictEqual(r.status, 200);
      return (await r.json()).url;
    }

    await t.test('start: exige POST e token valido', async () => {
      const { h } = mk();
      assert.strictEqual((await h(new Request(`${base}/start`))).status, 405);
      assert.strictEqual((await h(post(`${base}/start`))).status, 401);
      assert.strictEqual((await h(post(`${base}/start`, 'token-falso-0123456789abcdef'))).status, 401);
      assert.strictEqual((await h(new Request(`${base}/outra`))).status, 404);
    });

    await t.test('start: cria state de 10 min e devolve a URL da Steam', async () => {
      const { h, sb } = mk();
      const url = await start(h);
      assert.ok(url.startsWith('https://steamcommunity.com/openid/login?'));
      const q = new URL(url).searchParams;
      assert.strictEqual(q.get('openid.mode'), 'checkid_setup');
      assert.strictEqual(q.get('openid.realm'), base);
      const state = new URL(q.get('openid.return_to')).searchParams.get('state');
      assert.match(state, /^[A-Za-z0-9_-]{43}$/);
      assert.ok(q.get('openid.return_to').startsWith(`${base}/callback?state=`));
      const row = sb.states.get(state);
      assert.strictEqual(row.user_id, USER);
      assert.strictEqual(Date.parse(row.expires_at) - NOW, 10 * 60 * 1000);
      // Um novo start apaga o state anterior da mesma pessoa.
      await start(h);
      assert.strictEqual(sb.states.size, 1);
      assert.ok(!sb.states.has(state));
    });

    await t.test('callback: vincula, grava account id e o state so vale uma vez', async () => {
      clock = NOW;
      const { h, sb } = mk();
      const url = await start(h);
      const r = await h(steamReturn(url));
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.headers.get('content-security-policy').split(';')[0], "default-src 'none'");
      assert.strictEqual(r.headers.get('content-type'), 'text/plain; charset=utf-8');
      assert.strictEqual(r.headers.get('referrer-policy'), 'no-referrer');
      assert.match(await r.text(), /Steam vinculada\. Pode voltar ao Ghost Rank\./);
      assert.deepStrictEqual(sb.profiles[USER], { steam_account_id: 39734273 });
      const steamCall = sb.calls.find((c) => c.url === 'https://steamcommunity.com/openid/login');
      assert.strictEqual(new URLSearchParams(steamCall.body).get('openid.mode'), 'check_authentication');
      // Repetir o mesmo retorno nao funciona.
      const again = await h(steamReturn(url));
      assert.strictEqual(again.status, 400);
      assert.match(await again.text(), /expirou ou ja foi usado/);
    });

    await t.test('callback: HTML opcional (dominio proprio) com CSP', async () => {
      clock = NOW;
      const { h } = mk({}, { STEAM_LINK_HTML: 'true' });
      const r = await h(steamReturn(await start(h)));
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.headers.get('content-type'), 'text/html; charset=utf-8');
      assert.match(r.headers.get('content-security-policy'), /^default-src 'none'/);
      const html = await r.text();
      assert.match(html, /<html lang="pt-BR">/);
      assert.doesNotMatch(html, /<script|<link|<img|style=/);
    });

    await t.test('callback: state vencido e recusado', async () => {
      clock = NOW;
      const { h, sb } = mk();
      const url = await start(h);
      clock = NOW + 11 * 60 * 1000;
      const r = await h(steamReturn(url));
      assert.strictEqual(r.status, 400);
      assert.strictEqual(Object.keys(sb.profiles).length, 0);
      clock = NOW;
    });

    await t.test('callback: resposta adulterada ou nao confirmada pela Steam e recusada', async () => {
      clock = NOW;
      for (const ov of [{ 'openid.mode': 'cancel' }, { 'openid.op_endpoint': 'https://evil.example/openid/login' },
        { 'openid.claimed_id': 'https://evil.example/openid/id/76561198000000001' },
        { 'openid.return_to': `${base}/callback?state=${'Z'.repeat(43)}` }]) {
        const { h, sb } = mk();
        const r = await h(steamReturn(await start(h), ov));
        assert.strictEqual(r.status, 400, JSON.stringify(ov));
        assert.strictEqual(Object.keys(sb.profiles).length, 0);
      }
      const { h, sb } = mk({ steamValid: false });
      const r = await h(steamReturn(await start(h)));
      assert.strictEqual(r.status, 400);
      assert.strictEqual(Object.keys(sb.profiles).length, 0);
      const bad = await h(new Request(`${base}/callback?state=curto`));
      assert.strictEqual(bad.status, 400);
    });

    await t.test('callback: Steam ja vinculada a outra conta -> pagina de conflito', async () => {
      clock = NOW;
      const { h } = mk({ patchStatus: 409 });
      const r = await h(steamReturn(await start(h)));
      assert.strictEqual(r.status, 409);
      assert.match(await r.text(), /ja esta vinculada a outra conta/);
    });

    await t.test('respostas nunca contem a chave service_role', async () => {
      clock = NOW;
      const { h } = mk();
      const url = await start(h);
      const r = await h(steamReturn(url));
      assert.ok(!(await r.text()).includes(SERVICE));
      assert.ok(!url.includes(SERVICE));
    });
  });
}

test('Node suporta TypeScript (senao os testes acima foram pulados)', (t) => {
  if (!typeStripping) t.diagnostic('index.ts/bundle.ts nao executados: Node sem remocao de tipos');
});
