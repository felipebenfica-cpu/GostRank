'use strict';

// Etapa 6: cliente REST do Supabase (PostgREST, RPC, Storage) usado pelos módulos novos
// (social, servidores, mensagens). Independente de Electron: roda também no navegador (versão web).
// Regras: fetch injetável, timeout, redirect:'error', identidade sempre do token, erros sempre em
// português (UserInputError com `code`), nunca texto vindo do servidor na tela.

const { normalizeSupabaseUrl, isValidAnonKey } = require('./supabase-url');
const { userIdFromToken } = require('./auth');
const { UserInputError } = require('./controller');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_CHARS = 2 * 1024 * 1024;

const MESSAGES = Object.freeze({
  // Social
  user_not_found: 'Não encontramos ninguém com esse nome de usuário. Confira se está escrito certinho.',
  cannot_add_self: 'Você não pode adicionar a si mesmo.',
  already_friends: 'Vocês já são amigos.',
  request_exists: 'Já existe um pedido de amizade pendente com essa pessoa.',
  blocked: 'Não é possível fazer isso com essa pessoa.',
  dm_not_allowed: 'Você só pode mandar mensagem para amigos ou pessoas dos seus servidores.',
  username_taken: 'Esse nome de usuário já está em uso. Escolha outro.',
  invalid_username: 'O nome de usuário deve ter de 2 a 32 caracteres: letras minúsculas, números, _ e ponto.',
  invalid_display_name: 'O nome de exibição deve ter de 1 a 32 caracteres, sem < ou >.',
  invalid_about: 'O "sobre mim" pode ter no máximo 190 caracteres.',
  invalid_status: 'Status inválido.',
  invalid_custom_status: 'O status personalizado pode ter no máximo 128 caracteres.',
  invalid_query: 'Digite pelo menos 2 caracteres para buscar.',
  // Servidores
  too_many_servers: 'Você chegou ao limite de 50 servidores. Saia de algum para entrar em outro.',
  banned: 'Você foi banido desse servidor.',
  group_full: 'Esse servidor está cheio (máximo de 100 pessoas).',
  invalid_invite: 'Esse convite não vale: o código está errado, expirou ou atingiu o limite de usos.',
  not_member: 'Você não faz parte desse servidor.',
  not_in_group: 'Você não está em um servidor.',
  not_owner: 'Só o dono do servidor pode fazer isso.',
  not_admin: 'Só administradores podem fazer isso.',
  invalid_user: 'Pessoa inválida.',
  invalid_name: 'Nome inválido: use de 1 a 32 caracteres, sem < ou >.',
  cannot_target: 'Você não pode fazer isso com essa pessoa.',
  last_text_channel: 'O servidor precisa ter pelo menos um canal de texto.',
  already_in_group: 'Você já está nesse servidor.',
  // Mensagens
  empty_body: 'Escreva uma mensagem.',
  long_body: 'A mensagem pode ter no máximo 2000 caracteres.',
  invalid_body: 'A mensagem tem caracteres não permitidos.',
  too_many_attachments: 'Envie no máximo 4 anexos por mensagem.',
  attachment_too_big: 'Cada anexo pode ter no máximo 8 MB.',
  avatar_too_big: 'A imagem pode ter no máximo 2 MB.',
  invalid_file: 'Tipo de arquivo não permitido.',
  too_many_pins: 'Este canal já tem 50 mensagens fixadas. Desafixe alguma antes.',
  too_many_reactions: 'Essa mensagem já tem reações demais.',
  no_target: 'Abra um canal de texto ou uma conversa primeiro.',
  message_not_found: 'Essa mensagem não existe mais.',
  upload_failed: 'Não foi possível enviar o arquivo. Tente novamente.',
  invalid_attachment: 'Anexo inválido. Tente enviar o arquivo de novo.',
  invalid_channel: 'Esse canal não existe mais ou não aceita mensagens.',
  invalid_message: 'Essa mensagem não existe mais.',
  invalid_avatar: 'Imagem de perfil inválida.',
  invalid_options: 'Opção inválida.',
  too_many_channels: 'Esse servidor chegou ao limite de canais.',
  // Etapa 7 (LUMENEX): personalização do perfil, salas
  profile_too_big: 'A imagem passa de 40 MB. Escolha um arquivo de até 40 MB.',
  invalid_profile_image: 'Formato não aceito. Use JPG, PNG, GIF ou WebP.',
  invalid_thumb: 'Não foi possível preparar a miniatura da imagem. Tente de novo.',
  invalid_look: 'Opção de personalização inválida.',
  invalid_layout: 'Não foi possível salvar a nova ordem das salas. Tente de novo.',
  invalid_path: 'Caminho de arquivo inválido.',
  invalid_media: 'Não foi possível salvar a imagem. Tente enviar de novo.',
  upload_interrupted: 'A conexão caiu durante o envio. Verifique a internet e tente de novo.',
  needs_migration_0007: 'Atualize o banco (0007): rode o 0007_lumenex.sql no Supabase para usar esta função.',
  media_needs_0007: 'Atualize o banco (0007) para enviar imagens de até 40 MB e banners: rode o 0007_lumenex.sql no Supabase.',
  // Gerais
  needs_migration: 'Atualize o banco (0006): esta função ainda não existe no servidor. Rode o 0006_discord.sql no Supabase.',
  rate_limited: 'Muitas tentativas em pouco tempo. Aguarde alguns segundos e tente de novo.',
  unauthenticated: 'Sua sessão expirou. Entre novamente.',
  forbidden: 'Você não tem permissão para isso.',
  network: 'Sem conexão com o servidor. Verifique sua internet.',
  timeout: 'O servidor demorou demais para responder. Tente novamente.',
  bad_response: 'O servidor enviou uma resposta inesperada. Tente novamente.',
  unconfigured: 'Contas indisponíveis neste computador.',
  signed_out: 'Entre na sua conta primeiro.',
  invalid: 'Dados inválidos.',
});

