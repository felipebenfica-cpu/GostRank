'use strict';
// Executa as migracoes de verdade num Postgres temporario (se houver servidor local):
// banco principal 0001 -> 0002 -> (dados antigos) -> 0003_social -> 0004 -> 0005 (com dados) -> 0006;
// banco "grb" 0001 -> 0002 -> 0006 (sem as migracoes sociais).
// Imita o que o Supabase tem: auth, extensions, publicacao supabase_realtime, realtime.messages e storage.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const migDir = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const sql1 = path.join(migDir, '0001_perfis.sql');
const sql2 = path.join(migDir, '0002_grupo.sql');
const sqlSocial = path.join(migDir, '0003_social.sql');
const sqlChat = path.join(migDir, '0004_chat_mensagens.sql');
const sqlDm = path.join(migDir, '0005_mensagens_diretas.sql');
const sql3 = path.join(migDir, '0006_discord.sql');

const binDir = (() => {
  try {
    const v = fs.readdirSync('/usr/lib/postgresql').sort().pop();
    const d = `/usr/lib/postgresql/${v}/bin`;
    return fs.existsSync(`${d}/initdb`) && fs.existsSync(`${d}/pg_ctl`) ? d : null;
  } catch { return null; }
})();
const psqlBin = fs.existsSync('/usr/bin/psql') ? '/usr/bin/psql' : null;
const pgcryptoOk = (() => {
  try {
    return fs.readdirSync('/usr/share/postgresql').some((v) =>
      fs.existsSync(`/usr/share/postgresql/${v}/extension/pgcrypto.control`));
  } catch { return false; }
})();

const isRoot = process.getuid && process.getuid() === 0;
function run(cmd, args) {
  const [c, a] = isRoot ? ['runuser', ['-u', 'postgres', '--', cmd, ...args]] : [cmd, args];
  return spawnSync(c, a, { encoding: 'utf8' });
}

let skipReason = null;
let dir;
const port = '56' + String(Math.floor(100 + Math.random() * 800));

if (!binDir || !psqlBin) skipReason = 'Postgres local nao encontrado';
else if (!pgcryptoOk) skipReason = 'extensao pgcrypto nao instalada no Postgres local';

function exec(sqlText, db = 'gr') {
  const r = spawnSync(psqlBin, ['-h', dir, '-p', port, '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', '-At', '-c', sqlText],
    { encoding: 'utf8' });
  const out = (r.stdout || '').trim();
  return { ok: r.status === 0, out, last: out.split('\n').pop(), err: (r.stderr || '').trim() };
}
const pg = (s) => exec(s);
const as = (uid, s) => exec(`set request.jwt.claim.sub = '${uid}'; set role authenticated; ${s}`);
const asAnon = (s) => exec(`set request.jwt.claim.sub = ''; set role anon; ${s}`);
function psqlFile(f, db = 'gr') {
  const r = spawnSync(psqlBin, ['-h', dir, '-p', port, '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', '-f', f],
    { encoding: 'utf8' });
  return { ok: r.status === 0, err: (r.stderr || '').trim() };
}

const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const A = U(1); // dono do grupo antigo (vem do 0002)
const B = U(2); // membro do grupo antigo
const C = U(3);
const D = U(4);
const E = U(5);
const F = U(6);
const UUID = /^[0-9a-f-]{36}$/;
// Pessoas das migracoes sociais paralelas (0003_social/0005).
const P1 = U(31);
const P2 = U(32);
const P3 = U(33);
const P4 = U(34);
const PHOTO = 'data:image/jpeg;base64,/9j/4AD/2Q==';

function ok(r) { assert.ok(r.ok, r.err); return r.last; }
function expectErr(r, code) {
  assert.ok(!r.ok, `esperava erro ${code}, veio sucesso: ${r.out}`);
  assert.match(r.err, new RegExp(`ERROR:\\s+${code}\\b`), r.err);
}
function count(uid, table, where = 'true') {
  return Number(ok(as(uid, `select count(*) from ${table} where ${where}`)));
}
const permInvite = (uid, g) => ok(as(uid, `select code from public.create_invite('${g}')`));
const textChannel = (g) => pg(`select id from public.channels where group_id = '${g}' and kind = 'text' order by position, created_at limit 1`).out;
const voiceChannel = (g) => pg(`select id from public.channels where group_id = '${g}' and kind = 'voice' order by position limit 1`).out;
const makeFriends = (x, y) => {
  const un = pg(`select username from public.profiles where id = '${y}'`).out;
  ok(as(x, `select public.send_friend_request('${un}')`));
  ok(as(y, `select public.accept_friend_request('${x}')`));
};

let oldGroup;
let oldMessage;

