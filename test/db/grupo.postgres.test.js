'use strict';
// Executa 0001 + 0002 de verdade num Postgres temporario, se houver servidor local.
// Sem servidor (ou sem permissao para iniciar), os testes sao pulados com o motivo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const migDir = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const sql1 = path.join(migDir, '0001_perfis.sql');
const sql2 = path.join(migDir, '0002_grupo.sql');

const binDir = process.env.GR_PG_BINDIR || (() => {
  try {
    const v = fs.readdirSync('/usr/lib/postgresql').sort().pop();
    const d = `/usr/lib/postgresql/${v}/bin`;
    return fs.existsSync(`${d}/initdb`) && fs.existsSync(`${d}/pg_ctl`) ? d : null;
  } catch { return null; }
})();
const psqlPath = process.env.GR_PSQL || '/usr/bin/psql';
const psqlBin = fs.existsSync(psqlPath) ? psqlPath : null;
const pgcryptoOk = (() => {
  try {
    if (binDir && fs.existsSync(path.join(binDir, '../share/postgresql/extension/pgcrypto.control'))) return true;
    return fs.readdirSync('/usr/share/postgresql').some((v) =>
      fs.existsSync(`/usr/share/postgresql/${v}/extension/pgcrypto.control`));
  } catch { return false; }
})();

const isRoot = process.getuid && process.getuid() === 0;
function run(cmd, args) {
  const [c, a] = isRoot ? ['runuser', ['-u', 'postgres', '--', cmd, ...args]] : [cmd, args];
  return spawnSync(c, a, { encoding: 'utf8' });
}

const tcp = process.env.GR_PG_LOOPBACK === '1';
let skipReason = null;
let dir;
const port = '55' + String(Math.floor(100 + Math.random() * 800));

if (!binDir || !psqlBin) skipReason = 'Postgres local nao encontrado';
else if (!pgcryptoOk) skipReason = 'extensao pgcrypto nao instalada no Postgres local';

function exec(sqlText) {
  const r = spawnSync(psqlBin, ['-h', tcp ? '127.0.0.1' : dir, '-p', port, '-U', 'postgres', '-d', 'gr', '-v', 'ON_ERROR_STOP=1', '-At', '-c', sqlText],
    { encoding: 'utf8' });
  const out = (r.stdout || '').trim();
  return { ok: r.status === 0, out, last: out.split('\n').pop(), err: (r.stderr || '').trim() };
}
// Como superusuario (fora da RLS).
const pg = (s) => exec(s);
// Como usuario logado (role authenticated, auth.uid() = uid).
const as = (uid, s) => exec(`set request.jwt.claim.sub = '${uid}'; set role authenticated; ${s}`);
const asAnon = (s) => exec(`set request.jwt.claim.sub = ''; set role anon; ${s}`);
const asService = (s) => exec(`set role service_role; ${s}`);
function psqlFile(f) {
  const r = spawnSync(psqlBin, ['-h', tcp ? '127.0.0.1' : dir, '-p', port, '-U', 'postgres', '-d', 'gr', '-v', 'ON_ERROR_STOP=1', '-q', '-f', f],
    { encoding: 'utf8' });
  return { ok: r.status === 0, err: (r.stderr || '').trim() };
}

const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const A = U(1); // dono do grupo 1
const B = U(2); // membro do grupo 1
const C = U(20); // dono do grupo 2
const D = U(30); // sem grupo
const E = U(40); // dono do grupo 3 (apagar conta)
const F = U(41); // membro do grupo 3

function expectErr(r, code) {
  assert.ok(!r.ok, `esperava erro ${code}, veio sucesso: ${r.out}`);
  assert.match(r.err, new RegExp(`ERROR:\\s+${code}\\b`), r.err);
}
function count(uid, table, where = 'true') {
  const r = as(uid, `select count(*) from ${table} where ${where}`);
  assert.ok(r.ok, r.err);
  return Number(r.last);
}
function invite(uid) {
  const r = as(uid, 'select code from public.create_invite()');
  assert.ok(r.ok, r.err);
  return r.last;
}

