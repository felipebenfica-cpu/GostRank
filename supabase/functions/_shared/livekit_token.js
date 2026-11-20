// Gera o token de acesso (JWT HS256) da sala de voz do LiveKit.
// Sem dependencias: usa so WebCrypto e TextEncoder (Deno e Node 22).

const encoder = new TextEncoder();

function base64UrlFromBytes(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlJson(obj) {
  return base64UrlFromBytes(encoder.encode(JSON.stringify(obj)));
}

function requireText(value, field, max) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new TypeError(`livekit: campo invalido: ${field}`);
  }
}

/**
 * Cria o JWT do LiveKit.
 * @returns {Promise<string>}
 */
export async function createLiveKitToken({ apiKey, apiSecret, identity, name, room, ttlSeconds = 3600, now = Date.now() } = {}) {
  requireText(apiKey, 'apiKey', 256);
  requireText(apiSecret, 'apiSecret', 1024);
  requireText(identity, 'identity', 128);
  requireText(room, 'room', 128);
  if (name !== undefined && name !== null) requireText(name, 'name', 128);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 86400) {
    throw new TypeError('livekit: ttlSeconds invalido');
  }
  if (!Number.isFinite(now)) throw new TypeError('livekit: now invalido');

  const nowSec = Math.floor(now / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: apiKey,
    sub: identity,
    nbf: nowSec,
    exp: nowSec + ttlSeconds,
    video: {
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
    },
  };
  if (name) payload.name = name;

  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(apiSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput)));
  return `${signingInput}.${base64UrlFromBytes(sig)}`;
}

/** Nome da sala de voz de um grupo. */
export function roomForGroup(groupId) {
  return 'grupo-' + groupId;
}
