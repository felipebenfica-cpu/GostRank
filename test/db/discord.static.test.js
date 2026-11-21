'use strict';
// Analise estatica do 0006_discord.sql (roda mesmo sem Postgres local).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '0006_discord.sql'), 'utf8');
const code = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').toLowerCase().replace(/\s+/g, ' ');

const fnBodies = code.match(/create or replace function public\.\w+\(.*?\$\$;/g) || [];
const fn = (name) => fnBodies.find((f) => f.startsWith(`create or replace function public.${name}(`)) || '';

const NEW_TABLES = ['rate_events', 'relationships', 'group_bans', 'channel_categories', 'channels', 'dm_channels',
  'message_reactions', 'read_states'];

const RPC = ['search_users', 'send_friend_request', 'accept_friend_request', 'decline_friend_request', 'remove_friend',
  'block_user', 'unblock_user', 'open_dm', 'create_group', 'preview_invite', 'join_group', 'create_invite', 'list_invites',
  'revoke_invite', 'leave_group', 'delete_group', 'update_group', 'set_group_icon', 'set_member_role',
  'transfer_ownership', 'kick_member', 'ban_member', 'unban_member', 'list_bans', 'set_nickname', 'remove_member',
  'create_category', 'update_category', 'delete_category', 'create_channel', 'update_channel', 'delete_channel',
  'pin_message', 'mark_read', 'unread_summary', 'search_messages', 'delete_my_account'];

test('tabelas novas: idempotentes, RLS ligada, sem acesso de anon/public', () => {
  for (const t of NEW_TABLES) {
    assert.match(code, new RegExp(`create table if not exists public\\.${t} \\(`), t);
    assert.match(code, new RegExp(`alter table public\\.${t} enable row level security`), t);
    assert.match(code, new RegExp(`revoke all on table public\\.${t} from public, anon, authenticated`), t);
  }
  assert.doesNotMatch(code, /grant [^;]* to [^;]*\banon\b/);
  assert.doesNotMatch(code, /grant [^;]* to public\b/);
  assert.doesNotMatch(code, /grant all/);
  assert.doesNotMatch(sql, /service_role_key|eyJ[A-Za-z0-9_-]{10,}/, 'sem chave no SQL');
});

test('uma pessoa em varios servidores; cargos; colunas novas', () => {
  assert.match(code, /alter table public\.group_members drop constraint if exists group_members_user_id_key/);
  assert.match(code, /check \(role in \('owner', 'admin', 'member'\)\)/);
  assert.match(code, /check \(kind in \('friend', 'pending_out', 'pending_in', 'blocked'\)\)/);
  assert.match(code, /check \(kind in \('text', 'voice'\)\)/);
  assert.match(code, /check \(status in \('online', 'idle', 'dnd', 'invisible'\)\)/);
  assert.match(code, /check \(username ~ '\^\[a-z0-9_\.\]\{2,32\}\$'\)/);
  assert.match(code, /create unique index if not exists profiles_username_key on public\.profiles \(username\)/);
  assert.match(code, /char_length\(body\) <= 2000/);
  assert.match(code, /jsonb_array_length\(attachments\) <= 4/);
  assert.match(code, /constraint dm_channels_order_check check \(user_a < user_b\)/);
});

test('convites: podem nunca expirar e nao ter limite', () => {
  assert.match(code, /alter table public\.group_invites alter column expires_at drop not null/);
  assert.match(code, /alter table public\.group_invites alter column max_uses drop not null/);
  assert.match(code, /check \(max_uses is null or max_uses between 1 and 100\)/);
  const g = fn('invite_group');
  assert.match(g, /gi\.expires_at is null or gi\.expires_at > now\(\)/);
  assert.match(g, /gi\.max_uses is null or gi\.uses < gi\.max_uses/);
  const j = fn('join_group');
  assert.match(j, /total >= 100/);
  assert.match(j, /message = 'banned'/);
  assert.match(j, /message = 'too_many_servers'/);
  assert.match(fn('gen_invite_code'), /extensions\.gen_random_bytes\(/);
  assert.doesNotMatch(fn('gen_invite_code'), /random\(\)/);
});

test('RPCs: security definer, search_path vazio, executadas so por authenticated', () => {
  for (const name of RPC) {
    const f = fn(name);
    assert.ok(f, name);
    assert.match(f, /security definer/, name);
    assert.match(f, /set search_path = ''/, name);
    assert.ok(code.includes(`'public.${name}(`), `${name} na lista de grants`);
  }
  assert.match(code, /execute format\('revoke all on function %s from public, anon', f\)/);
  assert.match(code, /execute format\('grant execute on function %s to authenticated', f\)/);
  for (const internal of ['rate_check', 'leave_group_from', 'seed_channels', 'gen_invite_code', 'mod_target_check',
    'shares_server', 'are_friends', 'is_blocked_between', 'make_username', 'invite_group', 'parse_target', 'need_admin']) {
    assert.match(code, new RegExp(`revoke all on function public\\.${internal}\\([^)]*\\) from public, anon, authenticated`), internal);
    assert.ok(!code.includes(`'public.${internal}(`), `${internal} nao pode ser exposta`);
  }
});

test('compatibilidade com o app antigo', () => {
  assert.match(code, /drop function if exists public\.create_group\(text\)/);
  assert.match(code, /create or replace function public\.create_group\(p_name text, p_icon_color int default 0\)/);
  assert.match(code, /create or replace function public\.create_invite\(\) returns table \(code text, expires_at timestamptz\)/);
  assert.match(code, /create or replace function public\.leave_group\(\) returns void/);
  assert.match(code, /create or replace function public\.remove_member\(p_user_id uuid\)/);
  assert.match(fn('messages_before_insert'), /new\.channel_id is null and new\.dm_id is null and new\.group_id is not null/);
});

test('codigos de erro do contrato', () => {
  for (const c of ['user_not_found', 'cannot_add_self', 'already_friends', 'request_exists', 'blocked', 'rate_limited',
    'dm_not_allowed', 'invalid_invite', 'banned', 'group_full', 'too_many_servers', 'invalid_name', 'not_member',
    'not_owner', 'not_admin', 'invalid_user', 'cannot_target', 'last_text_channel', 'invalid_options',
    'invalid_attachment', 'invalid_channel', 'too_many_reactions']) {
    assert.match(code, new RegExp(`message = '${c}'`), c);
  }
});

test('politicas: sempre com drop antes, so authenticated, sem my_group_id', () => {
  const all = code.match(/create policy [^;]*;/g) || [];
  assert.ok(all.length >= 15);
  for (const p of all) {
    assert.match(p, /to authenticated/);
    assert.doesNotMatch(p, /for all|to anon|to public/);
    assert.doesNotMatch(p, /my_group_id/);
    const name = p.match(/create policy "([^"]+)"/)[1];
    assert.match(code, new RegExp(`drop policy if exists "${name}"`), name);
  }
  const dyn = code.match(/'create policy "[^"]+"/g) || [];
  for (const d of dyn) {
    const name = d.match(/"([^"]+)"/)[1];
    assert.match(code, new RegExp(`drop policy if exists "${name}"`), name);
  }
});

test('Realtime: publicacao, replica identity e topicos privados', () => {
  assert.match(code, /alter publication supabase_realtime add table public\.%i/);
  for (const t of ['messages', 'message_reactions', 'channels', 'channel_categories', 'dm_channels', 'groups']) {
    assert.ok(code.includes(`'${t}'`), t);
  }
  assert.match(code, /alter table public\.messages replica identity full/);
  assert.match(code, /alter table public\.message_reactions replica identity full/);
  assert.match(code, /realtime_can_read\(realtime\.topic\(\)\)/);
  assert.match(code, /realtime_can_write\(realtime\.topic\(\)\)/);
  for (const prefix of ['server:', 'user:', 'dm:', 'me:']) assert.ok(fn('realtime_can_read').includes(`'^${prefix}'`), prefix);
  // relationships e group_members saem da publicacao (DELETE vazaria a chave sem RLS) e viram avisos privados.
  assert.match(code, /alter publication supabase_realtime drop table public\.%i/);
  assert.match(fn('relationships_notify'), /'me:' \|\| r\.user_id/);
  assert.match(fn('group_members_notify'), /'server:' \|\| r\.group_id/);
  assert.match(fn('realtime_can_write'), /like 'me:%'[\s\S]*?return false/);
});

test('Storage: avatares publicos 2 MB, anexos privados 8 MB, caminhos validados', () => {
  assert.match(code, /values \('avatars', 'avatars', true, 2097152/);
  assert.match(code, /values \('attachments', 'attachments', false, 8388608, array\[/);
  assert.doesNotMatch(code.slice(code.indexOf("values ('attachments'"), code.indexOf("values ('attachments'") + 600), /text\/html|svg/);
  assert.match(code, /public\.can_use_attachment_path\(name\)/);
  assert.match(code, /public\.can_write_avatar_path\(name\)/);
  assert.match(fn('can_use_attachment_path'), /\\\.\\\./, 'recusa ..');
});

test('limites de taxa', () => {
  assert.match(fn('search_users'), /rate_check\('search', 30, 60\)/);
  assert.match(fn('send_friend_request'), /rate_check\('friend_request', 20, 3600\)/);
  assert.match(fn('social_people'), /rate_check\('search', 30, 60\)/);
  assert.match(fn('rate_check'), /pg_advisory_xact_lock/);
});

test('perfil: pedido enviado ou bloqueio nao liberam o perfil; username nao vem do e-mail', () => {
  assert.match(fn('can_see_user'), /r\.kind in \('friend', 'pending_in'\)/);
  assert.doesNotMatch(fn('handle_new_user'), /new\.email/);
  assert.match(fn('relationship_people'), /r\.user_id = auth\.uid\(\)/);
});

test('edicao de mensagem exige continuar no servidor/DM sem bloqueio', () => {
  const i = code.indexOf('create policy "messages_update_autor"');
  assert.match(code.slice(i, i + 400), /can_post_where\(group_id, channel_id, dm_id\)/);
  assert.match(fn('can_post_where'), /is_blocked_between/);
});
