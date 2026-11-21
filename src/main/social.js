'use strict';

const { validPhoto } = require('../core/socialPhoto');
const { createSupabaseRest, isUuid } = require('./group');

const PAGE_SIZE = 12;
const STATES = ['self', 'none', 'incoming', 'outgoing', 'friend'];
const MESSAGES = {
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
