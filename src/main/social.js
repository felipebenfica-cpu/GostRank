'use strict';

// Etapa 6: amigos, busca de pessoas, DMs, meu perfil (nome de usuário, sobre mim, status, avatar).
// Etapa 7 (LUMENEX): avatar e banner até 40 MB (upload resumível com progresso), animados, recorte,
// moldura, efeito do perfil e tema salvo na conta.

const { appError, isUuid } = require('./rest');
const { USERNAME_RE, selectProfiles, cleanCrop, FRAMES, EFFECTS, THEMES } = require('./users');
const { validateUpload } = require('./files');

const RELATIONS = Object.freeze(['friend', 'pending_in', 'pending_out', 'blocked']);
const STATUSES = Object.freeze(['online', 'idle', 'dnd', 'invisible']);
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const MAX_DMS = 100;
const MEDIA_KINDS = Object.freeze(['avatar', 'banner']);
const PROGRESS_STEP = 0.02; // atualiza a tela a cada 2% (não a cada bloco de bytes)

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

/** Banco sem a 0007 → mensagem própria (o resto do app continua). */
function rethrow0007(err) {
  if (err && err.code === 'needs_migration') throw appError('needs_migration_0007');
  throw err;
}

function createSocialService({ rest, users, onChange = () => {} } = {}) {
  let meId = null;
  const uploads = { avatar: null, banner: null };
  let relationships = []; // {id, relation, since}
  let dms = []; // {id, userId, lastMessageAt}
  let generation = 0;

  function emit() { try { onChange(); } catch { /* ignora */ } }

  async function loadMe() {
    const { id } = await rest.identity();
    meId = id;
    const rows = await selectProfiles(rest, (cols) => `/rest/v1/profiles?select=${cols}&id=eq.${id}`);
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
    // Pedido enviado e bloqueado não liberam o perfil completo: nome/@/cor/foto vêm da RPC básica.
    const missing = list.filter((x) => !users.get(x.id)).map((x) => x.id);
    if (missing.length) {
      try {
        const basic = await rest.rpc('relationship_people', {});
        users.upsertRows((Array.isArray(basic) ? basic : []).filter((r) => r && missing.includes(String(r.id).toLowerCase())));
      } catch { /* banco sem a RPC: a tela mostra "Desconhecido" */ }
    }
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

  /** Carrega tudo. Erros de "falta a 0006" sobem para quem chamou decidir o modo antigo. */
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

  function setUpload(kind, next) {
    const prev = uploads[kind];
    uploads[kind] = next;
    if (!prev || !next || prev.status !== next.status || Math.abs((next.progress || 0) - (prev.progress || 0)) >= PROGRESS_STEP || next.progress === 1) emit();
  }

  /** Recarrega meu perfil (depois de mudar aparência/imagens). */
  async function reloadMe() {
    try { await loadMe(); } catch { await users.ensure([meId], { force: true }); }
    emit();
  }

  /**
   * Avatar ou banner (Etapa 7): valida bytes reais (até 40 MB), sobe a miniatura WebP e o original
   * com upload resumível (progresso em view.uploads), grava com set_profile_media e apaga os antigos.
   */
  async function uploadMedia(kind, input) {
    if (!MEDIA_KINDS.includes(kind)) throw appError('invalid');
    if (uploads[kind] && (uploads[kind].status === 'uploading' || uploads[kind].status === 'processing')) throw appError('rate_limited');
    let f;
    let thumb;
    try {
      f = validateUpload(input, 'profile');
      thumb = validateUpload({ name: 'thumb.webp', mime: input.thumb && input.thumb.mime, data: input.thumb && input.thumb.data }, 'thumb');
    } catch (err) {
      setUpload(kind, { status: 'error', progress: 0, error: err.message || 'Imagem inválida.' });
      throw err;
    }
    if (!meId) await loadMe();
    const cur = users.get(meId);
    const oldMain = cur ? (kind === 'avatar' ? cur.avatarPath : cur.bannerPath) : null;
    const oldThumb = cur ? (kind === 'avatar' ? cur.avatarThumbPath : cur.bannerThumbPath) : null;
    const id = uuid();
    const mainPath = `${meId}/${kind}/${id}.${f.ext}`;
    const thumbPath = `${meId}/${kind}/${id}.thumb.webp`;
    const uploaded = [];
    setUpload(kind, { status: 'uploading', progress: 0, error: null });
    try {
      await rest.upload('avatars', thumbPath, thumb.bytes, 'image/webp');
      uploaded.push(thumbPath);
      await rest.uploadResumable('avatars', mainPath, f.bytes, f.mime, {
        onProgress: (p) => setUpload(kind, { status: 'uploading', progress: Math.min(0.99, p), error: null }),
      });
      uploaded.push(mainPath);
      setUpload(kind, { status: 'processing', progress: 1, error: null });
      try {
        await rest.rpc('set_profile_media', { p_kind: kind, p_path: mainPath, p_thumb_path: thumbPath, p_animated: f.animated === true });
      } catch (err) {
        // Banco só com a 0006: avatar até 2 MB ainda vai pelo caminho antigo; banner precisa da 0007.
        if (err && err.code === 'needs_migration' && kind === 'avatar' && f.size <= 2 * 1024 * 1024) {
          await patchMe({ avatar_path: mainPath });
        } else {
          rethrow0007(err);
        }
      }
    } catch (err) {
      if (uploaded.length) rest.removeObjects('avatars', uploaded).catch(() => {});
      // 413 com arquivo ≤ 40 MB: o bucket ainda tem o limite antigo (sem a 0007).
      const e = err && (err.code === 'attachment_too_big' || err.code === 'avatar_too_big') ? appError('media_needs_0007') : err;
      setUpload(kind, { status: 'error', progress: 0, error: e && e.name === 'UserInputError' ? e.message : appError('upload_failed').message });
      throw e && e.name === 'UserInputError' ? e : appError('upload_failed');
    }
    const stale = [oldMain, oldThumb].filter((p) => p && p.startsWith(`${meId}/`) && p !== mainPath && p !== thumbPath);
    if (stale.length) rest.removeObjects('avatars', stale).catch(() => {});
    setUpload(kind, { status: 'done', progress: 1, error: null });
    await reloadMe();
  }

  async function removeMedia(kind) {
    if (!MEDIA_KINDS.includes(kind)) throw appError('invalid');
    if (!meId) await loadMe();
    const cur = users.get(meId);
    const main = cur ? (kind === 'avatar' ? cur.avatarPath : cur.bannerPath) : null;
    const thumb = cur ? (kind === 'avatar' ? cur.avatarThumbPath : cur.bannerThumbPath) : null;
    try {
      await rest.rpc('set_profile_media', { p_kind: kind, p_path: null, p_thumb_path: null, p_animated: false });
    } catch (err) {
      if (err && err.code === 'needs_migration' && kind === 'avatar') await patchMe({ avatar_path: null });
      else rethrow0007(err);
    }
    const stale = [main, thumb].filter((p) => p && p.startsWith(`${meId}/`));
    if (stale.length) rest.removeObjects('avatars', stale).catch(() => {});
    uploads[kind] = null;
    await reloadMe();
  }

  const uploadAvatar = (input) => uploadMedia('avatar', input);
  const uploadBanner = (input) => uploadMedia('banner', input);
  const removeAvatar = () => removeMedia('avatar');
  const removeBanner = () => removeMedia('banner');

  /** Moldura, efeito, recorte e posição do banner (campos ausentes ficam como estão). */
  async function updateLook(patch) {
    if (!patch || typeof patch !== 'object') throw appError('invalid_look');
    if (!meId) await loadMe();
    const cur = users.get(meId) || {};
    let frame = cur.frame ?? null;
    let effect = cur.effect ?? null;
    let crop = cur.avatarCrop ?? null;
    let pos = Number.isInteger(cur.bannerPos) ? cur.bannerPos : 50;
    if (patch.frame !== undefined) { if (patch.frame !== null && !FRAMES.includes(patch.frame)) throw appError('invalid_look'); frame = patch.frame; }
    if (patch.effect !== undefined) { if (patch.effect !== null && !EFFECTS.includes(patch.effect)) throw appError('invalid_look'); effect = patch.effect; }
    if (patch.avatarCrop !== undefined) {
      if (patch.avatarCrop === null) crop = null;
      else { crop = cleanCrop(patch.avatarCrop); if (!crop) throw appError('invalid_look'); }
    }
    if (patch.bannerPos !== undefined) {
      if (!Number.isInteger(patch.bannerPos) || patch.bannerPos < 0 || patch.bannerPos > 100) throw appError('invalid_look');
      pos = patch.bannerPos;
    }
    try {
      await rest.rpc('update_profile_look', { p_frame: frame, p_effect: effect, p_avatar_crop: crop, p_banner_pos: pos });
    } catch (err) { rethrow0007(err); }
    await reloadMe();
  }

  async function resetLook() {
    try { await rest.rpc('reset_profile_look', {}); } catch (err) { rethrow0007(err); }
    await reloadMe();
  }

  /** Tema salvo na conta (falha calada: o tema local continua valendo). */
  async function saveTheme(theme) {
    if (!THEMES.includes(theme)) throw appError('invalid');
    try {
      await rest.rpc('set_appearance_theme', { p_theme: theme });
      const u = meId ? users.get(meId) : null;
      if (u) u.appearanceTheme = theme;
      return true;
    } catch { return false; }
  }

  function getUploads() {
    return {
      avatar: uploads.avatar ? { ...uploads.avatar } : null,
      banner: uploads.banner ? { ...uploads.banner } : null,
    };
  }

  function getMe() {
    if (!meId) return null;
    const u = users.get(meId);
    if (!u) return null;
    return { ...users.lite(meId), about: u.about, customStatus: u.customStatus, status: u.status, appearanceTheme: u.appearanceTheme || null };
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
    uploads.avatar = null;
    uploads.banner = null;
    relationships = [];
    dms = [];
  }

  return {
    refresh, refreshRelationships, refreshDms, searchUsers, sendFriendRequest, acceptFriend, declineFriend,
    removeFriend, blockUser, unblockUser, openDm, setStatus, setCustomStatus, updateProfile, uploadAvatar,
    removeAvatar, uploadBanner, removeBanner, updateLook, resetLook, saveTheme, getUploads, getMe, getFriendsView, getDms, relationOf, friendIds, touchDm, clear,
    getMeId: () => meId,
  };
}

module.exports = { createSocialService, normalizeUsername, validateDisplayName };