/** Erro seguro para a tela, com `code` para log. */
function appError(code) {
  const key = Object.prototype.hasOwnProperty.call(MESSAGES, code) ? code : 'bad_response';
  const err = new UserInputError(MESSAGES[key]);
  err.code = key;
  return err;
}

function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

/** PostgREST: função/tabela/coluna inexistente → o banco ainda não tem a migração 0006. */
function isMissingSchema(status, data) {
  const c = data && typeof data === 'object' && typeof data.code === 'string' ? data.code : '';
  if (['PGRST202', 'PGRST205', 'PGRST204', '42883', '42P01', '42703', 'PGRST200'].includes(c)) return true;
  return status === 404 && c === '';
}

/** Converte resposta de erro em código conhecido (sem usar o texto do servidor na tela). */
function errorCodeFrom(status, data) {
  if (isMissingSchema(status, data)) return 'needs_migration';
  const msg = data && typeof data === 'object' && typeof data.message === 'string' ? data.message.trim() : '';
  if (/^[a-z_]{2,40}$/.test(msg) && Object.prototype.hasOwnProperty.call(MESSAGES, msg)) return msg;
  const c = data && typeof data === 'object' && typeof data.code === 'string' ? data.code : '';
  if (c === '23505') return /username/i.test(JSON.stringify(data)) ? 'username_taken' : 'request_exists';
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 413) return 'attachment_too_big';
  if (status === 429) return 'rate_limited';
  return 'bad_response';
}

function encodePath(p) {
  return String(p).split('/').map((s) => encodeURIComponent(s)).join('/');
}

const TUS_CHUNK = 6 * 1024 * 1024; // o Supabase exige blocos de 6 MB (menos o último)