test.before(() => {
  if (skipReason) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grpg3-'));
  fs.chmodSync(dir, 0o777);
  const data = path.join(dir, 'data');
  let r = run(`${binDir}/initdb`, ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8']);
  if (r.status !== 0) { skipReason = 'initdb falhou: ' + (r.stderr || '').slice(0, 200); return; }
  r = run(`${binDir}/pg_ctl`, ['-D', data, '-o', `-p ${port} -k ${dir} -c listen_addresses=''`, '-l', path.join(dir, 'log'), '-w', 'start']);
  if (r.status !== 0) { skipReason = 'pg_ctl start falhou: ' + (r.stderr || '').slice(0, 200); return; }
  const c = spawnSync(psqlBin, ['-h', dir, '-p', port, '-U', 'postgres', '-d', 'postgres', '-c', 'create database gr;'], { encoding: 'utf8' });
  assert.strictEqual(c.status, 0, c.stderr);
  const roles = exec(`create role anon nologin; create role authenticated nologin;
    create role service_role nologin bypassrls;`);
  assert.ok(roles.ok, roles.err);
  const boot = path.join(dir, 'boot.sql');
  fs.writeFileSync(boot, `
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    create schema extensions;
    grant usage on schema extensions to anon, authenticated, service_role;
    create extension pgcrypto with schema extensions;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    -- Realtime (como no Supabase).
    create publication supabase_realtime;
    create schema realtime;
    create table realtime.messages (id bigint generated always as identity primary key, topic text, extension text, payload jsonb);
    create function realtime.topic() returns text language sql stable
      as $$ select nullif(current_setting('realtime.topic', true), '') $$;
    alter table realtime.messages enable row level security;
    grant usage on schema realtime to anon, authenticated;
    grant select, insert on realtime.messages to anon, authenticated;
    grant execute on function realtime.topic() to anon, authenticated;
    -- Storage (como no Supabase).
    create schema storage;
    create table storage.buckets (id text primary key, name text not null, public boolean default false,
      file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
      name text, owner_id text default auth.uid()::text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated;
    grant select, insert, update, delete on storage.objects to anon, authenticated;
  `);
  const b = psqlFile(boot);
  assert.ok(b.ok, b.err);
  let m = psqlFile(sql1);
  assert.ok(m.ok, '0001 falhou: ' + m.err);
  m = psqlFile(sql2);
  assert.ok(m.ok, '0002 falhou: ' + m.err);
  const ids = Array.from({ length: 40 }, (_, i) => U(i + 1));
  const vals = ids.map((id, i) => `('${id}', 'jogador${i % 3 === 0 ? 'x' : i}@example.com')`).join(',');
  ok(pg(`insert into auth.users (id, email) values ${vals}`));
  // Dados do jeito antigo (Etapa 5): grupo de A com B e uma mensagem.
  oldGroup = ok(as(A, `select public.create_group('Os Antigos')`));
  const code = ok(as(A, 'select code from public.create_invite()'));
  ok(as(B, `select public.join_group('${code}')`));
  oldMessage = ok(as(B, `insert into public.messages (group_id, body) values ('${oldGroup}', 'mensagem antiga') returning id`));

  // Migracoes sociais paralelas (0003_social, 0004, 0005) com dados, como no banco real.
  m = psqlFile(sqlSocial);
  assert.ok(m.ok, '0003_social falhou: ' + m.err);
  ok(as(P1, `select public.social_friend('send', '${P2}')`));
  ok(as(P2, `select public.social_friend('accept', '${P1}')`));
  ok(as(P1, `select public.social_friend('send', '${P3}')`));
  ok(as(P4, `select public.social_friend('send', '${P1}')`));
  ok(as(P1, `select public.social_photo('profile', '${PHOTO}')`));
  ok(as(A, `select public.social_photo('group', '${PHOTO}')`));
  ok(as(P2, 'select public.social_privacy(false)'));
  m = psqlFile(sqlChat);
  assert.ok(m.ok, '0004 falhou: ' + m.err);
  ok(as(B, `update public.messages set body = 'mensagem antiga (editada)' where id = ${oldMessage}`));
  m = psqlFile(sqlDm);
  assert.ok(m.ok, '0005 falhou: ' + m.err);
  for (const [who, text] of [[P1, 'oi'], [P2, 'fala'], [P1, 'bora jogar']]) {
    ok(as(who, `select count(*) from public.social_dm('${who === P1 ? P2 : P1}', '${text}')`));
  }
  ok(pg(`update public.direct_messages set sent_at = timestamptz '2026-11-01 10:00:00+00' + (id * interval '1 minute')`));

  m = psqlFile(sql3);
  assert.ok(m.ok, '0006 falhou: ' + m.err);

  // Banco sem as migracoes sociais: 0001 -> 0002 -> 0006 (duas vezes).
  ok(pg('create database grb'));
  for (const [label, f] of [['boot', boot], ['0001', sql1], ['0002', sql2], ['0006', sql3], ['0006 de novo', sql3]]) {
    const r2 = psqlFile(f, 'grb');
    assert.ok(r2.ok, `grb ${label} falhou: ` + r2.err);
  }
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

t('0006 roda de novo sem erro', () => {
  const r = psqlFile(sql3);
  assert.ok(r.ok, r.err);
});

t('dados antigos preservados: canais padrao, mensagem no #geral, dono com cargo, usernames', () => {
  assert.strictEqual(pg(`select string_agg(kind || ':' || name, ',' order by kind) from public.channels where group_id = '${oldGroup}'`).out,
    'text:geral,voice:Geral');
  assert.strictEqual(pg(`select count(*) from public.channel_categories where group_id = '${oldGroup}'`).out, '2');
  assert.strictEqual(pg(`select channel_id = '${textChannel(oldGroup)}' from public.messages where id = ${oldMessage}`).out, 't');
  assert.strictEqual(pg(`select role from public.group_members where group_id = '${oldGroup}' and user_id = '${A}'`).out, 'owner');
  assert.strictEqual(pg(`select role from public.group_members where group_id = '${oldGroup}' and user_id = '${B}'`).out, 'member');
  assert.strictEqual(pg('select count(*) from public.profiles where username is null').out, '0');
  // Emails repetidos (jogadorx) geram usernames diferentes.
  assert.strictEqual(pg(`select count(distinct username) = count(*) from public.profiles`).out, 't');
  assert.match(pg(`select username from public.profiles where id = '${C}'`).out, /^[a-z0-9_.]{2,32}$/);
});

t('conta nova ganha username', () => {
  ok(pg(`insert into auth.users (id, email) values ('${U(90)}', 'Nova.Pessoa@example.com')`));
  assert.strictEqual(pg(`select username from public.profiles where id = '${U(90)}'`).out, 'nova.pessoa');
});

t('RPCs: security definer, search_path vazio, so authenticated executa', () => {
  const rpc = ['search_users(text)', 'send_friend_request(text)', 'accept_friend_request(uuid)', 'open_dm(uuid)',
    'create_group(text, integer)', 'preview_invite(text)', 'join_group(text)', 'create_invite(uuid, integer, integer)',
    'create_invite()', 'leave_group(uuid)', 'leave_group()', 'remove_member(uuid)', 'kick_member(uuid, uuid)',
    'ban_member(uuid, uuid)', 'create_channel(uuid, text, text, uuid)', 'delete_channel(uuid)',
    'pin_message(bigint, boolean)', 'unread_summary()', 'mark_read(text, bigint)', 'search_messages(text, text)',
    'transfer_ownership(uuid, uuid)', 'set_nickname(uuid, text)', 'list_bans(uuid)', 'delete_my_account()'];
  for (const f of rpc) {
    const r = pg(`select prosecdef, array_to_string(proconfig, ','),
      has_function_privilege('anon', 'public.${f}', 'execute'),
      has_function_privilege('authenticated', 'public.${f}', 'execute')
      from pg_proc where oid = 'public.${f}'::regprocedure`);
    assert.strictEqual(r.out, 't|search_path=""|f|t', f + ' ' + r.out + r.err);
  }
  for (const f of ['rate_check(text, integer, integer)', 'leave_group_from(uuid, uuid)', 'seed_channels(uuid)',
    'gen_invite_code()', 'mod_target_check(uuid, uuid, text)', 'shares_server(uuid, uuid)', 'make_username(text)']) {
    assert.strictEqual(pg(`select has_function_privilege('authenticated', 'public.${f}', 'execute')`).out, 'f', f);
  }
  assert.strictEqual(pg(`select count(*) from pg_proc where oid = to_regprocedure('public.create_group(text)')`).out, '0');
});

t('anon nao le tabelas novas nem chama RPCs', () => {
  for (const tb of ['relationships', 'channels', 'channel_categories', 'dm_channels', 'message_reactions', 'read_states', 'group_bans', 'rate_events']) {
    assert.ok(!asAnon(`select * from public.${tb}`).ok, tb);
    assert.strictEqual(pg(`select relrowsecurity from pg_class where oid = 'public.${tb}'::regclass`).out, 't', tb);
  }
  assert.ok(!asAnon(`select * from public.search_users('jo')`).ok);
  assert.ok(!asAnon(`select public.send_friend_request('x')`).ok);
});

t('app antigo continua: create_invite() sem argumentos e join com codigo permanente', () => {
  const r = as(A, `select code || '|' || (expires_at > now() + interval '300 days') from public.create_invite()`);
  const [code, longo] = ok(r).split('|');
  assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/);
  assert.strictEqual(longo, 'true');
  assert.strictEqual(pg(`select (expires_at is null) || '/' || (max_uses is null) from public.group_invites where code = '${code}'`).out, 'true/true');
  // Mesmo codigo nas proximas vezes (convite permanente do servidor).
  assert.strictEqual(ok(as(A, 'select code from public.create_invite()')), code);
  // Membro comum tambem gera.
  assert.strictEqual(ok(as(B, 'select code from public.create_invite()')), code);
});

t('busca de pessoas: prefixo, sem voce, minimo 2 letras, curinga escapado', () => {
  pg(`update public.profiles set username = 'lua_cheia', display_name = 'Lua' where id = '${C}'`);
  pg(`update public.profiles set username = 'luana', display_name = 'Luana' where id = '${D}'`);
  const r = ok(as(A, `select string_agg(username || ':' || relation, ',' order by username) from public.search_users('LU')`));
  assert.strictEqual(r, 'lua_cheia:none,luana:none');
  assert.strictEqual(ok(as(A, `select count(*) from public.search_users('@lua_')`)), '1', 'sublinhado literal');
  assert.strictEqual(ok(as(A, `select count(*) from public.search_users('%')`)), '0');
  assert.strictEqual(ok(as(A, `select count(*) from public.search_users('l')`)), '0');
  const me = pg(`select username from public.profiles where id = '${A}'`).out;
  assert.strictEqual(ok(as(A, `select count(*) from public.search_users('${me}') where id = '${A}'`)), '0');
});

t('amizade: pedir, aceitar, erros e pedido cruzado vira amizade', () => {
  expectErr(as(A, `select public.send_friend_request('ninguem_aqui')`), 'user_not_found');
  const me = pg(`select username from public.profiles where id = '${A}'`).out;
  expectErr(as(A, `select public.send_friend_request('${me}')`), 'cannot_add_self');
  assert.strictEqual(ok(as(A, `select public.send_friend_request('@Lua_Cheia')`)), 'sent');
  expectErr(as(A, `select public.send_friend_request('lua_cheia')`), 'request_exists');
  assert.strictEqual(ok(as(C, `select kind from public.relationships where other_id = '${A}'`)), 'pending_in');
  assert.strictEqual(ok(as(A, `select relation from public.search_users('lua_cheia')`)), 'pending_out');
  // C ve o perfil de A por causa do pedido.
  assert.strictEqual(count(C, 'public.profiles', `id = '${A}'`), 1);
  ok(as(C, `select public.accept_friend_request('${A}')`));
  assert.strictEqual(pg(`select string_agg(kind, ',') from public.relationships where (user_id, other_id) in (('${A}', '${C}'), ('${C}', '${A}'))`).out, 'friend,friend');
  expectErr(as(A, `select public.send_friend_request('lua_cheia')`), 'already_friends');
  expectErr(as(A, `select public.accept_friend_request('${D}')`), 'invalid_user');
  // Pedido cruzado.
  const da = pg(`select username from public.profiles where id = '${A}'`).out;
  assert.strictEqual(ok(as(D, `select public.send_friend_request('${da}')`)), 'sent');
  assert.strictEqual(ok(as(A, `select public.send_friend_request('luana')`)), 'accepted');
  // So ve as proprias linhas.
  assert.strictEqual(count(A, 'public.relationships', `user_id <> '${A}'`), 0);
  assert.ok(!as(A, `insert into public.relationships (user_id, other_id, kind) values ('${A}', '${E}', 'friend')`).ok);
});

t('recusar/cancelar, remover e bloquear', () => {
  const ue = pg(`select username from public.profiles where id = '${E}'`).out;
  ok(as(A, `select public.send_friend_request('${ue}')`));
  ok(as(A, `select public.decline_friend_request('${E}')`)); // cancela o enviado
  assert.strictEqual(pg(`select count(*) from public.relationships where '${E}' in (user_id, other_id)`).out, '0');
  ok(as(A, `select public.send_friend_request('${ue}')`));
  ok(as(E, `select public.decline_friend_request('${A}')`)); // recusa o recebido
  assert.strictEqual(pg(`select count(*) from public.relationships where '${E}' in (user_id, other_id)`).out, '0');
  ok(as(A, `select public.remove_friend('${D}')`));
  expectErr(as(A, `select public.remove_friend('${D}')`), 'invalid_user');
  // E bloqueia A: A nao acha E na busca e nao consegue pedir.
  ok(as(E, `select public.block_user('${A}')`));
  assert.strictEqual(ok(as(A, `select count(*) from public.search_users('${ue}')`)), '0');
  expectErr(as(A, `select public.send_friend_request('${ue}')`), 'user_not_found');
  expectErr(as(E, `select public.send_friend_request('${pg(`select username from public.profiles where id = '${A}'`).out}')`), 'blocked');
  ok(as(E, `select public.unblock_user('${A}')`));
  expectErr(as(E, `select public.unblock_user('${A}')`), 'invalid_user');
});

let S1;
let S2;
t('varios servidores: criar, canais padrao, convite permanente ilimitado', () => {
  S1 = ok(as(C, `select public.create_group('Servidor Um', 3)`));
  S2 = ok(as(C, `select public.create_group('Servidor Dois')`));
  assert.match(S1, UUID);
  assert.strictEqual(count(C, 'public.groups'), 2);
  assert.strictEqual(count(C, 'public.channels', `group_id = '${S1}'`), 2);
  assert.strictEqual(pg(`select icon_color from public.groups where id = '${S1}'`).out, '3');
  expectErr(as(C, `select public.create_group('x')`), 'invalid_name');
  const code = permInvite(C, S1);
  assert.strictEqual(permInvite(C, S1), code, 'mesmo codigo');
  // Muita gente entra pelo mesmo codigo (sem limite de usos).
  for (let n = 10; n <= 25; n++) ok(as(U(n), `select public.join_group('${code}')`));
  assert.strictEqual(pg(`select count(*) from public.group_members where group_id = '${S1}'`).out, '17');
  // Ja membro: devolve o id, sem erro, e nao gasta uso.
  const uses = pg(`select uses from public.group_invites where code = '${code}'`).out;
  assert.strictEqual(ok(as(U(10), `select public.join_group('${code}')`)), S1);
  assert.strictEqual(pg(`select uses from public.group_invites where code = '${code}'`).out, uses);
  // A esta no servidor antigo e entra em S1 tambem.
  ok(as(A, `select public.join_group('${code}')`));
  assert.strictEqual(count(A, 'public.groups'), 2);
});

t('prévia do convite', () => {
  const code = permInvite(C, S1);
  const r = ok(as(D, `select name || '|' || icon_color || '|' || member_count || '|' || already_member from public.preview_invite('${code.toLowerCase()}')`));
  assert.strictEqual(r, 'Servidor Um|3|18|false');
  assert.strictEqual(ok(as(C, `select already_member from public.preview_invite('${code}')`)), 't');
  expectErr(as(D, `select * from public.preview_invite('ZZZZZZZZZZ')`), 'invalid_invite');
  // D ainda nao ve o servidor.
  assert.strictEqual(count(D, 'public.groups', `id = '${S1}'`), 0);
});

t('convite com validade e limite; opcoes invalidas; so membro cria', () => {
  const um = ok(as(C, `select code || '|' || max_uses || '|' || round(extract(epoch from (expires_at - now())) / 3600) from public.create_invite('${S2}', 3600, 1)`));
  const [code, max, horas] = um.split('|');
  assert.strictEqual(max, '1');
  assert.strictEqual(horas, '1');
  ok(as(D, `select public.join_group('${code}')`));
  expectErr(as(E, `select public.join_group('${code}')`), 'invalid_invite');
  expectErr(as(C, `select * from public.create_invite('${S2}', 999, null)`), 'invalid_options');
  expectErr(as(C, `select * from public.create_invite('${S2}', null, 7)`), 'invalid_options');
  expectErr(as(F, `select * from public.create_invite('${S2}')`), 'not_member');
  const venc = ok(as(C, `select code from public.create_invite('${S2}', 1800, null)`));
  pg(`update public.group_invites set expires_at = now() - interval '1 second' where code = '${venc}'`);
  expectErr(as(F, `select public.join_group('${venc}')`), 'invalid_invite');
  // Lista e revoga (admin+).
  const perm = permInvite(C, S2);
  assert.strictEqual(ok(as(C, `select count(*) from public.list_invites('${S2}') where code = '${perm}'`)), '1');
  expectErr(as(D, `select * from public.list_invites('${S2}')`), 'not_admin');
  ok(as(C, `select public.revoke_invite('${perm}')`));
  expectErr(as(F, `select public.join_group('${perm}')`), 'invalid_invite');
  assert.notStrictEqual(permInvite(C, S2), perm, 'gera outro permanente depois de revogar');
  // Convites continuam ilegiveis direto.
  assert.ok(!as(C, 'select * from public.group_invites').ok);
});

t('cargos e moderacao: admin, expulsar, banir, transferir', () => {
  expectErr(as(U(10), `select public.kick_member('${S1}', '${U(11)}')`), 'not_admin');
  expectErr(as(U(10), `select public.set_member_role('${S1}', '${U(11)}', 'admin')`), 'not_owner');
  ok(as(C, `select public.set_member_role('${S1}', '${U(10)}', 'admin')`));
  ok(as(C, `select public.set_member_role('${S1}', '${U(12)}', 'admin')`));
  expectErr(as(C, `select public.set_member_role('${S1}', '${U(10)}', 'owner')`), 'invalid_options');
  // Admin expulsa membro, mas nao outro admin nem o dono.
  ok(as(U(10), `select public.kick_member('${S1}', '${U(11)}')`));
  expectErr(as(U(10), `select public.kick_member('${S1}', '${U(12)}')`), 'cannot_target');
  expectErr(as(U(10), `select public.kick_member('${S1}', '${C}')`), 'cannot_target');
  expectErr(as(U(10), `select public.kick_member('${S1}', '${U(10)}')`), 'cannot_target');
  expectErr(as(U(10), `select public.kick_member('${S1}', '${F}')`), 'invalid_user');
  // Banir: sai e nao volta pelo convite.
  ok(as(U(10), `select public.ban_member('${S1}', '${U(13)}')`));
  const code = permInvite(C, S1);
  expectErr(as(U(13), `select public.join_group('${code}')`), 'banned');
  assert.strictEqual(ok(as(C, `select count(*) from public.list_bans('${S1}') where user_id = '${U(13)}'`)), '1');
  expectErr(as(U(14), `select * from public.list_bans('${S1}')`), 'not_admin');
  ok(as(C, `select public.unban_member('${S1}', '${U(13)}')`));
  ok(as(U(13), `select public.join_group('${code}')`));
  // Apelido.
  ok(as(U(14), `select public.set_nickname('${S1}', '  Apelido  ')`));
  assert.strictEqual(pg(`select nickname from public.group_members where group_id = '${S1}' and user_id = '${U(14)}'`).out, 'Apelido');
  expectErr(as(U(14), `select public.set_nickname('${S1}', '<b>')`), 'invalid_name');
  ok(as(U(14), `select public.set_nickname('${S1}', null)`));
  // Ninguem mexe direto em membros.
  assert.ok(!as(C, `update public.group_members set role = 'owner' where user_id = '${U(14)}'`).ok);
  // Transferir posse.
  ok(as(C, `select public.transfer_ownership('${S2}', '${D}')`));
  assert.strictEqual(pg(`select owner_id = '${D}' from public.groups where id = '${S2}'`).out, 't');
  assert.strictEqual(pg(`select role from public.group_members where group_id = '${S2}' and user_id = '${C}'`).out, 'admin');
  expectErr(as(C, `select public.delete_group('${S2}')`), 'not_owner');
});

t('canais e categorias: admin cria, nome normalizado, nao apaga o ultimo canal de texto', () => {
  expectErr(as(U(14), `select public.create_channel('${S1}', 'text', 'x', null)`), 'not_admin');
  const cat = ok(as(C, `select public.create_category('${S1}', 'Jogos')`));
  const ch = ok(as(U(10), `select public.create_channel('${S1}', 'text', '  Bate Papo  ', '${cat}')`));
  assert.strictEqual(pg(`select name || '|' || (category_id = '${cat}') from public.channels where id = '${ch}'`).out, 'bate-papo|true');
  expectErr(as(C, `select public.create_channel('${S1}', 'text', 'a/b', null)`), 'invalid_name');
  expectErr(as(C, `select public.create_channel('${S1}', 'video', 'abc', null)`), 'invalid_options');
  expectErr(as(C, `select public.create_channel('${S1}', 'text', 'abc', '${pg(`select id from public.channel_categories where group_id = '${oldGroup}' limit 1`).out}')`), 'invalid_options');
  const vc = ok(as(C, `select public.create_channel('${S1}', 'voice', 'Sala 2', null)`));
  ok(as(C, `select public.update_channel('${ch}', p_topic => 'Assunto livre', p_position => 3)`));
  assert.strictEqual(pg(`select topic || '|' || position from public.channels where id = '${ch}'`).out, 'Assunto livre|3');
  ok(as(C, `select public.update_channel('${ch}', p_clear_category => true)`));
  assert.strictEqual(pg(`select category_id is null from public.channels where id = '${ch}'`).out, 't');
  ok(as(C, `select public.update_category('${cat}', 'Jogos 2', 5)`));
  ok(as(C, `select public.delete_category('${cat}')`));
  ok(as(C, `select public.delete_channel('${vc}')`));
  ok(as(C, `select public.delete_channel('${ch}')`));
  expectErr(as(C, `select public.delete_channel('${textChannel(S1)}')`), 'last_text_channel');
  assert.strictEqual(count(F, 'public.channels', `group_id = '${S1}'`), 0, 'quem nao e membro nao ve canais');
  assert.ok(!as(C, `insert into public.channels (group_id, kind, name) values ('${S1}', 'text', 'hack')`).ok);
});

t('mensagens em canal: enviar, ler, app antigo por group_id, editar, apagar', () => {
  const ch = textChannel(S1);
  const id = ok(as(U(14), `insert into public.messages (channel_id, body, mentions) values ('${ch}', 'ola @C', '{${C}}') returning id`));
  assert.strictEqual(pg(`select group_id = '${S1}' from public.messages where id = ${id}`).out, 't');
  assert.strictEqual(count(C, 'public.messages', `id = ${id}`), 1);
  assert.strictEqual(count(F, 'public.messages', `id = ${id}`), 0);
  // Quem nao e membro nao envia; canal de voz nao recebe texto.
  assert.ok(!as(F, `insert into public.messages (channel_id, body) values ('${ch}', 'oi')`).ok);
  expectErr(as(C, `insert into public.messages (channel_id, body) values ('${voiceChannel(S1)}', 'oi')`), 'invalid_channel');
  // Nao da para mentir o group_id.
  const g = ok(as(C, `insert into public.messages (channel_id, group_id, body) values ('${ch}', '${oldGroup}', 'x') returning group_id`));
  assert.strictEqual(g, S1);
  // App antigo: so group_id -> primeiro canal de texto.
  const old = ok(as(B, `insert into public.messages (group_id, body) values ('${oldGroup}', 'do exe antigo') returning channel_id`));
  assert.strictEqual(old, textChannel(oldGroup));
  // Resposta e edicao.
  const r = ok(as(C, `insert into public.messages (channel_id, body, reply_to) values ('${ch}', 'resposta', ${id}) returning reply_to`));
  assert.strictEqual(r, id);
  const r2 = ok(as(C, `insert into public.messages (channel_id, body, reply_to) values ('${ch}', 'resposta', ${oldMessage}) returning coalesce(reply_to::text, 'nulo')`));
  assert.strictEqual(r2, 'nulo', 'resposta de outro canal vira nula');
  ok(as(U(14), `update public.messages set body = 'ola editado' where id = ${id}`));
  assert.strictEqual(pg(`select body || '|' || (edited_at is not null) from public.messages where id = ${id}`).out, 'ola editado|true');
  as(C, `update public.messages set body = 'hack' where id = ${id}`);
  assert.strictEqual(pg(`select body from public.messages where id = ${id}`).out, 'ola editado');
  assert.ok(!as(U(14), `update public.messages set pinned = true where id = ${id}`).ok);
  assert.ok(!as(U(14), `update public.messages set channel_id = '${textChannel(oldGroup)}' where id = ${id}`).ok);
  // Corpo: ate 2000; vazio so com anexo.
  assert.ok(!as(C, `insert into public.messages (channel_id, body) values ('${ch}', '   ')`).ok);
  assert.ok(as(C, `insert into public.messages (channel_id, body) values ('${ch}', repeat('a', 2000))`).ok);
  assert.ok(!as(C, `insert into public.messages (channel_id, body) values ('${ch}', repeat('a', 2001))`).ok);
  // Admin apaga mensagem dos outros; membro comum nao.
  const outra = ok(as(U(15), `insert into public.messages (channel_id, body) values ('${ch}', 'apagar') returning id`));
  as(U(14), `delete from public.messages where id = ${outra}`);
  assert.strictEqual(pg(`select count(*) from public.messages where id = ${outra}`).out, '1');
  ok(as(U(10), `delete from public.messages where id = ${outra}`));
  assert.strictEqual(pg(`select count(*) from public.messages where id = ${outra}`).out, '0');
});

t('anexos: caminho do proprio canal, ate 4, validados', () => {
  const ch = textChannel(S1);
  const good = `[{"path":"g_${S1}/${ch}/${U(77)}/foto.png","name":"foto.png","size":1234,"mime":"image/png","width":10,"height":10}]`;
  ok(as(C, `insert into public.messages (channel_id, body, attachments) values ('${ch}', '', '${good}')`));
  const bad = `[{"path":"g_${oldGroup}/${textChannel(oldGroup)}/${U(77)}/x.png","name":"x.png","size":1,"mime":"image/png"}]`;
  expectErr(as(C, `insert into public.messages (channel_id, body, attachments) values ('${ch}', 'x', '${bad}')`), 'invalid_attachment');
  const big = `[{"path":"g_${S1}/${ch}/${U(77)}/x.bin","name":"x.bin","size":9999999,"mime":"a/b"}]`;
  expectErr(as(C, `insert into public.messages (channel_id, body, attachments) values ('${ch}', 'x', '${big}')`), 'invalid_attachment');
  const five = JSON.stringify(Array.from({ length: 5 }, () => JSON.parse(good)[0]));
  assert.ok(!as(C, `insert into public.messages (channel_id, body, attachments) values ('${ch}', 'x', '${five}')`).ok);
});

t('reacoes: so quem le a mensagem; propria; limite de emojis diferentes', () => {
  const ch = textChannel(S1);
  const id = ok(as(C, `insert into public.messages (channel_id, body) values ('${ch}', 'reaja') returning id`));
  ok(as(U(14), `insert into public.message_reactions (message_id, emoji) values (${id}, '👍')`));
  ok(as(C, `insert into public.message_reactions (message_id, emoji) values (${id}, '👍')`));
  assert.ok(!as(U(14), `insert into public.message_reactions (message_id, emoji) values (${id}, '👍')`).ok, 'duplicada');
  assert.ok(!as(F, `insert into public.message_reactions (message_id, emoji) values (${id}, '👍')`).ok, 'quem nao le');
  assert.ok(!as(C, `insert into public.message_reactions (message_id, user_id, emoji) values (${id}, '${U(14)}', '🔥')`).ok);
  assert.strictEqual(count(U(15), 'public.message_reactions', `message_id = ${id}`), 2);
  assert.strictEqual(count(F, 'public.message_reactions', `message_id = ${id}`), 0);
  as(C, `delete from public.message_reactions where message_id = ${id} and user_id = '${U(14)}'`);
  assert.strictEqual(pg(`select count(*) from public.message_reactions where message_id = ${id}`).out, '2');
  ok(as(C, `delete from public.message_reactions where message_id = ${id} and user_id = '${C}'`));
  for (let i = 0; i < 20; i++) pg(`insert into public.message_reactions (message_id, user_id, emoji) values (${id}, '${U(16)}', 'e${i}')`);
  expectErr(as(C, `insert into public.message_reactions (message_id, emoji) values (${id}, 'novo')`), 'too_many_reactions');
  ok(as(C, `insert into public.message_reactions (message_id, emoji) values (${id}, 'e1')`));
});

t('fixar: admin no servidor; nao lidas, mencoes e marcar como lido; busca', () => {
  const ch = textChannel(S1);
  const id = ok(as(U(15), `insert into public.messages (channel_id, body, mentions) values ('${ch}', 'oi 50%_ @dono', '{${C}}') returning id`));
  expectErr(as(U(15), `select public.pin_message(${id}, true)`), 'not_admin');
  ok(as(U(10), `select public.pin_message(${id}, true)`));
  assert.strictEqual(pg(`select pinned from public.messages where id = ${id}`).out, 't');
  expectErr(as(F, `select public.pin_message(${id}, true)`), 'invalid_message');
  const sum = () => ok(as(C, `select unread || '|' || mentions || '|' || (last_message_id = (select max(id) from public.messages where channel_id = '${ch}')) from public.unread_summary() where target = 'c:${ch}'`));
  const [unread, mentions, last] = sum().split('|');
  assert.ok(Number(unread) >= 1);
  assert.ok(Number(mentions) >= 1);
  assert.strictEqual(last, 'true');
  ok(as(C, `select public.mark_read('c:${ch}', (select max(id) from public.messages where channel_id = '${ch}'))`));
  assert.strictEqual(sum().split('|').slice(0, 2).join('|'), '0|0');
  // Marcar como lido nao volta para tras.
  ok(as(C, `select public.mark_read('c:${ch}', 1)`));
  assert.strictEqual(sum().split('|')[0], '0');
  expectErr(as(F, `select public.mark_read('c:${ch}', 1)`), 'invalid_channel');
  expectErr(as(C, `select public.mark_read('lixo', 1)`), 'invalid_channel');
  assert.strictEqual(count(C, 'public.read_states', `user_id <> '${C}'`), 0);
  // Busca escapa % e _.
  assert.strictEqual(ok(as(C, `select count(*) from public.search_messages('c:${ch}', '50%_')`)), '1');
  assert.strictEqual(ok(as(C, `select count(*) from public.search_messages('c:${ch}', '%')`)), '1');
  expectErr(as(F, `select * from public.search_messages('c:${ch}', 'oi')`), 'invalid_channel');
});

let DM;
t('DM: so amigos ou quem divide servidor; mensagens privadas; bloqueio impede', () => {
  // A e C sao amigos (teste de amizade).
  DM = ok(as(A, `select public.open_dm('${C}')`));
  assert.strictEqual(ok(as(C, `select public.open_dm('${A}')`)), DM, 'mesma DM dos dois lados');
  expectErr(as(A, `select public.open_dm('${U(39)}')`), 'dm_not_allowed');
  expectErr(as(A, `select public.open_dm('${A}')`), 'invalid_user');
  // Quem divide servidor (U14 e C em S1) pode.
  const dm2 = ok(as(U(14), `select public.open_dm('${C}')`));
  assert.match(dm2, UUID);
  const id = ok(as(A, `insert into public.messages (dm_id, body) values ('${DM}', 'segredo') returning id`));
  assert.strictEqual(pg(`select group_id is null from public.messages where id = ${id}`).out, 't');
  assert.strictEqual(count(C, 'public.messages', `id = ${id}`), 1);
  assert.strictEqual(count(U(14), 'public.messages', `id = ${id}`), 0);
  assert.ok(!as(U(14), `insert into public.messages (dm_id, body) values ('${DM}', 'intruso')`).ok);
  assert.strictEqual(count(U(14), 'public.dm_channels', `id = '${DM}'`), 0);
  assert.strictEqual(pg(`select last_message_at is not null from public.dm_channels where id = '${DM}'`).out, 't');
  // Fixar na DM: qualquer participante.
  ok(as(C, `select public.pin_message(${id}, true)`));
  assert.ok(Number(ok(as(C, `select unread from public.unread_summary() where target = 'd:${DM}'`))) >= 1);
  // Bloqueio: ninguem envia.
  ok(as(C, `select public.block_user('${A}')`));
  expectErr(as(A, `insert into public.messages (dm_id, body) values ('${DM}', 'oi')`), 'blocked');
  expectErr(as(C, `insert into public.messages (dm_id, body) values ('${DM}', 'oi')`), 'blocked');
  ok(as(C, `select public.unblock_user('${A}')`));
  ok(as(A, `insert into public.messages (dm_id, body) values ('${DM}', 'voltei')`));
});

t('perfis visiveis: amigo, colega, DM; estranho nao; username pode mudar e e unico', () => {
  assert.strictEqual(count(U(14), 'public.profiles', `id = '${C}'`), 1, 'colega de servidor');
  assert.strictEqual(count(U(39), 'public.profiles', `id = '${C}'`), 0, 'estranho');
  ok(as(C, `update public.profiles set username = '  Fantasma_Lua ', about = 'oi', custom_status = 'jogando', status = 'dnd', avatar_color = 5 where id = '${C}'`));
  assert.strictEqual(pg(`select username || '|' || status from public.profiles where id = '${C}'`).out, 'fantasma_lua|dnd');
  assert.ok(!as(D, `update public.profiles set username = 'fantasma_lua' where id = '${D}'`).ok, 'unico');
  assert.ok(!as(D, `update public.profiles set username = 'a b' where id = '${D}'`).ok);
  assert.ok(!as(D, `update public.profiles set status = 'ocupado' where id = '${D}'`).ok);
  assert.ok(!as(D, `update public.profiles set avatar_path = '${C}/${U(70)}.png' where id = '${D}'`).ok, 'avatar alheio');
  ok(as(D, `update public.profiles set avatar_path = '${D}/${U(70)}.png' where id = '${D}'`));
  assert.ok(!as(D, `update public.profiles set steam_account_id = 1 where id = '${D}'`).ok);
});

t('MMR: colega de servidor e amigo (friends) veem; estranho nao', () => {
  ok(pg(`insert into public.mmr_snapshots (user_id, current_mmr, goal_mmr, start_mmr, status) values ('${C}', 3000, 3500, 2900, 'on_track')`));
  pg(`update public.profiles set mmr_visibility = 'friends' where id = '${C}'`);
  assert.strictEqual(count(U(14), 'public.mmr_snapshots', `user_id = '${C}'`), 1);
  assert.strictEqual(count(A, 'public.mmr_snapshots', `user_id = '${C}'`), 1, 'amigo e colega');
  assert.strictEqual(count(U(39), 'public.mmr_snapshots', `user_id = '${C}'`), 0);
  pg(`update public.profiles set mmr_visibility = 'nobody' where id = '${C}'`);
  assert.strictEqual(count(U(14), 'public.mmr_snapshots', `user_id = '${C}'`), 0);
});

t('Realtime: topicos privados server:/user:/dm:', () => {
  const can = (uid, topic, op) => {
    const sqlText = op === 'read'
      ? `set realtime.topic = '${topic}'; select count(*) from realtime.messages`
      : `set realtime.topic = '${topic}'; insert into realtime.messages (topic, extension) values ('${topic}', 'presence')`;
    const r = as(uid, sqlText);
    return op === 'read' ? r.ok && Number(r.last) > 0 : r.ok;
  };
  ok(pg(`insert into realtime.messages (topic, extension) values ('x', 'broadcast')`));
  assert.strictEqual(can(U(14), `server:${S1}`, 'read'), true);
  assert.strictEqual(can(U(14), `server:${S1}`, 'write'), true);
  assert.strictEqual(can(U(39), `server:${S1}`, 'read'), false);
  assert.strictEqual(can(U(39), `server:${S1}`, 'write'), false);
  assert.strictEqual(can(A, `dm:${DM}`, 'read'), true);
  assert.strictEqual(can(U(14), `dm:${DM}`, 'read'), false);
  // user:<id>: amigos/colegas leem; so o dono escreve.
  assert.strictEqual(can(A, `user:${C}`, 'read'), true);
  assert.strictEqual(can(A, `user:${C}`, 'write'), false);
  assert.strictEqual(can(C, `user:${C}`, 'write'), true);
  assert.strictEqual(can(U(39), `user:${C}`, 'read'), false);
  assert.strictEqual(can(A, 'qualquer', 'read'), false);
  assert.strictEqual(can(A, `server:${S1}'; drop table x; --`, 'read'), false);
  // Tabelas na publicacao.
  const pub = pg(`select string_agg(tablename, ',' order by tablename) from pg_publication_tables where pubname = 'supabase_realtime'`).out;
  for (const tb of ['messages', 'message_reactions', 'relationships', 'group_members', 'channels', 'dm_channels']) {
    assert.ok(pub.split(',').includes(tb), tb);
  }
  assert.strictEqual(pg(`select relreplident from pg_class where oid = 'public.messages'::regclass`).out, 'f');
});

t('Storage: buckets e quem grava/le anexos e avatares', () => {
  assert.strictEqual(pg(`select string_agg(id || ':' || public || ':' || file_size_limit, ',' order by id) from storage.buckets`).out,
    'attachments:false:8388608,avatars:true:2097152');
  const ch = textChannel(S1);
  const path1 = `g_${S1}/${ch}/${U(71)}/foto.png`;
  ok(as(U(14), `insert into storage.objects (bucket_id, name) values ('attachments', '${path1}')`));
  assert.ok(!as(U(39), `insert into storage.objects (bucket_id, name) values ('attachments', 'g_${S1}/${ch}/${U(72)}/x.png')`).ok);
  assert.ok(!as(U(14), `insert into storage.objects (bucket_id, name) values ('attachments', 'g_${S1}/${voiceChannel(S1)}/${U(72)}/x.png')`).ok);
  assert.ok(!as(U(14), `insert into storage.objects (bucket_id, name) values ('attachments', 'g_${S1}/${ch}/../../x.png')`).ok);
  assert.strictEqual(count(C, 'storage.objects', `name = '${path1}'`), 1);
  assert.strictEqual(count(U(39), 'storage.objects', `name = '${path1}'`), 0);
  // So quem enviou apaga.
  as(C, `delete from storage.objects where name = '${path1}'`);
  assert.strictEqual(pg(`select count(*) from storage.objects where name = '${path1}'`).out, '1');
  ok(as(U(14), `delete from storage.objects where name = '${path1}'`));
  assert.strictEqual(pg(`select count(*) from storage.objects where name = '${path1}'`).out, '0');
  // DM.
  ok(as(A, `insert into storage.objects (bucket_id, name) values ('attachments', 'd_${DM}/${U(73)}/doc.pdf')`));
  assert.ok(!as(U(14), `insert into storage.objects (bucket_id, name) values ('attachments', 'd_${DM}/${U(74)}/doc.pdf')`).ok);
  // Avatar: propria pasta; icone do servidor so admin.
  ok(as(D, `insert into storage.objects (bucket_id, name) values ('avatars', '${D}/${U(75)}.png')`));
  assert.ok(!as(D, `insert into storage.objects (bucket_id, name) values ('avatars', '${C}/${U(75)}.png')`).ok);
  ok(as(U(10), `insert into storage.objects (bucket_id, name) values ('avatars', 'g_${S1}/${U(76)}.webp')`));
  assert.ok(!as(U(14), `insert into storage.objects (bucket_id, name) values ('avatars', 'g_${S1}/${U(76)}.webp')`).ok);
  ok(as(U(10), `select public.set_group_icon('${S1}', 'g_${S1}/${U(76)}.webp')`));
  expectErr(as(U(10), `select public.set_group_icon('${S1}', 'g_${S2}/${U(76)}.webp')`), 'invalid_options');
});

t('sair: dono passa a posse para admin mais antigo; sozinho apaga; compat leave_group()', () => {
  ok(as(C, `select public.leave_group('${S1}')`));
  assert.strictEqual(pg(`select owner_id = '${U(10)}' from public.groups where id = '${S1}'`).out, 't');
  assert.strictEqual(pg(`select role from public.group_members where group_id = '${S1}' and user_id = '${U(10)}'`).out, 'owner');
  expectErr(as(C, `select public.leave_group('${S1}')`), 'not_member');
  const solo = ok(as(F, `select public.create_group('Solo')`));
  ok(as(F, `select public.leave_group('${solo}')`));
  assert.strictEqual(pg(`select count(*) from public.groups where id = '${solo}'`).out, '0');
  // App antigo: B sai do primeiro servidor dele (o antigo).
  ok(as(B, 'select public.leave_group()'));
  assert.strictEqual(pg(`select count(*) from public.group_members where group_id = '${oldGroup}' and user_id = '${B}'`).out, '0');
  expectErr(as(B, 'select public.leave_group()'), 'not_in_group');
});

t('compat remove_member(uuid): dono do primeiro servidor remove', () => {
  const code = ok(as(A, 'select code from public.create_invite()'));
  ok(as(E, `select public.join_group('${code}')`));
  expectErr(as(E, `select public.remove_member('${A}')`), 'not_owner');
  ok(as(A, `select public.remove_member('${E}')`));
  assert.strictEqual(pg(`select count(*) from public.group_members where group_id = '${oldGroup}' and user_id = '${E}'`).out, '0');
});

t('apagar conta: sai de todos os servidores sem sumir com eles', () => {
  const g = ok(as(U(30), `select public.create_group('Do Trinta')`));
  ok(as(U(31), `select public.join_group('${permInvite(U(30), g)}')`));
  ok(as(U(30), 'select public.delete_my_account()'));
  assert.strictEqual(pg(`select owner_id = '${U(31)}' from public.groups where id = '${g}'`).out, 't');
  assert.strictEqual(pg(`select count(*) from auth.users where id = '${U(30)}'`).out, '0');
});

// ---------------------------------------------------------------------------
// Compatibilidade com 0003_social / 0004 / 0005
// ---------------------------------------------------------------------------
const rel = (x, y) => pg(`select kind from public.relationships where user_id = '${x}' and other_id = '${y}'`).out;
const dmOf = (x, y) => pg(`select id from public.dm_channels where user_a = least('${x}'::uuid, '${y}'::uuid) and user_b = greatest('${x}'::uuid, '${y}'::uuid)`).out;

t('compat: amizades e pedidos antigos viram relationships nas duas direcoes', () => {
  assert.strictEqual(rel(P1, P2), 'friend');
  assert.strictEqual(rel(P2, P1), 'friend');
  assert.strictEqual(rel(P1, P3), 'pending_out');
  assert.strictEqual(rel(P3, P1), 'pending_in');
  assert.strictEqual(rel(P4, P1), 'pending_out');
  assert.strictEqual(rel(P1, P4), 'pending_in');
  // O app novo enxerga: P1 aceita P4 pela RPC nova.
  ok(as(P1, `select public.accept_friend_request('${P4}')`));
  assert.strictEqual(rel(P4, P1), 'friend');
});

t('compat: conversas privadas antigas viram DM com as datas originais', () => {
  const d = dmOf(P1, P2);
  assert.match(d, UUID);
  assert.strictEqual(pg(`select string_agg(body, ',' order by id) from public.messages where dm_id = '${d}'`).out, 'oi,fala,bora jogar');
  assert.strictEqual(pg(`select count(*) from public.messages m join public.direct_messages o on o.body = m.body
    where m.dm_id = '${d}' and m.created_at = o.sent_at and m.user_id = o.sender`).out, '3');
  assert.strictEqual(pg(`select last_message_at = (select max(sent_at) from public.direct_messages) from public.dm_channels where id = '${d}'`).out, 't');
  assert.strictEqual(count(P1, 'public.messages', `dm_id = '${d}'`), 3);
  assert.strictEqual(count(P3, 'public.messages', `dm_id = '${d}'`), 0, 'estranho nao le');
  // Limite de taxa voltou a valer depois da copia.
  assert.strictEqual(pg(`select count(*) from pg_trigger where tgrelid = 'public.messages'::regclass and tgenabled = 'D'`).out, '0');
});

t('compat: fotos, mensagem editada, um so gatilho de edicao e uma so politica de update', () => {
  assert.strictEqual(pg(`select photo from public.profiles where id = '${P1}'`).out, PHOTO);
  assert.strictEqual(pg(`select photo from public.groups where id = '${oldGroup}'`).out, PHOTO);
  assert.strictEqual(pg(`select body || '|' || (edited_at is not null) from public.messages where id = ${oldMessage}`).out,
    'mensagem antiga (editada)|true');
  assert.strictEqual(pg(`select count(*) from pg_trigger where tgrelid = 'public.messages'::regclass and tgname = 'messages_set_edited_at'`).out, '0');
  assert.strictEqual(pg(`select count(*) from pg_policies where tablename = 'messages' and cmd = 'UPDATE'`).out, '1');
  // Editar continua marcando edited_at (gatilho do 0006).
  const id = ok(as(P1, `insert into public.messages (dm_id, body) values ('${dmOf(P1, P2)}', 'antes') returning id`));
  ok(as(P1, `update public.messages set body = 'depois' where id = ${id}`));
  assert.strictEqual(pg(`select edited_at is not null from public.messages where id = ${id}`).out, 't');
});

t('compat: funcoes social_* do .exe anterior funcionam sobre o modelo novo', () => {
  const people = ok(as(P1, `select string_agg(state, ',' order by id) from public.social_people(null, null)`));
  assert.strictEqual(people, 'self,friend,outgoing,friend'); // P1, P2, P3 e P4 (aceito no teste acima)
  // DM antiga: envia e le pela funcao velha, grava no modelo novo.
  const r = ok(as(P2, `select string_agg(body, ',' order by id) from public.social_dm('${P1}', 'pelo exe velho')`));
  assert.ok(r.endsWith('pelo exe velho'), r);
  assert.strictEqual(pg(`select count(*) from public.messages where dm_id = '${dmOf(P1, P2)}' and body = 'pelo exe velho'`).out, '1');
  expectErr(as(P3, `select * from public.social_dm('${P1}', 'oi')`), 'invalid_user');
  // Quem escolheu nao aparecer: fora da busca para estranhos, visivel para quem ja tem relacao.
  const s2user = pg(`select username from public.profiles where id = '${P2}'`).out;
  assert.strictEqual(ok(as(P3, `select count(*) from public.search_users('${s2user}')`)), '0');
  assert.strictEqual(ok(as(P1, `select count(*) from public.search_users('${s2user}')`)), '1');
  expectErr(as(P3, `select public.social_friend('send', '${P2}')`), 'invalid_user');
  // Pedido pelo velho, aceite pelo velho, remover pelo velho.
  ok(as(P3, `select public.social_friend('send', '${P4}')`));
  assert.strictEqual(rel(P4, P3), 'pending_in');
  ok(as(P4, `select public.social_friend('accept', '${P3}')`));
  assert.strictEqual(rel(P3, P4), 'friend');
  ok(as(P3, `select public.social_friend('remove', '${P4}')`));
  assert.strictEqual(rel(P3, P4), '');
  // Bloqueio pelo app novo vale para a funcao velha.
  ok(as(P4, `select public.block_user('${P3}')`));
  expectErr(as(P3, `select public.social_friend('send', '${P4}')`), 'invalid_user');
  // MMR antigo delega para o novo.
  assert.strictEqual(ok(as(P1, `select public.can_read_social_mmr('${P1}')`)), 't');
  assert.ok(!asAnon(`select public.social_people(null, null)`).ok, 'anon nao chama');
});

t('compat: rodar 0006 de novo nao duplica nem desfaz mudancas feitas no app novo', () => {
  ok(as(P1, `select public.remove_friend('${P2}')`));
  const d = dmOf(P1, P2);
  const before = pg(`select count(*) from public.messages where dm_id = '${d}'`).out;
  const r = psqlFile(sql3);
  assert.ok(r.ok, r.err);
  assert.strictEqual(rel(P1, P2), '', 'amizade removida continua removida');
  assert.strictEqual(pg(`select count(*) from public.messages where dm_id = '${d}'`).out, before);
  assert.strictEqual(pg(`select count(*) from public.dm_channels where user_a = least('${P1}'::uuid, '${P2}'::uuid)
    and user_b = greatest('${P1}'::uuid, '${P2}'::uuid)`).out, '1');
});

t('banco sem 0003_social/0004/0005: 0006 cria o necessario e as funcoes antigas existem', () => {
  const g = (sqlText) => exec(sqlText, 'grb');
  assert.strictEqual(g(`select count(*) from information_schema.columns where table_schema = 'public'
    and ((table_name = 'profiles' and column_name in ('photo', 'discoverable', 'username')) or (table_name = 'groups' and column_name = 'photo'))`).last, '4');
  assert.strictEqual(g(`select count(*) from pg_proc where proname in ('social_people', 'social_friend', 'social_photo', 'social_privacy', 'social_dm', 'can_read_social_mmr')`).last, '6');
  assert.strictEqual(g(`select to_regclass('public.friendships') is null and to_regclass('public.direct_messages') is null`).last, 't');
  ok(g(`insert into auth.users (id, email) values ('${U(1)}', 'um@example.com'), ('${U(2)}', 'dois@example.com')`));
  const asB = (uid, q) => exec(`set request.jwt.claim.sub = '${uid}'; set role authenticated; ${q}`, 'grb');
  const un2 = g(`select username from public.profiles where id = '${U(2)}'`).last;
  assert.strictEqual(asB(U(1), `select public.send_friend_request('${un2}')`).last, 'sent');
  assert.strictEqual(asB(U(2), `select string_agg(state, ',' order by id) from public.social_people(null, null)`).last, 'incoming,self');
  assert.ok(asB(U(2), `select public.social_friend('accept', '${U(1)}')`).ok);
  const sent = asB(U(1), `select body from public.social_dm('${U(2)}', 'oi grb')`);
  assert.ok(sent.ok, sent.err);
  assert.strictEqual(sent.last, 'oi grb');
  assert.ok(asB(U(1), `select public.social_photo('profile', '${PHOTO}')`).ok);
});
