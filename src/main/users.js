'use strict';

// Etapa 6: cache de usuários (UserLite) para a view: autores, amigos, membros, DMs.

const { isUuid } = require('./rest');
const { validPhoto } = require('../core/socialPhoto');

const PROFILE_COLS = 'id,username,display_name,avatar_color,avatar_path,about,custom_status,status';
const USERNAME_RE = /^[a-z0-9_.]{2,32}$/;
const CHUNK = 80;

function cleanText(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  return s.length > 0 ? s.slice(0, max) : null;
}

/** Foto antiga (0003_social): só data: URL JPEG válida; senão null. */
function legacyPhoto(v) {
  return typeof v === 'string' && v.length > 0 && validPhoto(v) ? v : null;
}

// Bancos sem a coluna `photo` (não rodaram 0003_social nem 0006): lembra e pede sem ela.
const photoColumn = new WeakMap(); // rest -> false quando a coluna não existe

/**
 * SELECT com a coluna `photo` quando ela existir. `build(cols)` monta o caminho com as colunas.
 * Se o banco recusar por coluna inexistente (needs_migration), tenta de novo sem `photo`.
 */
async function selectWithPhoto(rest, build, cols) {
  if (rest && typeof rest === 'object' && photoColumn.get(rest) !== false) {
    try {
      return await rest.select(build(`${cols},photo`));
    } catch (err) {
      if (!err || err.code !== 'needs_migration') throw err;
      // Só lembra "sem photo" se o pedido sem ela funcionar (senão falta outra coisa, ex.: 0006 inteira).
      const rows = await rest.select(build(cols));
      photoColumn.set(rest, false);
      return rows;
    }
  }
  return rest.select(build(cols));
}

function createUserCache({ rest } = {}) {
  const users = new Map(); // id -> {id, username, displayName, avatarColor, avatarUrl, about, customStatus, status}

  function fromRow(row) {
    if (!row || !isUuid(row.id)) return null;
    const id = row.id.toLowerCase();
    const username = typeof row.username === 'string' && USERNAME_RE.test(row.username) ? row.username : null;
    const displayName = (cleanText(row.display_name, 32) || username || 'fantasma').replace(/[<>]/g, '');
    const color = Number.isInteger(row.avatar_color) && row.avatar_color >= 0 && row.avatar_color <= 7
      ? row.avatar_color : (parseInt(id.slice(0, 2), 16) % 8);
    const avatarUrl = (typeof row.avatar_path === 'string' && rest ? rest.publicUrl('avatars', row.avatar_path) : null)
      || legacyPhoto(row.photo);
    const status = ['online', 'idle', 'dnd', 'invisible'].includes(row.status) ? row.status : 'online';
    return {
      id,
      username: username || `user_${id.slice(0, 6)}`,
      displayName,
      avatarColor: color,
      avatarUrl,
      avatarPath: typeof row.avatar_path === 'string' ? row.avatar_path : null,
      about: cleanText(row.about, 190),
      customStatus: cleanText(row.custom_status, 128),
      status,
    };
  }

  function upsertRows(rows) {
    const out = [];
    for (const r of Array.isArray(rows) ? rows : []) {
      const u = fromRow(r);
      if (u) {
        users.set(u.id, u);
        out.push(u);
      }
    }
    return out;
  }

  /** Busca perfis que ainda não estão no cache (falha silenciosa: a tela mostra "fantasma"). */
  async function ensure(ids, { force = false } = {}) {
    const want = [...new Set((ids || []).filter(isUuid).map((s) => s.toLowerCase()))]
      .filter((id) => force || !users.has(id));
    for (let i = 0; i < want.length; i += CHUNK) {
      const part = want.slice(i, i + CHUNK);
      try {
        const rows = await selectWithPhoto(rest, (cols) => `/rest/v1/profiles?select=${cols}&id=in.(${part.join(',')})`, PROFILE_COLS);
        upsertRows(rows);
      } catch { /* sem perfil: placeholder */ }
    }
  }

  function get(id) {
    return users.get(id) || null;
  }

  function lite(id) {
    const u = users.get(id);
    if (!u) {
      return { id, username: `user_${String(id).slice(0, 6)}`, displayName: 'fantasma', avatarColor: parseInt(String(id).slice(0, 2), 16) % 8 || 0, avatarUrl: null };
    }
    return { id: u.id, username: u.username, displayName: u.displayName, avatarColor: u.avatarColor, avatarUrl: u.avatarUrl };
  }

  /** Mapa para view.users (só ids pedidos). */
  function viewMap(ids) {
    const out = {};
    for (const id of ids) {
      if (!id || out[id]) continue;
      const u = users.get(id);
      out[id] = { ...lite(id), customStatus: u ? u.customStatus : null };
    }
    return out;
  }

  function findByUsername(name) {
    for (const u of users.values()) if (u.username === name) return u;
    return null;
  }

  function clear() { users.clear(); }

  return { upsertRows, ensure, get, lite, viewMap, findByUsername, clear, fromRow };
}

module.exports = { createUserCache, PROFILE_COLS, USERNAME_RE, selectWithPhoto, legacyPhoto };
