'use strict';
// Analise estatica do SQL do grupo (sem banco).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '0002_grupo.sql'), 'utf8');
const code = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').toLowerCase().replace(/\s+/g, ' ');

function fn(name) {
  const re = new RegExp(`create or replace function public\\.${name}\\(.*?\\$\\$;`);
  return (code.match(re) || [])[0] || '';
}

const TABLES = ['groups', 'group_members', 'group_invites', 'mmr_snapshots', 'messages', 'steam_link_states'];
const RPC = [['create_group', 'text'], ['create_invite', ''], ['join_group', 'text'], ['leave_group', ''], ['remove_member', 'uuid'], ['my_group_id', ''], ['delete_my_account', '']];

test('tabelas criadas de forma idempotente, com RLS e sem acesso de anon/public', () => {
  for (const t of TABLES) {
    assert.match(code, new RegExp(`create table if not exists public\\.${t} \\(`), t);
    assert.match(code, new RegExp(`alter table public\\.${t} enable row level security`), t);
    assert.match(code, new RegExp(`revoke all on table public\\.${t} from public, anon, authenticated`), t);
  }
  assert.doesNotMatch(code, /grant [^;]* to [^;]*\banon\b/);
  assert.doesNotMatch(code, /grant [^;]* to public\b/);
  assert.doesNotMatch(code, /grant all/);
});

test('grants minimos a authenticated', () => {
  assert.match(code, /grant select on table public\.groups to authenticated/);
  assert.match(code, /grant select on table public\.group_members to authenticated/);
  assert.match(code, /grant select, delete on table public\.messages to authenticated/);
  assert.match(code, /grant insert \(group_id, user_id, body\) on table public\.messages to authenticated/);
  assert.doesNotMatch(code, /grant [^;]*update[^;]*public\.messages/);
  assert.doesNotMatch(code, /grant [^;]*(insert|update|delete)[^;]* on table public\.(groups|group_members) /);
  assert.doesNotMatch(code, /grant [^;]* on table public\.(group_invites|steam_link_states) to authenticated/);
  // updated_at e created_at nao sao gravaveis pelo app.
  for (const g of code.match(/grant (insert|update) \([^)]*\) on table public\.\w+/g) || []) {
    assert.doesNotMatch(g, /updated_at|created_at|[(,] ?id\b/, g);
  }
});

