-- Ghost Rank - Etapas 2, 3 e 4: grupo, MMR do grupo, chat e vinculo com a Steam.
-- Rode este arquivo inteiro no SQL Editor do Supabase, DEPOIS do 0001_perfis.sql.
-- Pode rodar de novo sem problema.

-- Gerador de numeros aleatorios seguros (no Supabase a extensao fica no schema "extensions").
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null
    constraint groups_name_check
    check (char_length(name) between 2 and 32 and name !~ '[<>[:cntrl:]]'),
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- unique (user_id): uma pessoa so pode estar em um grupo.
create table if not exists public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id),
  constraint group_members_user_id_key unique (user_id)
);

-- Convites: ninguem le direto, so pelas funcoes create_invite e join_group.
create table if not exists public.group_invites (
  code text primary key
    constraint group_invites_code_check
    check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$'),
  group_id uuid not null references public.groups (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  uses int not null default 0 constraint group_invites_uses_check check (uses >= 0),
  max_uses int not null default 5 constraint group_invites_max_uses_check check (max_uses between 1 and 50)
);

create index if not exists group_invites_group_id_idx on public.group_invites (group_id);

-- Resumo do MMR que cada pessoa publica para o grupo.
create table if not exists public.mmr_snapshots (
  user_id uuid primary key references auth.users (id) on delete cascade,
  current_mmr int constraint mmr_snapshots_current_check check (current_mmr between 0 and 20000),
  goal_mmr int constraint mmr_snapshots_goal_check check (goal_mmr between 0 and 20000),
  start_mmr int constraint mmr_snapshots_start_check check (start_mmr between 0 and 20000),
  wins int not null default 0 constraint mmr_snapshots_wins_check check (wins >= 0),
  losses int not null default 0 constraint mmr_snapshots_losses_check check (losses >= 0),
  status text not null
    constraint mmr_snapshots_status_check
    check (status in ('goal_reached', 'on_track', 'unreachable', 'insufficient_data')),
  updated_at timestamptz not null default now()
);

-- Chat de texto do grupo.
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null
    constraint messages_body_check
    check (char_length(body) between 1 and 1000 and char_length(btrim(body)) >= 1),
  created_at timestamptz not null default now()
);

create index if not exists messages_group_id_id_idx on public.messages (group_id, id);
create index if not exists messages_user_id_created_at_idx on public.messages (user_id, created_at);

-- Estados temporarios do vinculo com a Steam: so a Edge Function (service role) usa.
create table if not exists public.steam_link_states (
  state text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null
);

create index if not exists steam_link_states_user_id_idx on public.steam_link_states (user_id);

-- ---------------------------------------------------------------------------
-- Permissoes (o Supabase da tudo para anon/authenticated por padrao: tiramos)
-- ---------------------------------------------------------------------------
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invites enable row level security;
alter table public.mmr_snapshots enable row level security;
alter table public.messages enable row level security;
alter table public.steam_link_states enable row level security;

revoke all on table public.groups from public, anon, authenticated;
revoke all on table public.group_members from public, anon, authenticated;
revoke all on table public.group_invites from public, anon, authenticated;
revoke all on table public.mmr_snapshots from public, anon, authenticated;
revoke all on table public.messages from public, anon, authenticated;
revoke all on table public.steam_link_states from public, anon, authenticated;
revoke all on sequence public.messages_id_seq from public, anon, authenticated;

-- Grupo e membros: so leitura (mudancas apenas pelas funcoes abaixo).
grant select on table public.groups to authenticated;
grant select on table public.group_members to authenticated;
-- MMR: a pessoa grava so a propria linha; updated_at e definido pelo servidor.
grant select, delete on table public.mmr_snapshots to authenticated;
grant insert (user_id, current_mmr, goal_mmr, start_mmr, wins, losses, status)
  on table public.mmr_snapshots to authenticated;
grant update (user_id, current_mmr, goal_mmr, start_mmr, wins, losses, status)
  on table public.mmr_snapshots to authenticated;
-- Chat: ler, enviar e apagar a propria mensagem. Sem update.
grant select, delete on table public.messages to authenticated;
grant insert (group_id, user_id, body) on table public.messages to authenticated;
-- group_invites e steam_link_states: nenhum acesso para anon/authenticated.

-- A Edge Function usa a chave service_role (ja tem acesso no Supabase; reforcamos aqui).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, delete on table public.steam_link_states to service_role;
    grant select on table public.group_members to service_role;
    grant select on table public.profiles to service_role;
    grant update (steam_account_id) on table public.profiles to service_role;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Funcao auxiliar: grupo da pessoa logada (ou null)
-- ---------------------------------------------------------------------------
create or replace function public.my_group_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select gm.group_id from public.group_members gm where gm.user_id = auth.uid();
$$;

revoke all on function public.my_group_id() from public;
revoke all on function public.my_group_id() from anon;
grant execute on function public.my_group_id() to authenticated;

