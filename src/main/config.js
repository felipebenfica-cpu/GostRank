'use strict';

const nodeFs = require('node:fs');
const path = require('node:path');

const MAX_CONFIG_BYTES = 16 * 1024;
const { normalizeSupabaseUrl, isValidAnonKey } = require('../core/supabaseConfig');

/**
 * Lê GHOST_RANK_SUPABASE_URL / GHOST_RANK_SUPABASE_ANON_KEY ou config.local.json.
 * Qualquer problema devolve null (o rastreador funciona sem contas).
 */
function loadConfig({ env = process.env, fs = nodeFs, dir = path.join(__dirname, '..', '..'), warn = (m) => process.stderr.write(m + '\n') } = {}) {
  try {
    let file = {};
    const needFile = !(env && env.GHOST_RANK_SUPABASE_URL && env.GHOST_RANK_SUPABASE_ANON_KEY);
    if (needFile) {
      try {
        // config.local.json (da máquina) tem prioridade; config.public.json vem junto no instalador.
        const local = path.join(dir, 'config.local.json');
        let p = local;
        try { fs.statSync(local); } catch { p = path.join(dir, 'config.public.json'); }
        let st = null;
        try { st = fs.statSync(p); } catch { warn('[config] config.local.json/config.public.json não encontrado em ' + dir); }
        if (st && st.isFile() && st.size <= MAX_CONFIG_BYTES) {
          // O Bloco de Notas pode salvar com BOM (\uFEFF), que quebra o JSON.parse.
          const text = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
          let parsed = null;
          try { parsed = JSON.parse(text); } catch { warn('[config] ' + path.basename(p) + ' não é um JSON válido'); }
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) file = parsed;
        }
      } catch { file = {}; }
    }
    const rawUrl = (env && env.GHOST_RANK_SUPABASE_URL) || file.supabaseUrl;
    const anonKey = (env && env.GHOST_RANK_SUPABASE_ANON_KEY) || file.anonKey;
    const supabaseUrl = normalizeSupabaseUrl(rawUrl);
    if (!supabaseUrl) { if (rawUrl) warn('[config] supabaseUrl inválida (use https://<projeto>.supabase.co)'); return null; }
    if (!isValidAnonKey(anonKey)) { warn('[config] anonKey ausente ou inválida'); return null; }
    return { supabaseUrl, anonKey };
  } catch {
    return null;
  }
}

module.exports = { loadConfig, normalizeSupabaseUrl, isValidAnonKey };
