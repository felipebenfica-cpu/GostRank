'use strict';

// Validação da URL/chave do Supabase, sem Node (usada também na versão web).

const HOST_RE = /^[a-z0-9][a-z0-9-]*\.supabase\.co$/;
const KEY_RE = /^[A-Za-z0-9._-]{8,2000}$/;

/** Devolve a origem normalizada (sem barra final) ou null se não for https://*.supabase.co. */
function normalizeSupabaseUrl(value) {
  if (typeof value !== 'string' || value.length > 200) return null;
  let u;
  try { u = new URL(value.trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password || u.port || u.search || u.hash) return null;
  // Aceita a URL colada com caminho (ex.: .../rest/v1/); só a origem é usada.
  if (!HOST_RE.test(u.hostname)) return null;
  return `https://${u.hostname}`;
}

function isValidAnonKey(k) {
  return typeof k === 'string' && KEY_RE.test(k);
}

module.exports = { normalizeSupabaseUrl, isValidAnonKey };
