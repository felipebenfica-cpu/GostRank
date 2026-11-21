'use strict';

// Grupo (Etapa 4): cliente PostgREST/RPC do Supabase + serviço que guarda o grupo para a View.
// Regras iguais às do profile.js: fetch injetável, timeout, redirect:'error', identidade só do token.
//
// Membros + apelidos: `group_members.user_id` e `profiles.id` apontam ambos para `auth.users`,
// sem chave estrangeira direta entre eles, então o PostgREST não consegue embutir
// `profiles(display_name)` em `group_members`. Por isso `load()` faz consultas separadas
// (membros; perfis com `id=in.(...)`; `mmr_snapshots` com `user_id=in.(...)`) e junta em JS.

const { createRequester, userIdFromToken } = require('./auth');
const { UserInputError } = require('./controller');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const INVITE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/;
const CONTROL_RE = /[\p{Cc}\p{Zl}\p{Zp}]/u;
const GROUP_NAME_MIN = 2;
const GROUP_NAME_MAX = 32;
const MAX_MEMBERS_READ = 50;
const MMR_MIN = 0;
const MMR_MAX = 20000;
const STATUSES = Object.freeze(['goal_reached', 'on_track', 'unreachable', 'insufficient_data']);

/** Códigos que as funções do banco devolvem em `message` (raise exception ... message = '<codigo>'). */
const DB_ERROR_CODES = Object.freeze([
  'already_in_group', 'not_in_group', 'not_owner', 'invalid_invite', 'group_full', 'invalid_name', 'rate_limited',
]);

const MESSAGES = Object.freeze({
  already_in_group: 'Você já está em um grupo. Saia dele antes de entrar em outro.',
  not_in_group: 'Você não está em um grupo.',
  not_owner: 'Só o dono do grupo pode fazer isso.',
  invalid_invite: 'Código de convite inválido, expirado ou já usado.',
  group_full: 'Esse grupo está cheio (máximo de 10 pessoas).',
  invalid_name: `O nome do grupo deve ter de ${GROUP_NAME_MIN} a ${GROUP_NAME_MAX} caracteres, sem < ou >.`,
  rate_limited: 'Muitas tentativas em pouco tempo. Aguarde alguns segundos e tente de novo.',
  invalid_user: 'Pessoa inválida.',
  unauthenticated: 'Sua sessão expirou. Entre novamente.',
  forbidden: 'Você não tem permissão para isso.',
  network: 'Sem conexão com o servidor. Verifique sua internet.',
  timeout: 'O servidor demorou demais para responder. Tente novamente.',
  bad_response: 'O servidor enviou uma resposta inesperada. Tente novamente.',
  unconfigured: 'Grupos indisponíveis neste computador.',
  signed_out: 'Entre na sua conta primeiro.',
});

/** Erro seguro para a tela (UserInputError) com `code` para registro genérico. */
function groupError(code) {
  const key = Object.prototype.hasOwnProperty.call(MESSAGES, code) ? code : 'bad_response';
  const err = new UserInputError(MESSAGES[key]);
  err.code = key;
  return err;
}

/** Código de erro seguro para log (nunca texto vindo de fora). */
function safeErrorCode(err) {
  const c = err && err.code;
  return typeof c === 'string' && Object.prototype.hasOwnProperty.call(MESSAGES, c) ? c : 'erro';
}

function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

