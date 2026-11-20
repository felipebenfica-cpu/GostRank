'use strict';
// Executa o SQL de verdade num Postgres temporario, se houver servidor local.
// Sem servidor (ou sem permissao para iniciar), os testes sao pulados.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const sqlFile = path.join(__dirname, '..', '..', 'supabase', 'migrations', '0001_perfis.sql');
const binDir = (() => {
  try {
    const v = fs.readdirSync('/usr/lib/postgresql').sort().pop();
    const d = `/usr/lib/postgresql/${v}/bin`;
    return fs.existsSync(`${d}/initdb`) && fs.existsSync(`${d}/pg_ctl`) ? d : null;
  } catch { return null; }
})();
const psqlBin = fs.existsSync('/usr/bin/psql') ? '/usr/bin/psql' : null;

const isRoot = process.getuid && process.getuid() === 0;
function wrap(cmd, args) {
  // initdb/postgres recusam rodar como root: usa o usuario "postgres" se for o caso.
  if (isRoot) return ['runuser', ['-u', 'postgres', '--', cmd, ...args]];
  return [cmd, args];
}
function run(cmd, args, opts = {}) {
  const [c, a] = wrap(cmd, args);
  return spawnSync(c, a, { encoding: 'utf8', ...opts });
}

let skipReason = null;
let dir, sock;
const port = '54' + String(Math.floor(100 + Math.random() * 800));

if (!binDir || !psqlBin) skipReason = 'Postgres local nao encontrado';

