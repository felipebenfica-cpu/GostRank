'use strict';

const { validPhoto } = require('../core/socialPhoto');
const { createSupabaseRest, isUuid } = require('./group');

const PAGE_SIZE = 12;
const STATES = ['self', 'none', 'incoming', 'outgoing', 'friend'];
const MESSAGES = {
  invalid_message: 'Informe uma mensagem de até 1.000 caracteres.',
  invalid_search: 'Digite de 2 a 64 caracteres para buscar um jogador.',
  invalid_user: 'Essa solicitação não está disponível. Atualize a lista de amigos.',
  invalid_photo: 'Escolha uma foto JPEG de até 64 KiB.',
  invalid_setting: 'Configuração inválida.',
};

function createSocialClient(options) {
  const rest = createSupabaseRest({ ...options, extraMessages: MESSAGES });

  async function people(query, token) {
    let after = null;
    const rows = [];
    do {
      const page = await rest.rpc('social_people', { p_query: query, p_after: after }, token);
      if (!Array.isArray(page) || page.length > PAGE_SIZE) throw rest.errorFor('bad_response');
      for (const row of page) {
        if (!row || !isUuid(row.id) || (query === null && after && row.id <= after)
            || typeof row.name !== 'string' || !validPhoto(row.photo) || !STATES.includes(row.state)) {
          throw rest.errorFor('bad_response');
        }
        rows.push({ id: row.id, name: row.name, photo: row.photo, state: row.state, discoverable: row.discoverable });
        after = row.id;
      }
      if (query !== null || page.length < PAGE_SIZE) return { rows };
    } while (true);
  }

  return async function social(action, value) {
    const { token } = await rest.identity();
    switch (action) {
      case 'dmRead':
      case 'dmSend': {
        if (!value || !isUuid(value.peer)) throw rest.errorFor('invalid_user');
        const before = value.before ?? null;
        if (before !== null && (!Number.isSafeInteger(before) || before < 1)) throw rest.errorFor('invalid_message');
        const body = action === 'dmSend' && typeof value.body === 'string' ? value.body.trim() : null;
        if (action === 'dmSend' && (!body || [...body].length > 1000 || before !== null)) throw rest.errorFor('invalid_message');
        const rows = await rest.rpc('social_dm', { p_peer: value.peer, p_body: body, p_before: before }, token);
        if (!Array.isArray(rows) || rows.length > 50) throw rest.errorFor('bad_response');
        return { rows };
      }
      case 'list':
        return people(null, token);
      case 'search': {
        const query = typeof value === 'string' ? value.trim() : '';
        if ([...query].length < 2 || [...query].length > 64) throw rest.errorFor('invalid_search');
        return people(query, token);
      }
      case 'send':
      case 'accept':
      case 'remove':
        if (!isUuid(value)) throw rest.errorFor('invalid_user');
        await rest.rpc('social_friend', { p_action: action, p_target: value }, token);
        break;
      case 'profilePhoto':
      case 'groupPhoto':
        if (!validPhoto(value)) throw rest.errorFor('invalid_photo');
        await rest.rpc('social_photo', { p_scope: action === 'profilePhoto' ? 'profile' : 'group', p_photo: value }, token);
        break;
      case 'privacy':
        if (typeof value !== 'boolean') throw rest.errorFor('invalid_setting');
        await rest.rpc('social_privacy', { p_discoverable: value }, token);
        break;
      default:
        throw rest.errorFor('invalid_setting');
    }
    return {};
  };
}

module.exports = { createSocialClient, validPhoto };