function base64Utf8(text) {
  const bytes = new TextEncoder().encode(String(text));
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function createRest({
  fetchImpl, supabaseUrl, anonKey, getAccessToken, timeoutMs = 10000, uploadTimeoutMs = 120000, retryDelayMs = 700,
} = {}) {
  const base = normalizeSupabaseUrl(supabaseUrl);
  const fetchFn = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!base || !isValidAnonKey(anonKey) || typeof fetchFn !== 'function') throw appError('unconfigured');

  async function identity() {
    let token = null;
    try { token = typeof getAccessToken === 'function' ? await getAccessToken() : null; } catch { token = null; }
    const id = userIdFromToken(token);
    if (!token || !id) throw appError('unauthenticated');
    return { token, id };
  }

  /** Requisição com timeout. `json` vira corpo JSON; `bytes` vai cru com `contentType`. */
  async function request(pathAndQuery, { method = 'GET', token = null, json, bytes, contentType, headers = {}, timeout = timeoutMs } = {}) {
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeout);
    try {
      const h = { apikey: anonKey, Authorization: `Bearer ${token || anonKey}`, Accept: 'application/json', ...headers };
      const init = { method, headers: h, signal: ctrl.signal, redirect: 'error' };
      if (json !== undefined) {
        h['Content-Type'] = 'application/json';
        init.body = JSON.stringify(json);
      } else if (bytes !== undefined) {
        h['Content-Type'] = contentType || 'application/octet-stream';
        init.body = bytes;
      }
      const res = await fetchFn(base + pathAndQuery, init);
      const text = await res.text();
      if (typeof text !== 'string' || text.length > MAX_BODY_CHARS) throw appError('bad_response');
      let data = null;
      if (text.length > 0) { try { data = JSON.parse(text); } catch { data = null; } }
      return { status: res.status, data };
    } catch (err) {
      if (err && err.name === 'UserInputError') throw err;
      throw appError(timedOut || (err && err.name === 'AbortError') ? 'timeout' : 'network');
    } finally {
      clearTimeout(timer);
    }
  }

  const okStatus = (s) => s >= 200 && s < 300;

  async function authed(pathAndQuery, opts = {}) {
    const { token } = await identity();
    const r = await request(pathAndQuery, { ...opts, token });
    if (!okStatus(r.status)) throw appError(errorCodeFrom(r.status, r.data));
    return r.data;
  }

  async function rpc(name, args = {}) {
    if (!/^[a-z_]{2,40}$/.test(name)) throw appError('invalid');
    return authed(`/rest/v1/rpc/${name}`, { method: 'POST', json: args });
  }

  async function select(pathAndQuery) {
    const data = await authed(pathAndQuery);
    if (!Array.isArray(data)) throw appError('bad_response');
    return data;
  }

  async function insert(table, body, { returning = '' } = {}) {
    const q = returning ? `?select=${returning}` : '';
    const data = await authed(`/rest/v1/${table}${q}`, {
      method: 'POST', json: body, headers: { Prefer: returning ? 'return=representation' : 'return=minimal' },
    });
    return Array.isArray(data) ? data[0] ?? null : data;
  }

  async function update(pathAndQuery, body, { returning = false } = {}) {
    const data = await authed(pathAndQuery, {
      method: 'PATCH', json: body, headers: { Prefer: returning ? 'return=representation' : 'return=minimal' },
    });
    return Array.isArray(data) ? data : [];
  }

  async function remove(pathAndQuery) {
    await authed(pathAndQuery, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    return true;
  }

  async function upload(bucket, objectPath, bytes, mime) {
    const { token } = await identity();
    const r = await request(`/storage/v1/object/${bucket}/${encodePath(objectPath)}`, {
      method: 'POST', token, bytes, contentType: mime, headers: { 'x-upsert': 'false', 'cache-control': '3600' }, timeout: uploadTimeoutMs,
    });
    if (!okStatus(r.status)) {
      const code = errorCodeFrom(r.status, r.data);
      throw appError(code === 'bad_response' || code === 'needs_migration' ? 'upload_failed' : code);
    }
    return objectPath;
  }

  /** Requisição crua com cabeçalhos de resposta (TUS precisa de Location e Upload-Offset). */
  async function rawRequest(url, { method, headers, body, timeout = timeoutMs }) {
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeout);
    try {
      const res = await fetchFn(url, { method, headers, body, signal: ctrl.signal, redirect: 'error' });
      let text = '';
      try { text = await res.text(); } catch { text = ''; }
      let data = null;
      if (typeof text === 'string' && text.length > 0 && text.length <= MAX_BODY_CHARS) { try { data = JSON.parse(text); } catch { data = null; } }
      const get = (name) => (res.headers && typeof res.headers.get === 'function' ? res.headers.get(name) : null);
      return { status: res.status, data, header: get };
    } catch (err) {
      if (err && err.name === 'UserInputError') throw err;
      throw appError(timedOut || (err && err.name === 'AbortError') ? 'timeout' : 'network');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Upload resumível (TUS) do Storage: blocos de 6 MB, progresso por bloco (`onProgress(0..1)`) e até
   * `retries` novas tentativas por bloco (retoma do offset que o servidor confirmou). Etapa 7.
   */
  async function uploadResumable(bucket, objectPath, bytes, mime, { onProgress = null, retries = 3, chunkSize = TUS_CHUNK } = {}) {
    const { token } = await identity();
    const total = bytes.length;
    const report = (n) => { try { if (onProgress) onProgress(total ? Math.min(1, n / total) : 1); } catch { /* ignora */ } };
    const common = { apikey: anonKey, Authorization: `Bearer ${token}`, 'Tus-Resumable': '1.0.0' };
    const metadata = [['bucketName', bucket], ['objectName', objectPath], ['contentType', mime], ['cacheControl', '3600']]
      .map(([k, v]) => `${k} ${base64Utf8(v)}`).join(',');
    const created = await rawRequest(`${base}/storage/v1/upload/resumable`, {
      method: 'POST',
      headers: { ...common, 'Upload-Length': String(total), 'Upload-Metadata': metadata, 'x-upsert': 'false' },
    });
    if (created.status !== 201) {
      const code = errorCodeFrom(created.status, created.data);
      throw appError(code === 'bad_response' || code === 'needs_migration' ? 'upload_failed' : code);
    }
    let loc = created.header('location') || created.header('Location') || '';
    if (loc.startsWith('/')) loc = base + loc;
    if (!loc.startsWith(`${base}/storage/v1/upload/resumable/`) || loc.length > 2048) throw appError('upload_failed');

    async function serverOffset() {
      const r = await rawRequest(loc, { method: 'HEAD', headers: { ...common } });
      const o = Number(r.header('upload-offset'));
      if (r.status >= 200 && r.status < 300 && Number.isSafeInteger(o) && o >= 0 && o <= total) return o;
      throw appError('upload_failed');
    }

    let offset = 0;
    report(0);
    while (offset < total) {
      const end = Math.min(total, offset + chunkSize);
      let failures = 0;
      for (;;) {
        let fatal = null;
        try {
          const r = await rawRequest(loc, {
            method: 'PATCH',
            headers: { ...common, 'Upload-Offset': String(offset), 'Content-Type': 'application/offset+octet-stream' },
            body: bytes.subarray(offset, end),
            timeout: uploadTimeoutMs,
          });
          if (r.status === 204 || r.status === 200) {
            const o = Number(r.header('upload-offset'));
            offset = Number.isSafeInteger(o) && o > offset && o <= total ? o : end;
            break;
          }
          if (r.status === 409) { offset = await serverOffset(); break; } // offset diferente: ressincroniza
          if ([400, 401, 403, 404, 410, 413].includes(r.status)) {
            const code = errorCodeFrom(r.status, r.data);
            fatal = appError(code === 'bad_response' || code === 'needs_migration' ? 'upload_failed' : code);
          } else {
            throw appError('network');
          }
        } catch (err) {
          if (!(err && (err.code === 'network' || err.code === 'timeout' || err.code === 'upload_failed'))) throw err;
        }
        if (fatal) throw fatal;
        failures += 1;
        if (failures > retries) throw appError('upload_interrupted');
        await new Promise((r) => setTimeout(r, retryDelayMs * failures));
        try { offset = await serverOffset(); } catch { /* tenta do mesmo ponto */ }
        if (offset >= end) break;
      }
      report(offset);
    }
    return objectPath;
  }

  async function removeObjects(bucket, paths) {
    if (!paths.length) return true;
    try {
      await authed(`/storage/v1/object/${bucket}`, { method: 'DELETE', json: { prefixes: paths } });
    } catch { /* limpeza é opcional */ }
    return true;
  }

  /** URLs assinadas (bucket privado). Devolve Map caminho → URL absoluta; falhas ficam de fora. */
  async function sign(bucket, paths, expiresIn = 6 * 3600) {
    const out = new Map();
    const list = [...new Set(paths.filter((p) => typeof p === 'string' && p.length > 0 && p.length <= 512))];
    if (list.length === 0) return out;
    let data;
    try {
      data = await authed(`/storage/v1/object/sign/${bucket}`, { method: 'POST', json: { expiresIn, paths: list } });
    } catch { return out; }
    if (!Array.isArray(data)) return out;
    for (const row of data) {
      const rel = row && typeof row.signedURL === 'string' ? row.signedURL : (row && typeof row.signedUrl === 'string' ? row.signedUrl : '');
      if (!row || typeof row.path !== 'string' || !rel || row.error) continue;
      const url = rel.startsWith('http') ? rel : `${base}/storage/v1${rel.startsWith('/') ? '' : '/'}${rel}`;
      if (url.startsWith(base + '/storage/v1/')) out.set(row.path, url);
    }
    return out;
  }

  function publicUrl(bucket, objectPath) {
    if (typeof objectPath !== 'string' || !objectPath || objectPath.length > 512 || objectPath.includes('..')) return null;
    return `${base}/storage/v1/object/public/${bucket}/${encodePath(objectPath)}`;
  }

  /** O banco tem a 0006? true / false / null (sem resposta: tenta de novo depois). */
  async function hasSchemaV3() {
    let r;
    try {
      const { token } = await identity();
      r = await request('/rest/v1/channels?select=id&limit=1', { token });
    } catch { return null; }
    if (okStatus(r.status)) return true;
    if (isMissingSchema(r.status, r.data)) return false;
    return null;
  }

  return {
    base, identity, request, rpc, select, insert, update, remove, upload, uploadResumable, removeObjects, sign, publicUrl, hasSchemaV3,
  };
}

module.exports = { createRest, appError, isUuid, errorCodeFrom, isMissingSchema, MESSAGES, UUID_RE, TUS_CHUNK };
