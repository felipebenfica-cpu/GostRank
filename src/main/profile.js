'use strict';

const { validateDisplayName, validateVisibility } = require('../core/credentials');
const { AuthError, createRequester, userIdFromToken } = require('./auth');

function createProfileClient({ fetchImpl, supabaseUrl, anonKey, getAccessToken, timeoutMs = 10000 } = {}) {
  const request = createRequester({ fetchImpl, supabaseUrl, anonKey, timeoutMs });

  async function identity() {
    const token = typeof getAccessToken === 'function' ? await getAccessToken() : null;
    const id = userIdFromToken(token);
    if (!token || !id) throw new AuthError('unauthenticated');
    return { token, id };
  }

  function check(status) {
    if (status === 401 || status === 403) throw new AuthError('unauthenticated');
    if (status < 200 || status >= 300) throw new AuthError('bad_response');
  }

  function toProfile(row) {
    if (!row || typeof row !== 'object') throw new AuthError('bad_response');
    const steam = Number(row.steam_account_id);
    return {
      displayName: typeof row.display_name === 'string' ? row.display_name : null,
      mmrVisibility: validateVisibility(row.mmr_visibility).ok ? row.mmr_visibility : 'friends',
      steamAccountId: row.steam_account_id !== null && row.steam_account_id !== undefined
        && Number.isSafeInteger(steam) && steam > 0 ? steam : null,
    };
  }

  async function get() {
    const { token, id } = await identity();
    const { status, data } = await request(
      `/rest/v1/profiles?select=display_name,mmr_visibility,steam_account_id&id=eq.${id}`,
      { token },
    );
    check(status);
    if (!Array.isArray(data) || data.length !== 1) throw new AuthError('bad_response');
    return toProfile(data[0]);
  }

  async function update(patch) {
    if (!patch || typeof patch !== 'object') throw new AuthError('invalid');
    const body = {};
    if (patch.displayName !== undefined) {
      const v = validateDisplayName(patch.displayName);
      if (!v.ok) throw Object.assign(new AuthError('invalid'), { message: v.error });
      body.display_name = v.value;
    }
    if (patch.mmrVisibility !== undefined) {
      const v = validateVisibility(patch.mmrVisibility);
      if (!v.ok) throw Object.assign(new AuthError('invalid'), { message: v.error });
      body.mmr_visibility = v.value;
    }
    if (Object.keys(body).length === 0) throw Object.assign(new AuthError('invalid'), { message: 'Nada para alterar.' });
    const { token, id } = await identity();
    const { status, data } = await request(`/rest/v1/profiles?id=eq.${id}`, {
      method: 'PATCH',
      token,
      body,
      headers: { Prefer: 'return=representation' },
    });
    check(status);
    if (!Array.isArray(data) || data.length !== 1) throw new AuthError('bad_response');
    return toProfile(data[0]);
  }

  async function deleteAccount() {
    const { token } = await identity();
    const { status } = await request('/rest/v1/rpc/delete_my_account', { method: 'POST', token, body: {} });
    check(status);
    return { ok: true };
  }

  return { get, update, deleteAccount };
}

module.exports = { createProfileClient };
