'use strict';
// Analise estatica do SQL de perfis (sem banco).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '0001_perfis.sql'), 'utf8');
// Remove comentarios de linha para nao dar falso positivo.
const code = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').toLowerCase().replace(/\s+/g, ' ');

function stmt(re) {
  return (code.match(re) || [])[0] || '';
}

test('RLS ligada em public.profiles', () => {
  assert.match(code, /alter table public\.profiles enable row level security/);
});

test('politicas so do dono e sem insert/delete', () => {
  const policies = code.match(/create policy [^;]*;/g) || [];
  assert.ok(policies.length >= 2);
  for (const p of policies) {
    assert.match(p, /auth\.uid\(\) = id/);
    assert.doesNotMatch(p, /for insert/);
    assert.doesNotMatch(p, /for delete/);
    assert.doesNotMatch(p, /for all/);
    assert.doesNotMatch(p, /to anon|to public/);
  }
  assert.ok(policies.some((p) => /for select/.test(p)));
  assert.ok(policies.some((p) => /for update/.test(p) && /with check/.test(p)));
});

test('update restrito as colunas display_name e mmr_visibility', () => {
  assert.match(code, /grant update \(display_name, mmr_visibility\) on table public\.profiles to authenticated/);
  assert.match(code, /revoke all on table public\.profiles from authenticated/);
  assert.match(code, /revoke all on table public\.profiles from anon/);
  assert.doesNotMatch(code, /grant (insert|delete|all)[^;]*public\.profiles/);
  assert.doesNotMatch(code, /grant update \([^)]*steam_account_id/);
  assert.doesNotMatch(code, /grant update on/);
});

test('mmr_visibility tem check com os tres valores', () => {
  assert.match(code, /mmr_visibility text not null default 'friends'/);
  assert.match(code, /check \(mmr_visibility in \('friends', 'group', 'nobody'\)\)/);
});

test('funcoes e gatilhos existem', () => {
  assert.match(code, /create or replace function public\.handle_new_user\(\)/);
  assert.match(code, /create or replace function public\.delete_my_account\(\)/);
  assert.match(code, /create or replace function public\.set_updated_at\(\)/);
  assert.match(code, /create trigger on_auth_user_created after insert on auth\.users/);
  assert.match(code, /create trigger profiles_set_updated_at before update on public\.profiles/);
});

test('handle_new_user: security definer, search_path fixo, apelido ate 24', () => {
  const f = stmt(/create or replace function public\.handle_new_user\(\).*?\$\$;/);
  assert.match(f, /security definer/);
  assert.match(f, /set search_path = ''/);
  assert.match(f, /split_part\(.*'@', 1\)/);
  assert.match(f, /left\(/);
  assert.match(f, /, 24 \)/);
});

test('delete_my_account: security definer, search_path fixo, so authenticated', () => {
  const f = stmt(/create or replace function public\.delete_my_account\(\).*?\$\$;/);
  assert.match(f, /security definer/);
  assert.match(f, /set search_path = ''/);
  assert.match(f, /delete from auth\.users where id = auth\.uid\(\)/);
  assert.match(code, /revoke all on function public\.delete_my_account\(\) from public/);
  assert.match(code, /revoke all on function public\.delete_my_account\(\) from anon/);
  assert.match(code, /grant execute on function public\.delete_my_account\(\) to authenticated/);
  assert.doesNotMatch(code, /grant execute on function public\.delete_my_account\(\) to (anon|public)/);
});

test('handle_new_user nao e chamavel pela API', () => {
  assert.match(code, /revoke all on function public\.handle_new_user\(\) from public, anon, authenticated/);
});

test('idempotencia: sem create policy/trigger sem drop antes', () => {
  assert.match(code, /create table if not exists public\.profiles/);
  assert.match(code, /drop policy if exists "profiles_select_proprio"/);
  assert.match(code, /drop policy if exists "profiles_update_proprio"/);
  assert.match(code, /drop trigger if exists on_auth_user_created/);
  assert.match(code, /drop trigger if exists profiles_set_updated_at/);
});
