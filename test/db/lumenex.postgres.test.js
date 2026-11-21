'use strict';
// Executa a 0007_lumenex.sql de verdade num Postgres temporario (se houver servidor local):
// banco "gr"  0001 -> 0002 -> 0003_social -> 0004 -> 0005 -> 0006 -> 0007 -> 0007 (de novo);
// banco "grb" 0001 -> 0002 -> 0006 -> 0007 -> 0007.
// Imita o que o Supabase tem: auth, extensions, publicacao supabase_realtime, realtime.messages/send e storage.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const migDir = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const M = (f) => path.join(migDir, f);
const CHAIN_FULL = ['0001_perfis.sql', '0002_grupo.sql', '0003_social.sql', '0004_chat_mensagens.sql',
  '0005_mensagens_diretas.sql', '0006_discord.sql'];
const CHAIN_SHORT = ['0001_perfis.sql', '0002_grupo.sql', '0006_discord.sql'];
const SQL7 = M('0007_lumenex.sql');

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
const port = '57' + String(Math.floor(100 + Math.random() * 800));
if (!binDir || !psqlBin) skipReason = 'Postgres local nao encontrado';
else if (!pgcryptoOk) skipReason = 'extensao pgcrypto nao instalada no Postgres local';

function exec(sqlText, db = 'gr') {
  const r = spawnSync(psqlBin, ['-h', dir, '-p', port, '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', '-At', '-c', sqlText],
    { encoding: 'utf8' });
  const out = (r.stdout || '').trim();
  return { ok: r.status === 0, out, last: out.split('\n').pop(), err: (r.stderr || '').trim() };
}
function psqlFile(f, db = 'gr') {
  const r = spawnSync(psqlBin, ['-h', dir, '-p', port, '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', '-f', f],
    { encoding: 'utf8' });
  return { ok: r.status === 0, err: (r.stderr || '').trim() };
}
const pg = (s, db) => exec(s, db);
const as = (uid, s, db) => exec(`set request.jwt.claim.sub = '${uid}'; set role authenticated; ${s}`, db);
const asAnon = (s) => exec(`set request.jwt.claim.sub = ''; set role anon; ${s}`);
function ok(r) { assert.ok(r.ok, r.err); return r.last; }
function expectErr(r, code) {
  assert.ok(!r.ok, `esperava erro ${code}, veio sucesso: ${r.out}`);
  assert.match(r.err, new RegExp(`ERROR:\\s+${code}\\b`), r.err);
}

const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const OWNER = U(1);
const ADMIN = U(2);
const MEMBER = U(3);
const OTHER = U(4); // fora do servidor
const OUT2 = U(5);
const F1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const F2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let G; // servidor de teste
let G2; // outro servidor (de OTHER)

const BOOT = `
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
  create publication supabase_realtime;
  create schema realtime;
  create table realtime.messages (id bigint generated always as identity primary key, topic text, extension text, payload jsonb);
  create function realtime.topic() returns text language sql stable
    as $$ select nullif(current_setting('realtime.topic', true), '') $$;
  alter table realtime.messages enable row level security;
  grant usage on schema realtime to anon, authenticated;
  grant select, insert on realtime.messages to anon, authenticated;
  grant execute on function realtime.topic() to anon, authenticated;
  create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void
    language sql security definer
    as $$ insert into realtime.messages (topic, extension, payload)
          values (topic, 'broadcast', jsonb_build_object('event', event, 'payload', payload)) $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
    name text, owner_id text default auth.uid()::text);
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
`;