/** Base comum de PostgREST/RPC/Edge Functions usada por grupo, chat, voz e Steam. */
function createSupabaseRest({ fetchImpl, supabaseUrl, anonKey, getAccessToken, timeoutMs = 10000, extraMessages = {} } = {}) {
  const errorFor = (code) => {
    if (Object.prototype.hasOwnProperty.call(extraMessages, code)) {
      const e = new UserInputError(extraMessages[code]);
      e.code = code;
      return e;
    }
    return groupError(code);
  };
  let request;
  try {
    request = createRequester({ fetchImpl, supabaseUrl, anonKey, timeoutMs });
  } catch {
    throw errorFor('unconfigured');
  }

  async function identity() {
    let token = null;
    try {
      token = typeof getAccessToken === 'function' ? await getAccessToken() : null;
    } catch { token = null; }
    const id = userIdFromToken(token);
    if (!token || !id) throw errorFor('unauthenticated');
    return { token, id };
  }

  async function call(pathAndQuery, opts) {
    try {
      return await request(pathAndQuery, opts);
    } catch (err) {
      const code = err && err.name === 'AuthError' ? err.code : 'bad_response';
      throw errorFor(['network', 'timeout', 'rate_limited', 'unauthenticated'].includes(code) ? code : 'bad_response');
    }
  }

  /** Converte uma resposta de erro do PostgREST/Edge Function em UserInputError. */
  function fail(status, data) {
    const msg = data && typeof data === 'object' && typeof data.message === 'string' ? data.message.trim() : '';
    if (DB_ERROR_CODES.includes(msg)) return errorFor(msg);
    if (status === 401) return errorFor('unauthenticated');
    if (status === 403) return errorFor('forbidden');
    return errorFor('bad_response');
  }

  const ok = (status) => status >= 200 && status < 300;

  async function rpc(name, args, token) {
    const { status, data } = await call(`/rest/v1/rpc/${name}`, { method: 'POST', token, body: args || {} });
    if (!ok(status)) throw fail(status, data);
    return data;
  }

  return { identity, call, fail, ok, rpc, errorFor };
}

function validateGroupName(name) {
  if (typeof name !== 'string') return { ok: false };
  const value = name.trim();
  const len = [...value].length;
  if (len < GROUP_NAME_MIN || len > GROUP_NAME_MAX) return { ok: false };
  if (CONTROL_RE.test(value) || /[<>]/.test(value)) return { ok: false };
  return { ok: true, value };
}

