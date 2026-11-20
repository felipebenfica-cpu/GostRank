// Edge Function "livekit-token": entrega o token da sala de voz do grupo.
// POST com "Authorization: Bearer <access_token do usuario>".
// Publicar com "Verify JWT" DESLIGADO: a funcao valida o token ela mesma em /auth/v1/user.
import { createLiveKitToken, roomForGroup } from '../_shared/livekit_token.js';
import { UUID_RE, bearerToken, getUserFromToken, jsonResponse, restCall, supabaseConfig } from '../_shared/http.js';

type Deps = {
  getEnv: (name: string) => string | undefined;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

const ALLOW = { Allow: 'POST, OPTIONS' };

export function createHandler({ getEnv, fetchImpl = fetch, now = () => Date.now() }: Deps) {
  return async function handler(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: ALLOW });
    if (req.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' }, ALLOW);

    const cfg = supabaseConfig(getEnv);
    if (!cfg) return jsonResponse(500, { error: 'server_misconfigured' });

    try {
      const user = await getUserFromToken({
        supabaseUrl: cfg.supabaseUrl, apiKey: cfg.anonKey, token: bearerToken(req), fetchImpl,
      });
      if (!user || !UUID_RE.test(user.id)) return jsonResponse(401, { error: 'unauthorized' });

      const lkUrl = getEnv('LIVEKIT_URL') || '';
      const apiKey = getEnv('LIVEKIT_API_KEY') || '';
      const apiSecret = getEnv('LIVEKIT_API_SECRET') || '';
      if (!lkUrl.startsWith('wss://') || !apiKey || !apiSecret) {
        return jsonResponse(503, { error: 'voice_unconfigured' });
      }

      const rest = { supabaseUrl: cfg.supabaseUrl, serviceKey: cfg.serviceKey, fetchImpl };
      const member = await restCall(rest, 'GET', `group_members?select=group_id&user_id=eq.${user.id}`);
      if (member.status !== 200 || !Array.isArray(member.data)) return jsonResponse(502, { error: 'upstream_error' });
      const groupId = member.data[0] && member.data[0].group_id;
      if (typeof groupId !== 'string' || !UUID_RE.test(groupId)) return jsonResponse(403, { error: 'not_in_group' });

      const profile = await restCall(rest, 'GET', `profiles?select=display_name&id=eq.${user.id}`);
      const displayName = profile.status === 200 && Array.isArray(profile.data) && profile.data[0]
        && typeof profile.data[0].display_name === 'string' ? profile.data[0].display_name : undefined;

      const token = await createLiveKitToken({
        apiKey,
        apiSecret,
        identity: user.id,
        name: displayName,
        room: roomForGroup(groupId),
        ttlSeconds: 3600,
        now: now(),
      });
      return jsonResponse(200, { url: lkUrl, token });
    } catch {
      return jsonResponse(502, { error: 'upstream_error' });
    }
  };
}

if (typeof Deno !== 'undefined') {
  Deno.serve(createHandler({ getEnv: (name: string) => Deno.env.get(name) }));
}
