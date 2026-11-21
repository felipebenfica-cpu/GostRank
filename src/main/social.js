'use strict';

// Etapa 6: amigos, busca de pessoas, DMs, meu perfil (nome de usuário, sobre mim, status, avatar).

const { appError, isUuid } = require('./rest');
const { PROFILE_COLS, USERNAME_RE } = require('./users');
const { validateUpload } = require('./files');

const RELATIONS = Object.freeze(['friend', 'pending_in', 'pending_out', 'blocked']);
const STATUSES = Object.freeze(['online', 'idle', 'dnd', 'invisible']);
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const MAX_DMS = 100;

function uuid() {
  return globalThis.crypto.randomUUID();
}

/** "@Fulano.Silva " → "fulano.silva" (ou null se não for nome de usuário válido). */
function normalizeUsername(v) {
  if (typeof v !== 'string' || v.length > 64) return null;
  const s = v.trim().replace(/^@/, '').toLowerCase();
  return USERNAME_RE.test(s) ? s : null;
}

function validateDisplayName(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const len = [...s].length;
  if (len < 1 || len > 32 || /[<>]/.test(s) || CONTROL_RE.test(s)) return null;
  return s;
}

function optionalText(v, max) {
  if (v === null) return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false };
  const s = v.trim();
  if ([...s].length > max || CONTROL_RE.test(s.replace(/[\n\r\t]/g, ''))) return { ok: false };
  return { ok: true, value: s.length ? s : null };
}

