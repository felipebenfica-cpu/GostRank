'use strict';
// Gera supabase/functions/<funcao>/bundle.ts: o index.ts com os arquivos de _shared embutidos,
// para colar num unico arquivo no editor do painel do Supabase.
//   node supabase/functions/build-bundles.js          (gera/atualiza)
//   node supabase/functions/build-bundles.js --check  (so confere se estao em dia)
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const FUNCTIONS = ['livekit-token', 'steam-link'];
const IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*'\.\.\/_shared\/([\w-]+)\.js';\n?/g;
const EXPORT_RE = /^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm;

function embedModule(mod) {
  const src = fs.readFileSync(path.join(ROOT, '_shared', `${mod}.js`), 'utf8');
  if (/^\s*import\s/m.test(src)) throw new Error(`_shared/${mod}.js nao pode importar outros modulos`);
  const names = [...src.matchAll(EXPORT_RE)].map((m) => m[1]);
  const body = src.replace(/^export\s+/gm, '').trimEnd();
  const indented = body.split('\n').map((l) => (l ? '  ' + l : l)).join('\n');
  return `// ---- _shared/${mod}.js (embutido) ----\nconst __shared_${mod} = (() => {\n${indented}\n  return { ${names.join(', ')} };\n})();\n`;
}

function buildBundle(fn) {
  const src = fs.readFileSync(path.join(ROOT, fn, 'index.ts'), 'utf8');
  const imports = [...src.matchAll(IMPORT_RE)];
  const mods = [...new Set(imports.map((m) => m[2]))];
  let out = '// @ts-nocheck\n'
    + `// ARQUIVO GERADO por supabase/functions/build-bundles.js a partir de ${fn}/index.ts e _shared/*.js.\n`
    + '// Nao edite a mao: altere os originais e rode o script de novo.\n\n';
  for (const mod of mods) out += embedModule(mod) + '\n';
  for (const m of imports) {
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    out += `const { ${names.join(', ')} } = __shared_${m[2]};\n`;
  }
  out += '\n' + src.replace(IMPORT_RE, '').replace(/^\n+/, '');
  return out;
}

function main(argv) {
  const check = argv.includes('--check');
  let stale = 0;
  for (const fn of FUNCTIONS) {
    const file = path.join(ROOT, fn, 'bundle.ts');
    const next = buildBundle(fn);
    const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (cur === next) continue;
    if (check) {
      stale++;
      console.error(`desatualizado: ${path.relative(process.cwd(), file)}`);
    } else {
      fs.writeFileSync(file, next);
      console.log(`gerado: ${path.relative(process.cwd(), file)}`);
    }
  }
  return stale ? 1 : 0;
}

module.exports = { buildBundle, FUNCTIONS };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