function psql(sqlText, { user = 'postgres', claim } = {}) {
  const pre = claim !== undefined ? `set request.jwt.claim.sub = '${claim}'; set role ${user};` : '';
  const r = spawnSync(psqlBin, ['-h', sock, '-p', port, '-U', 'postgres', '-d', 'gr', '-v', 'ON_ERROR_STOP=1', '-At', '-c', pre + sqlText],
    { encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
function psqlFile(f) {
  const r = spawnSync(psqlBin, ['-h', sock, '-p', port, '-U', 'postgres', '-d', 'gr', '-v', 'ON_ERROR_STOP=1', '-q', '-f', f],
    { encoding: 'utf8' });
  return { ok: r.status === 0, err: (r.stderr || '').trim() };
}

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';

test.before(() => {
  if (skipReason) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grpg-'));
  fs.chmodSync(dir, 0o777);
  sock = dir;
  const data = path.join(dir, 'data');
  let r = run(`${binDir}/initdb`, ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8']);
  if (r.status !== 0) { skipReason = 'initdb falhou: ' + (r.stderr || '').slice(0, 200); return; }
  r = run(`${binDir}/pg_ctl`, ['-D', data, '-o', `-p ${port} -k ${dir} -c listen_addresses=''`, '-l', path.join(dir, 'log'), '-w', 'start']);
  if (r.status !== 0) { skipReason = 'pg_ctl start falhou: ' + (r.stderr || '').slice(0, 200); return; }
  const setup = `
    create database gr;`;
  const c = spawnSync(psqlBin, ['-h', sock, '-p', port, '-U', 'postgres', '-d', 'postgres', '-c', setup], { encoding: 'utf8' });
  assert.strictEqual(c.status, 0, c.stderr);
  const boot = path.join(dir, 'boot.sql');
  fs.writeFileSync(boot, `
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    -- Imita os privilegios padrao do Supabase.
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
  `);
  const b = psqlFile(boot);
  assert.ok(b.ok, b.err);
  const m = psqlFile(sqlFile);
  assert.ok(m.ok, 'migracao falhou: ' + m.err);
});

test.after(() => {
  if (!dir || !binDir) return;
  run(`${binDir}/pg_ctl`, ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop']);
  fs.rmSync(dir, { recursive: true, force: true });
});

function t(name, fn) {
  test(name, (ctx) => {
    if (skipReason) return ctx.skip(skipReason);
    return fn();
  });
}

t('migracao e idempotente (roda duas vezes)', () => {
  const r = psqlFile(sqlFile);
  assert.ok(r.ok, r.err);
});

t('RLS ligada na tabela', () => {
  assert.strictEqual(psql("select relrowsecurity from pg_class where oid = 'public.profiles'::regclass").out, 't');
});

t('cadastro cria perfil com apelido do e-mail truncado em 24', () => {
  let r = psql(`insert into auth.users (id, email) values ('${U1}', 'ana.silva@example.com')`);
  assert.ok(r.ok, r.err);
  assert.strictEqual(psql(`select display_name || '|' || mmr_visibility from public.profiles where id='${U1}'`).out, 'ana.silva|friends');
  const longo = 'a'.repeat(40) + '@x.com';
  r = psql(`insert into auth.users (id, email) values ('${U2}', '${longo}')`);
  assert.ok(r.ok, r.err);
  assert.strictEqual(psql(`select display_name from public.profiles where id='${U2}'`).out, 'a'.repeat(24));
});

t('e-mail com 1 letra antes do @ nao quebra o cadastro', () => {
  const r = psql(`insert into auth.users (email) values ('x@y.com')`);
  assert.ok(r.ok, r.err);
  assert.strictEqual(psql(`select display_name from public.profiles where id=(select id from auth.users where email='x@y.com')`).out, 'jogador');
});

t('anon nao ve nada nem altera', () => {
  assert.ok(!psql('select * from public.profiles', { user: 'anon', claim: '' }).ok);
  assert.ok(!psql(`update public.profiles set display_name='zz'`, { user: 'anon', claim: '' }).ok);
});

t('dono ve so o proprio perfil', () => {
  const r = psql('select count(*) from public.profiles', { user: 'authenticated', claim: U1 });
  assert.ok(r.ok, r.err);
  assert.strictEqual(r.out.split('\n').pop(), '1');
});

t('dono altera display_name e mmr_visibility; updated_at muda', () => {
  const antes = psql(`select updated_at from public.profiles where id='${U1}'`).out;
  psql('select pg_sleep(0.05)');
  const r = psql(`update public.profiles set display_name='Ana', mmr_visibility='nobody' where id='${U1}'`, { user: 'authenticated', claim: U1 });
  assert.ok(r.ok, r.err);
  assert.strictEqual(psql(`select display_name||mmr_visibility from public.profiles where id='${U1}'`).out, 'Ananobody');
  assert.notStrictEqual(psql(`select updated_at from public.profiles where id='${U1}'`).out, antes);
});

t('dono nao altera steam_account_id nem id', () => {
  assert.ok(!psql(`update public.profiles set steam_account_id=1 where id='${U1}'`, { user: 'authenticated', claim: U1 }).ok);
  assert.ok(!psql(`update public.profiles set id=gen_random_uuid() where id='${U1}'`, { user: 'authenticated', claim: U1 }).ok);
});

t('dono nao altera perfil alheio (0 linhas)', () => {
  const r = psql(`update public.profiles set display_name='hack' where id='${U2}'`, { user: 'authenticated', claim: U1 });
  assert.ok(r.ok, r.err);
  assert.notStrictEqual(psql(`select display_name from public.profiles where id='${U2}'`).out, 'hack');
});

t('valores invalidos sao recusados', () => {
  assert.ok(!psql(`update public.profiles set mmr_visibility='todos' where id='${U1}'`, { user: 'authenticated', claim: U1 }).ok);
  assert.ok(!psql(`update public.profiles set display_name='<b>' where id='${U1}'`, { user: 'authenticated', claim: U1 }).ok);
  assert.ok(!psql(`update public.profiles set display_name='a' where id='${U1}'`, { user: 'authenticated', claim: U1 }).ok);
});

t('sem insert e sem delete direto', () => {
  assert.ok(!psql(`insert into public.profiles (id, display_name) values (gen_random_uuid(), 'abc')`, { user: 'authenticated', claim: U1 }).ok);
  assert.ok(!psql(`delete from public.profiles where id='${U1}'`, { user: 'authenticated', claim: U1 }).ok);
});

t('delete_my_account: anon nao executa; authenticated apaga so a si mesmo', () => {
  assert.ok(!psql('select public.delete_my_account()', { user: 'anon', claim: '' }).ok);
  const r = psql('select public.delete_my_account()', { user: 'authenticated', claim: U1 });
  assert.ok(r.ok, r.err);
  assert.strictEqual(psql(`select count(*) from auth.users where id='${U1}'`).out, '0');
  assert.strictEqual(psql(`select count(*) from public.profiles where id='${U1}'`).out, '0');
  assert.strictEqual(psql(`select count(*) from auth.users where id='${U2}'`).out, '1');
});

t('handle_new_user nao e executavel por authenticated', () => {
  assert.ok(!psql('select public.handle_new_user()', { user: 'authenticated', claim: U2 }).ok);
});
