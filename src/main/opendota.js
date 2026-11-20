'use strict';

// Cliente mínimo do OpenDota (sem chave). Só HTTPS, fila com intervalo mínimo,
// timeout e validação do formato das respostas. Nunca registra dados pessoais.

class OpenDotaError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'OpenDotaError';
    this.code = code;
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createOpenDotaClient({
  fetchImpl = globalThis.fetch,
  baseUrl = 'https://api.opendota.com/api',
  timeoutMs = 10000,
  minIntervalMs = 1100,
  now = () => Date.now(),
  sleep = defaultSleep,
} = {}) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('baseUrl inválida');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('baseUrl precisa usar https');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch indisponível');
  }
  const base = baseUrl.replace(/\/+$/, '');

  let lastStart = null;
  let chain = Promise.resolve();

  // Serializa as chamadas e garante o intervalo mínimo entre os inícios.
  function enqueue(task) {
    const run = chain.then(async () => {
      if (lastStart !== null) {
        const wait = lastStart + minIntervalMs - now();
        if (wait > 0) await sleep(wait);
      }
      lastStart = now();
      return task();
    });
    chain = run.catch(() => {});
    return run;
  }

  async function request(path) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      let res;
      try {
        res = await fetchImpl(base + path, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
          redirect: 'error',
        });
      } catch (err) {
        if (timedOut) throw new OpenDotaError('timeout', 'Tempo esgotado ao consultar o OpenDota');
        throw new OpenDotaError('network', 'Falha de rede ao consultar o OpenDota');
      }
      if (res.status === 429) throw new OpenDotaError('rate_limited', 'OpenDota limitou as consultas');
      if (res.status === 404) throw new OpenDotaError('not_found', 'Recurso não encontrado no OpenDota');
      if (!res.ok) throw new OpenDotaError('http_error', `OpenDota respondeu com status ${res.status}`);
      try {
        return await res.json();
      } catch (err) {
        if (timedOut) throw new OpenDotaError('timeout', 'Tempo esgotado ao consultar o OpenDota');
        throw new OpenDotaError('bad_response', 'Resposta do OpenDota inválida');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  function checkId(accountId) {
    if (!Number.isInteger(accountId) || accountId < 1 || accountId > 4294967295) {
      throw new TypeError('accountId inválido');
    }
  }

  const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  return {
    async getPlayer(accountId) {
      checkId(accountId);
      let data;
      try {
        data = await enqueue(() => request(`/players/${accountId}`));
      } catch (err) {
        if (err instanceof OpenDotaError && err.code === 'not_found') {
          return { personaName: null, found: false };
        }
        throw err;
      }
      if (!isPlainObject(data)) throw new OpenDotaError('bad_response', 'Resposta do OpenDota inválida');
      const profile = data.profile;
      if (profile === undefined || profile === null) return { personaName: null, found: false };
      if (!isPlainObject(profile)) throw new OpenDotaError('bad_response', 'Resposta do OpenDota inválida');
      const name = typeof profile.personaname === 'string' && profile.personaname ? profile.personaname : null;
      return { personaName: name, found: true };
    },

    async getRecentMatches(accountId, limit = 20) {
      checkId(accountId);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('limit inválido');
      const data = await enqueue(() =>
        request(`/players/${accountId}/matches?limit=${limit}&lobby_type=7`));
      if (!Array.isArray(data) || !data.every(isPlainObject)) {
        throw new OpenDotaError('bad_response', 'Resposta do OpenDota inválida');
      }
      return data;
    },

    async getHeroes() {
      const data = await enqueue(() => request('/constants/heroes'));
      if (!isPlainObject(data)) throw new OpenDotaError('bad_response', 'Resposta do OpenDota inválida');
      const out = {};
      for (const hero of Object.values(data)) {
        if (!isPlainObject(hero) || !Number.isInteger(hero.id) || typeof hero.localized_name !== 'string') {
          throw new OpenDotaError('bad_response', 'Resposta do OpenDota inválida');
        }
        out[hero.id] = hero.localized_name;
      }
      return out;
    },
  };
}

module.exports = { createOpenDotaClient, OpenDotaError };