test.before(() => {
  if (skipReason) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grpg2-'));
  fs.chmodSync(dir, 0o777);
  const data = path.join(dir, 'data');
  let r = run(`${binDir}/initdb`, ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8']);
  if (r.status !== 0) { skipReason = 'initdb falhou: ' + (r.stderr || '').slice(0, 200); return; }
  r = run(`${binDir}/pg_ctl`, ['-D', data, '-o', tcp ? `-p ${port} -c unix_socket_directories='' -c listen_addresses=127.0.0.1` : `-p ${port} -k ${dir} -c listen_addresses=''`, '-l', path.join(dir, 'log'), '-w', 'start']);
  if (r.status !== 0) { skipReason = 'pg_ctl start falhou: ' + (r.stderr || '').slice(0, 200); return; }
  const c = spawnSync(psqlBin, ['-h', tcp ? '127.0.0.1' : dir, '-p', port, '-U', 'postgres', '-d', 'postgres', '-c', 'create database gr;'], { encoding: 'utf8' });
  assert.strictEqual(c.status, 0, c.stderr);
  const boot = path.join(dir, 'boot.sql');
  fs.writeFileSync(boot, `
    create role anon nologin; create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    -- Como no Supabase: pgcrypto no schema "extensions".
    create schema extensions;
    grant usage on schema extensions to anon, authenticated, service_role;
    create extension pgcrypto with schema extensions;
    -- Imita os privilegios padrao do Supabase.
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  `);
  const b = psqlFile(boot);
  assert.ok(b.ok, b.err);
  let m = psqlFile(sql1);
  assert.ok(m.ok, '0001 falhou: ' + m.err);
  m = psqlFile(sql2);
  assert.ok(m.ok, '0002 falhou: ' + m.err);
  const ids = [A, B, ...Array.from({ length: 10 }, (_, i) => U(3 + i)), C, D, E, F];
  const vals = ids.map((id, i) => `('${id}', 'jogador${i}@example.com')`).join(',');
  const u = pg(`insert into auth.users (id, email) values ${vals}`);
  assert.ok(u.ok, u.err);
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

const TABLES = ['groups', 'group_members', 'group_invites', 'mmr_snapshots', 'messages', 'steam_link_states'];

t('migracao 0002 e idempotente (roda de novo)', () => {
  const r = psqlFile(sql2);
  assert.ok(r.ok, r.err);
});

t('RLS ligada em todas as tabelas novas', () => {
  for (const tb of TABLES) {
    assert.strictEqual(pg(`select relrowsecurity from pg_class where oid = 'public.${tb}'::regclass`).out, 't', tb);
  }
});

t('funcoes: security definer, search_path vazio, EXECUTE so authenticated', () => {
  const rpc = ['create_group(text)', 'create_invite()', 'join_group(text)', 'leave_group()', 'remove_member(uuid)', 'my_group_id()', 'delete_my_account()'];
  for (const f of rpc) {
    const r = pg(`select prosecdef, array_to_string(proconfig, ','),
      has_function_privilege('anon', 'public.${f}', 'execute'),
      has_function_privilege('authenticated', 'public.${f}', 'execute'),
      has_function_privilege('public', 'public.${f}', 'execute')
      from pg_proc where oid = 'public.${f}'::regprocedure`);
    assert.strictEqual(r.out, 't|search_path=""|f|t|f', f + ' ' + r.out);
  }
  for (const f of ['leave_group_of(uuid)', 'messages_rate_limit()']) {
    const r = pg(`select has_function_privilege('authenticated', 'public.${f}', 'execute'),
      has_function_privilege('anon', 'public.${f}', 'execute')`);
    assert.strictEqual(r.out, 'f|f', f);
  }
});

t('anon nao le tabelas nem chama funcoes', () => {
  for (const tb of TABLES) assert.ok(!asAnon(`select * from public.${tb}`).ok, tb);
  assert.ok(!asAnon(`insert into public.messages (group_id, body) values (gen_random_uuid(), 'oi')`).ok);
  assert.ok(!asAnon(`select public.create_group('Anon')`).ok);
  assert.ok(!asAnon(`select public.join_group('ABCDEFGHJK')`).ok);
  assert.ok(!asAnon('select public.my_group_id()').ok);
});

t('criar grupo: nome validado, dono vira membro', () => {
  expectErr(as(A, `select public.create_group('a')`), 'invalid_name');
  expectErr(as(A, `select public.create_group('<b>oi')`), 'invalid_name');
  expectErr(as(A, `select public.create_group('${'x'.repeat(33)}')`), 'invalid_name');
  expectErr(as(A, `select public.create_group(E'ab\\ncd')`), 'invalid_name');
  const r = as(A, `select public.create_group('  Fantasmas  ')`);
  assert.ok(r.ok, r.err);
  assert.match(r.last, /^[0-9a-f-]{36}$/);
  assert.strictEqual(pg(`select name || '|' || (owner_id = '${A}') from public.groups where id = '${r.last}'`).out, 'Fantasmas|true');
  assert.strictEqual(pg(`select count(*) from public.group_members where group_id = '${r.last}' and user_id = '${A}'`).out, '1');
  assert.strictEqual(as(A, 'select public.my_group_id()').last, r.last);
  expectErr(as(A, `select public.create_group('Outro')`), 'already_in_group');
});

t('convite: so o dono cria; codigo de 10 letras sem ambiguas, validade 7 dias', () => {
  expectErr(as(B, 'select * from public.create_invite()'), 'not_in_group');
  const r = as(A, `select code || '|' || round(extract(epoch from (expires_at - now())) / 86400) from public.create_invite()`);
  assert.ok(r.ok, r.err);
  const [code, days] = r.last.split('|');
  assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/);
  assert.strictEqual(days, '7');
  assert.strictEqual(pg(`select uses || '/' || max_uses from public.group_invites where code = '${code}'`).out, '0/5');
  // Codigos diferentes a cada chamada.
  assert.notStrictEqual(invite(A), invite(A));
});

t('convites nao sao legiveis diretamente', () => {
  assert.ok(!as(A, 'select * from public.group_invites').ok);
  assert.ok(!as(A, `insert into public.group_invites (code, group_id, expires_at) values ('ABCDEFGHJK', gen_random_uuid(), now())`).ok);
});

t('entrar com codigo (minusculas e espacos aceitos); membro nao cria convite', () => {
  const code = invite(A);
  const r = as(B, `select public.join_group('  ${code.toLowerCase()} ')`);
  assert.ok(r.ok, r.err);
  assert.strictEqual(r.last, as(A, 'select public.my_group_id()').last);
  assert.strictEqual(pg(`select uses from public.group_invites where code = '${code}'`).out, '1');
  expectErr(as(B, 'select * from public.create_invite()'), 'not_owner');
});

t('codigo inexistente, mal formado, vencido ou esgotado: mesmo erro invalid_invite', () => {
  const venc = invite(A);
  pg(`update public.group_invites set expires_at = now() - interval '1 second' where code = '${venc}'`);
  const esg = invite(A);
  pg(`update public.group_invites set uses = max_uses where code = '${esg}'`);
  const erros = [
    as(D, `select public.join_group('ZZZZZZZZZZ')`),
    as(D, `select public.join_group('abc')`),
    as(D, `select public.join_group(null)`),
    as(D, `select public.join_group('${venc}')`),
    as(D, `select public.join_group('${esg}')`),
  ];
  for (const r of erros) expectErr(r, 'invalid_invite');
  const msgs = new Set(erros.map((r) => r.err.split('\n')[0]));
  assert.strictEqual(msgs.size, 1, [...msgs].join(' / '));
  assert.strictEqual(count(D, 'public.group_members'), 0);
});

t('quem ja esta em grupo nao entra em outro', () => {
  const r = as(C, `select public.create_group('Grupo C')`);
  assert.ok(r.ok, r.err);
  const codeC = invite(C);
  expectErr(as(B, `select public.join_group('${codeC}')`), 'already_in_group');
  expectErr(as(B, `select public.create_group('Novo')`), 'already_in_group');
  assert.strictEqual(pg(`select uses from public.group_invites where code = '${codeC}'`).out, '0');
});

t('grupo cheio: no maximo 10 membros', () => {
  // Grupo 1 tem A e B; entram U3..U10 (8 pessoas) usando dois convites.
  let code = invite(A);
  for (let n = 3; n <= 10; n++) {
    if (n === 7) code = invite(A);
    const r = as(U(n), `select public.join_group('${code}')`);
    assert.ok(r.ok, `U${n}: ${r.err}`);
  }
  assert.strictEqual(pg(`select count(*) from public.group_members where group_id = (select group_id from public.group_members where user_id = '${A}')`).out, '10');
  const extra = invite(A);
  expectErr(as(U(11), `select public.join_group('${extra}')`), 'group_full');
  assert.strictEqual(pg(`select uses from public.group_invites where code = '${extra}'`).out, '0');
  assert.strictEqual(count(U(11), 'public.group_members'), 0);
});

t('membros veem o proprio grupo, os colegas e o perfil deles', () => {
  assert.strictEqual(count(B, 'public.groups'), 1);
  assert.strictEqual(count(B, 'public.group_members'), 10);
  assert.strictEqual(count(B, 'public.profiles'), 10);
  // Colega nao altera o perfil do outro.
  const r = as(B, `update public.profiles set display_name = 'hack' where id = '${A}'`);
  assert.ok(r.ok, r.err);
  assert.notStrictEqual(pg(`select display_name from public.profiles where id = '${A}'`).out, 'hack');
});

t('membros nao alteram grupo nem membros diretamente', () => {
  assert.ok(!as(A, `update public.groups set name = 'Hack'`).ok);
  assert.ok(!as(A, `insert into public.groups (name, owner_id) values ('Hack', '${A}')`).ok);
  assert.ok(!as(A, 'delete from public.groups').ok);
  assert.ok(!as(D, `insert into public.group_members (group_id, user_id) select group_id, '${D}' from public.group_members limit 1`).ok);
  assert.ok(!as(A, `delete from public.group_members where user_id = '${B}'`).ok);
  assert.ok(!as(A, `update public.group_members set user_id = '${D}' where user_id = '${B}'`).ok);
});

t('snapshot de MMR: dono grava so a propria linha, servidor define updated_at', () => {
  let r = as(A, `insert into public.mmr_snapshots (user_id, current_mmr, goal_mmr, start_mmr, wins, losses, status)
    values (auth.uid(), 3100, 4000, 3000, 5, 3, 'on_track')`);
  assert.ok(r.ok, r.err);
  // Upsert (como o PostgREST faz com resolution=merge-duplicates).
  r = as(A, `insert into public.mmr_snapshots (user_id, current_mmr, goal_mmr, start_mmr, wins, losses, status)
    values (auth.uid(), 3150, 4000, 3000, 6, 3, 'on_track')
    on conflict (user_id) do update set current_mmr = excluded.current_mmr, wins = excluded.wins, user_id = excluded.user_id`);
  assert.ok(r.ok, r.err);
  assert.strictEqual(pg(`select current_mmr || '/' || wins from public.mmr_snapshots where user_id = '${A}'`).out, '3150/6');
  assert.ok(!as(A, `insert into public.mmr_snapshots (user_id, current_mmr, status) values ('${B}', 1, 'on_track')`).ok);
  assert.ok(!as(A, `update public.mmr_snapshots set updated_at = '2000-01-01'`).ok);
  assert.ok(!as(A, `update public.mmr_snapshots set current_mmr = 30000`).ok);
  assert.ok(!as(A, `update public.mmr_snapshots set status = 'otimo'`).ok);
  assert.ok(!as(A, `update public.mmr_snapshots set user_id = '${B}'`).ok);
  r = as(B, `insert into public.mmr_snapshots (user_id, current_mmr, goal_mmr, start_mmr, status) values (auth.uid(), 2000, 2500, 1900, 'insufficient_data')`);
  assert.ok(r.ok, r.err);
  // B nao altera nem apaga o snapshot de A (0 linhas).
  as(B, `update public.mmr_snapshots set current_mmr = 1 where user_id = '${A}'`);
  as(B, `delete from public.mmr_snapshots where user_id = '${A}'`);
  assert.strictEqual(pg(`select current_mmr from public.mmr_snapshots where user_id = '${A}'`).out, '3150');
});

t('snapshot visivel a colegas so com mmr_visibility group ou friends', () => {
  const vis = (v) => pg(`update public.profiles set mmr_visibility = '${v}' where id = '${A}'`);
  const seen = (uid) => count(uid, 'public.mmr_snapshots', `user_id = '${A}'`);
  vis('friends');
  assert.strictEqual(seen(B), 1);
  vis('group');
  assert.strictEqual(seen(B), 1);
  vis('nobody');
  assert.strictEqual(seen(B), 0);
  assert.strictEqual(seen(A), 1, 'o dono sempre ve o proprio');
  vis('group');
  assert.strictEqual(seen(C), 0, 'outro grupo nunca ve');
  assert.strictEqual(seen(D), 0, 'sem grupo nunca ve');
});

t('chat: membro envia e le; nao envia em grupo alheio nem como outra pessoa', () => {
  const g1 = as(A, 'select public.my_group_id()').last;
  const g2 = as(C, 'select public.my_group_id()').last;
  let r = as(B, `insert into public.messages (group_id, body) values ('${g1}', 'oi grupo') returning user_id`);
  assert.ok(r.ok, r.err);
  assert.ok(r.out.split('\n').includes(B), r.out);
  assert.ok(!as(B, `insert into public.messages (group_id, body) values ('${g2}', 'invasao')`).ok);
  assert.ok(!as(B, `insert into public.messages (group_id, user_id, body) values ('${g1}', '${A}', 'falso')`).ok);
  assert.ok(!as(D, `insert into public.messages (group_id, body) values ('${g1}', 'de fora')`).ok);
  assert.ok(!as(B, `insert into public.messages (group_id, body) values ('${g1}', '')`).ok);
  assert.ok(!as(B, `insert into public.messages (group_id, body) values ('${g1}', '   ')`).ok);
  assert.ok(!as(B, `insert into public.messages (group_id, body) values ('${g1}', '${'x'.repeat(1001)}')`).ok);
  assert.ok(!as(B, `insert into public.messages (group_id, body, created_at) values ('${g1}', 'antiga', '2000-01-01')`).ok);
  r = as(C, `insert into public.messages (group_id, body) values ('${g2}', 'segredo do C')`);
  assert.ok(r.ok, r.err);
  assert.strictEqual(count(A, 'public.messages', `body = 'oi grupo'`), 1);
  assert.strictEqual(count(A, 'public.messages', `body = 'segredo do C'`), 0);
});

t('chat: sem update; apagar so a propria mensagem', () => {
  assert.ok(!as(B, `update public.messages set body = 'editada'`).ok);
  let r = as(A, `delete from public.messages where body = 'oi grupo'`);
  assert.ok(r.ok, r.err);
  assert.strictEqual(pg(`select count(*) from public.messages where body = 'oi grupo'`).out, '1');
  r = as(B, `delete from public.messages where body = 'oi grupo'`);
  assert.ok(r.ok, r.err);
  assert.strictEqual(pg(`select count(*) from public.messages where body = 'oi grupo'`).out, '0');
});

t('chat: limite de 10 mensagens em 10 segundos (rate_limited)', () => {
  const g1 = as(A, 'select public.my_group_id()').last;
  const ins = (n) => Array.from({ length: n }, (_, i) => `insert into public.messages (group_id, body) values ('${g1}', 'msg ${i}');`).join(' ');
  let r = as(U(3), ins(10));
  assert.ok(r.ok, r.err);
  expectErr(as(U(3), ins(1)), 'rate_limited');
  // Numa mesma chamada tambem barra a 11a.
  expectErr(as(U(4), ins(11)), 'rate_limited');
  assert.strictEqual(pg(`select count(*) from public.messages where user_id = '${U(4)}'`).out, '0');
  // Outra pessoa nao e afetada.
  r = as(U(5), ins(1));
  assert.ok(r.ok, r.err);
  // Passados 10 s, volta a poder enviar.
  pg(`update public.messages set created_at = created_at - interval '11 seconds' where user_id = '${U(3)}'`);
  r = as(U(3), ins(1));
  assert.ok(r.ok, r.err);
});

t('isolamento: ninguem de fora le grupo, membros, mensagens, snapshots ou perfis', () => {
  const g1 = as(A, 'select public.my_group_id()').last;
  for (const outsider of [C, D]) {
    assert.strictEqual(count(outsider, 'public.groups', `id = '${g1}'`), 0);
    assert.strictEqual(count(outsider, 'public.group_members', `group_id = '${g1}'`), 0);
    assert.strictEqual(count(outsider, 'public.messages', `group_id = '${g1}'`), 0);
    assert.strictEqual(count(outsider, 'public.mmr_snapshots', `user_id <> auth.uid()`), 0);
    assert.strictEqual(count(outsider, 'public.profiles', `id <> auth.uid()`), 0);
  }
  // E o grupo 1 nao ve o grupo 2.
  const g2 = as(C, 'select public.my_group_id()').last;
  assert.strictEqual(count(A, 'public.groups', `id = '${g2}'`), 0);
  assert.strictEqual(count(A, 'public.profiles', `id = '${C}'`), 0);
  assert.strictEqual(as(D, 'select coalesce(public.my_group_id()::text, \'nenhum\')').last, 'nenhum');
});

t('remover membro: so o dono, nao a si mesmo, so do proprio grupo', () => {
  expectErr(as(B, `select public.remove_member('${U(3)}')`), 'not_owner');
  expectErr(as(A, `select public.remove_member('${A}')`), 'not_owner');
  expectErr(as(A, `select public.remove_member('${C}')`), 'not_in_group');
  expectErr(as(D, `select public.remove_member('${B}')`), 'not_in_group');
  const r = as(A, `select public.remove_member('${U(3)}')`);
  assert.ok(r.ok, r.err);
  assert.strictEqual(count(U(3), 'public.groups'), 0);
  assert.strictEqual(count(U(3), 'public.messages'), 0);
  assert.strictEqual(count(B, 'public.group_members'), 9);
  assert.strictEqual(count(B, 'public.profiles', `id = '${U(3)}'`), 0);
});

t('sair: dono passa a posse ao membro mais antigo; ultimo a sair apaga o grupo', () => {
  expectErr(as(D, 'select public.leave_group()'), 'not_in_group');
  const g1 = as(A, 'select public.my_group_id()').last;
  let r = as(A, 'select public.leave_group()');
  assert.ok(r.ok, r.err);
  assert.strictEqual(pg(`select owner_id from public.groups where id = '${g1}'`).out, B);
  assert.strictEqual(count(A, 'public.groups'), 0);
  // Novo dono pode convidar; o antigo nao.
  invite(B);
  expectErr(as(A, 'select * from public.create_invite()'), 'not_in_group');
  // Membro comum sai sem mudar o dono.
  r = as(U(4), 'select public.leave_group()');
  assert.ok(r.ok, r.err);
  assert.strictEqual(pg(`select owner_id from public.groups where id = '${g1}'`).out, B);
  // Grupo 2 (so o C): ao sair, o grupo some com convites e mensagens.
  const g2 = as(C, 'select public.my_group_id()').last;
  r = as(C, 'select public.leave_group()');
  assert.ok(r.ok, r.err);
  assert.strictEqual(pg(`select count(*) from public.groups where id = '${g2}'`).out, '0');
  assert.strictEqual(pg(`select count(*) from public.group_invites where group_id = '${g2}'`).out, '0');
  assert.strictEqual(pg(`select count(*) from public.messages where group_id = '${g2}'`).out, '0');
  // Quem saiu pode criar outro grupo.
  r = as(C, `select public.create_group('Grupo C2')`);
  assert.ok(r.ok, r.err);
});

t('steam_link_states: so o service role acessa', () => {
  assert.ok(!as(E, 'select * from public.steam_link_states').ok);
  assert.ok(!as(E, `insert into public.steam_link_states values ('x', '${E}', now())`).ok);
  const r = asService(`insert into public.steam_link_states values ('estado-e', '${E}', now() + interval '10 minutes');
    select count(*) from public.steam_link_states`);
  assert.ok(r.ok, r.err);
  assert.strictEqual(r.last, '1');
  // O service role grava steam_account_id (vinculo Steam).
  const p = asService(`update public.profiles set steam_account_id = 12345 where id = '${E}'`);
  assert.ok(p.ok, p.err);
});

t('apagar conta limpa tudo e passa a posse do grupo', () => {
  let r = as(E, `select public.create_group('Grupo E')`);
  assert.ok(r.ok, r.err);
  const g3 = r.last;
  r = as(F, `select public.join_group('${invite(E)}')`);
  assert.ok(r.ok, r.err);
  r = as(E, `insert into public.messages (group_id, body) values ('${g3}', 'tchau');
    insert into public.mmr_snapshots (user_id, current_mmr, status) values (auth.uid(), 1000, 'on_track')`);
  assert.ok(r.ok, r.err);
  r = as(E, 'select public.delete_my_account()');
  assert.ok(r.ok, r.err);
  for (const [tb, col] of [['auth.users', 'id'], ['public.profiles', 'id'], ['public.group_members', 'user_id'],
    ['public.messages', 'user_id'], ['public.mmr_snapshots', 'user_id'], ['public.steam_link_states', 'user_id'],
    ['public.groups', 'owner_id']]) {
    assert.strictEqual(pg(`select count(*) from ${tb} where ${col} = '${E}'`).out, '0', tb);
  }
  assert.strictEqual(pg(`select owner_id from public.groups where id = '${g3}'`).out, F);
  assert.strictEqual(pg(`select count(*) from public.group_invites where created_by = '${E}'`).out, '0');
  // F, ultimo membro, apaga a conta: o grupo some junto.
  r = as(F, 'select public.delete_my_account()');
  assert.ok(r.ok, r.err);
  assert.strictEqual(pg(`select count(*) from public.groups where id = '${g3}'`).out, '0');
});

t('0003 recupera convite antigo e permite mais de cinco entradas pelo mesmo código', () => {
  const sql3 = path.join(migDir, '0003_social.sql');
  const code = invite(C);
  assert.ok(pg(`update public.group_invites set expires_at = now() - interval '1 month', uses = max_uses where code = '${code}'`).ok);
  for (let i = 0; i < 2; i++) {
    const migration = psqlFile(sql3);
    assert.ok(migration.ok, migration.err);
  }
  const groupId = as(C, 'select public.my_group_id()').last;
  for (let i = 0; i < 7; i++) {
    const joined = as(D, `select public.join_group(' ${code.toLowerCase()} ')`);
    assert.ok(joined.ok, joined.err);
    assert.equal(joined.last, groupId);
    assert.ok(as(D, 'select public.leave_group()').ok);
  }
  assert.equal(invite(C), invite(C));
  const result = as(C, 'select expires_at is null from public.create_invite()');
  assert.equal(result.last, 't', result.err);
});

t('busca e amizade entre grupos respeitam destinatário, terceiros e preferência de descoberta', () => {
  const people = (uid, target, query = 'null') => as(uid, `select coalesce((select state from public.social_people(${query}) where id = '${target}'), '-')`);
  const friend = (uid, action, target) => as(uid, `select public.social_friend('${action}', '${target}')`);
  assert.ok(as(C, "update public.profiles set display_name = 'Teste Social' where id = auth.uid()").ok);
  assert.equal(people(A, C, "'tE sOc'").last, 'none');
  for (const cancelBy of [A, C]) {
    assert.ok(friend(A, 'send', C).ok);
    assert.ok(friend(cancelBy, 'remove', cancelBy === A ? C : A).ok);
    assert.equal(people(C, A).last, '-');
  }
  assert.ok(friend(A, 'send', C).ok);
  assert.equal(people(A, C).last, 'outgoing');
  assert.equal(people(C, A).last, 'incoming');
  assert.equal(friend(A, 'accept', C).ok, false);
  assert.equal(friend(D, 'accept', A).ok, false);
  assert.equal(people(C, A).last, 'incoming');
  assert.equal(people(D, A).last, '-');
  assert.ok(friend(C, 'accept', A).ok);
  assert.equal(people(A, C).last, 'friend');
  assert.equal(people(C, A).last, 'friend');
  assert.ok(friend(A, 'remove', C).ok);
  assert.equal(people(C, A).last, '-');
  assert.equal(people(A, C).last, '-');
  assert.ok(as(C, 'select public.social_privacy(false)').ok);
  assert.equal(people(D, C, "'Teste Social'").last, '-');
  assert.equal(friend(D, 'send', C).ok, false);
  assert.equal(people(C, C).last, 'self');
  assert.equal(asAnon("select * from public.social_people('Teste Social')").ok, false);
});

t('foto de grupo exige dono e foto do perfil é vinculada à sessão', () => {
  const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgAB/9k=';
  const photo = (uid, scope, value) => as(uid, `select public.social_photo('${scope}', ${value})`);
  assert.ok(as(D, `select public.join_group('${invite(C)}')`).ok);
  assert.equal(photo(D, 'group', `'${jpeg}'`).ok, false);
  assert.equal(photo(C, 'group', "'data:image/svg+xml;base64,AAAA'").ok, false);
  const updated = photo(C, 'group', `'${jpeg}'`);
  assert.ok(updated.ok, updated.err);
  assert.equal(as(D, 'select photo from public.groups where id = public.my_group_id()').last, jpeg);
  assert.ok(photo(D, 'profile', `'${jpeg}'`).ok);
  assert.equal(as(C, `select photo from public.profiles where id = '${D}'`).last, jpeg);
  assert.equal(as(C, 'select photo is null from public.profiles where id = auth.uid()').last, 't');
  assert.equal(asAnon(`select public.social_photo('profile', '${jpeg}')`).ok, false);
  assert.ok(photo(C, 'group', 'null').ok);
  assert.equal(as(D, 'select photo is null from public.groups where id = public.my_group_id()').last, 't');
});

t('ajuste de MMR para amigos exige amizade aceita, inclusive dentro do grupo', () => {
  const own = `user_id = '${D}'`;
  assert.ok(as(D, "update public.profiles set mmr_visibility = 'friends' where id = auth.uid()").ok);
  assert.ok(as(D, "insert into public.mmr_snapshots (user_id, current_mmr, status) values (auth.uid(),2000,'on_track') on conflict (user_id) do update set current_mmr = 2000").ok);
  assert.equal(count(C, 'public.mmr_snapshots', own), 0);
  assert.ok(as(C, `select public.social_friend('send','${D}')`).ok);
  assert.equal(count(C, 'public.mmr_snapshots', own), 0);
  assert.ok(as(D, `select public.social_friend('accept','${C}')`).ok);
  assert.equal(count(C, 'public.mmr_snapshots', own), 1);
  assert.ok(as(C, `select public.social_friend('remove','${D}')`).ok);
  assert.equal(count(C, 'public.mmr_snapshots', own), 0);
});
