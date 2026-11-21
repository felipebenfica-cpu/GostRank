'use strict';

const ALLOWED_EXTERNAL_HOSTS = Object.freeze([
  'opendota.com',
  'www.opendota.com',
  'steamcommunity.com',
  'docs.opendota.com',
]);

/** Link externo permitido: https, sem credenciais, host na allowlist. */
function isAllowedExternalUrl(value) {
  if (typeof value !== 'string' || value.length > 2000) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== '443') return false;
  return ALLOWED_EXTERNAL_HOSTS.includes(url.hostname.toLowerCase());
}

module.exports = { ALLOWED_EXTERNAL_HOSTS, isAllowedExternalUrl };