-- ---------------------------------------------------------------------------
-- Politicas
-- ---------------------------------------------------------------------------
drop policy if exists "groups_select_membro" on public.groups;
create policy "groups_select_membro"
  on public.groups
  for select
  to authenticated
  using (id = public.my_group_id());

drop policy if exists "group_members_select_membro" on public.group_members;
create policy "group_members_select_membro"
  on public.group_members
  for select
  to authenticated
  using (group_id = public.my_group_id());

-- Colegas de grupo veem o perfil uns dos outros (so as colunas ja liberadas no 0001).
drop policy if exists "profiles_select_colega" on public.profiles;
create policy "profiles_select_colega"
  on public.profiles
  for select
  to authenticated
  using (id in (select gm.user_id from public.group_members gm where gm.group_id = public.my_group_id()));

drop policy if exists "mmr_snapshots_select" on public.mmr_snapshots;
create policy "mmr_snapshots_select"
  on public.mmr_snapshots
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or user_id in (
      select gm.user_id
      from public.group_members gm
      join public.profiles p on p.id = gm.user_id
      where gm.group_id = public.my_group_id()
        and p.mmr_visibility in ('group', 'friends')
    )
  );

drop policy if exists "mmr_snapshots_insert_proprio" on public.mmr_snapshots;
create policy "mmr_snapshots_insert_proprio"
  on public.mmr_snapshots
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "mmr_snapshots_update_proprio" on public.mmr_snapshots;
create policy "mmr_snapshots_update_proprio"
  on public.mmr_snapshots
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "mmr_snapshots_delete_proprio" on public.mmr_snapshots;
create policy "mmr_snapshots_delete_proprio"
  on public.mmr_snapshots
  for delete
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "messages_select_membro" on public.messages;
create policy "messages_select_membro"
  on public.messages
  for select
  to authenticated
  using (group_id = public.my_group_id());

drop policy if exists "messages_insert_membro" on public.messages;
create policy "messages_insert_membro"
  on public.messages
  for insert
  to authenticated
  with check (user_id = auth.uid() and group_id = public.my_group_id());

drop policy if exists "messages_delete_proprio" on public.messages;
create policy "messages_delete_proprio"
  on public.messages
  for delete
  to authenticated
  using (user_id = auth.uid());

-- Sem politicas em group_invites e steam_link_states: com RLS ligada, ninguem le.

-- ---------------------------------------------------------------------------
-- Gatilhos
-- ---------------------------------------------------------------------------
drop trigger if exists mmr_snapshots_set_updated_at on public.mmr_snapshots;
create trigger mmr_snapshots_set_updated_at
  before insert or update on public.mmr_snapshots
  for each row execute function public.set_updated_at();

-- Limite do chat: no maximo 10 mensagens em 10 segundos por pessoa.
create or replace function public.messages_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recentes int;
begin
  new.created_at := now();
  -- Serializa envios simultaneos da mesma pessoa.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('gr_chat:' || new.user_id::text));
  select count(*) into recentes
  from public.messages m
  where m.user_id = new.user_id
    and m.created_at > now() - interval '10 seconds';
  if recentes >= 10 then
    raise exception using errcode = 'P0001', message = 'rate_limited';
  end if;
  return new;
end;
$$;

revoke all on function public.messages_rate_limit() from public, anon, authenticated;

drop trigger if exists messages_rate_limit on public.messages;
create trigger messages_rate_limit
  before insert on public.messages
  for each row execute function public.messages_rate_limit();