test.before(() => {
  if (skipReason) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grpg7-'));
  fs.chmodSync(dir, 0o777);
  const data = path.join(dir, 'data');
  let r = run(`${binDir}/initdb`, ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8']);
  if (r.status !== 0) { skipReason = 'initdb falhou: ' + (r.stderr || '').slice(0, 200); return; }
  r = run(`${binDir}/pg_ctl`, ['-D', data, '-o', `-p ${port} -k ${dir} -c listen_addresses=''`, '-l', path.join(dir, 'log'), '-w', 'start']);
  if (r.status !== 0) { skipReason = 'pg_ctl start falhou: ' + (r.stderr || '').slice(0, 200); return; }
  for (const db of ['gr', 'grb']) {
    const c = spawnSync(psqlBin, ['-h', dir, '-p', port, '-U', 'postgres', '-d', 'postgres', '-c', `create database ${db};`], { encoding: 'utf8' });
    assert.strictEqual(c.status, 0, c.stderr);
  }
  ok(exec('create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;'));
  const boot = path.join(dir, 'boot.sql');
  fs.writeFileSync(boot, BOOT);
  for (const [db, chain] of [['gr', CHAIN_FULL], ['grb', CHAIN_SHORT]]) {
    let m = psqlFile(boot, db);
    assert.ok(m.ok, `${db} boot: ${m.err}`);
    for (const f of chain) {
      m = psqlFile(M(f), db);
      assert.ok(m.ok, `${db} ${f}: ${m.err}`);
      if (f === '0002_grupo.sql') {
        // Pessoas e dados antes da 0006, do jeito antigo.
        const ids = Array.from({ length: 12 }, (_, i) => U(i + 1));
        ok(pg(`insert into auth.users (id, email) values ${ids.map((id, i) => `('${id}', 'p${i}@example.com')`).join(',')}`, db));
      }
    }
    // Avatar antigo da Etapa 6 gravado direto na coluna (app antigo) antes da 0007.
    ok(as(MEMBER, `update public.profiles set avatar_path = '${MEMBER}/${F1}.png' where id = '${MEMBER}'`, db));
    for (const label of ['0007', '0007 de novo']) {
      m = psqlFile(SQL7, db);
      assert.ok(m.ok, `${db} ${label}: ${m.err}`);
    }
  }
  G = ok(as(OWNER, `select public.create_group('Lumenex', 0)`));
  const code = ok(as(OWNER, `select code from public.create_invite('${G}')`));
  ok(as(ADMIN, `select public.join_group('${code}')`));
  ok(as(MEMBER, `select public.join_group('${code}')`));
  ok(as(OWNER, `select public.set_member_role('${G}', '${ADMIN}', 'admin')`));
  G2 = ok(as(OTHER, `select public.create_group('Outro', 0)`));
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

const chan = (g, kind) => pg(`select id from public.channels where group_id = '${g}' and kind = '${kind}' order by position limit 1`).out;

t('0007 exige a 0006 e preserva dados: avatar antigo continua valido', () => {
  assert.strictEqual(pg(`select avatar_path from public.profiles where id = '${MEMBER}'`).out, `${MEMBER}/${F1}.png`);
  assert.strictEqual(pg(`select avatar_path from public.profiles where id = '${MEMBER}'`, 'grb').out, `${MEMBER}/${F1}.png`);
  assert.strictEqual(pg(`select banner_pos || '/' || avatar_animated || '/' || coalesce(avatar_frame, '-') from public.profiles where id = '${OWNER}'`).out,
    '50/false/-');
  ok(pg('create database grc'));
  const r = psqlFile(SQL7, 'grc');
  assert.ok(!r.ok);
  assert.match(r.err, /Rode antes a 0006_discord\.sql/);
});

t('RPCs novas: security definer, search_path vazio, so authenticated', () => {
  for (const f of ['set_profile_media(text, text, text, boolean)', 'update_profile_look(text, text, jsonb, integer)',
    'reset_profile_look()', 'set_appearance_theme(text)', 'reorder_channels(uuid, jsonb, jsonb)',
    'move_voice_member(uuid, uuid, uuid)']) {
    const r = pg(`select prosecdef, array_to_string(proconfig, ','),
      has_function_privilege('anon', 'public.${f}', 'execute'),
      has_function_privilege('authenticated', 'public.${f}', 'execute')
      from pg_proc where oid = 'public.${f}'::regprocedure`);
    assert.strictEqual(r.out, 't|search_path=""|f|t', f + ' ' + r.out + r.err);
  }
  assert.ok(!asAnon('select public.reset_profile_look()').ok);
});

t('colunas novas nao aceitam update direto (so pelas RPCs)', () => {
  for (const [col, val] of [['banner_path', `'${OWNER}/banner/${F1}.png'`], ['avatar_frame', `'gold'`],
    ['profile_effect', `'burst'`], ['avatar_crop', `'{"x":1,"y":1,"zoom":1}'`], ['banner_pos', '10'],
    ['appearance_theme', `'midnight'`], ['avatar_animated', 'true'], ['avatar_thumb_path', `'${OWNER}/avatar/${F1}.thumb.webp'`]]) {
    const r = as(OWNER, `update public.profiles set ${col} = ${val} where id = '${OWNER}'`);
    assert.ok(!r.ok, col);
    assert.match(r.err, /permission denied/, col);
  }
});

t('set_profile_media: avatar e banner na propria pasta, com miniatura e animado', () => {
  ok(as(OWNER, `select public.set_profile_media('avatar', '${OWNER}/avatar/${F1}.gif', '${OWNER}/avatar/${F1}.thumb.webp', true)`));
  ok(as(OWNER, `select public.set_profile_media('banner', '${OWNER}/banner/${F2}.webp', '${OWNER}/banner/${F2}.thumb.webp', true)`));
  assert.strictEqual(pg(`select avatar_path || '|' || avatar_thumb_path || '|' || avatar_animated || '|' || banner_path || '|' || banner_animated
    from public.profiles where id = '${OWNER}'`).out,
  `${OWNER}/avatar/${F1}.gif|${OWNER}/avatar/${F1}.thumb.webp|true|${OWNER}/banner/${F2}.webp|true`);
  // Pasta de outra pessoa, tipo errado, sem miniatura, miniatura de outro tipo, caminho torto.
  for (const args of [
    `'avatar', '${ADMIN}/avatar/${F1}.png', '${ADMIN}/avatar/${F1}.thumb.webp', false`,
    `'avatar', '${OWNER}/banner/${F1}.png', '${OWNER}/banner/${F1}.thumb.webp', false`,
    `'avatar', '${OWNER}/avatar/${F1}.png', null, false`,
    `'avatar', '${OWNER}/avatar/${F1}.png', '${OWNER}/banner/${F1}.thumb.webp', false`,
    `'banner', '${OWNER}/banner/../${F1}.png', '${OWNER}/banner/${F1}.thumb.webp', false`,
    `'banner', '${OWNER}/banner/${F1}.svg', '${OWNER}/banner/${F1}.thumb.webp', false`,
    `'avatar', null, '${OWNER}/avatar/${F1}.thumb.webp', false`,
  ]) expectErr(as(OWNER, `select public.set_profile_media(${args})`), 'invalid_media');
  expectErr(as(OWNER, `select public.set_profile_media('capa', null, null, false)`), 'invalid_options');
  // Remover limpa miniatura, animado e recorte/posicao.
  ok(as(OWNER, `select public.update_profile_look(null, null, '{"x":10,"y":20,"zoom":2}', 30)`));
  ok(as(OWNER, `select public.set_profile_media('banner', null, null, false)`));
  assert.strictEqual(pg(`select coalesce(banner_path, '-') || coalesce(banner_thumb_path, '-') || banner_animated || banner_pos
    from public.profiles where id = '${OWNER}'`).out, '--false50');
  ok(as(OWNER, `select public.set_profile_media('avatar', null, null, false)`));
  assert.strictEqual(pg(`select coalesce(avatar_path, '-') || coalesce(avatar_thumb_path, '-') || avatar_animated || coalesce(avatar_crop::text, '-')
    from public.profiles where id = '${OWNER}'`).out, '--false-');
});

t('app antigo trocando avatar_path direto: miniatura e animado antigos caem; pasta alheia recusada', () => {
  ok(as(ADMIN, `select public.set_profile_media('avatar', '${ADMIN}/avatar/${F1}.gif', '${ADMIN}/avatar/${F1}.thumb.webp', true)`));
  ok(as(ADMIN, `update public.profiles set avatar_path = '${ADMIN}/${F2}.png' where id = '${ADMIN}'`));
  assert.strictEqual(pg(`select coalesce(avatar_thumb_path, '-') || '|' || avatar_animated from public.profiles where id = '${ADMIN}'`).out, '-|false');
  assert.ok(!as(ADMIN, `update public.profiles set avatar_path = '${OWNER}/${F2}.png' where id = '${ADMIN}'`).ok);
  // Ninguem edita o perfil de outra pessoa (a linha alheia nem e alcancada pelo update).
  ok(as(OWNER, `select public.set_profile_media('avatar', '${OWNER}/avatar/${F2}.png', '${OWNER}/avatar/${F2}.thumb.webp', false)`));
  assert.strictEqual(as(ADMIN, `update public.profiles set avatar_path = null where id = '${OWNER}' returning id`).out, '');
  assert.strictEqual(pg(`select avatar_path from public.profiles where id = '${OWNER}'`).out, `${OWNER}/avatar/${F2}.png`);
});

t('update_profile_look / reset / tema: valida e grava so no proprio perfil', () => {
  ok(as(MEMBER, `select public.update_profile_look('fire', 'flames', '{"x":50,"y":40,"zoom":1.5}', 70)`));
  assert.strictEqual(pg(`select avatar_frame || '|' || profile_effect || '|' || (avatar_crop ->> 'zoom') || '|' || banner_pos
    from public.profiles where id = '${MEMBER}'`).out, 'fire|flames|1.5|70');
  for (const frame of ['gold', 'fire', 'lightning', 'arcane', 'shadow', 'ice', 'red', 'particles']) {
    ok(as(MEMBER, `select public.update_profile_look('${frame}', null, null, null)`));
  }
  for (const effect of ['burst', 'flames', 'sparks', 'magic', 'mist', 'crystal', 'waves', 'pulse']) {
    ok(as(MEMBER, `select public.update_profile_look(null, '${effect}', null, null)`));
  }
  for (const args of [
    `'neon', null, null, null`, `null, 'confete', null, null`, `null, null, null, 101`, `null, null, null, -1`,
    `null, null, '{"x":101,"y":0,"zoom":1}', null`, `null, null, '{"x":0,"y":0,"zoom":4}', null`,
    `null, null, '{"x":0,"y":0}', null`, `null, null, '{"x":"0","y":0,"zoom":1}', null`,
    `null, null, '{"x":0,"y":0,"zoom":1,"extra":1}', null`, `null, null, '[1,2,3]', null`,
  ]) expectErr(as(MEMBER, `select public.update_profile_look(${args})`), 'invalid_options');
  ok(as(MEMBER, `select public.update_profile_look('ice', 'pulse', '{"x":1,"y":2,"zoom":3}', 0)`));
  ok(as(MEMBER, 'select public.reset_profile_look()'));
  assert.strictEqual(pg(`select coalesce(avatar_frame, '-') || coalesce(profile_effect, '-') || coalesce(avatar_crop::text, '-') || banner_pos
    from public.profiles where id = '${MEMBER}'`).out, '---50');
  // Imagens nao somem no reset.
  assert.strictEqual(pg(`select avatar_path is not null from public.profiles where id = '${MEMBER}'`).out, 't');
  ok(as(MEMBER, `select public.set_appearance_theme('midnight')`));
  assert.strictEqual(pg(`select appearance_theme from public.profiles where id = '${MEMBER}'`).out, 'midnight');
  ok(as(MEMBER, 'select public.set_appearance_theme(null)'));
  expectErr(as(MEMBER, `select public.set_appearance_theme('amoled')`), 'invalid_options');
  // Ninguem mais mudou.
  assert.strictEqual(pg(`select count(*) from public.profiles where id <> '${MEMBER}' and appearance_theme is not null`).out, '0');
});

t('reorder_channels: dono e admin reorganizam e trocam de categoria; membro comum recebe not_admin', () => {
  const cats = pg(`select string_agg(id::text, ',' order by position) from public.channel_categories where group_id = '${G}'`).out.split(',');
  const txt = chan(G, 'text');
  const voz = chan(G, 'voice');
  const voz2 = ok(as(OWNER, `select public.create_channel('${G}', 'voice', 'Ranqueada', '${cats[1]}')`));
  const layout = JSON.stringify([
    { id: voz2, categoryId: cats[1], position: 0 }, { id: voz, categoryId: cats[1], position: 1 },
    { id: txt, categoryId: null, position: 0 },
  ]);
  expectErr(as(MEMBER, `select public.reorder_channels('${G}', '${layout}')`), 'not_admin');
  expectErr(as(OTHER, `select public.reorder_channels('${G}', '${layout}')`), 'not_admin');
  ok(as(ADMIN, `select public.reorder_channels('${G}', '${layout}', '${JSON.stringify([{ id: cats[1], position: 0 }, { id: cats[0], position: 1 }])}')`));
  assert.strictEqual(pg(`select string_agg(name || ':' || coalesce(category_id::text, 'sem') || ':' || position, ',' order by name)
    from public.channels where group_id = '${G}'`).out,
  `Geral:${cats[1]}:1,Ranqueada:${cats[1]}:0,geral:sem:0`);
  assert.strictEqual(pg(`select string_agg(id::text, ',' order by position) from public.channel_categories where group_id = '${G}'`).out,
    `${cats[1]},${cats[0]}`);
  ok(as(OWNER, `select public.reorder_channels('${G}', '${JSON.stringify([{ id: txt, categoryId: cats[0], position: 0 }])}')`));
});

t('reorder_channels: tudo ou nada; canal ou categoria de outro servidor e formato invalido recusados', () => {
  const txt = chan(G, 'text');
  const antes = pg(`select category_id || ':' || position from public.channels where id = '${txt}'`).out;
  const outroCanal = chan(G2, 'text');
  const outraCat = pg(`select id from public.channel_categories where group_id = '${G2}' limit 1`).out;
  for (const layout of [
    [{ id: txt, categoryId: null, position: 3 }, { id: outroCanal, categoryId: null, position: 0 }],
    [{ id: txt, categoryId: outraCat, position: 0 }],
    [{ id: txt, categoryId: null, position: 1001 }],
    [{ id: txt, categoryId: null, position: -1 }],
    [{ id: txt, categoryId: null, position: 1.5 }],
    [{ id: txt, position: 0 }],
    [{ id: 'x', categoryId: null, position: 0 }],
    [{ id: txt, categoryId: null, position: 0 }, { id: txt, categoryId: null, position: 1 }],
    [],
  ]) expectErr(as(OWNER, `select public.reorder_channels('${G}', '${JSON.stringify(layout)}')`), 'invalid_layout');
  expectErr(as(OWNER, `select public.reorder_channels('${G}', '{"a":1}')`), 'invalid_layout');
  expectErr(as(OWNER, `select public.reorder_channels('${G}', '[]', '${JSON.stringify([{ id: outraCat, position: 0 }])}')`), 'invalid_layout');
  assert.strictEqual(pg(`select category_id || ':' || position from public.channels where id = '${txt}'`).out, antes);
});

t('move_voice_member: admin move membro; aviso so no topico me: da pessoa; membro comum nao move', () => {
  const voz = chan(G, 'voice');
  ok(pg('delete from realtime.messages'));
  ok(as(ADMIN, `select public.move_voice_member('${G}', '${MEMBER}', '${voz}')`));
  const msg = pg(`select topic || '|' || (payload ->> 'event') || '|' || (payload -> 'payload' ->> 'serverId') || '|' ||
    (payload -> 'payload' ->> 'channelId') || '|' || (payload -> 'payload' ->> 'by') from realtime.messages where payload ->> 'event' = 'voice_move'`).out;
  assert.strictEqual(msg, `me:${MEMBER}|voice_move|${G}|${voz}|${ADMIN}`);
  expectErr(as(MEMBER, `select public.move_voice_member('${G}', '${ADMIN}', '${voz}')`), 'not_admin');
  expectErr(as(OTHER, `select public.move_voice_member('${G}', '${MEMBER}', '${voz}')`), 'not_admin');
  expectErr(as(ADMIN, `select public.move_voice_member('${G}', '${OUT2}', '${voz}')`), 'not_member');
  expectErr(as(ADMIN, `select public.move_voice_member('${G}', '${MEMBER}', '${chan(G, 'text')}')`), 'invalid_channel');
  expectErr(as(ADMIN, `select public.move_voice_member('${G}', '${MEMBER}', '${chan(G2, 'voice')}')`), 'invalid_channel');
  expectErr(as(ADMIN, `select public.move_voice_member('${G}', '${OWNER}', '${voz}')`), 'cannot_target');
  ok(as(OWNER, `select public.move_voice_member('${G}', '${ADMIN}', '${voz}')`));
  ok(as(OWNER, `select public.move_voice_member('${G}', '${OWNER}', '${voz}')`));
  // So a propria pessoa le o topico me:.
  assert.strictEqual(pg(`select public.realtime_can_read('me:${MEMBER}') from (select set_config('request.jwt.claim.sub', '${ADMIN}', false)) s`).out, 'f');
});

t('storage: bucket avatars com 40 MB exatos e so imagens; escrita so na propria pasta', () => {
  assert.strictEqual(pg(`select file_size_limit || '|' || public || '|' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'avatars'`).out,
    '41943040|true|image/png,image/jpeg,image/webp,image/gif');
  const limite = Number(pg(`select file_size_limit from storage.buckets where id = 'avatars'`).out);
  assert.ok(40 * 1024 * 1024 <= limite, '40 MB exatos cabem');
  assert.ok(40 * 1024 * 1024 + 1 > limite, '40 MB + 1 byte passa do limite');
  assert.strictEqual(pg(`select file_size_limit from storage.buckets where id = 'avatars'`, 'grb').out, '41943040');
  // Pastas novas e antigas do proprio usuario; nada na pasta alheia; svg/html recusados pelo caminho.
  for (const name of [`${OWNER}/avatar/${F1}.gif`, `${OWNER}/avatar/${F1}.thumb.webp`, `${OWNER}/banner/${F2}.webp`,
    `${OWNER}/banner/${F2}.thumb.webp`, `${OWNER}/${F1}.png`]) {
    ok(as(OWNER, `insert into storage.objects (bucket_id, name) values ('avatars', '${name}')`));
  }
  for (const name of [`${ADMIN}/avatar/${F1}.gif`, `${OWNER}/avatar/${F1}.svg`, `${OWNER}/avatar/${F1}.html`,
    `${OWNER}/capa/${F1}.png`, `${OWNER}/avatar/x/${F1}.png`, `${OWNER}/banner/${F1}.thumb.png`]) {
    assert.ok(!as(OWNER, `insert into storage.objects (bucket_id, name) values ('avatars', '${name}')`).ok, name);
  }
  // Apagar o arquivo de outra pessoa nao apaga nada.
  ok(as(ADMIN, `delete from storage.objects where name = '${OWNER}/avatar/${F1}.gif'`));
  assert.strictEqual(pg(`select count(*) from storage.objects where name = '${OWNER}/avatar/${F1}.gif'`).out, '1');
});

t('limites de taxa: reorganizar e mover', () => {
  const voz = chan(G, 'voice');
  ok(pg(`delete from public.rate_events where user_id = '${OWNER}'`));
  ok(pg(`insert into public.rate_events (user_id, kind) select '${OWNER}', 'voice_move' from generate_series(1, 60)`));
  expectErr(as(OWNER, `select public.move_voice_member('${G}', '${MEMBER}', '${voz}')`), 'rate_limited');
});
