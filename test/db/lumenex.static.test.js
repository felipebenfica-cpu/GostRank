'use strict';
// Analise estatica da 0007_lumenex.sql (roda mesmo sem Postgres local).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '0007_lumenex.sql'), 'utf8');
const code = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').toLowerCase().replace(/\s+/g, ' ');
const fnBodies = code.match(/create or replace function public\.\w+\(.*?\$\$;/g) || [];
const fn = (name) => fnBodies.find((f) => f.startsWith(`create or replace function public.${name}(`)) || '';

const RPC = ['set_profile_media', 'update_profile_look', 'reset_profile_look', 'set_appearance_theme',
  'reorder_channels', 'move_voice_member'];

test('idempotente, sem apagar dados, sem chave e sem grant para anon/public', () => {
  assert.doesNotMatch(code, /\bdrop table\b|\bdrop column\b|\btruncate\b|\bdelete from public\./);
  assert.match(code, /add column if not exists banner_path/);
  assert.match(code, /add column if not exists avatar_frame/);
  assert.match(code, /add column if not exists profile_effect/);
  assert.match(code, /add column if not exists appearance_theme/);
  assert.doesNotMatch(code, /grant [^;]* to [^;]*\banon\b/);
  assert.doesNotMatch(code, /grant [^;]* to public\b/);
  assert.doesNotMatch(code, /grant all/);
  assert.doesNotMatch(code, /grant update/, 'colunas novas so mudam pelas RPCs');
  assert.doesNotMatch(sql, /service_role_key|eyJ[A-Za-z0-9_-]{10,}/);
  assert.match(sql, /Rode antes a 0006_discord\.sql/);
});

test('RPCs: security definer, search_path vazio, conferem quem chama', () => {
  for (const r of RPC) {
    const body = fn(r);
    assert.ok(body, r);
    assert.match(body, /security definer set search_path = ''/, r);
    assert.match(body, /auth\.uid\(\)|need_admin\(/, r);
    assert.match(code, new RegExp(`'public\\.${r}\\(`), `${r} na lista de grants`);
  }
  assert.match(code, /execute format\('revoke all on function %s from public, anon', f\)/);
  assert.match(code, /execute format\('grant execute on function %s to authenticated', f\)/);
  assert.match(fn('reorder_channels'), /perform public\.need_admin\(p_group\)/);
  assert.match(fn('move_voice_member'), /perform public\.need_admin\(p_group\)/);
  assert.match(fn('move_voice_member'), /public\.gr_notify\('me:' \|\| p_user::text, 'voice_move'/);
});

test('8 molduras, 8 efeitos e 3 temas, nos checks e nas RPCs', () => {
  const frames = "'gold', 'fire', 'lightning', 'arcane', 'shadow', 'ice', 'red', 'particles'";
  const effects = "'burst', 'flames', 'sparks', 'magic', 'mist', 'crystal', 'waves', 'pulse'";
  assert.ok(code.includes(`avatar_frame in (${frames})`));
  assert.ok(code.includes(`profile_effect in (${effects})`));
  assert.ok(fn('update_profile_look').includes(`p_frame not in (${frames})`));
  assert.ok(fn('update_profile_look').includes(`p_effect not in (${effects})`));
  assert.ok(code.includes("appearance_theme in ('light', 'dark', 'midnight')"));
});

test('storage: avatars com 40 MB exatos (41943040) e so imagens', () => {
  assert.match(code, /values \('avatars', 'avatars', true, 41943040, array\['image\/png', 'image\/jpeg', 'image\/webp', 'image\/gif'\]\)/);
  assert.strictEqual(41943040, 40 * 1024 * 1024);
  assert.match(fn('can_write_avatar_path'), /\(avatar\|banner\)/);
  assert.match(fn('can_write_avatar_path'), /split_part\(p_name, '\/', 1\) = auth\.uid\(\)::text/);
});