function normalizeInviteCode(code) {
  if (typeof code !== 'string' || code.length > 64) return null;
  const v = code.trim().toUpperCase();
  return INVITE_RE.test(v) ? v : null;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/** progress = (current-start)/(goal-start) limitado a 0..1; meta <= início → 1 se já alcançou. */
function computeProgress(current, start, goal) {
  if (goal <= start) return current >= goal ? 1 : 0;
  return clamp((current - start) / (goal - start), 0, 1);
}

function isMmr(v) {
  return Number.isInteger(v) && v >= MMR_MIN && v <= MMR_MAX;
}

function toMmr(row) {
  if (!row || typeof row !== 'object') return null;
  const { current_mmr: current, goal_mmr: goal, start_mmr: start, wins, losses, status } = row;
  if (!isMmr(current) || !isMmr(goal) || !isMmr(start)) return null;
  if (!Number.isInteger(wins) || wins < 0 || !Number.isInteger(losses) || losses < 0) return null;
  if (!STATUSES.includes(status)) return null;
  const updatedAt = typeof row.updated_at === 'string' ? Date.parse(row.updated_at) : NaN;
  return {
    current, goal, start, wins, losses, status,
    progress: computeProgress(current, start, goal),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : null,
  };
}

function cleanDisplayName(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length > 0 && s.length <= 64 ? s : null;
}

function createGroupClient({
  fetchImpl, supabaseUrl, anonKey, getAccessToken, getUserId = null, timeoutMs = 10000,
} = {}) {
  // `getUserId` é aceito pelo contrato do plano, mas a identidade usada é sempre a do token.
  void getUserId;
  const rest = createSupabaseRest({ fetchImpl, supabaseUrl, anonKey, getAccessToken, timeoutMs });
  const { identity, call, fail, ok, rpc } = rest;

  async function getList(pathAndQuery, token) {
    const { status, data } = await call(pathAndQuery, { token });
    if (!ok(status)) throw fail(status, data);
    if (!Array.isArray(data)) throw groupError('bad_response');
    return data;
  }

  async function load() {
    const { token, id } = await identity();
    const mine = await getList(`/rest/v1/group_members?select=group_id,groups(id,name,owner_id)&user_id=eq.${id}`, token);
    if (mine.length === 0) return null;
    const g = mine[0] && mine[0].groups;
    if (!g || typeof g !== 'object' || !isUuid(g.id) || !isUuid(g.owner_id) || typeof g.name !== 'string') {
      throw groupError('bad_response');
    }
    const groupId = g.id.toLowerCase();
    const ownerId = g.owner_id.toLowerCase();

    const rows = await getList(
      `/rest/v1/group_members?select=user_id,joined_at&group_id=eq.${groupId}&order=joined_at.asc,user_id.asc`,
      token,
    );
    if (rows.length > MAX_MEMBERS_READ) throw groupError('bad_response');
    const ids = [];
    for (const r of rows) {
      if (!r || !isUuid(r.user_id)) throw groupError('bad_response');
      const uid = r.user_id.toLowerCase();
      if (!ids.includes(uid)) ids.push(uid);
    }
    if (!ids.includes(id)) ids.push(id); // nunca some da própria lista

    const inList = ids.join(',');
    const [profiles, snapshots] = await Promise.all([
      getList(`/rest/v1/profiles?select=id,display_name&id=in.(${inList})`, token),
      getList(
        `/rest/v1/mmr_snapshots?select=user_id,current_mmr,goal_mmr,start_mmr,wins,losses,status,updated_at&user_id=in.(${inList})`,
        token,
      ),
    ]);
    const names = new Map();
    for (const p of profiles) {
      if (p && isUuid(p.id)) names.set(p.id.toLowerCase(), cleanDisplayName(p.display_name));
    }
    const mmrs = new Map();
    for (const s of snapshots) {
      if (s && isUuid(s.user_id)) mmrs.set(s.user_id.toLowerCase(), toMmr(s));
    }
    return {
      id: groupId,
      name: g.name,
      isOwner: ownerId === id,
      members: ids.map((uid) => ({
        userId: uid,
        displayName: names.get(uid) ?? null,
        isMe: uid === id,
        isOwner: uid === ownerId,
        mmr: mmrs.get(uid) ?? null,
      })),
    };
  }

  async function create(name) {
    const v = validateGroupName(name);
    if (!v.ok) throw groupError('invalid_name');
    const { token } = await identity();
    const data = await rpc('create_group', { p_name: v.value }, token);
    if (!isUuid(data)) throw groupError('bad_response');
    return data.toLowerCase();
  }

  async function invite() {
    const { token } = await identity();
    const data = await rpc('create_invite', {}, token);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== 'object' || !INVITE_RE.test(String(row.code))) throw groupError('bad_response');
    const expiresAt = typeof row.expires_at === 'string' ? Date.parse(row.expires_at) : NaN;
    if (!Number.isFinite(expiresAt)) throw groupError('bad_response');
    return { code: row.code, expiresAt };
  }

  async function join(code) {
    const c = normalizeInviteCode(code);
    if (!c) throw groupError('invalid_invite');
    const { token } = await identity();
    const data = await rpc('join_group', { p_code: c }, token);
    if (!isUuid(data)) throw groupError('bad_response');
    return data.toLowerCase();
  }

  async function leave() {
    const { token } = await identity();
    await rpc('leave_group', {}, token);
    return { ok: true };
  }

  async function remove(userId) {
    if (!isUuid(userId)) throw groupError('invalid_user');
    const { token } = await identity();
    await rpc('remove_member', { p_user_id: userId.toLowerCase() }, token);
    return { ok: true };
  }

  /** Upsert da linha do próprio usuário em mmr_snapshots a partir do `summary` do rastreador. */
  async function publishSnapshot(summary) {
    if (!summary || typeof summary !== 'object') throw groupError('bad_response');
    const toInt = (v) => clamp(Math.round(Number(v)), MMR_MIN, MMR_MAX);
    const nums = [summary.currentMmr, summary.goalMmr, summary.startMmr];
    if (nums.some((v) => !Number.isFinite(Number(v)) || v === null || v === undefined)) throw groupError('bad_response');
    if (!STATUSES.includes(summary.status)) throw groupError('bad_response');
    const matches = Array.isArray(summary.matches) ? summary.matches : [];
    const wins = matches.filter((m) => m && m.win === true).length;
    const losses = matches.filter((m) => m && m.win === false).length;
    const { token, id } = await identity();
    const body = {
      user_id: id,
      current_mmr: toInt(summary.currentMmr),
      goal_mmr: toInt(summary.goalMmr),
      start_mmr: toInt(summary.startMmr),
      wins,
      losses,
      status: summary.status,
      // updated_at/created_at: preenchidos pelo servidor (o app não tem grant nessas colunas).
    };
    const { status, data } = await call('/rest/v1/mmr_snapshots?on_conflict=user_id', {
      method: 'POST',
      token,
      body,
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
    if (!ok(status)) throw fail(status, data);
    return { ok: true };
  }

  return { load, create, invite, join, leave, remove, publishSnapshot };
}

/**
 * Guarda o grupo atual para a View e coordena o chat.
 * `isSignedIn()` diz se há sessão; sem sessão o grupo some da View.
 */
function createGroupService({
  client = null, isSignedIn = () => false, chatFeed = null, getSummary = null, onChange = () => {},
} = {}) {
  let group = null;
  let generation = 0;

  function emit() {
    try { onChange(); } catch { /* o consumidor não pode quebrar o serviço */ }
  }

  function signedIn() {
    try { return Boolean(isSignedIn()); } catch { return false; }
  }

  function need() {
    if (!client) throw groupError('unconfigured');
    if (!signedIn()) throw groupError('signed_out');
  }

  function setGroup(g) {
    group = g;
    if (chatFeed) {
      try { chatFeed.setContext(g ? { groupId: g.id, members: g.members } : null); } catch { /* chat é opcional */ }
    }
    emit();
  }

  function getView() {
    if (!group || !signedIn()) return null;
    return {
      id: group.id,
      name: group.name,
      isOwner: group.isOwner,
      members: group.members.map((m) => ({ ...m, mmr: m.mmr ? { ...m.mmr } : null })),
    };
  }

  function hasGroup() {
    return getView() !== null;
  }

  async function refresh({ quiet = false } = {}) {
    if (quiet && (!client || !signedIn())) return null;
    need();
    const gen = generation;
    try {
      const g = await client.load();
      if (gen === generation && signedIn()) setGroup(g);
    } catch (err) {
      if (gen === generation && err && err.code === 'unauthenticated') setGroup(null);
      if (!quiet) throw err;
    }
    return getView();
  }

  function publishNow() {
    if (typeof getSummary !== 'function') return;
    let summary = null;
    try { summary = getSummary(); } catch { summary = null; }
    if (summary) publishSnapshot(summary).catch(() => {});
  }

  async function create(name) {
    need();
    await client.create(name);
    await refresh();
    publishNow();
    return getView();
  }

  async function join(code) {
    need();
    await client.join(code);
    await refresh();
    publishNow();
    return getView();
  }

  async function leave() {
    need();
    await client.leave();
    generation++;
    setGroup(null);
    return null;
  }

  async function remove(userId) {
    need();
    await client.remove(userId);
    await refresh();
    return getView();
  }

  async function invite() {
    need();
    if (!group) throw groupError('not_in_group');
    return client.invite();
  }

  /** Sem sessão ou sem grupo não faz nada (resolve false). */
  async function publishSnapshot(summary) {
    if (!client || !signedIn() || !group) return false;
    await client.publishSnapshot(summary);
    return true;
  }

  function clear() {
    generation++;
    setGroup(null);
  }

  return { getView, hasGroup, refresh, create, join, leave, remove, invite, publishSnapshot, clear };
}

module.exports = {
  createGroupClient,
  createGroupService,
  createSupabaseRest,
  groupError,
  safeErrorCode,
  computeProgress,
  toMmr,
  validateGroupName,
  normalizeInviteCode,
  isUuid,
  DB_ERROR_CODES,
  MESSAGES,
  INVITE_ALPHABET,
  INVITE_RE,
  UUID_RE,
  GROUP_NAME_MIN,
  GROUP_NAME_MAX,
};
