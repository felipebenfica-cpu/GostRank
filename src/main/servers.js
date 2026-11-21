'use strict';

// Etapa 6: servidores (tabela groups), canais, categorias, cargos, convites e moderação.

const { appError, isUuid } = require('./rest');
const { toMmr, normalizeInviteCode } = require('./group');
const { validateUpload } = require('./files');
const { selectWithPhoto, legacyPhoto } = require('./users');

const ROLES = Object.freeze(['owner', 'admin', 'member']);
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const MAX_AGES = Object.freeze([null, 1800, 3600, 21600, 43200, 86400, 604800]);
const MAX_USES = Object.freeze([null, 1, 5, 10, 25, 50, 100]);
const MEMBER_CHUNK = 80;

function uuid() { return globalThis.crypto.randomUUID(); }

function validateServerName(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const len = [...s].length;
  if (len < 2 || len > 32 || /[<>]/.test(s) || CONTROL_RE.test(s)) return null;
  return s;
}

function validateLabel(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const len = [...s].length;
  if (len < 1 || len > 32 || /[<>]/.test(s) || CONTROL_RE.test(s)) return null;
  return s;
}

/** Nome de canal de texto no estilo Discord: minúsculo, espaços viram hífen. */
function normalizeTextChannelName(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase().replace(/\s+/g, '-').replace(/-+/g, '-');
  return /^[\p{L}\p{N}_-]{1,32}$/u.test(s) ? s : null;
}

function validateTopic(v) {
  if (v === null) return { ok: true, value: null };
  if (typeof v !== 'string' || [...v].length > 1024 || /[<>]/.test(v) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)) return { ok: false };
  const s = v.trim();
  return { ok: true, value: s.length ? s : null };
}

function iconColor(v) {
  return Number.isInteger(v) && v >= 0 && v <= 7 ? v : null;
}

function ts(v) {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
}

