// Edge Function "steam-link": vincula a conta Steam ao perfil do Ghost Rank.
//   POST /steam-link/start    (Authorization: Bearer <access_token>) -> {url}
//   GET  /steam-link/callback (volta da Steam, aberto no navegador)  -> pagina simples
// Publicar com "Verify JWT" DESLIGADO: o callback vem do navegador sem token,
// e o /start valida o token ele mesmo em /auth/v1/user.
import {
  STATE_RE, buildSteamLoginUrl, callbackUrl, checkAuthentication, randomState,
  steamId64ToAccountId, verifyAssertionParams,
} from '../_shared/steam_openid.js';
import {
  UUID_RE, bearerToken, getUserFromToken, jsonResponse, pageResponse, preflightResponse, restCall, supabaseConfig,
} from '../_shared/http.js';

type Deps = {
  getEnv: (name: string) => string | undefined;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

const STATE_TTL_MS = 10 * 60 * 1000;

const MSG = {
  ok: 'Steam vinculada. Pode voltar ao Ghost Rank.',
  invalid: 'Nao foi possivel confirmar o login na Steam. Volte ao Ghost Rank e tente de novo.',
  expired: 'Este link expirou ou ja foi usado. Volte ao Ghost Rank e tente de novo.',
  conflict: 'Esta conta Steam ja esta vinculada a outra conta do Ghost Rank.',
  error: 'Algo deu errado ao vincular a Steam. Tente de novo mais tarde.',
};

export function createHandler({ getEnv, fetchImpl = fetch, now = () => Date.now() }: Deps) {
  return async function handler(req: Request): Promise<Response> {
    const cfg = supabaseConfig(getEnv);
    const html = getEnv('STEAM_LINK_HTML') === 'true';
    const path = new URL(req.url).pathname;
    const route = path.endsWith('/start') ? 'start' : path.endsWith('/callback') ? 'callback' : '';

    if (route === 'start') {
      if (req.method === 'OPTIONS') return preflightResponse({ Allow: 'POST, OPTIONS' });
      if (req.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' }, { Allow: 'POST, OPTIONS' });
      if (!cfg) return jsonResponse(500, { error: 'server_misconfigured' });
      try {
        const user = await getUserFromToken({
          supabaseUrl: cfg.supabaseUrl, apiKey: cfg.anonKey, token: bearerToken(req), fetchImpl,
        });
        if (!user || !UUID_RE.test(user.id)) return jsonResponse(401, { error: 'unauthorized' });

        const rest = { supabaseUrl: cfg.supabaseUrl, serviceKey: cfg.serviceKey, fetchImpl };
        const nowIso = encodeURIComponent(new Date(now()).toISOString());
        // Um state ativo por pessoa; aproveita para limpar os vencidos.
        await restCall(rest, 'DELETE', `steam_link_states?or=(user_id.eq.${user.id},expires_at.lt.${nowIso})`,
          { prefer: 'return=minimal' });
        const state = randomState();
        const ins = await restCall(rest, 'POST', 'steam_link_states', {
          body: { state, user_id: user.id, expires_at: new Date(now() + STATE_TTL_MS).toISOString() },
          prefer: 'return=minimal',
        });
        if (ins.status !== 201 && ins.status !== 204) return jsonResponse(502, { error: 'upstream_error' });
        const functionUrl = `${cfg.supabaseUrl}/functions/v1/steam-link`;
        return jsonResponse(200, { url: buildSteamLoginUrl({ functionUrl, state }) });
      } catch {
        return jsonResponse(502, { error: 'upstream_error' });
      }
    }

    if (route === 'callback') {
      if (req.method !== 'GET') return pageResponse(405, MSG.invalid, { html });
      if (!cfg) return pageResponse(500, MSG.error, { html });
      try {
        const params = new URL(req.url).searchParams;
        const state = params.get('state') || '';
        if (!STATE_RE.test(state)) return pageResponse(400, MSG.invalid, { html });
        const functionUrl = `${cfg.supabaseUrl}/functions/v1/steam-link`;
        const check = verifyAssertionParams(params, { expectedReturnTo: callbackUrl(functionUrl, state) });
        if (!check.ok) return pageResponse(400, MSG.invalid, { html });

        // Consome o state (uso unico e dentro da validade).
        const rest = { supabaseUrl: cfg.supabaseUrl, serviceKey: cfg.serviceKey, fetchImpl };
        const nowIso = encodeURIComponent(new Date(now()).toISOString());
        const consumed = await restCall(rest, 'DELETE',
          `steam_link_states?state=eq.${state}&expires_at=gt.${nowIso}&select=user_id`,
          { prefer: 'return=representation' });
        if (consumed.status !== 200 || !Array.isArray(consumed.data)) return pageResponse(502, MSG.error, { html });
        const userId = consumed.data[0] && consumed.data[0].user_id;
        if (typeof userId !== 'string' || !UUID_RE.test(userId)) return pageResponse(400, MSG.expired, { html });

        // Confirma com a propria Steam que a resposta e autentica.
        if (!(await checkAuthentication(params, { fetchImpl }))) return pageResponse(400, MSG.invalid, { html });

        const accountId = steamId64ToAccountId(check.steamId64);
        const upd = await restCall(rest, 'PATCH', `profiles?id=eq.${userId}`, {
          body: { steam_account_id: accountId },
          prefer: 'return=minimal',
        });
        if (upd.status === 409) return pageResponse(409, MSG.conflict, { html });
        if (upd.status !== 204 && upd.status !== 200) return pageResponse(502, MSG.error, { html });
        return pageResponse(200, MSG.ok, { html });
      } catch {
        return pageResponse(502, MSG.error, { html });
      }
    }

    return jsonResponse(404, { error: 'not_found' });
  };
}

if (typeof Deno !== 'undefined') {
  Deno.serve(createHandler({ getEnv: (name: string) => Deno.env.get(name) }));
}
