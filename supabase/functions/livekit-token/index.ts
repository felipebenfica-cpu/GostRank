// Edge Function "livekit-token": entrega o token de uma sala de voz.
// POST com "Authorization: Bearer <access_token do usuario>" e corpo JSON:
//   {"channelId": "<uuid>"}  canal de voz de um servidor (precisa ser membro)      -> sala vc_<id>
//   {"dmId": "<uuid>"}       chamada numa DM (precisa participar, sem bloqueio)    -> sala dm_<id>
//   {} ou sem corpo          app antigo: primeiro canal de voz do primeiro servidor
// Publicar com "Verify JWT" DESLIGADO: a funcao valida o token ela mesma em /auth/v1/user.
import { createLiveKitToken, roomForChannel, roomForDm, roomForGroup } from '../_shared/livekit_token.js';
import {
  UUID_RE, bearerToken, getUserFromToken, jsonResponse, preflightResponse, restCall, supabaseConfig,
} from '../_shared/http.js';

type Deps = {
  getEnv: (name: string) => string | undefined;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

type Target = { kind: 'legacy' } | { kind: 'channel'; id: string } | { kind: 'dm'; id: string };

const ALLOW = { Allow: 'POST, OPTIONS' };
const MAX_BODY = 1024;

/** Le o corpo: vazio, {} , {channelId} ou {dmId}. Qualquer outra coisa e invalida (null). */
async function readTarget(req: Request): Promise<Target | null> {
  let text = '';
  try { text = await req.text(); } catch { return null; }
  if (text.length > MAX_BODY) return null;
  if (text.trim() === '') return { kind: 'legacy' };
  let body: unknown;
  try { body = JSON.parse(text); } catch { return null; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const keys = Object.keys(b);
  if (keys.some((k) => k !== 'channelId' && k !== 'dmId')) return null;
  const hasChannel = b.channelId !== undefined && b.channelId !== null;
  const hasDm = b.dmId !== undefined && b.dmId !== null;
  if (hasChannel && hasDm) return null;
  if (hasChannel) {
    return typeof b.channelId === 'string' && UUID_RE.test(b.channelId) ? { kind: 'channel', id: b.channelId } : null;
  }
  if (hasDm) {
    return typeof b.dmId === 'string' && UUID_RE.test(b.dmId) ? { kind: 'dm', id: b.dmId } : null;
  }
  return { kind: 'legacy' };
}

const rows = (r: { status: number; data: any }) => (r.status === 200 && Array.isArray(r.data) ? r.data : null);

export function createHandler({ getEnv, fetchImpl = fetch, now = () => Date.now() }: Deps) {
  return async function handler(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return preflightResponse(ALLOW);
    if (req.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' }, ALLOW);

    const cfg = supabaseConfig(getEnv);
    if (!cfg) return jsonResponse(500, { error: 'server_misconfigured' });

    try {
      const user = await getUserFromToken({
        supabaseUrl: cfg.supabaseUrl, apiKey: cfg.anonKey, token: bearerToken(req), fetchImpl,
      });
      if (!user || !UUID_RE.test(user.id)) return jsonResponse(401, { error: 'unauthorized' });

      const target = await readTarget(req);
      if (!target) return jsonResponse(400, { error: 'bad_request' });

      // Tolera espacos, aspas e "NOME=" colados por engano no painel.
      const clean = (name: string) => (getEnv(name) || '').trim()
        .replace(new RegExp('^' + name + '='), '').replace(/^["']|["']$/g, '').trim();
      const lkUrl = clean('LIVEKIT_URL');
      const apiKey = clean('LIVEKIT_API_KEY');
      const apiSecret = clean('LIVEKIT_API_SECRET');
      if (!lkUrl.startsWith('wss://') || !apiKey || !apiSecret) {
        return jsonResponse(503, { error: 'voice_unconfigured' });
      }

      const rest = { supabaseUrl: cfg.supabaseUrl, serviceKey: cfg.serviceKey, fetchImpl };
      const upstream = () => jsonResponse(502, { error: 'upstream_error' });
      let room: string;

      if (target.kind === 'channel') {
        const ch = rows(await restCall(rest, 'GET', `channels?select=id,group_id,kind&id=eq.${target.id}`));
        if (!ch) return upstream();
        const c = ch[0];
        if (!c || c.kind !== 'voice' || typeof c.group_id !== 'string' || !UUID_RE.test(c.group_id)) {
          return jsonResponse(403, { error: 'not_member' });
        }
        const mem = rows(await restCall(rest, 'GET',
          `group_members?select=group_id&group_id=eq.${c.group_id}&user_id=eq.${user.id}`));
        if (!mem) return upstream();
        if (mem.length === 0) return jsonResponse(403, { error: 'not_member' });
        room = roomForChannel(target.id);
      } else if (target.kind === 'dm') {
        const dm = rows(await restCall(rest, 'GET', `dm_channels?select=id,user_a,user_b&id=eq.${target.id}`));
        if (!dm) return upstream();
        const d = dm[0];
        if (!d || (d.user_a !== user.id && d.user_b !== user.id)) return jsonResponse(403, { error: 'not_member' });
        const other = d.user_a === user.id ? d.user_b : d.user_a;
        if (typeof other !== 'string' || !UUID_RE.test(other)) return jsonResponse(403, { error: 'not_member' });
        const blocks = rows(await restCall(rest, 'GET',
          `relationships?select=user_id&kind=eq.blocked&user_id=in.(${user.id},${other})&other_id=in.(${user.id},${other})`));
        if (!blocks) return upstream();
        if (blocks.length > 0) return jsonResponse(403, { error: 'not_member' });
        room = roomForDm(target.id);
      } else {
        // App antigo: primeiro servidor da pessoa, primeiro canal de voz dele.
        const member = rows(await restCall(rest, 'GET',
          `group_members?select=group_id&user_id=eq.${user.id}&order=joined_at.asc&limit=1`));
        if (!member) return upstream();
        const groupId = member[0] && member[0].group_id;
        if (typeof groupId !== 'string' || !UUID_RE.test(groupId)) return jsonResponse(403, { error: 'not_in_group' });
        const vc = await restCall(rest, 'GET',
          `channels?select=id&group_id=eq.${groupId}&kind=eq.voice&order=position.asc,created_at.asc&limit=1`);
        const first = rows(vc);
        const channelId = first && first[0] && first[0].id;
        room = typeof channelId === 'string' && UUID_RE.test(channelId) ? roomForChannel(channelId) : roomForGroup(groupId);
      }

      const profile = await restCall(rest, 'GET', `profiles?select=display_name&id=eq.${user.id}`);
      const displayName = profile.status === 200 && Array.isArray(profile.data) && profile.data[0]
        && typeof profile.data[0].display_name === 'string' ? profile.data[0].display_name : undefined;

      const token = await createLiveKitToken({
        apiKey,
        apiSecret,
        identity: user.id,
        name: displayName,
        room,
        ttlSeconds: 3600,
        now: now(),
        canPublishData: true,
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