test('uma pessoa por grupo e restricoes das colunas', () => {
  assert.match(code, /primary key \(group_id, user_id\)/);
  assert.match(code, /unique \(user_id\)/);
  assert.match(code, /check \(char_length\(name\) between 2 and 32 and name !~ '\[<>\[:cntrl:\]\]'\)/);
  assert.match(code, /check \(char_length\(body\) between 1 and 1000/);
  assert.match(code, /check \(status in \('goal_reached', 'on_track', 'unreachable', 'insufficient_data'\)\)/);
  for (const c of ['current', 'goal', 'start']) {
    assert.match(code, new RegExp(`check \\(${c}_mmr between 0 and 20000\\)`));
  }
  assert.match(code, /max_uses int not null default 5/);
  assert.match(code, /create index if not exists messages_group_id_id_idx on public\.messages \(group_id, id\)/);
});

test('funcoes RPC: security definer, search_path vazio, EXECUTE so authenticated', () => {
  for (const [name, args] of RPC) {
    const f = fn(name);
    assert.ok(f, name);
    assert.match(f, /security definer/, name);
    assert.match(f, /set search_path = ''/, name);
    const sig = `public\\.${name}\\(${args}\\)`;
    assert.match(code, new RegExp(`revoke all on function ${sig} from public;`), name);
    assert.match(code, new RegExp(`revoke all on function ${sig} from anon;`), name);
    assert.match(code, new RegExp(`grant execute on function ${sig} to authenticated;`), name);
  }
  for (const name of ['leave_group_of', 'messages_rate_limit']) {
    assert.match(fn(name), /security definer/);
    assert.match(fn(name), /set search_path = ''/);
    assert.match(code, new RegExp(`revoke all on function public\\.${name}\\([a-z]*\\) from public, anon, authenticated`));
    assert.doesNotMatch(code, new RegExp(`grant execute on function public\\.${name}`));
  }
});

test('codigos de erro do plano', () => {
  for (const c of ['already_in_group', 'not_in_group', 'not_owner', 'invalid_invite', 'group_full', 'invalid_name', 'rate_limited']) {
    assert.match(code, new RegExp(`raise exception using errcode = 'p0001', message = '${c}'`), c);
  }
});

test('convite: gen_random_bytes do schema extensions, alfabeto sem ambiguos, 7 dias', () => {
  const f = fn('create_invite');
  assert.match(f, /extensions\.gen_random_bytes\(/);
  assert.match(f, /'abcdefghjkmnpqrstuvwxyz23456789'/);
  assert.match(f, /interval '7 days'/);
  assert.match(f, /message = 'not_owner'/);
  assert.doesNotMatch(f, /random\(\)/);
  assert.match(code, /create extension if not exists pgcrypto with schema extensions/);
});

test('join_group: mesmo erro para inexistente, vencido e esgotado; limite de 10', () => {
  const f = fn('join_group');
  assert.match(f, /gi\.expires_at > now\(\) and gi\.uses < gi\.max_uses/);
  assert.match(f, /total >= 10/);
  assert.match(f, /for update/);
  assert.match(f, /set uses = gi\.uses \+ 1/);
  const invalid = f.match(/message = 'invalid_invite'/g) || [];
  assert.strictEqual(invalid.length, 2);
});

test('politicas', () => {
  const pol = (name) => (code.match(new RegExp(`create policy "${name}"[^;]*;`)) || [])[0] || '';
  assert.match(pol('groups_select_membro'), /for select to authenticated using \(id = public\.my_group_id\(\)\)/);
  assert.match(pol('group_members_select_membro'), /for select to authenticated using \(group_id = public\.my_group_id\(\)\)/);
  assert.match(pol('profiles_select_colega'), /on public\.profiles for select to authenticated/);
  assert.match(pol('mmr_snapshots_select'), /mmr_visibility in \('group', 'friends'\)/);
  assert.match(pol('mmr_snapshots_insert_proprio'), /with check \(user_id = auth\.uid\(\)\)/);
  assert.match(pol('mmr_snapshots_update_proprio'), /using \(user_id = auth\.uid\(\)\) with check \(user_id = auth\.uid\(\)\)/);
  assert.match(pol('mmr_snapshots_delete_proprio'), /for delete to authenticated using \(user_id = auth\.uid\(\)\)/);
  assert.match(pol('messages_insert_membro'), /with check \(user_id = auth\.uid\(\) and group_id = public\.my_group_id\(\)\)/);
  assert.match(pol('messages_delete_proprio'), /using \(user_id = auth\.uid\(\)\)/);
  const all = code.match(/create policy [^;]*;/g) || [];
  for (const p of all) {
    assert.match(p, /to authenticated/);
    assert.doesNotMatch(p, /for all|to anon|to public|for update[^;]*on public\.messages/);
    const name = p.match(/create policy "([^"]+)"/)[1];
    assert.match(code, new RegExp(`drop policy if exists "${name}"`), name);
  }
  assert.ok(!all.some((p) => /on public\.messages for update/.test(p)));
  assert.ok(!all.some((p) => /on public\.(group_invites|steam_link_states)/.test(p)));
});

test('limite de taxa do chat: 10 mensagens em 10 segundos', () => {
  const f = fn('messages_rate_limit');
  assert.match(f, /interval '10 seconds'/);
  assert.match(f, /recentes >= 10/);
  assert.match(f, /new\.created_at := now\(\)/);
  assert.match(code, /create trigger messages_rate_limit before insert on public\.messages/);
  assert.match(code, /drop trigger if exists messages_rate_limit/);
});

test('my_group_id: stable, usa auth.uid()', () => {
  const f = fn('my_group_id');
  assert.match(f, /stable/);
  assert.match(f, /where gm\.user_id = auth\.uid\(\)/);
});