function createServersService({ rest, users, onChange = () => {} } = {}) {
  let meId = null;
  let list = []; // {id, name, iconColor, iconPath, ownerId, role}
  let details = null; // servidor selecionado
  let selectedId = null;
  let generation = 0;

  function emit() { try { onChange(); } catch { /* ignora */ } }

  // Ícone do Storage; sem ele, a foto antiga do grupo (0003_social), se for válida.
  function iconUrl(path, photo = null) {
    return (path ? rest.publicUrl('avatars', path) : null) || legacyPhoto(photo);
  }

  async function refreshList() {
    const { id } = await rest.identity();
    meId = id;
    const rows = await selectWithPhoto(rest,
      (cols) => `/rest/v1/group_members?select=group_id,role,joined_at,groups(${cols})&user_id=eq.${id}&order=joined_at.asc`,
      'id,name,owner_id,icon_color,icon_path');
    const out = [];
    for (const r of rows) {
      const g = r && r.groups;
      if (!g || !isUuid(g.id) || typeof g.name !== 'string') continue;
      out.push({
        id: g.id.toLowerCase(),
        name: g.name.slice(0, 64),
        iconColor: iconColor(g.icon_color) ?? (parseInt(g.id.slice(0, 2), 16) % 8),
        iconPath: typeof g.icon_path === 'string' ? g.icon_path : null,
        photo: legacyPhoto(g.photo),
        ownerId: isUuid(g.owner_id) ? g.owner_id.toLowerCase() : null,
        role: ROLES.includes(r.role) ? r.role : (g.owner_id === id ? 'owner' : 'member'),
      });
    }
    list = out;
    if (selectedId && !list.some((s) => s.id === selectedId)) {
      selectedId = null;
      details = null;
    }
    emit();
    return list;
  }

  async function loadDetails(serverId) {
    const gid = serverId.toLowerCase();
    const [cats, chans, members] = await Promise.all([
      rest.select(`/rest/v1/channel_categories?select=id,name,position&group_id=eq.${gid}&order=position.asc,name.asc`),
      rest.select(`/rest/v1/channels?select=id,kind,name,topic,category_id,position&group_id=eq.${gid}&order=position.asc,name.asc`),
      rest.select(`/rest/v1/group_members?select=user_id,role,nickname,joined_at&group_id=eq.${gid}&order=joined_at.asc&limit=200`),
    ]);
    const categories = cats.filter((c) => c && isUuid(c.id)).map((c) => ({
      id: c.id.toLowerCase(), name: String(c.name || '').slice(0, 32), position: Number.isInteger(c.position) ? c.position : 0,
    }));
    const catIds = new Set(categories.map((c) => c.id));
    const channels = chans.filter((c) => c && isUuid(c.id) && ['text', 'voice'].includes(c.kind)).map((c) => ({
      id: c.id.toLowerCase(),
      kind: c.kind,
      name: String(c.name || '').slice(0, 32),
      topic: typeof c.topic === 'string' ? c.topic.slice(0, 1024) : null,
      categoryId: isUuid(c.category_id) && catIds.has(c.category_id.toLowerCase()) ? c.category_id.toLowerCase() : null,
      position: Number.isInteger(c.position) ? c.position : 0,
    }));
    const mem = members.filter((m) => m && isUuid(m.user_id)).map((m) => ({
      id: m.user_id.toLowerCase(),
      role: ROLES.includes(m.role) ? m.role : 'member',
      nickname: typeof m.nickname === 'string' && m.nickname.trim() ? m.nickname.trim().slice(0, 32) : null,
      joinedAt: ts(m.joined_at),
    }));
    const ids = mem.map((m) => m.id);
    await users.ensure(ids);
    const mmrs = new Map();
    for (let i = 0; i < ids.length; i += MEMBER_CHUNK) {
      const part = ids.slice(i, i + MEMBER_CHUNK);
      try {
        const snaps = await rest.select(`/rest/v1/mmr_snapshots?select=user_id,current_mmr,goal_mmr,start_mmr,wins,losses,status,updated_at&user_id=in.(${part.join(',')})`);
        for (const s of snaps) if (s && isUuid(s.user_id)) mmrs.set(s.user_id.toLowerCase(), toMmr(s));
      } catch { /* MMR é opcional */ }
    }
    for (const m of mem) m.mmr = mmrs.get(m.id) ?? null;
    return { id: gid, categories, channels, members: mem };
  }

  /** Seleciona e carrega o servidor (null limpa). */
  async function select(serverId) {
    const gen = ++generation;
    if (!serverId) {
      selectedId = null;
      details = null;
      emit();
      return null;
    }
    const gid = serverId.toLowerCase();
    if (!list.some((s) => s.id === gid)) throw appError('not_member');
    if (selectedId !== gid) details = null;
    selectedId = gid;
    const d = await loadDetails(gid);
    if (gen === generation && selectedId === gid) {
      details = d;
      emit();
    }
    return d;
  }

  async function reloadSelected() {
    if (!selectedId) return null;
    const gid = selectedId;
    const gen = generation;
    try {
      const d = await loadDetails(gid);
      if (gen === generation && selectedId === gid) { details = d; emit(); }
    } catch { /* fica como estava */ }
    return details;
  }

  function needServer(serverId) {
    if (!isUuid(serverId)) throw appError('not_member');
    return serverId.toLowerCase();
  }

  function needUser(userId) {
    if (!isUuid(userId)) throw appError('invalid_user');
    return userId.toLowerCase();
  }

  async function afterChange(serverId) {
    await refreshList();
    if (serverId && serverId === selectedId) await reloadSelected();
  }

  // ---------------- Servidores ----------------
  async function create({ name, iconColor: color = 0 }) {
    const n = validateServerName(name);
    if (!n) throw appError('invalid_name');
    const c = iconColor(color) ?? 0;
    const id = await rest.rpc('create_group', { p_name: n, p_icon_color: c });
    if (!isUuid(id)) throw appError('bad_response');
    await refreshList();
    return id.toLowerCase();
  }

  async function previewInvite(code) {
    const c = normalizeInviteCode(code);
    if (!c) throw appError('invalid_invite');
    const data = await rest.rpc('preview_invite', { p_code: c });
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || !isUuid(row.group_id)) throw appError('invalid_invite');
    return {
      serverId: row.group_id.toLowerCase(),
      name: String(row.name || '').slice(0, 64),
      iconColor: iconColor(row.icon_color) ?? 0,
      iconUrl: typeof row.icon_path === 'string' ? iconUrl(row.icon_path) : null,
      memberCount: Number.isInteger(row.member_count) && row.member_count >= 0 ? row.member_count : 0,
      alreadyMember: row.already_member === true,
    };
  }

  async function join(code) {
    const c = normalizeInviteCode(code);
    if (!c) throw appError('invalid_invite');
    const id = await rest.rpc('join_group', { p_code: c });
    if (!isUuid(id)) throw appError('bad_response');
    await refreshList();
    return id.toLowerCase();
  }

  async function leave(serverId) {
    const gid = needServer(serverId);
    await rest.rpc('leave_group', { p_group: gid });
    if (selectedId === gid) { selectedId = null; details = null; }
    await refreshList();
  }

  async function remove(serverId) {
    const gid = needServer(serverId);
    await rest.rpc('delete_group', { p_group: gid });
    if (selectedId === gid) { selectedId = null; details = null; }
    await refreshList();
  }

  async function update({ serverId, name, iconColor: color }) {
    const gid = needServer(serverId);
    const cur = list.find((s) => s.id === gid);
    let n = cur ? cur.name : null;
    if (name !== undefined) {
      n = validateServerName(name);
      if (!n) throw appError('invalid_name');
    }
    let c = cur ? cur.iconColor : 0;
    if (color !== undefined) {
      c = iconColor(color);
      if (c === null) throw appError('invalid');
    }
    await rest.rpc('update_group', { p_group: gid, p_name: n, p_icon_color: c });
    await afterChange(gid);
  }

  async function uploadIcon({ serverId, name, mime, data }) {
    const gid = needServer(serverId);
    const f = validateUpload({ name, mime, data }, 'image');
    const path = `g_${gid}/${uuid()}.${f.ext}`;
    await rest.upload('avatars', path, f.bytes, f.mime);
    await rest.rpc('set_group_icon', { p_group: gid, p_path: path });
    await afterChange(gid);
  }

  // ---------------- Convites ----------------
  function toInvite(row) {
    if (!row || typeof row.code !== 'string' || !normalizeInviteCode(row.code)) return null;
    return {
      code: row.code,
      expiresAt: ts(row.expires_at),
      maxUses: Number.isInteger(row.max_uses) ? row.max_uses : null,
      uses: Number.isInteger(row.uses) ? row.uses : 0,
      createdBy: isUuid(row.created_by) ? row.created_by.toLowerCase() : null,
    };
  }

  async function createInvite({ serverId, maxAgeSeconds = null, maxUses = null }) {
    const gid = needServer(serverId);
    if (!MAX_AGES.includes(maxAgeSeconds) || !MAX_USES.includes(maxUses)) throw appError('invalid');
    const data = await rest.rpc('create_invite', { p_group: gid, p_max_age_seconds: maxAgeSeconds, p_max_uses: maxUses });
    const inv = toInvite(Array.isArray(data) ? data[0] : data);
    if (!inv) throw appError('bad_response');
    return inv;
  }

  async function listInvites(serverId) {
    const gid = needServer(serverId);
    const data = await rest.rpc('list_invites', { p_group: gid });
    if (!Array.isArray(data)) throw appError('bad_response');
    const out = data.map(toInvite).filter(Boolean);
    await users.ensure(out.map((i) => i.createdBy).filter(Boolean));
    return out.map((i) => ({ ...i, creator: i.createdBy ? users.lite(i.createdBy) : null }));
  }

  async function revokeInvite(code) {
    const c = normalizeInviteCode(code);
    if (!c) throw appError('invalid_invite');
    await rest.rpc('revoke_invite', { p_code: c });
  }

  // ---------------- Membros ----------------
  async function memberAction(rpcName, serverId, userId, extra = {}) {
    const gid = needServer(serverId);
    const uid = needUser(userId);
    await rest.rpc(rpcName, { p_group: gid, p_user: uid, ...extra });
    await afterChange(gid);
  }

  async function setMemberRole({ serverId, userId, role }) {
    if (!['admin', 'member'].includes(role)) throw appError('invalid');
    await memberAction('set_member_role', serverId, userId, { p_role: role });
  }
  const transferOwnership = ({ serverId, userId }) => memberAction('transfer_ownership', serverId, userId);
  const kickMember = ({ serverId, userId }) => memberAction('kick_member', serverId, userId);
  const banMember = ({ serverId, userId }) => memberAction('ban_member', serverId, userId);
  const unbanMember = ({ serverId, userId }) => memberAction('unban_member', serverId, userId);

  async function listBans(serverId) {
    const gid = needServer(serverId);
    const data = await rest.rpc('list_bans', { p_group: gid });
    if (!Array.isArray(data)) throw appError('bad_response');
    const rows = data.filter((r) => r && isUuid(r.user_id));
    users.upsertRows(rows.map((r) => ({ ...r, id: r.user_id })));
    return rows.map((r) => ({ ...users.lite(r.user_id.toLowerCase()), bannedAt: ts(r.banned_at || r.created_at) }));
  }

  async function setNickname({ serverId, nickname }) {
    const gid = needServer(serverId);
    let nick = null;
    if (nickname !== null && nickname !== undefined) {
      nick = validateLabel(nickname);
      if (!nick) throw appError('invalid_name');
    }
    await rest.rpc('set_nickname', { p_group: gid, p_nickname: nick });
    await afterChange(gid);
  }

  // ---------------- Canais ----------------
  function serverOfChannel(channelId) {
    return details && details.channels.some((c) => c.id === channelId) ? details.id : null;
  }

  async function createCategory({ serverId, name }) {
    const gid = needServer(serverId);
    const n = validateLabel(name);
    if (!n) throw appError('invalid_name');
    const id = await rest.rpc('create_category', { p_group: gid, p_name: n });
    await afterChange(gid);
    return isUuid(id) ? id.toLowerCase() : null;
  }

  async function updateCategory({ categoryId, name, position }) {
    if (!isUuid(categoryId)) throw appError('invalid');
    const cur = details && details.categories.find((c) => c.id === categoryId.toLowerCase());
    let n = cur ? cur.name : null;
    if (name !== undefined) { n = validateLabel(name); if (!n) throw appError('invalid_name'); }
    let p = cur ? cur.position : 0;
    if (position !== undefined) { if (!Number.isInteger(position) || position < 0 || position > 1000) throw appError('invalid'); p = position; }
    await rest.rpc('update_category', { p_id: categoryId.toLowerCase(), p_name: n, p_position: p });
    await reloadSelected();
  }

  async function deleteCategory(categoryId) {
    if (!isUuid(categoryId)) throw appError('invalid');
    await rest.rpc('delete_category', { p_id: categoryId.toLowerCase() });
    await reloadSelected();
  }

  async function createChannel({ serverId, kind, name, categoryId = null }) {
    const gid = needServer(serverId);
    if (!['text', 'voice'].includes(kind)) throw appError('invalid');
    const n = kind === 'text' ? normalizeTextChannelName(name) : validateLabel(name);
    if (!n) throw appError('invalid_name');
    if (categoryId !== null && !isUuid(categoryId)) throw appError('invalid');
    const id = await rest.rpc('create_channel', { p_group: gid, p_kind: kind, p_name: n, p_category: categoryId ? categoryId.toLowerCase() : null });
    await afterChange(gid);
    return isUuid(id) ? id.toLowerCase() : null;
  }

  async function updateChannel({ channelId, name, topic, categoryId, position }) {
    if (!isUuid(channelId)) throw appError('invalid');
    const cid = channelId.toLowerCase();
    const cur = details && details.channels.find((c) => c.id === cid);
    if (!cur) throw appError('not_member');
    let n = cur.name;
    if (name !== undefined) {
      n = cur.kind === 'text' ? normalizeTextChannelName(name) : validateLabel(name);
      if (!n) throw appError('invalid_name');
    }
    let t = cur.topic;
    if (topic !== undefined) { const r = validateTopic(topic); if (!r.ok) throw appError('invalid'); t = r.value; }
    let cat = cur.categoryId;
    if (categoryId !== undefined) { if (categoryId !== null && !isUuid(categoryId)) throw appError('invalid'); cat = categoryId ? categoryId.toLowerCase() : null; }
    let p = cur.position;
    if (position !== undefined) { if (!Number.isInteger(position) || position < 0 || position > 1000) throw appError('invalid'); p = position; }
    // p_category null mantém a categoria; tirar da categoria é p_clear_category=true. Tópico vazio → '' (limpa).
    await rest.rpc('update_channel', {
      p_id: cid, p_name: n, p_topic: t === null ? '' : t, p_category: cat, p_position: p, p_clear_category: cat === null,
    });
    await reloadSelected();
  }

  async function deleteChannel(channelId) {
    if (!isUuid(channelId)) throw appError('invalid');
    await rest.rpc('delete_channel', { p_id: channelId.toLowerCase() });
    await reloadSelected();
  }

  // ---------------- Etapa 7: arrastar e soltar (só ADM; o banco confere de novo) ----------------
  function isAdminOf(gid) {
    const s = list.find((x) => x.id === gid);
    return Boolean(s && (s.role === 'owner' || s.role === 'admin'));
  }

  /**
   * Nova ordem das salas (e, opcional, das categorias). Otimista: a tela muda na hora e volta
   * como estava se o banco recusar.
   */
  async function reorderChannels({ serverId, channels, categories = null }) {
    const gid = needServer(serverId);
    if (!details || details.id !== gid) throw appError('invalid_layout');
    if (!isAdminOf(gid)) throw appError('not_admin');
    const chanIds = new Set(details.channels.map((c) => c.id));
    const catIds = new Set(details.categories.map((c) => c.id));
    const seen = new Set();
    const cleanChannels = [];
    for (const c of channels) {
      const id = String(c.id).toLowerCase();
      const cat = c.categoryId === null ? null : String(c.categoryId).toLowerCase();
      if (!chanIds.has(id) || seen.has(id) || (cat !== null && !catIds.has(cat))) throw appError('invalid_layout');
      seen.add(id);
      cleanChannels.push({ id, categoryId: cat, position: c.position });
    }
    let cleanCats = null;
    if (categories) {
      const seenCat = new Set();
      cleanCats = [];
      for (const c of categories) {
        const id = String(c.id).toLowerCase();
        if (!catIds.has(id) || seenCat.has(id)) throw appError('invalid_layout');
        seenCat.add(id);
        cleanCats.push({ id, position: c.position });
      }
    }
    const before = { channels: details.channels.map((c) => ({ ...c })), categories: details.categories.map((c) => ({ ...c })) };
    const byId = new Map(cleanChannels.map((c) => [c.id, c]));
    details.channels = details.channels.map((c) => (byId.has(c.id) ? { ...c, categoryId: byId.get(c.id).categoryId, position: byId.get(c.id).position } : c));
    if (cleanCats) {
      const catById = new Map(cleanCats.map((c) => [c.id, c]));
      details.categories = details.categories.map((c) => (catById.has(c.id) ? { ...c, position: catById.get(c.id).position } : c))
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    }
    emit();
    const gen = generation;
    try {
      await rest.rpc('reorder_channels', { p_group: gid, p_channels: cleanChannels, p_categories: cleanCats });
    } catch (err) {
      if (gen === generation && details && details.id === gid) {
        details.channels = before.channels;
        details.categories = before.categories;
        emit();
      }
      if (err && err.code === 'needs_migration') throw appError('needs_migration_0007');
      throw err;
    }
  }

  /** Move alguém para outra sala de voz do mesmo servidor (o banco avisa a pessoa no tópico me:). */
  async function moveVoiceMember({ serverId, userId, channelId }) {
    const gid = needServer(serverId);
    const uid = needUser(userId);
    if (!isUuid(channelId)) throw appError('invalid_channel');
    const cid = channelId.toLowerCase();
    if (!isAdminOf(gid)) throw appError('not_admin');
    if (details && details.id === gid) {
      const ch = details.channels.find((c) => c.id === cid);
      if (!ch || ch.kind !== 'voice') throw appError('invalid_channel');
    }
    try {
      await rest.rpc('move_voice_member', { p_group: gid, p_user: uid, p_channel: cid });
    } catch (err) {
      if (err && err.code === 'needs_migration') throw appError('needs_migration_0007');
      throw err;
    }
  }

  // ---------------- View ----------------
  function getList() {
    return list.map(({ photo, ...s }) => ({ ...s, iconUrl: iconUrl(s.iconPath, photo) }));
  }

  function getSelected() {
    if (!selectedId) return null;
    const s = list.find((x) => x.id === selectedId);
    if (!s) return null;
    return {
      id: s.id, name: s.name, iconColor: s.iconColor, iconUrl: iconUrl(s.iconPath, s.photo), role: s.role, ownerId: s.ownerId,
      loaded: Boolean(details && details.id === s.id),
      categories: details ? details.categories.map((c) => ({ ...c })) : [],
      channels: details ? details.channels.map((c) => ({ ...c })) : [],
      members: details ? details.members.map((m) => ({ ...m, mmr: m.mmr ? { ...m.mmr } : null })) : [],
    };
  }

  /** Primeiro canal de texto (categorias em ordem, depois canais sem categoria no topo como no Discord). */
  function defaultTextChannel() {
    if (!details) return null;
    const order = sortedChannels(details).filter((c) => c.kind === 'text');
    return order.length ? order[0].id : null;
  }

  function sortedChannels(d) {
    const catPos = new Map(d.categories.map((c) => [c.id, c.position]));
    return d.channels.slice().sort((a, b) => {
      const ca = a.categoryId ? catPos.get(a.categoryId) ?? 0 : -1;
      const cb = b.categoryId ? catPos.get(b.categoryId) ?? 0 : -1;
      if (ca !== cb) return ca - cb;
      if (a.kind !== b.kind && !a.categoryId && !b.categoryId) return a.kind === 'text' ? -1 : 1;
      return a.position - b.position || a.name.localeCompare(b.name);
    });
  }

  function findChannel(channelId) {
    return details ? details.channels.find((c) => c.id === channelId) || null : null;
  }

  function memberIds() {
    return details ? details.members.map((m) => m.id) : [];
  }

  function clear() {
    generation++;
    list = [];
    details = null;
    selectedId = null;
    meId = null;
  }

  return {
    refreshList, select, reloadSelected, create, previewInvite, join, leave, remove, update, uploadIcon,
    createInvite, listInvites, revokeInvite, setMemberRole, transferOwnership, kickMember, banMember, unbanMember,
    listBans, setNickname, createCategory, updateCategory, deleteCategory, createChannel, updateChannel, deleteChannel,
    reorderChannels, moveVoiceMember, getList, getSelected, defaultTextChannel, findChannel, serverOfChannel, memberIds, clear,
    getSelectedId: () => selectedId, has: (id) => list.some((s) => s.id === id), getMeId: () => meId,
  };
}

module.exports = {
  createServersService, validateServerName, normalizeTextChannelName, validateLabel, MAX_AGES, MAX_USES,
};
