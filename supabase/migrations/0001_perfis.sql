-- Ghost Rank - Etapa 1A: perfis de usuario.
-- Rode este arquivo inteiro no SQL Editor do Supabase. Pode rodar de novo sem problema.

-- ---------------------------------------------------------------------------
-- Tabela de perfis (uma linha por conta em auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null
    constraint profiles_display_name_check
    check (char_length(display_name) between 2 and 24 and display_name !~ '[<>[:cntrl:]]'),
  -- Quem pode ver o MMR: amigos, grupo ou ninguem.
  mmr_visibility text not null default 'friends'
    constraint profiles_mmr_visibility_check
    check (mmr_visibility in ('friends', 'group', 'nobody')),
  -- Preenchido so por funcao do servidor (login pela Steam, etapa 1B).
  steam_account_id bigint unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Perfil publico de cada conta do Ghost Rank.';

-- ---------------------------------------------------------------------------
-- Seguranca em nivel de linha (RLS)
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

-- Cada pessoa le apenas o proprio perfil.
drop policy if exists "profiles_select_proprio" on public.profiles;
create policy "profiles_select_proprio"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

-- Cada pessoa altera apenas o proprio perfil (e so as colunas liberadas abaixo).
drop policy if exists "profiles_update_proprio" on public.profiles;
create policy "profiles_update_proprio"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Nao existe politica de insert nem de delete: o perfil nasce pelo gatilho
-- e some junto com a conta (on delete cascade).

-- ---------------------------------------------------------------------------
-- Permissoes por coluna
-- ---------------------------------------------------------------------------
revoke all on table public.profiles from public;
revoke all on table public.profiles from anon;
revoke all on table public.profiles from authenticated;

grant select on table public.profiles to authenticated;
-- So estas duas colunas podem ser alteradas pelo app (steam_account_id nao).
grant update (display_name, mmr_visibility) on table public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- updated_at automatico
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Cria o perfil quando uma conta nova e cadastrada
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  nome text;
begin
  -- Apelido inicial: parte do e-mail antes do @, sem caracteres proibidos, ate 24 letras.
  nome := left(
    regexp_replace(split_part(coalesce(new.email, ''), '@', 1), '[<>[:cntrl:]]', '', 'g'),
    24
  );
  if char_length(nome) < 2 then
    nome := 'jogador';
  end if;

  insert into public.profiles (id, display_name)
  values (new.id, nome)
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Apagar a propria conta
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- O perfil some junto (on delete cascade).
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public;
revoke all on function public.delete_my_account() from anon;
grant execute on function public.delete_my_account() to authenticated;
