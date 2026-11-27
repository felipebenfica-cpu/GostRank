'use strict';

// Etapa 6: preferências locais (notificações, silenciados, voz, aparência). Validadas campo a campo;
// guardadas no store do computador (ou localStorage na versão web). Nada aqui é segredo.

const { UserInputError } = require('./controller');
const { THEME_IDS, DEFAULT_THEME } = require('../core/themes');

const TARGET_RE = /^[cds]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DEVICE_RE = /^[A-Za-z0-9+/=_.:-]{1,200}$/;
const KEY_CODE_RE = /^[A-Za-z0-9]{1,24}$/;
const MAX_MUTED = 500;

function defaults() {
  return {
    notifications: { desktop: true, sounds: true, mentionsOnly: false },
    muted: [],
    voice: {
      inputDeviceId: 'default', outputDeviceId: 'default', mode: 'vad', pttKey: 'KeyV',
      sensitivity: -50, autoSensitivity: true, noiseSuppression: true, echoCancellation: true,
      inputVolume: 100, outputVolume: 100, cameraDeviceId: 'default',
    },
    appearance: { theme: DEFAULT_THEME, fontScale: 100, compact: false },
  };
}

const bool = (v) => (typeof v === 'boolean' ? { ok: true, v } : { ok: false });
const intIn = (lo, hi) => (v) => (Number.isInteger(v) && v >= lo && v <= hi ? { ok: true, v } : { ok: false });
const oneOf = (...vals) => (v) => (vals.includes(v) ? { ok: true, v } : { ok: false });
const device = (v) => (typeof v === 'string' && DEVICE_RE.test(v) ? { ok: true, v } : { ok: false });

const SCHEMA = {
  notifications: { desktop: bool, sounds: bool, mentionsOnly: bool },
  voice: {
    inputDeviceId: device, outputDeviceId: device, cameraDeviceId: device,
    mode: oneOf('vad', 'ptt'),
    pttKey: (v) => (typeof v === 'string' && KEY_CODE_RE.test(v) ? { ok: true, v } : { ok: false }),
    sensitivity: intIn(-100, 0), autoSensitivity: bool, noiseSuppression: bool, echoCancellation: bool,
    inputVolume: intIn(0, 200), outputVolume: intIn(0, 200),
  },
  appearance: { theme: oneOf(...THEME_IDS), fontScale: intIn(80, 130), compact: bool },
};

function isPlain(o) {
  return o !== null && typeof o === 'object' && !Array.isArray(o)
    && (Object.getPrototypeOf(o) === Object.prototype || Object.getPrototypeOf(o) === null);
}

function invalid() {
  return new UserInputError('Preferência inválida.');
}

function validMuted(list) {
  return Array.isArray(list) && list.length <= MAX_MUTED && list.every((t) => typeof t === 'string' && TARGET_RE.test(t));
}

/** Aplica `patch` sobre `base` validando tudo. Lança UserInputError se algo for inválido. */
function mergePrefs(base, patch) {
  if (!isPlain(patch)) throw invalid();
  const out = JSON.parse(JSON.stringify(base));
  for (const [section, value] of Object.entries(patch)) {
    if (section === 'muted') {
      if (!validMuted(value)) throw invalid();
      out.muted = [...new Set(value)];
      continue;
    }
    const schema = SCHEMA[section];
    if (!schema || !isPlain(value)) throw invalid();
    for (const [k, v] of Object.entries(value)) {
      const check = schema[k];
      if (!check) throw invalid();
      const r = check(v);
      if (!r.ok) throw invalid();
      out[section][k] = r.v;
    }
  }
  return out;
}

/** Lê o que estiver salvo descartando campos inválidos (nunca quebra por arquivo antigo/estranho). */
function sanitize(saved) {
  const out = defaults();
  if (!isPlain(saved)) return out;
  if (validMuted(saved.muted)) out.muted = [...new Set(saved.muted)];
  for (const [section, schema] of Object.entries(SCHEMA)) {
    const val = saved[section];
    if (!isPlain(val)) continue;
    for (const [k, check] of Object.entries(schema)) {
      if (k in val) {
        const r = check(val[k]);
        if (r.ok) out[section][k] = r.v;
      }
    }
  }
  return out;
}

/**
 * `store`: { load(): obj|null, save(obj) } (o mesmo formato do store.js).
 * O store guarda também `_nav` (última seleção), que não vai para a view.
 */
function createPrefs({ store = null } = {}) {
  let raw = null;
  try { raw = store ? store.load() : null; } catch { raw = null; }
  let prefs = sanitize(raw);
  let nav = raw && isPlain(raw._nav) ? raw._nav : null;
  // Etapa 7: este aparelho já escolheu um tema? (senão, vale o tema salvo na conta)
  let themeHere = Boolean(raw && raw._themeHere === true);
  // Uma única vez: quem nunca escolheu um tema passa a ver o padrão atual (o antigo 'dark' era só o
  // padrão gravado). Depois disso, um 'dark' vindo da conta é respeitado.
  if (!themeHere && !(raw && raw._themeRev === 2) && prefs.appearance.theme === 'dark') prefs.appearance.theme = DEFAULT_THEME;

  function persist() {
    if (!store) return;
    try { store.save({ ...prefs, _nav: nav, _themeHere: themeHere, _themeRev: 2 }); } catch { /* fica só em memória */ }
  }

  function get() {
    return JSON.parse(JSON.stringify(prefs));
  }

  function update(patch, { fromAccount = false } = {}) {
    prefs = mergePrefs(prefs, patch);
    if (!fromAccount && isPlain(patch.appearance) && 'theme' in patch.appearance) themeHere = true;
    persist();
    return get();
  }

  function setMuted(target, muted) {
    if (typeof target !== 'string' || !TARGET_RE.test(target)) throw invalid();
    const set = new Set(prefs.muted);
    if (muted) set.add(target); else set.delete(target);
    if (set.size > MAX_MUTED) throw invalid();
    prefs.muted = [...set];
    persist();
    return get();
  }

  function isMuted(target) {
    return prefs.muted.includes(target);
  }

  function getNav() { return nav ? { ...nav } : null; }
  function setNav(n) { nav = isPlain(n) ? { ...n } : null; persist(); }

  return { get, update, setMuted, isMuted, getNav, setNav, themeChosenHere: () => themeHere };
}

module.exports = { createPrefs, mergePrefs, sanitize, defaults, TARGET_RE };