-- ---------------------------------------------------------------------------
-- Funcoes chamadas pelo app (RPC)
-- ---------------------------------------------------------------------------
create or replace function public.create_group(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  nome text := btrim(coalesce(p_name, ''));
  novo uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if char_length(nome) not between 2 and 32 or nome ~ '[<>[:cntrl:]]' then
    raise exception using errcode = 'P0001', message = 'invalid_name';
  end if;
  if exists (select 1 from public.group_members gm where gm.user_id = uid) then
    raise exception using errcode = 'P0001', message = 'already_in_group';
  end if;

  insert into public.groups (name, owner_id) values (nome, uid) returning id into novo;
  begin
    insert into public.group_members (group_id, user_id) values (novo, uid);
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'already_in_group';
  end;
  return novo;
end;
$$;

create or replace function public.create_invite()
returns table (code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  alfabeto constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  grupo uuid;
  dono uuid;
  novo text;
  validade timestamptz := now() + interval '7 days';
  bytes bytea;
  b int;
  i int;
  tentativa int := 0;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select g.id, g.owner_id into grupo, dono
  from public.group_members gm join public.groups g on g.id = gm.group_id
  where gm.user_id = uid;
  if grupo is null then
    raise exception using errcode = 'P0001', message = 'not_in_group';
  end if;
  if dono <> uid then
    raise exception using errcode = 'P0001', message = 'not_owner';
  end if;

  -- Limpa convites vencidos ou esgotados deste grupo.
  delete from public.group_invites gi
  where gi.group_id = grupo and (gi.expires_at <= now() or gi.uses >= gi.max_uses);

  loop
    tentativa := tentativa + 1;
    novo := '';
    -- 31 letras: usa so bytes < 248 (31 * 8) para nao favorecer nenhuma letra.
    while char_length(novo) < 10 loop
      bytes := extensions.gen_random_bytes(16);
      i := 0;
      while i < 16 and char_length(novo) < 10 loop
        b := get_byte(bytes, i);
        if b < 248 then
          novo := novo || substr(alfabeto, (b % 31) + 1, 1);
        end if;
        i := i + 1;
      end loop;
    end loop;
    begin
      insert into public.group_invites (code, group_id, created_by, expires_at)
      values (novo, grupo, uid, validade);
      exit;
    exception when unique_violation then
      if tentativa >= 5 then
        raise;
      end if;
    end;
  end loop;

  return query select novo, validade;
end;
$$;

create or replace function public.join_group(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  codigo text := upper(btrim(coalesce(p_code, '')));
  grupo uuid;
  total int;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if exists (select 1 from public.group_members gm where gm.user_id = uid) then
    raise exception using errcode = 'P0001', message = 'already_in_group';
  end if;
  -- Mesmo erro para codigo mal formado, inexistente, vencido ou esgotado.
  if codigo !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$' then
    raise exception using errcode = 'P0001', message = 'invalid_invite';
  end if;

  select gi.group_id into grupo
  from public.group_invites gi
  where gi.code = codigo and gi.expires_at > now() and gi.uses < gi.max_uses
  for update;
  if grupo is null then
    raise exception using errcode = 'P0001', message = 'invalid_invite';
  end if;

  -- Trava o grupo para contar os membros sem corrida.
  perform 1 from public.groups g where g.id = grupo for update;
  select count(*) into total from public.group_members gm where gm.group_id = grupo;
  if total >= 10 then
    raise exception using errcode = 'P0001', message = 'group_full';
  end if;

  begin
    insert into public.group_members (group_id, user_id) values (grupo, uid);
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'already_in_group';
  end;
  update public.group_invites gi set uses = gi.uses + 1 where gi.code = codigo;
  return grupo;
end;
$$;

-- Logica de saida (uso interno; nao e chamavel pela API).
create or replace function public.leave_group_of(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  grupo uuid;
  dono uuid;
  novo_dono uuid;
begin
  select gm.group_id into grupo from public.group_members gm where gm.user_id = p_user_id;
  if grupo is null then
    return false;
  end if;
  select g.owner_id into dono from public.groups g where g.id = grupo for update;

  delete from public.group_members gm where gm.group_id = grupo and gm.user_id = p_user_id;

  if dono = p_user_id then
    select gm.user_id into novo_dono
    from public.group_members gm
    where gm.group_id = grupo
    order by gm.joined_at, gm.user_id
    limit 1;
    if novo_dono is null then
      delete from public.groups g where g.id = grupo;
    else
      update public.groups g set owner_id = novo_dono where g.id = grupo;
    end if;
  end if;
  return true;
end;
$$;

revoke all on function public.leave_group_of(uuid) from public, anon, authenticated;

create or replace function public.leave_group()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.leave_group_of(auth.uid()) then
    raise exception using errcode = 'P0001', message = 'not_in_group';
  end if;
end;
$$;

create or replace function public.remove_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  grupo uuid;
  dono uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select g.id, g.owner_id into grupo, dono
  from public.group_members gm join public.groups g on g.id = gm.group_id
  where gm.user_id = uid;
  if grupo is null then
    raise exception using errcode = 'P0001', message = 'not_in_group';
  end if;
  if dono <> uid or p_user_id is null or p_user_id = uid then
    -- O dono nao remove a si mesmo (para isso existe leave_group).
    raise exception using errcode = 'P0001', message = 'not_owner';
  end if;
  delete from public.group_members gm where gm.group_id = grupo and gm.user_id = p_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'not_in_group';
  end if;
end;
$$;

revoke all on function public.create_group(text) from public;
revoke all on function public.create_group(text) from anon;
grant execute on function public.create_group(text) to authenticated;

revoke all on function public.create_invite() from public;
revoke all on function public.create_invite() from anon;
grant execute on function public.create_invite() to authenticated;

revoke all on function public.join_group(text) from public;
revoke all on function public.join_group(text) from anon;
grant execute on function public.join_group(text) to authenticated;

revoke all on function public.leave_group() from public;
revoke all on function public.leave_group() from anon;
grant execute on function public.leave_group() to authenticated;

revoke all on function public.remove_member(uuid) from public;
revoke all on function public.remove_member(uuid) from anon;
grant execute on function public.remove_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Apagar a propria conta: antes passa a posse do grupo (se for dono), para o
-- grupo nao sumir para os outros membros. O resto some pelas cascatas.
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

  perform public.leave_group_of(auth.uid());
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public;
revoke all on function public.delete_my_account() from anon;
grant execute on function public.delete_my_account() to authenticated;