function createSocialService({ rest, users, onChange = () => {} } = {}) {
  let meId = null;
  let relationships = []; // {id, relation, since}
  let dms = []; // {id, userId, lastMessageAt}
  let generation = 0;

  function emit() { try { onChange(); } catch { /* ignora */ } }

  async function loadMe() {
    const { id } = await rest.identity();
    meId = id;
    const rows = await rest.select(`/rest/v1/profiles?select=${PROFILE_COLS}&id=eq.${id}`);
    users.upsertRows(rows);
    return users.get(id);
  }

  async function loadRelationships() {
    const rows = await rest.select('/rest/v1/relationships?select=other_id,kind,created_at&order=created_at.desc&limit=1000');
    const list = [];
    for (const r of rows) {
      if (!r || !isUuid(r.other_id) || !RELATIONS.includes(r.kind)) continue;
      const t = Date.parse(r.created_at);
      list.push({ id: r.other_id.toLowerCase(), relation: r.kind, since: Number.isFinite(t) ? t : null });
    }
    await users.ensure(list.map((x) => x.id));
    relationships = list;
  }

  async function loadDms() {
    const rows = await rest.select(`/rest/v1/dm_channels?select=id,user_a,user_b,last_message_at,created_at&order=last_message_at.desc.nullslast&limit=${MAX_DMS}`);
    const list = [];
    for (const r of rows) {
      if (!r || !isUuid(r.id) || !isUuid(r.user_a) || !isUuid(r.user_b)) continue;
      const a = r.user_a.toLowerCase();
      const b = r.user_b.toLowerCase();
      const other = a === meId ? b : a;
      const t = Date.parse(r.last_message_at || r.created_at);
      list.push({ id: r.id.toLowerCase(), userId: other, lastMessageAt: Number.isFinite(t) ? t : null });
    }
    list.sort((x, y) => (y.lastMessageAt || 0) - (x.lastMessageAt || 0));
    await users.ensure(list.map((d) => d.userId));
    dms = list;
  }

  /** Carrega tudo. Erros de "falta a 0003" sobem para quem chamou decidir o modo antigo. */
  async function refresh() {
    const gen = ++generation;
    await loadMe();
    await Promise.all([loadRelationships(), loadDms()]);
    if (gen === generation) emit();
  }

  async function refreshRelationships() { await loadRelationships(); emit(); }
  async function refreshDms() { await loadDms(); emit(); }

  function relationOf(userId) {
    const r = relationships.find((x) => x.id === userId);
    return r ? r.relation : 'none';
  }

  function friendIds() {
    return relationships.filter((r) => r.relation === 'friend').map((r) => r.id);
  }

  /** Marca a DM como recém-usada (mensagem nova) sem ir ao servidor. */
  function touchDm(dmId, at) {
    const d = dms.find((x) => x.id === dmId);
    if (!d) return false;
    d.lastMessageAt = at || Date.now();
    dms.sort((x, y) => (y.lastMessageAt || 0) - (x.lastMessageAt || 0));
    return true;
  }

  async function searchUsers(query) {
    if (typeof query !== 'string') throw appError('invalid_query');
    const q = query.trim().replace(/^@/, '');
    if ([...q].length < 2 || q.length > 64 || CONTROL_RE.test(q)) throw appError('invalid_query');
    const rows = await rest.rpc('search_users', { p_query: q });
    if (!Array.isArray(rows)) throw appError('bad_response');
    const out = [];
    for (const row of rows.slice(0, 20)) {
      const u = users.upsertRows([row])[0];
      if (!u || u.id === meId) continue;
      const relation = ['friend', 'pending_in', 'pending_out', 'blocked', 'none'].includes(row.relation) ? row.relation : relationOf(u.id);
      out.push({ ...users.lite(u.id), relation });
    }
    return out;
  }

  async function sendFriendRequest(username) {
    const name = normalizeUsername(username);
    if (!name) throw appError('invalid_username');
    const me = meId ? users.get(meId) : null;
    if (me && me.username === name) throw appError('cannot_add_self');
    const r = await rest.rpc('send_friend_request', { p_username: name });
    await loadRelationships();
    emit();
    return r === 'accepted' ? 'accepted' : 'sent';
  }

  function needUser(userId) {
    if (!isUuid(userId)) throw appError('invalid_user');
    return userId.toLowerCase();
  }

  async function relAction(rpcName, userId) {
    const id = needUser(userId);
    await rest.rpc(rpcName, { p_user: id });
    await loadRelationships();
    emit();
  }

  const acceptFriend = (id) => relAction('accept_friend_request', id);
  const declineFriend = (id) => relAction('decline_friend_request', id);
  const removeFriend = (id) => relAction('remove_friend', id);
  const blockUser = (id) => relAction('block_user', id);
  const unblockUser = (id) => relAction('unblock_user', id);

  async function openDm(userId) {
    const id = needUser(userId);
    if (id === meId) throw appError('cannot_add_self');
    const dmId = await rest.rpc('open_dm', { p_user: id });
    if (!isUuid(dmId)) throw appError('bad_response');
    await loadDms();
    const low = dmId.toLowerCase();
    if (!dms.some((d) => d.id === low)) dms.unshift({ id: low, userId: id, lastMessageAt: Date.now() });
    emit();
    return low;
  }

  async function patchMe(body) {
    if (!meId) await loadMe();
    const rows = await rest.update(`/rest/v1/profiles?id=eq.${meId}`, body, { returning: true });
    if (rows.length) users.upsertRows(rows.map((r) => ({ ...r, id: meId })));
    else await users.ensure([meId], { force: true });
    emit();
  }

  async function setStatus(status) {
    if (!STATUSES.includes(status)) throw appError('invalid_status');
    await patchMe({ status });
  }

  async function setCustomStatus(text) {
    const r = optionalText(text, 128);
    if (!r.ok) throw appError('invalid_custom_status');
    await patchMe({ custom_status: r.value });
  }

  /** Campos novos do perfil (os antigos displayName/mmrVisibility também passam por aqui no modo novo). */
  async function updateProfile(patch) {
    const body = {};
    if (patch.displayName !== undefined) {
      const v = validateDisplayName(patch.displayName);
      if (!v) throw appError('invalid_display_name');
      body.display_name = v;
    }
    if (patch.username !== undefined) {
      const v = normalizeUsername(patch.username);
      if (!v) throw appError('invalid_username');
      body.username = v;
    }
    if (patch.about !== undefined) {
      const r = optionalText(patch.about, 190);
      if (!r.ok) throw appError('invalid_about');
      body.about = r.value;
    }
    if (patch.avatarColor !== undefined) {
      if (!Number.isInteger(patch.avatarColor) || patch.avatarColor < 0 || patch.avatarColor > 7) throw appError('invalid');
      body.avatar_color = patch.avatarColor;
    }
    if (patch.mmrVisibility !== undefined) {
      if (!['friends', 'group', 'nobody'].includes(patch.mmrVisibility)) throw appError('invalid');
      body.mmr_visibility = patch.mmrVisibility;
    }
    if (Object.keys(body).length === 0) throw appError('invalid');
    await patchMe(body);
  }

  async function uploadAvatar(input) {
    const f = validateUpload(input, 'image');
    if (!meId) await loadMe();
    const old = users.get(meId) ? users.get(meId).avatarPath : null;
    const path = `${meId}/${uuid()}.${f.ext}`;
    await rest.upload('avatars', path, f.bytes, f.mime);
    await patchMe({ avatar_path: path });
    if (old && old.startsWith(`${meId}/`)) rest.removeObjects('avatars', [old]).catch(() => {});
  }

  async function removeAvatar() {
    if (!meId) await loadMe();
    const old = users.get(meId) ? users.get(meId).avatarPath : null;
    await patchMe({ avatar_path: null });
    if (old && old.startsWith(`${meId}/`)) rest.removeObjects('avatars', [old]).catch(() => {});
  }

  function getMe() {
    if (!meId) return null;
    const u = users.get(meId);
    if (!u) return null;
    return { ...users.lite(meId), about: u.about, customStatus: u.customStatus, status: u.status };
  }

  function getFriendsView() {
    return relationships.map((r) => {
      const u = users.get(r.id);
      return { ...users.lite(r.id), relation: r.relation, customStatus: u ? u.customStatus : null, since: r.since };
    });
  }

  function getDms() {
    return dms.map((d) => ({ ...d }));
  }

  function clear() {
    generation++;
    meId = null;
    relationships = [];
    dms = [];
  }

  return {
    refresh, refreshRelationships, refreshDms, searchUsers, sendFriendRequest, acceptFriend, declineFriend,
    removeFriend, blockUser, unblockUser, openDm, setStatus, setCustomStatus, updateProfile, uploadAvatar,
    removeAvatar, getMe, getFriendsView, getDms, relationOf, friendIds, touchDm, clear,
    getMeId: () => meId,
  };
}

module.exports = { createSocialService, normalizeUsername, validateDisplayName };
