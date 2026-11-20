'use strict';

const STEAM_ID64_BASE = 76561197960265728n;
const MAX_ID32 = 4294967295n;
const MAX_INPUT_LENGTH = 200;

const fail = (error) => ({ ok: false, error });

function fromNumeric(digits) {
  let n;
  try {
    n = BigInt(digits);
  } catch {
    return fail('Não foi possível ler esse número de conta.');
  }
  if (n >= STEAM_ID64_BASE) n -= STEAM_ID64_BASE;
  if (n < 1n || n > MAX_ID32) {
    return fail('Esse número de conta está fora do intervalo válido.');
  }
  return { ok: true, accountId: Number(n) };
}

function parseAccountId(input) {
  if (typeof input !== 'string') return fail('Informe o ID da conta como texto.');
  if (input.length > MAX_INPUT_LENGTH) return fail('Texto muito longo (máximo de 200 caracteres).');
  const text = input.trim();
  if (text === '') return fail('Informe o ID da sua conta ou o link do seu perfil.');

  if (/^\d+$/.test(text)) return fromNumeric(text);

  const m = /^(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+)\/(.*)$/i.exec(text);
  if (!m) {
    return fail('Não reconheci esse formato. Use o número da conta (ID de amigo ou SteamID64) ou o link do perfil.');
  }
  const host = m[1].toLowerCase();
  const path = m[2];

  if (host === 'steamcommunity.com') {
    if (/^id\/[^/?#]*/i.test(path)) {
      return fail('Links com apelido (steamcommunity.com/id/...) não servem. Abra seu perfil na Steam e use o link com números (steamcommunity.com/profiles/...), ou use o ID numérico da conta.');
    }
    const p = /^profiles\/(\d+)(?:[/?#].*)?$/i.exec(path);
    if (p) return fromNumeric(p[1]);
    return fail('Link da Steam não reconhecido. Use steamcommunity.com/profiles/<número>.');
  }

  if (host === 'opendota.com' || host === 'dotabuff.com' || host === 'stratz.com') {
    const p = /^players\/(\d+)(?:[/?#].*)?$/i.exec(path);
    if (p) return fromNumeric(p[1]);
    return fail('Link não reconhecido. Use o link do perfil do jogador (…/players/<número>).');
  }

  return fail('Site não suportado. Use um link da Steam, OpenDota, Dotabuff ou Stratz, ou o número da conta.');
}

module.exports = { parseAccountId };
