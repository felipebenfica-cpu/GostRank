-- Ghost Rank - Etapa 6: modelo completo do Discord.
-- Amigos, varios servidores, canais e categorias, cargos, DMs, reacoes, respostas, edicao,
-- anexos, fixadas, nao lidas, convites ilimitados, Realtime e Storage.
-- Rode este arquivo inteiro no SQL Editor do Supabase, DEPOIS do 0001 e do 0002.
-- Pode rodar de novo sem problema. Os dados atuais sao preservados: o grupo atual vira um
-- servidor com #geral e "Geral", e as mensagens antigas vao para o #geral.
-- O app antigo (.exe da Etapa 5) continua funcionando: create_group(p_name), create_invite(),
-- join_group(p_code), leave_group(), remove_member(p_user_id) e o chat por group_id seguem valendo.

create extension if not exists pgcrypto with schema extensions;

-- ===========================================================================
-- 1. Limite de taxa generico
-- ===========================================================================
create table if not exists public.rate_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null constraint rate_events_kind_check check (kind ~ '^[a-z_]{1,32}$'),
  at timestamptz not null default now()
);
create index if not exists rate_events_user_kind_at_idx on public.rate_events (user_id, kind, at);
alter table public.rate_events enable row level security;
revoke all on table public.rate_events from public, anon, authenticated;
revoke all on sequence public.rate_events_id_seq from public, anon, authenticated;

-- Conta o evento e recusa (rate_limited) se passou de p_max em p_seconds. Uso interno.
create or replace function public.rate_check(p_kind text, p_max int, p_seconds int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  total int;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('gr_rate:' || p_kind || ':' || uid::text));
  delete from public.rate_events re
  where re.user_id = uid and re.kind = p_kind and re.at < now() - make_interval(secs => greatest(p_seconds, 1) * 2);
  select count(*) into total from public.rate_events re
  where re.user_id = uid and re.kind = p_kind and re.at > now() - make_interval(secs => p_seconds);
  if total >= p_max then
    raise exception using errcode = 'P0001', message = 'rate_limited';
  end if;
  insert into public.rate_events (user_id, kind) values (uid, p_kind);
end;
$$;
revoke all on function public.rate_check(text, int, int) from public, anon, authenticated;

-- ===========================================================================
-- 2. Perfis: nome de usuario, avatar, sobre mim, status
-- ===========================================================================
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists avatar_color smallint not null default 0;
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists about text;
alter table public.profiles add column if not exists custom_status text;
alter table public.profiles add column if not exists status text not null default 'online';

alter table public.profiles drop constraint if exists profiles_display_name_check;
alter table public.profiles add constraint profiles_display_name_check
  check (char_length(display_name) between 1 and 32 and display_name !~ '[<>[:cntrl:]]');
alter table public.profiles drop constraint if exists profiles_avatar_color_check;
alter table public.profiles add constraint profiles_avatar_color_check check (avatar_color between 0 and 7);
alter table public.profiles drop constraint if exists profiles_about_check;
alter table public.profiles add constraint profiles_about_check
  check (about is null or (char_length(about) <= 190 and about !~ '[<>\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'));
alter table public.profiles drop constraint if exists profiles_custom_status_check;
alter table public.profiles add constraint profiles_custom_status_check
  check (custom_status is null or (char_length(custom_status) between 1 and 128 and custom_status !~ '[<>[:cntrl:]]'));
alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check check (status in ('online', 'idle', 'dnd', 'invisible'));
alter table public.profiles drop constraint if exists profiles_username_check;
alter table public.profiles add constraint profiles_username_check check (username ~ '^[a-z0-9_.]{2,32}$');
alter table public.profiles drop constraint if exists profiles_avatar_path_check;
alter table public.profiles add constraint profiles_avatar_path_check
  check (avatar_path is null or avatar_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|jpeg|webp|gif)$');

-- Gera um nome de usuario livre a partir de um texto qualquer.
create or replace function public.make_username(p_base text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text := left(regexp_replace(lower(coalesce(p_base, '')), '[^a-z0-9_.]', '', 'g'), 24);
  candidato text;
  tentativa int := 0;
begin
  if char_length(base) < 2 then
    base := 'fantasma';
  end if;
  candidato := base;
  while exists (select 1 from public.profiles p where p.username = candidato) loop
    tentativa := tentativa + 1;
    candidato := base || (1000 + floor(random() * 9000)::int)::text;
    if tentativa > 20 then
      candidato := base || replace(gen_random_uuid()::text, '-', '');
      candidato := left(candidato, 32);
    end if;
  end loop;
  return candidato;
end;
$$;
revoke all on function public.make_username(text) from public, anon, authenticated;

-- Preenche quem ja existe.
do $$
declare
  r record;
begin
  for r in select p.id, p.display_name from public.profiles p where p.username is null order by p.created_at, p.id loop
    update public.profiles set username = public.make_username(r.display_name) where id = r.id;
  end loop;
end;
$$;

create unique index if not exists profiles_username_key on public.profiles (username);
alter table public.profiles alter column username set not null;

-- Nome de usuario sempre minusculo; avatar so dentro da propria pasta.
create or replace function public.profiles_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.username is not null then
    new.username := lower(btrim(new.username));
  end if;
  if new.custom_status is not null and btrim(new.custom_status) = '' then
    new.custom_status := null;
  end if;
  if new.about is not null and btrim(new.about) = '' then
    new.about := null;
  end if;
  if new.avatar_path is not null and split_part(new.avatar_path, '/', 1) <> new.id::text then
    raise exception using errcode = 'P0001', message = 'invalid_avatar';
  end if;
  return new;
end;
$$;
revoke all on function public.profiles_normalize() from public, anon, authenticated;

drop trigger if exists profiles_normalize on public.profiles;
create trigger profiles_normalize
  before insert or update on public.profiles
  for each row execute function public.profiles_normalize();

-- Conta nova: perfil com apelido e nome de usuario.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  nome text;
begin
  nome := left(
    regexp_replace(split_part(coalesce(new.email, ''), '@', 1), '[<>[:cntrl:]]', '', 'g'),
    32
  );
  if char_length(nome) < 2 then
    nome := 'jogador';
  end if;

  insert into public.profiles (id, display_name, username)
  values (new.id, nome, public.make_username(nome))
  on conflict (id) do nothing;

  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

grant update (display_name, mmr_visibility, username, avatar_color, avatar_path, about, custom_status, status)
  on table public.profiles to authenticated;

-- ===========================================================================
-- 3. Relacionamentos (amigos, pedidos, bloqueios)
-- ===========================================================================
create table if not exists public.relationships (
  user_id uuid not null references auth.users (id) on delete cascade,
  other_id uuid not null references auth.users (id) on delete cascade,
  kind text not null
    constraint relationships_kind_check check (kind in ('friend', 'pending_out', 'pending_in', 'blocked')),
  created_at timestamptz not null default now(),
  primary key (user_id, other_id),
  constraint relationships_not_self check (user_id <> other_id)
);
create index if not exists relationships_other_id_idx on public.relationships (other_id);

alter table public.relationships enable row level security;
revoke all on table public.relationships from public, anon, authenticated;
grant select on table public.relationships to authenticated;

drop policy if exists "relationships_select_proprio" on public.relationships;
create policy "relationships_select_proprio"
  on public.relationships
  for select
  to authenticated
  using (user_id = auth.uid());

-- ===========================================================================
-- 4. Servidores (groups), membros, cargos e banimentos
-- ===========================================================================
alter table public.groups add column if not exists icon_color smallint not null default 0;
alter table public.groups add column if not exists icon_path text;
alter table public.groups drop constraint if exists groups_icon_color_check;
alter table public.groups add constraint groups_icon_color_check check (icon_color between 0 and 7);
alter table public.groups drop constraint if exists groups_icon_path_check;
alter table public.groups add constraint groups_icon_path_check
  check (icon_path is null or icon_path ~ '^g_[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|jpeg|webp|gif)$');

-- Agora uma pessoa pode estar em varios servidores.
alter table public.group_members drop constraint if exists group_members_user_id_key;
alter table public.group_members add column if not exists role text not null default 'member';
alter table public.group_members add column if not exists nickname text;
alter table public.group_members drop constraint if exists group_members_role_check;
alter table public.group_members add constraint group_members_role_check check (role in ('owner', 'admin', 'member'));
alter table public.group_members drop constraint if exists group_members_nickname_check;
alter table public.group_members add constraint group_members_nickname_check
  check (nickname is null or (char_length(nickname) between 1 and 32 and nickname !~ '[<>[:cntrl:]]'));
create index if not exists group_members_user_id_idx on public.group_members (user_id);

update public.group_members gm set role = 'owner'
from public.groups g
where g.id = gm.group_id and g.owner_id = gm.user_id and gm.role <> 'owner';

create table if not exists public.group_bans (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  banned_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
alter table public.group_bans enable row level security;
revoke all on table public.group_bans from public, anon, authenticated;

-- Funcoes auxiliares de permissao.
create or replace function public.is_member(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.group_members gm where gm.group_id = gid and gm.user_id = auth.uid());
$$;

create or replace function public.member_role(gid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select gm.role from public.group_members gm where gm.group_id = gid and gm.user_id = auth.uid();
$$;

-- Compatibilidade com o app antigo: primeiro servidor em que a pessoa entrou.
create or replace function public.my_group_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select gm.group_id from public.group_members gm where gm.user_id = auth.uid()
  order by gm.joined_at, gm.group_id
  limit 1;
$$;

-- ===========================================================================
-- 5. Categorias e canais
-- ===========================================================================
create table if not exists public.channel_categories (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  name text not null
    constraint channel_categories_name_check check (char_length(name) between 1 and 32 and name !~ '[<>[:cntrl:]]'),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists channel_categories_group_id_idx on public.channel_categories (group_id);

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  category_id uuid references public.channel_categories (id) on delete set null,
  kind text not null constraint channels_kind_check check (kind in ('text', 'voice')),
  name text not null
    constraint channels_name_check check (char_length(name) between 1 and 32 and name !~ '[<>[:cntrl:]]'),
  topic text constraint channels_topic_check check (topic is null or (char_length(topic) <= 1024 and topic !~ '[<>]')),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists channels_group_id_idx on public.channels (group_id);

alter table public.channel_categories enable row level security;
alter table public.channels enable row level security;
revoke all on table public.channel_categories from public, anon, authenticated;
revoke all on table public.channels from public, anon, authenticated;
grant select on table public.channel_categories to authenticated;
grant select on table public.channels to authenticated;

drop policy if exists "channel_categories_select_membro" on public.channel_categories;
create policy "channel_categories_select_membro"
  on public.channel_categories
  for select
  to authenticated
  using (public.is_member(group_id));

drop policy if exists "channels_select_membro" on public.channels;
create policy "channels_select_membro"
  on public.channels
  for select
  to authenticated
  using (public.is_member(group_id));

-- Nome de canal: texto vira minusculo com hifens; voz so sem < > e controle.
create or replace function public.normalize_channel_name(p_kind text, p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  n text := btrim(coalesce(p_name, ''));
begin
  if p_kind = 'text' then
    n := lower(regexp_replace(n, '\s+', '-', 'g'));
    if n !~ '^[[:alnum:]_-]{1,32}$' then
      raise exception using errcode = 'P0001', message = 'invalid_name';
    end if;
  else
    if char_length(n) not between 1 and 32 or n ~ '[<>[:cntrl:]]' then
      raise exception using errcode = 'P0001', message = 'invalid_name';
    end if;
  end if;
  return n;
end;
$$;
revoke all on function public.normalize_channel_name(text, text) from public, anon, authenticated;

-- Canais padrao de um servidor novo. Uso interno.
create or replace function public.seed_channels(p_group uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cat_texto uuid;
  cat_voz uuid;
  geral uuid;
begin
  insert into public.channel_categories (group_id, name, position) values (p_group, 'Canais de texto', 0)
  returning id into cat_texto;
  insert into public.channel_categories (group_id, name, position) values (p_group, 'Canais de voz', 1)
  returning id into cat_voz;
  insert into public.channels (group_id, category_id, kind, name, position) values (p_group, cat_texto, 'text', 'geral', 0)
  returning id into geral;
  insert into public.channels (group_id, category_id, kind, name, position) values (p_group, cat_voz, 'voice', 'Geral', 0);
  return geral;
end;
$$;
revoke all on function public.seed_channels(uuid) from public, anon, authenticated;

-- Servidores ja existentes ganham os canais padrao.
do $$
declare
  r record;
begin
  for r in select g.id from public.groups g where not exists (select 1 from public.channels c where c.group_id = g.id) loop
    perform public.seed_channels(r.id);
  end loop;
end;
$$;

-- ===========================================================================
-- 6. Mensagens diretas
-- ===========================================================================
create table if not exists public.dm_channels (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users (id) on delete cascade,
  user_b uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint dm_channels_order_check check (user_a < user_b),
  constraint dm_channels_pair_key unique (user_a, user_b)
);
create index if not exists dm_channels_user_b_idx on public.dm_channels (user_b);

alter table public.dm_channels enable row level security;
revoke all on table public.dm_channels from public, anon, authenticated;
grant select on table public.dm_channels to authenticated;

drop policy if exists "dm_channels_select_participante" on public.dm_channels;
create policy "dm_channels_select_participante"
  on public.dm_channels
  for select
  to authenticated
  using (auth.uid() = user_a or auth.uid() = user_b);

create or replace function public.is_dm_participant(p_dm uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.dm_channels d
    where d.id = p_dm and (d.user_a = auth.uid() or d.user_b = auth.uid())
  );
$$;

-- Algum dos dois bloqueou o outro?
create or replace function public.is_blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.relationships r
    where r.kind = 'blocked'
      and ((r.user_id = p_a and r.other_id = p_b) or (r.user_id = p_b and r.other_id = p_a))
  );
$$;
revoke all on function public.is_blocked_between(uuid, uuid) from public, anon, authenticated;

create or replace function public.shares_server(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members x join public.group_members y on y.group_id = x.group_id
    where x.user_id = p_a and y.user_id = p_b
  );
$$;
revoke all on function public.shares_server(uuid, uuid) from public, anon, authenticated;

create or replace function public.are_friends(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.relationships r where r.user_id = p_a and r.other_id = p_b and r.kind = 'friend');
$$;
revoke all on function public.are_friends(uuid, uuid) from public, anon, authenticated;

-- Quem pode ver o perfil de p_user: o proprio, quem tem relacao registrada com ele (amigo, pedido,
-- bloqueio feito por voce), quem divide servidor e quem tem DM com ele.
create or replace function public.can_see_user(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user = auth.uid()
    or exists (select 1 from public.relationships r where r.user_id = auth.uid() and r.other_id = p_user)
    or public.shares_server(auth.uid(), p_user)
    or exists (
      select 1 from public.dm_channels d
      where (d.user_a = auth.uid() and d.user_b = p_user) or (d.user_b = auth.uid() and d.user_a = p_user)
    );
$$;

-- Quem pode acompanhar a presenca (online/ausente) de p_user: o proprio, amigos e colegas de servidor,
-- sem bloqueio entre os dois.
create or replace function public.can_watch_presence(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user = auth.uid()
    or (
      (public.are_friends(auth.uid(), p_user) or public.shares_server(auth.uid(), p_user))
      and not public.is_blocked_between(auth.uid(), p_user)
    );
$$;

-- ===========================================================================
-- 7. Mensagens: canais, DMs, respostas, edicao, anexos, mencoes, fixadas
-- ===========================================================================
alter table public.messages add column if not exists channel_id uuid references public.channels (id) on delete cascade;
alter table public.messages add column if not exists dm_id uuid references public.dm_channels (id) on delete cascade;
alter table public.messages add column if not exists reply_to bigint references public.messages (id) on delete set null;
alter table public.messages add column if not exists edited_at timestamptz;
alter table public.messages add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table public.messages add column if not exists mentions uuid[] not null default '{}';
alter table public.messages add column if not exists pinned boolean not null default false;
alter table public.messages alter column group_id drop not null;

-- Mensagens antigas vao para o primeiro canal de texto do servidor.
update public.messages m set channel_id = (
  select c.id from public.channels c
  where c.group_id = m.group_id and c.kind = 'text'
  order by c.position, c.created_at, c.id
  limit 1
)
where m.channel_id is null and m.dm_id is null and m.group_id is not null;

alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages add constraint messages_body_check
  check (char_length(body) <= 2000
    and (char_length(btrim(body)) >= 1 or jsonb_array_length(attachments) > 0));
alter table public.messages drop constraint if exists messages_target_check;
alter table public.messages add constraint messages_target_check
  check ((channel_id is not null and dm_id is null and group_id is not null)
    or (channel_id is null and dm_id is not null and group_id is null));
alter table public.messages drop constraint if exists messages_attachments_check;
alter table public.messages add constraint messages_attachments_check
  check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 4);
alter table public.messages drop constraint if exists messages_mentions_check;
alter table public.messages add constraint messages_mentions_check check (cardinality(mentions) <= 50);

create index if not exists messages_channel_id_id_idx on public.messages (channel_id, id);
create index if not exists messages_dm_id_id_idx on public.messages (dm_id, id);
create index if not exists messages_pinned_idx on public.messages (channel_id, dm_id) where pinned;

-- Antes de gravar: confere o alvo, liga group_id ao canal, valida resposta e anexos.
create or replace function public.messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  canal record;
  dm record;
  prefixo text;
  item jsonb;
begin
  -- App antigo: so manda group_id. Cai no primeiro canal de texto.
  if new.channel_id is null and new.dm_id is null and new.group_id is not null then
    select c.id into new.channel_id from public.channels c
    where c.group_id = new.group_id and c.kind = 'text'
    order by c.position, c.created_at, c.id
    limit 1;
  end if;

  if new.channel_id is not null then
    select c.id, c.group_id, c.kind into canal from public.channels c where c.id = new.channel_id;
    if canal.id is null or canal.kind <> 'text' then
      raise exception using errcode = 'P0001', message = 'invalid_channel';
    end if;
    new.group_id := canal.group_id;
    new.dm_id := null;
    prefixo := 'g_' || canal.group_id::text || '/' || canal.id::text || '/';
  elsif new.dm_id is not null then
    select d.id, d.user_a, d.user_b into dm from public.dm_channels d where d.id = new.dm_id;
    if dm.id is null then
      raise exception using errcode = 'P0001', message = 'invalid_channel';
    end if;
    if public.is_blocked_between(dm.user_a, dm.user_b) then
      raise exception using errcode = 'P0001', message = 'blocked';
    end if;
    new.group_id := null;
    prefixo := 'd_' || dm.id::text || '/';
  else
    raise exception using errcode = 'P0001', message = 'invalid_channel';
  end if;

  -- Resposta so a mensagem do mesmo canal/DM (senao fica sem resposta).
  if new.reply_to is not null and not exists (
    select 1 from public.messages r
    where r.id = new.reply_to
      and r.channel_id is not distinct from new.channel_id
      and r.dm_id is not distinct from new.dm_id
  ) then
    new.reply_to := null;
  end if;

  if jsonb_typeof(new.attachments) <> 'array' then
    raise exception using errcode = 'P0001', message = 'invalid_attachment';
  end if;
  for item in select * from jsonb_array_elements(new.attachments) loop
    if jsonb_typeof(item) <> 'object'
      or jsonb_typeof(item -> 'path') <> 'string'
      or left(item ->> 'path', char_length(prefixo)) <> prefixo
      or (item ->> 'path') ~ '\.\.'
      or char_length(item ->> 'path') > 400
      or jsonb_typeof(item -> 'name') <> 'string'
      or char_length(item ->> 'name') not between 1 and 200
      or jsonb_typeof(item -> 'size') <> 'number'
      or (item ->> 'size')::numeric not between 0 and 8388608
      or jsonb_typeof(item -> 'mime') <> 'string'
      or char_length(item ->> 'mime') > 100
    then
      raise exception using errcode = 'P0001', message = 'invalid_attachment';
    end if;
  end loop;

  new.edited_at := null;
  new.pinned := false;
  new.mentions := coalesce(new.mentions, '{}');
  return new;
end;
$$;
revoke all on function public.messages_before_insert() from public, anon, authenticated;

drop trigger if exists messages_before_insert on public.messages;
create trigger messages_before_insert
  before insert on public.messages
  for each row execute function public.messages_before_insert();

-- Editar: so o texto e as mencoes; marca edited_at.
create or replace function public.messages_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.messages_before_update() from public, anon, authenticated;

drop trigger if exists messages_before_update on public.messages;
create trigger messages_before_update
  before update on public.messages
  for each row execute function public.messages_before_update();

-- DM sobe na lista quando chega mensagem.
create or replace function public.messages_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.dm_id is not null then
    update public.dm_channels d set last_message_at = new.created_at where d.id = new.dm_id;
  end if;
  return null;
end;
$$;
revoke all on function public.messages_after_insert() from public, anon, authenticated;

drop trigger if exists messages_after_insert on public.messages;
create trigger messages_after_insert
  after insert on public.messages
  for each row execute function public.messages_after_insert();

revoke all on table public.messages from public, anon, authenticated;
grant select, delete on table public.messages to authenticated;
grant insert (group_id, channel_id, dm_id, user_id, body, reply_to, attachments, mentions)
  on table public.messages to authenticated;
grant update (body, mentions) on table public.messages to authenticated;

drop policy if exists "messages_select_membro" on public.messages;
create policy "messages_select_membro"
  on public.messages
  for select
  to authenticated
  using (
    (channel_id is not null and public.is_member(group_id))
    or (dm_id is not null and public.is_dm_participant(dm_id))
  );

drop policy if exists "messages_insert_membro" on public.messages;
create policy "messages_insert_membro"
  on public.messages
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and (
      (channel_id is not null and public.is_member(group_id))
      or (dm_id is not null and public.is_dm_participant(dm_id))
    )
  );

drop policy if exists "messages_update_autor" on public.messages;
create policy "messages_update_autor"
  on public.messages
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "messages_delete_proprio" on public.messages;
drop policy if exists "messages_delete_autor_ou_admin" on public.messages;
create policy "messages_delete_autor_ou_admin"
  on public.messages
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    or (group_id is not null and public.member_role(group_id) in ('owner', 'admin'))
  );

-- Reacoes
create table if not exists public.message_reactions (
  message_id bigint not null references public.messages (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  emoji text not null
    constraint message_reactions_emoji_check check (char_length(emoji) between 1 and 32 and emoji !~ '[<>[:cntrl:][:space:]]'),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

alter table public.message_reactions enable row level security;
revoke all on table public.message_reactions from public, anon, authenticated;
grant select, delete on table public.message_reactions to authenticated;
grant insert (message_id, user_id, emoji) on table public.message_reactions to authenticated;

create or replace function public.can_read_message(p_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.messages m
    where m.id = p_id
      and ((m.channel_id is not null and public.is_member(m.group_id))
        or (m.dm_id is not null and public.is_dm_participant(m.dm_id)))
  );
$$;

drop policy if exists "message_reactions_select" on public.message_reactions;
create policy "message_reactions_select"
  on public.message_reactions
  for select
  to authenticated
  using (public.can_read_message(message_id));

drop policy if exists "message_reactions_insert_proprio" on public.message_reactions;
create policy "message_reactions_insert_proprio"
  on public.message_reactions
  for insert
  to authenticated
  with check (user_id = auth.uid() and public.can_read_message(message_id));

drop policy if exists "message_reactions_delete_proprio" on public.message_reactions;
create policy "message_reactions_delete_proprio"
  on public.message_reactions
  for delete
  to authenticated
  using (user_id = auth.uid());

-- No maximo 20 emojis diferentes por mensagem e 30 reacoes por minuto por pessoa.
create or replace function public.message_reactions_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_at := now();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('gr_react:' || new.message_id::text));
  if not exists (select 1 from public.message_reactions r where r.message_id = new.message_id and r.emoji = new.emoji)
    and (select count(distinct r.emoji) from public.message_reactions r where r.message_id = new.message_id) >= 20 then
    raise exception using errcode = 'P0001', message = 'too_many_reactions';
  end if;
  if (select count(*) from public.message_reactions r
      where r.user_id = new.user_id and r.created_at > now() - interval '1 minute') >= 30 then
    raise exception using errcode = 'P0001', message = 'rate_limited';
  end if;
  return new;
end;
$$;
revoke all on function public.message_reactions_limit() from public, anon, authenticated;

drop trigger if exists message_reactions_limit on public.message_reactions;
create trigger message_reactions_limit
  before insert on public.message_reactions
  for each row execute function public.message_reactions_limit();

-- Ate onde cada pessoa leu
create table if not exists public.read_states (
  user_id uuid not null references auth.users (id) on delete cascade,
  target text not null
    constraint read_states_target_check check (target ~ '^[cd]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  last_read_id bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, target)
);
alter table public.read_states enable row level security;
revoke all on table public.read_states from public, anon, authenticated;
grant select on table public.read_states to authenticated;

drop policy if exists "read_states_select_proprio" on public.read_states;
create policy "read_states_select_proprio"
  on public.read_states
  for select
  to authenticated
  using (user_id = auth.uid());

-- ===========================================================================
-- 8. Politicas antigas trocadas para varios servidores
-- ===========================================================================
drop policy if exists "groups_select_membro" on public.groups;
create policy "groups_select_membro"
  on public.groups
  for select
  to authenticated
  using (public.is_member(id));

drop policy if exists "group_members_select_membro" on public.group_members;
create policy "group_members_select_membro"
  on public.group_members
  for select
  to authenticated
  using (public.is_member(group_id));

drop policy if exists "profiles_select_colega" on public.profiles;
drop policy if exists "profiles_select_visivel" on public.profiles;
create policy "profiles_select_visivel"
  on public.profiles
  for select
  to authenticated
  using (public.can_see_user(id));

-- MMR: o proprio; colegas de servidor com visibilidade 'group' ou 'friends'; amigos com 'friends'.
create or replace function public.can_see_mmr(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = p_user
        and (
          (p.mmr_visibility in ('group', 'friends') and public.shares_server(auth.uid(), p.id))
          or (p.mmr_visibility = 'friends' and public.are_friends(auth.uid(), p.id))
        )
    );
$$;

drop policy if exists "mmr_snapshots_select" on public.mmr_snapshots;
create policy "mmr_snapshots_select"
  on public.mmr_snapshots
  for select
  to authenticated
  using (public.can_see_mmr(user_id));

-- ===========================================================================
-- 9. Convites: podem nunca expirar e nao ter limite de usos
-- ===========================================================================
alter table public.group_invites alter column expires_at drop not null;
alter table public.group_invites alter column max_uses drop not null;
alter table public.group_invites alter column max_uses drop default;
alter table public.group_invites drop constraint if exists group_invites_max_uses_check;
alter table public.group_invites add constraint group_invites_max_uses_check
  check (max_uses is null or max_uses between 1 and 100);
alter table public.group_invites add column if not exists created_at timestamptz not null default now();

-- Codigo de 10 letras sem ambiguas (sem I, L, O, 0 e 1). Uso interno.
create or replace function public.gen_invite_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  alfabeto constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  novo text := '';
  bytes bytea;
  b int;
  i int;
begin
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
  return novo;
end;
$$;
revoke all on function public.gen_invite_code() from public, anon, authenticated;

-- ===========================================================================
-- 10. RPCs: amigos
-- ===========================================================================
create or replace function public.search_users(p_query text)
returns table (id uuid, username text, display_name text, avatar_color smallint, avatar_path text, relation text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  q text := lower(btrim(coalesce(p_query, '')));
  padrao text;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  q := ltrim(q, '@');
  if char_length(q) < 2 or char_length(q) > 32 then
    return;
  end if;
  perform public.rate_check('search', 30, 60);
  padrao := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    select p.id, p.username, p.display_name, p.avatar_color, p.avatar_path,
      coalesce((select r.kind from public.relationships r where r.user_id = uid and r.other_id = p.id), 'none') as relation
    from public.profiles p
    where p.id <> uid
      and (p.username like padrao or lower(p.display_name) like padrao)
      and not exists (
        select 1 from public.relationships rb where rb.user_id = p.id and rb.other_id = uid and rb.kind = 'blocked'
      )
    order by (p.username = q) desc, char_length(p.username), p.username
    limit 20;
end;
$$;

create or replace function public.send_friend_request(p_username text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  alvo uuid;
  minha text;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select p.id into alvo from public.profiles p where p.username = lower(ltrim(btrim(coalesce(p_username, '')), '@'));
  if alvo is null then
    raise exception using errcode = 'P0001', message = 'user_not_found';
  end if;
  if alvo = uid then
    raise exception using errcode = 'P0001', message = 'cannot_add_self';
  end if;
  -- Quem te bloqueou parece nao existir.
  if exists (select 1 from public.relationships r where r.user_id = alvo and r.other_id = uid and r.kind = 'blocked') then
    raise exception using errcode = 'P0001', message = 'user_not_found';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('gr_rel:' || least(uid, alvo)::text || greatest(uid, alvo)::text));
  select r.kind into minha from public.relationships r where r.user_id = uid and r.other_id = alvo;
  if minha = 'blocked' then
    raise exception using errcode = 'P0001', message = 'blocked';
  elsif minha = 'friend' then
    raise exception using errcode = 'P0001', message = 'already_friends';
  elsif minha = 'pending_out' then
    raise exception using errcode = 'P0001', message = 'request_exists';
  elsif minha = 'pending_in' then
    update public.relationships set kind = 'friend', created_at = now() where user_id = uid and other_id = alvo;
    update public.relationships set kind = 'friend', created_at = now() where user_id = alvo and other_id = uid;
    return 'accepted';
  end if;
  perform public.rate_check('friend_request', 20, 3600);
  insert into public.relationships (user_id, other_id, kind) values (uid, alvo, 'pending_out');
  insert into public.relationships (user_id, other_id, kind) values (alvo, uid, 'pending_in')
  on conflict (user_id, other_id) do nothing;
  return 'sent';
end;
$$;

create or replace function public.accept_friend_request(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from public.relationships r where r.user_id = uid and r.other_id = p_user and r.kind = 'pending_in') then
    raise exception using errcode = 'P0001', message = 'invalid_user';
  end if;
  update public.relationships set kind = 'friend', created_at = now() where user_id = uid and other_id = p_user;
  insert into public.relationships (user_id, other_id, kind) values (p_user, uid, 'friend')
  on conflict (user_id, other_id) do update set kind = 'friend', created_at = now()
  where public.relationships.kind = 'pending_out';
end;
$$;

-- Recusa um pedido recebido ou cancela um enviado.
create or replace function public.decline_friend_request(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from public.relationships r
  where r.user_id = uid and r.other_id = p_user and r.kind in ('pending_in', 'pending_out');
  if not found then
    raise exception using errcode = 'P0001', message = 'invalid_user';
  end if;
  delete from public.relationships r
  where r.user_id = p_user and r.other_id = uid and r.kind in ('pending_in', 'pending_out');
end;
$$;

create or replace function public.remove_friend(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from public.relationships r where r.user_id = uid and r.other_id = p_user and r.kind = 'friend';
  if not found then
    raise exception using errcode = 'P0001', message = 'invalid_user';
  end if;
  delete from public.relationships r where r.user_id = p_user and r.other_id = uid and r.kind = 'friend';
end;
$$;

create or replace function public.block_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_user is null or p_user = uid or not exists (select 1 from public.profiles p where p.id = p_user) then
    raise exception using errcode = 'P0001', message = 'invalid_user';
  end if;
  insert into public.relationships (user_id, other_id, kind) values (uid, p_user, 'blocked')
  on conflict (user_id, other_id) do update set kind = 'blocked', created_at = now();
  -- Desfaz amizade/pedidos do outro lado (o bloqueio dele, se houver, continua).
  delete from public.relationships r where r.user_id = p_user and r.other_id = uid and r.kind <> 'blocked';
end;
$$;

create or replace function public.unblock_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from public.relationships r where r.user_id = uid and r.other_id = p_user and r.kind = 'blocked';
  if not found then
    raise exception using errcode = 'P0001', message = 'invalid_user';
  end if;
end;
$$;

create or replace function public.open_dm(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  a uuid;
  b uuid;
  dm uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_user is null or p_user = uid or not exists (select 1 from public.profiles p where p.id = p_user) then
    raise exception using errcode = 'P0001', message = 'invalid_user';
  end if;
  a := least(uid, p_user);
  b := greatest(uid, p_user);
  select d.id into dm from public.dm_channels d where d.user_a = a and d.user_b = b;
  if dm is not null then
    return dm;
  end if;
  if public.is_blocked_between(uid, p_user)
    or not (public.are_friends(uid, p_user) or public.shares_server(uid, p_user)) then
    raise exception using errcode = 'P0001', message = 'dm_not_allowed';
  end if;
  insert into public.dm_channels (user_a, user_b) values (a, b)
  on conflict (user_a, user_b) do nothing
  returning id into dm;
  if dm is null then
    select d.id into dm from public.dm_channels d where d.user_a = a and d.user_b = b;
  end if;
  return dm;
end;
$$;

-- ===========================================================================
-- 11. RPCs: servidores e convites
-- ===========================================================================
drop function if exists public.create_group(text);

create or replace function public.create_group(p_name text, p_icon_color int default 0)
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
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('gr_member:' || uid::text));
  if (select count(*) from public.group_members gm where gm.user_id = uid) >= 50 then
    raise exception using errcode = 'P0001', message = 'too_many_servers';
  end if;
  perform public.rate_check('create_group', 10, 3600);
  insert into public.groups (name, owner_id, icon_color)
  values (nome, uid, case when p_icon_color between 0 and 7 then p_icon_color else 0 end)
  returning id into novo;
  insert into public.group_members (group_id, user_id, role) values (novo, uid, 'owner');
  perform public.seed_channels(novo);
  return novo;
end;
$$;

-- Validade de um convite (uso interno).
create or replace function public.invite_group(p_code text, p_lock boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  codigo text := upper(btrim(coalesce(p_code, '')));
  grupo uuid;
begin
  if codigo !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$' then
    return null;
  end if;
  if p_lock then
    select gi.group_id into grupo from public.group_invites gi
    where gi.code = codigo
      and (gi.expires_at is null or gi.expires_at > now())
      and (gi.max_uses is null or gi.uses < gi.max_uses)
    for update;
  else
    select gi.group_id into grupo from public.group_invites gi
    where gi.code = codigo
      and (gi.expires_at is null or gi.expires_at > now())
      and (gi.max_uses is null or gi.uses < gi.max_uses);
  end if;
  return grupo;
end;
$$;
revoke all on function public.invite_group(text, boolean) from public, anon, authenticated;

create or replace function public.preview_invite(p_code text)
returns table (group_id uuid, name text, icon_color smallint, icon_path text, member_count int, already_member boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  grupo uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform public.rate_check('invite_lookup', 30, 60);
  grupo := public.invite_group(p_code);
  if grupo is null then
    raise exception using errcode = 'P0001', message = 'invalid_invite';
  end if;
  return query
    select g.id, g.name, g.icon_color, g.icon_path,
      (select count(*)::int from public.group_members gm where gm.group_id = g.id),
      exists (select 1 from public.group_members gm where gm.group_id = g.id and gm.user_id = uid)
    from public.groups g where g.id = grupo;
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
  perform public.rate_check('invite_lookup', 30, 60);
  -- Mesmo erro para codigo mal formado, inexistente, vencido ou esgotado.
  grupo := public.invite_group(codigo, true);
  if grupo is null then
    raise exception using errcode = 'P0001', message = 'invalid_invite';
  end if;
  -- Ja e membro: so abre o servidor.
  if exists (select 1 from public.group_members gm where gm.group_id = grupo and gm.user_id = uid) then
    return grupo;
  end if;
  if exists (select 1 from public.group_bans b where b.group_id = grupo and b.user_id = uid) then
    raise exception using errcode = 'P0001', message = 'banned';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('gr_member:' || uid::text));
  if (select count(*) from public.group_members gm where gm.user_id = uid) >= 50 then
    raise exception using errcode = 'P0001', message = 'too_many_servers';
  end if;
  -- Trava o servidor para contar os membros sem corrida.
  perform 1 from public.groups g where g.id = grupo for update;
  select count(*) into total from public.group_members gm where gm.group_id = grupo;
  if total >= 100 then
    raise exception using errcode = 'P0001', message = 'group_full';
  end if;
  insert into public.group_members (group_id, user_id, role) values (grupo, uid, 'member')
  on conflict (group_id, user_id) do nothing;
  update public.group_invites gi set uses = gi.uses + 1 where gi.code = codigo;
  return grupo;
end;
$$;

create or replace function public.create_invite(p_group uuid, p_max_age_seconds int default null, p_max_uses int default null)
returns table (code text, expires_at timestamptz, max_uses int, uses int)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  existente record;
  novo text;
  validade timestamptz;
  tentativa int := 0;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.is_member(p_group) then
    raise exception using errcode = 'P0001', message = 'not_member';
  end if;
  if p_max_age_seconds is not null and p_max_age_seconds not in (1800, 3600, 21600, 43200, 86400, 604800) then
    raise exception using errcode = 'P0001', message = 'invalid_options';
  end if;
  if p_max_uses is not null and p_max_uses not in (1, 5, 10, 25, 50, 100) then
    raise exception using errcode = 'P0001', message = 'invalid_options';
  end if;

  -- Limpa convites vencidos ou esgotados deste servidor.
  delete from public.group_invites gi
  where gi.group_id = p_group
    and ((gi.expires_at is not null and gi.expires_at <= now())
      or (gi.max_uses is not null and gi.uses >= gi.max_uses));

  -- Convite permanente: o mesmo codigo sempre.
  if p_max_age_seconds is null and p_max_uses is null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('gr_invite:' || p_group::text));
    select gi.code, gi.expires_at, gi.max_uses, gi.uses into existente
    from public.group_invites gi
    where gi.group_id = p_group and gi.expires_at is null and gi.max_uses is null
    order by gi.created_at, gi.code
    limit 1;
    if existente.code is not null then
      return query select existente.code, existente.expires_at, existente.max_uses, existente.uses;
      return;
    end if;
  end if;

  perform public.rate_check('create_invite', 20, 3600);
  if p_max_age_seconds is not null then
    validade := now() + make_interval(secs => p_max_age_seconds);
  end if;
  loop
    tentativa := tentativa + 1;
    novo := public.gen_invite_code();
    begin
      insert into public.group_invites (code, group_id, created_by, expires_at, max_uses)
      values (novo, p_group, uid, validade, p_max_uses);
      exit;
    exception when unique_violation then
      if tentativa >= 5 then
        raise;
      end if;
    end;
  end loop;
  return query select novo, validade, p_max_uses, 0;
end;
$$;

create or replace function public.list_invites(p_group uuid)
returns table (code text, created_by uuid, expires_at timestamptz, max_uses int, uses int, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if coalesce(public.member_role(p_group), '') not in ('owner', 'admin') then
    raise exception using errcode = 'P0001', message = 'not_admin';
  end if;
  return query
    select gi.code, gi.created_by, gi.expires_at, gi.max_uses, gi.uses, gi.created_at
    from public.group_invites gi
    where gi.group_id = p_group
      and (gi.expires_at is null or gi.expires_at > now())
      and (gi.max_uses is null or gi.uses < gi.max_uses)
    order by gi.created_at desc;
end;
$$;

create or replace function public.revoke_invite(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  conv record;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select gi.code, gi.group_id, gi.created_by into conv
  from public.group_invites gi where gi.code = upper(btrim(coalesce(p_code, '')));
  if conv.code is null then
    raise exception using errcode = 'P0001', message = 'invalid_invite';
  end if;
  if conv.created_by is distinct from uid and coalesce(public.member_role(conv.group_id), '') not in ('owner', 'admin') then
    raise exception using errcode = 'P0001', message = 'not_admin';
  end if;
  delete from public.group_invites gi where gi.code = conv.code;
end;
$$;

-- Saida de um servidor (uso interno). Dono sozinho: apaga. Dono com outros: passa para o admin
-- mais antigo, senao para o membro mais antigo.
create or replace function public.leave_group_from(p_user uuid, p_group uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  dono uuid;
  novo_dono uuid;
begin
  select g.owner_id into dono from public.groups g where g.id = p_group for update;
  delete from public.group_members gm where gm.group_id = p_group and gm.user_id = p_user;
  if not found then
    return false;
  end if;
  if dono = p_user then
    select gm.user_id into novo_dono
    from public.group_members gm
    where gm.group_id = p_group
    order by (gm.role = 'admin') desc, gm.joined_at, gm.user_id
    limit 1;
    if novo_dono is null then
      delete from public.groups g where g.id = p_group;
    else
      update public.groups g set owner_id = novo_dono where g.id = p_group;
      update public.group_members gm set role = 'owner' where gm.group_id = p_group and gm.user_id = novo_dono;
    end if;
  end if;
  return true;
end;
$$;
revoke all on function public.leave_group_from(uuid, uuid) from public, anon, authenticated;

-- Sai de todos os servidores (usado ao apagar a conta). Uso interno.
create or replace function public.leave_group_of(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  saiu boolean := false;
begin
  for r in select gm.group_id from public.group_members gm where gm.user_id = p_user_id loop
    if public.leave_group_from(p_user_id, r.group_id) then
      saiu := true;
    end if;
  end loop;
  return saiu;
end;
$$;
revoke all on function public.leave_group_of(uuid) from public, anon, authenticated;

create or replace function public.leave_group(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.leave_group_from(auth.uid(), p_group) then
    raise exception using errcode = 'P0001', message = 'not_member';
  end if;
end;
$$;

-- Compatibilidade: app antigo sai do primeiro servidor.
create or replace function public.leave_group()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  grupo uuid := public.my_group_id();
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if grupo is null or not public.leave_group_from(auth.uid(), grupo) then
    raise exception using errcode = 'P0001', message = 'not_in_group';
  end if;
end;
$$;

-- Compatibilidade: app antigo pede o convite do primeiro servidor (agora permanente).
-- Devolve uma validade de 1 ano so para o app antigo exibir; o codigo nao expira.
create or replace function public.create_invite()
returns table (code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  grupo uuid := public.my_group_id();
  conv record;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if grupo is null then
    raise exception using errcode = 'P0001', message = 'not_in_group';
  end if;
  select * into conv from public.create_invite(grupo, null, null);
  return query select conv.code, coalesce(conv.expires_at, now() + interval '365 days');
end;
$$;

create or replace function public.delete_group(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if coalesce(public.member_role(p_group), '') <> 'owner' then
    raise exception using errcode = 'P0001', message = 'not_owner';
  end if;
  delete from public.groups g where g.id = p_group;
end;
$$;

create or replace function public.update_group(p_group uuid, p_name text default null, p_icon_color int default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  nome text := btrim(p_name);
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if coalesce(public.member_role(p_group), '') not in ('owner', 'admin') then
    raise exception using errcode = 'P0001', message = 'not_admin';
  end if;
  if p_name is not null and (char_length(nome) not between 2 and 32 or nome ~ '[<>[:cntrl:]]') then
    raise exception using errcode = 'P0001', message = 'invalid_name';
  end if;
  if p_icon_color is not null and p_icon_color not between 0 and 7 then
    raise exception using errcode = 'P0001', message = 'invalid_options';
  end if;
  update public.groups g
  set name = coalesce(nome, g.name), icon_color = coalesce(p_icon_color, g.icon_color)
  where g.id = p_group;
end;
$$;

create or replace function public.set_group_icon(p_group uuid, p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if coalesce(public.member_role(p_group), '') not in ('owner', 'admin') then
    raise exception using errcode = 'P0001', message = 'not_admin';
  end if;
  if p_path is not null
    and p_path !~ ('^g_' || p_group::text || '/[0-9a-f-]{36}\.(png|jpg|jpeg|webp|gif)$') then
    raise exception using errcode = 'P0001', message = 'invalid_options';
  end if;
  update public.groups g set icon_path = p_path where g.id = p_group;
end;
$$;

-- Alvo de moderacao (uso interno): confere cargo de quem pede e de quem sofre.
create or replace function public.mod_target_check(p_group uuid, p_user uuid, p_min text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  eu text := public.member_role(p_group);
  ele text;
begin
  if eu is null then
    raise exception using errcode = 'P0001', message = 'not_member';
  end if;
  if p_min = 'owner' and eu <> 'owner' then
    raise exception using errcode = 'P0001', message = 'not_owner';
  end if;
  if p_min = 'admin' and eu not in ('owner', 'admin') then
    raise exception using errcode = 'P0001', message = 'not_admin';
  end if;
  if p_user is null or p_user = auth.uid() then
    raise exception using errcode = 'P0001', message = 'cannot_target';
  end if;
  select gm.role into ele from public.group_members gm where gm.group_id = p_group and gm.user_id = p_user;
  if ele is null then
    raise exception using errcode = 'P0001', message = 'invalid_user';
  end if;
  if ele = 'owner' or (eu = 'admin' and ele = 'admin') then
    raise exception using errcode = 'P0001', message = 'cannot_target';
  end if;
  return ele;
end;
$$;
revoke all on function public.mod_target_check(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.set_member_role(p_group uuid, p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_role is null or p_role not in ('admin', 'member') then
    raise exception using errcode = 'P0001', message = 'invalid_options';
  end if;
  perform public.mod_target_check(p_group, p_user, 'owner');
  update public.group_members gm set role = p_role where gm.group_id = p_group and gm.user_id = p_user;
end;
$$;

create or replace function public.transfer_ownership(p_group uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform public.mod_target_check(p_group, p_user, 'owner');
  perform 1 from public.groups g where g.id = p_group for update;
  update public.group_members gm set role = 'admin' where gm.group_id = p_group and gm.user_id = auth.uid();
  update public.group_members gm set role = 'owner' where gm.group_id = p_group and gm.user_id = p_user;
  update public.groups g set owner_id = p_user where g.id = p_group;
end;
$$;

create or replace function public.kick_member(p_group uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform public.mod_target_check(p_group, p_user, 'admin');
  delete from public.group_members gm where gm.group_id = p_group and gm.user_id = p_user;
end;
$$;

create or replace function public.ban_member(p_group uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform public.mod_target_check(p_group, p_user, 'admin');
  delete from public.group_members gm where gm.group_id = p_group and gm.user_id = p_user;
  insert into public.group_bans (group_id, user_id, banned_by) values (p_group, p_user, auth.uid())
  on conflict (group_id, user_id) do nothing;
end;
$$;

create or replace function public.unban_member(p_group uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if coalesce(public.member_role(p_group), '') not in ('owner', 'admin') then
    raise exception using errcode = 'P0001', message = 'not_admin';
  end if;
  delete from public.group_bans b where b.group_id = p_group and b.user_id = p_user;
  if not found then
    raise exception using errcode = 'P0001', message = 'invalid_user';
  end if;
end;
$$;

create or replace function public.list_bans(p_group uuid)
returns table (user_id uuid, username text, display_name text, avatar_color smallint, avatar_path text, banned_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if coalesce(public.member_role(p_group), '') not in ('owner', 'admin') then
    raise exception using errcode = 'P0001', message = 'not_admin';
  end if;
  return query
    select b.user_id, p.username, p.display_name, p.avatar_color, p.avatar_path, b.created_at
    from public.group_bans b
    join public.profiles p on p.id = b.user_id
    where b.group_id = p_group
    order by b.created_at desc;
end;
$$;

create or replace function public.set_nickname(p_group uuid, p_nickname text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  apelido text := nullif(btrim(coalesce(p_nickname, '')), '');
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.is_member(p_group) then
    raise exception using errcode = 'P0001', message = 'not_member';
  end if;
  if apelido is not null and (char_length(apelido) > 32 or apelido ~ '[<>[:cntrl:]]') then
    raise exception using errcode = 'P0001', message = 'invalid_name';
  end if;
  update public.group_members gm set nickname = apelido where gm.group_id = p_group and gm.user_id = auth.uid();
end;
$$;

-- Compatibilidade: app antigo remove alguem do primeiro servidor.
create or replace function public.remove_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  grupo uuid := public.my_group_id();
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if grupo is null then
    raise exception using errcode = 'P0001', message = 'not_in_group';
  end if;
  if coalesce(public.member_role(grupo), '') not in ('owner', 'admin') or p_user_id is null or p_user_id = auth.uid() then
    raise exception using errcode = 'P0001', message = 'not_owner';
  end if;
  if not exists (select 1 from public.group_members gm where gm.group_id = grupo and gm.user_id = p_user_id) then
    raise exception using errcode = 'P0001', message = 'not_in_group';
  end if;
  perform public.mod_target_check(grupo, p_user_id, 'admin');
  delete from public.group_members gm where gm.group_id = grupo and gm.user_id = p_user_id;
end;
$$;

-- ===========================================================================
-- 12. RPCs: canais e categorias (admin ou dono)
-- ===========================================================================
create or replace function public.need_admin(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_group is null or coalesce(public.member_role(p_group), '') not in ('owner', 'admin') then
    raise exception using errcode = 'P0001', message = 'not_admin';
  end if;
end;
$$;
revoke all on function public.need_admin(uuid) from public, anon, authenticated;

create or replace function public.create_category(p_group uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  nome text := btrim(coalesce(p_name, ''));
  novo uuid;
begin
  perform public.need_admin(p_group);
  if char_length(nome) not between 1 and 32 or nome ~ '[<>[:cntrl:]]' then
    raise exception using errcode = 'P0001', message = 'invalid_name';
  end if;
  if (select count(*) from public.channel_categories c where c.group_id = p_group) >= 50 then
    raise exception using errcode = 'P0001', message = 'too_many_channels';
  end if;
  insert into public.channel_categories (group_id, name, position)
  values (p_group, nome, coalesce((select max(c.position) + 1 from public.channel_categories c where c.group_id = p_group), 0))
  returning id into novo;
  return novo;
end;
$$;

create or replace function public.update_category(p_id uuid, p_name text default null, p_position int default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  grupo uuid;
  nome text := btrim(p_name);
begin
  select c.group_id into grupo from public.channel_categories c where c.id = p_id;
  perform public.need_admin(grupo);
  if p_name is not null and (char_length(nome) not between 1 and 32 or nome ~ '[<>[:cntrl:]]') then
    raise exception using errcode = 'P0001', message = 'invalid_name';
  end if;
  if p_position is not null and p_position not between 0 and 1000 then
    raise exception using errcode = 'P0001', message = 'invalid_options';
  end if;
  update public.channel_categories c
  set name = coalesce(nome, c.name), position = coalesce(p_position, c.position)
  where c.id = p_id;
end;
$$;

create or replace function public.delete_category(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  grupo uuid;
begin
  select c.group_id into grupo from public.channel_categories c where c.id = p_id;
  perform public.need_admin(grupo);
  delete from public.channel_categories c where c.id = p_id;
end;
$$;

create or replace function public.create_channel(p_group uuid, p_kind text, p_name text, p_category uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  nome text;
  novo uuid;
begin
  perform public.need_admin(p_group);
  if p_kind is null or p_kind not in ('text', 'voice') then
    raise exception using errcode = 'P0001', message = 'invalid_options';
  end if;
  nome := public.normalize_channel_name(p_kind, p_name);
  if p_category is not null and not exists (
    select 1 from public.channel_categories c where c.id = p_category and c.group_id = p_group
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_options';
  end if;
  if (select count(*) from public.channels c where c.group_id = p_group) >= 200 then
    raise exception using errcode = 'P0001', message = 'too_many_channels';
  end if;
  insert into public.channels (group_id, category_id, kind, name, position)
  values (p_group, p_category, p_kind, nome,
    coalesce((select max(c.position) + 1 from public.channels c
      where c.group_id = p_group and c.category_id is not distinct from p_category), 0))
  returning id into novo;
  return novo;
end;
$$;

-- p_category: null mantem; para tirar da categoria use p_clear_category = true.
create or replace function public.update_channel(
  p_id uuid, p_name text default null, p_topic text default null, p_category uuid default null,
  p_position int default null, p_clear_category boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  canal record;
  nome text;
  topico text := p_topic;
begin
  select c.id, c.group_id, c.kind into canal from public.channels c where c.id = p_id;
  perform public.need_admin(canal.group_id);
  if p_name is not null then
    nome := public.normalize_channel_name(canal.kind, p_name);
  end if;
  if p_topic is not null then
    topico := btrim(p_topic);
    if char_length(topico) > 1024 or topico ~ '[<>]' then
      raise exception using errcode = 'P0001', message = 'invalid_options';
    end if;
  end if;
  if p_category is not null and not exists (
    select 1 from public.channel_categories c where c.id = p_category and c.group_id = canal.group_id
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_options';
  end if;
  if p_position is not null and p_position not between 0 and 1000 then
    raise exception using errcode = 'P0001', message = 'invalid_options';
  end if;
  update public.channels c set
    name = coalesce(nome, c.name),
    topic = case when p_topic is null then c.topic else nullif(topico, '') end,
    category_id = case when p_clear_category then null else coalesce(p_category, c.category_id) end,
    position = coalesce(p_position, c.position)
  where c.id = p_id;
end;
$$;

create or replace function public.delete_channel(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  canal record;
begin
  select c.id, c.group_id, c.kind into canal from public.channels c where c.id = p_id;
  perform public.need_admin(canal.group_id);
  perform 1 from public.groups g where g.id = canal.group_id for update;
  if canal.kind = 'text' and (
    select count(*) from public.channels c where c.group_id = canal.group_id and c.kind = 'text'
  ) <= 1 then
    raise exception using errcode = 'P0001', message = 'last_text_channel';
  end if;
  delete from public.channels c where c.id = p_id;
end;
$$;

-- ===========================================================================
-- 13. RPCs: mensagens (fixar, nao lidas, busca)
-- ===========================================================================
-- Alvo 'c:<uuid>' ou 'd:<uuid>' que a pessoa pode ler (uso interno). Devolve (kind, id).
create or replace function public.parse_target(p_target text)
returns table (kind text, id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  k text;
  i uuid;
begin
  if p_target is null or p_target !~ '^[cd]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode = 'P0001', message = 'invalid_channel';
  end if;
  k := left(p_target, 1);
  i := substr(p_target, 3)::uuid;
  if k = 'c' then
    if not exists (select 1 from public.channels c where c.id = i and c.kind = 'text' and public.is_member(c.group_id)) then
      raise exception using errcode = 'P0001', message = 'invalid_channel';
    end if;
  elsif not public.is_dm_participant(i) then
    raise exception using errcode = 'P0001', message = 'invalid_channel';
  end if;
  return query select k, i;
end;
$$;
revoke all on function public.parse_target(text) from public, anon, authenticated;

create or replace function public.pin_message(p_id bigint, p_pinned boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  msg record;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select m.id, m.group_id, m.channel_id, m.dm_id, m.pinned into msg from public.messages m where m.id = p_id;
  if msg.id is null or not public.can_read_message(p_id) then
    raise exception using errcode = 'P0001', message = 'invalid_message';
  end if;
  if msg.channel_id is not null and coalesce(public.member_role(msg.group_id), '') not in ('owner', 'admin') then
    raise exception using errcode = 'P0001', message = 'not_admin';
  end if;
  if coalesce(p_pinned, false) and not msg.pinned and (
    select count(*) from public.messages m
    where m.pinned and m.channel_id is not distinct from msg.channel_id and m.dm_id is not distinct from msg.dm_id
  ) >= 50 then
    raise exception using errcode = 'P0001', message = 'too_many_pins';
  end if;
  update public.messages m set pinned = coalesce(p_pinned, false) where m.id = p_id;
end;
$$;

create or replace function public.mark_read(p_target text, p_last_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  alvo record;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into alvo from public.parse_target(p_target);
  insert into public.read_states (user_id, target, last_read_id, updated_at)
  values (auth.uid(), p_target, greatest(coalesce(p_last_id, 0), 0), now())
  on conflict (user_id, target) do update
    set last_read_id = greatest(public.read_states.last_read_id, excluded.last_read_id), updated_at = now();
end;
$$;

create or replace function public.unread_summary()
returns table (target text, last_message_id bigint, unread int, mentions int)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  return query
    with alvos as (
      select 'c:' || c.id::text as target, c.id as channel_id, null::uuid as dm_id
      from public.channels c
      join public.group_members gm on gm.group_id = c.group_id and gm.user_id = uid
      where c.kind = 'text'
      union all
      select 'd:' || d.id::text, null::uuid, d.id
      from public.dm_channels d
      where d.user_a = uid or d.user_b = uid
    )
    select a.target,
      coalesce((select max(m.id) from public.messages m
        where (m.channel_id = a.channel_id or m.dm_id = a.dm_id)), 0)::bigint,
      (select count(*)::int from (
        select 1 from public.messages m
        where (m.channel_id = a.channel_id or m.dm_id = a.dm_id)
          and m.user_id <> uid
          and m.id > coalesce((select rs.last_read_id from public.read_states rs where rs.user_id = uid and rs.target = a.target), 0)
        limit 99) x),
      (select count(*)::int from (
        select 1 from public.messages m
        where (m.channel_id = a.channel_id or m.dm_id = a.dm_id)
          and m.user_id <> uid
          and uid = any (m.mentions)
          and m.id > coalesce((select rs.last_read_id from public.read_states rs where rs.user_id = uid and rs.target = a.target), 0)
        limit 99) y)
    from alvos a;
end;
$$;

create or replace function public.search_messages(p_target text, p_query text)
returns setof public.messages
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  alvo record;
  q text := btrim(coalesce(p_query, ''));
  padrao text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into alvo from public.parse_target(p_target);
  if char_length(q) < 1 or char_length(q) > 100 then
    return;
  end if;
  padrao := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  if alvo.kind = 'c' then
    return query select m.* from public.messages m
      where m.channel_id = alvo.id and m.body ilike padrao order by m.id desc limit 25;
  else
    return query select m.* from public.messages m
      where m.dm_id = alvo.id and m.body ilike padrao order by m.id desc limit 25;
  end if;
end;
$$;

-- ===========================================================================
-- 14. Apagar a propria conta: sai de todos os servidores antes
-- ===========================================================================
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

-- ===========================================================================
-- 15. Permissoes das funcoes
-- ===========================================================================
do $$
declare
  f text;
  rpc text[] := array[
    'public.is_member(uuid)', 'public.member_role(uuid)', 'public.my_group_id()',
    'public.is_dm_participant(uuid)', 'public.can_see_user(uuid)', 'public.can_see_mmr(uuid)', 'public.can_watch_presence(uuid)',
    'public.can_read_message(bigint)',
    'public.search_users(text)', 'public.send_friend_request(text)', 'public.accept_friend_request(uuid)',
    'public.decline_friend_request(uuid)', 'public.remove_friend(uuid)', 'public.block_user(uuid)',
    'public.unblock_user(uuid)', 'public.open_dm(uuid)',
    'public.create_group(text, integer)', 'public.preview_invite(text)', 'public.join_group(text)',
    'public.create_invite(uuid, integer, integer)', 'public.create_invite()', 'public.list_invites(uuid)',
    'public.revoke_invite(text)', 'public.leave_group(uuid)', 'public.leave_group()', 'public.delete_group(uuid)',
    'public.update_group(uuid, text, integer)', 'public.set_group_icon(uuid, text)',
    'public.set_member_role(uuid, uuid, text)', 'public.transfer_ownership(uuid, uuid)',
    'public.kick_member(uuid, uuid)', 'public.ban_member(uuid, uuid)', 'public.unban_member(uuid, uuid)',
    'public.list_bans(uuid)', 'public.set_nickname(uuid, text)', 'public.remove_member(uuid)',
    'public.create_category(uuid, text)', 'public.update_category(uuid, text, integer)',
    'public.delete_category(uuid)', 'public.create_channel(uuid, text, text, uuid)',
    'public.update_channel(uuid, text, text, uuid, integer, boolean)', 'public.delete_channel(uuid)',
    'public.pin_message(bigint, boolean)', 'public.mark_read(text, bigint)', 'public.unread_summary()',
    'public.search_messages(text, text)', 'public.delete_my_account()'
  ];
begin
  foreach f in array rpc loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

-- ===========================================================================
-- 16. Realtime
-- ===========================================================================
alter table public.messages replica identity full;
alter table public.message_reactions replica identity full;
alter table public.relationships replica identity full;
alter table public.group_members replica identity full;

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['messages', 'message_reactions', 'relationships', 'group_members', 'channels',
      'channel_categories', 'dm_channels', 'groups'] loop
      if not exists (
        select 1 from pg_publication_tables pt
        where pt.pubname = 'supabase_realtime' and pt.schemaname = 'public' and pt.tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;

-- Quem pode receber (ler) num topico privado de broadcast/presence.
create or replace function public.realtime_can_read(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uuid_re constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
begin
  if auth.uid() is null or p_topic is null then
    return false;
  end if;
  if p_topic ~ ('^server:' || uuid_re || '$') then
    return public.is_member(substr(p_topic, 8)::uuid);
  elsif p_topic ~ ('^user:' || uuid_re || '$') then
    return public.can_watch_presence(substr(p_topic, 6)::uuid);
  elsif p_topic ~ ('^dm:' || uuid_re || '$') then
    return public.is_dm_participant(substr(p_topic, 4)::uuid);
  end if;
  return false;
end;
$$;

-- Quem pode enviar (broadcast) ou se anunciar (presence) num topico privado.
create or replace function public.realtime_can_write(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uuid_re constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
begin
  if auth.uid() is null or p_topic is null then
    return false;
  end if;
  if p_topic ~ ('^user:' || uuid_re || '$') then
    -- So o dono do topico anuncia o proprio status.
    return substr(p_topic, 6)::uuid = auth.uid();
  end if;
  return public.realtime_can_read(p_topic);
end;
$$;

revoke all on function public.realtime_can_read(text) from public, anon;
revoke all on function public.realtime_can_write(text) from public, anon;
grant execute on function public.realtime_can_read(text) to authenticated;
grant execute on function public.realtime_can_write(text) to authenticated;

do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists "gr_realtime_receber" on realtime.messages';
    execute 'create policy "gr_realtime_receber" on realtime.messages for select to authenticated '
      || 'using (public.realtime_can_read(realtime.topic()))';
    execute 'drop policy if exists "gr_realtime_enviar" on realtime.messages';
    execute 'create policy "gr_realtime_enviar" on realtime.messages for insert to authenticated '
      || 'with check (public.realtime_can_write(realtime.topic()))';
  end if;
end;
$$;

-- ===========================================================================
-- 17. Storage: avatares (publico) e anexos (privado)
-- ===========================================================================
-- Caminho de anexo valido para quem esta logado:
--   g_<servidor>/<canal de texto>/<uuid>/<nome>  (membro do servidor)
--   d_<dm>/<uuid>/<nome>                         (participante da DM)
create or replace function public.can_use_attachment_path(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uuid_re constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  nome_re constant text := '[^/\\]{1,200}';
  gid uuid;
  cid uuid;
begin
  if auth.uid() is null or p_name is null or char_length(p_name) > 400 or p_name ~ '\.\.' then
    return false;
  end if;
  if p_name ~ ('^g_' || uuid_re || '/' || uuid_re || '/' || uuid_re || '/' || nome_re || '$') then
    gid := substr(split_part(p_name, '/', 1), 3)::uuid;
    cid := split_part(p_name, '/', 2)::uuid;
    return public.is_member(gid)
      and exists (select 1 from public.channels c where c.id = cid and c.group_id = gid and c.kind = 'text');
  elsif p_name ~ ('^d_' || uuid_re || '/' || uuid_re || '/' || nome_re || '$') then
    return public.is_dm_participant(substr(split_part(p_name, '/', 1), 3)::uuid);
  end if;
  return false;
end;
$$;

-- Caminho de avatar/icone que a pessoa pode gravar:
--   <seu id>/<uuid>.<ext>  ou  g_<servidor>/<uuid>.<ext> (admin ou dono)
create or replace function public.can_write_avatar_path(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uuid_re constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  ext_re constant text := '\.(png|jpg|jpeg|webp|gif)$';
begin
  if auth.uid() is null or p_name is null then
    return false;
  end if;
  if p_name ~ ('^' || uuid_re || '/' || uuid_re || ext_re) then
    return split_part(p_name, '/', 1) = auth.uid()::text;
  elsif p_name ~ ('^g_' || uuid_re || '/' || uuid_re || ext_re) then
    return coalesce(public.member_role(substr(split_part(p_name, '/', 1), 3)::uuid), '') in ('owner', 'admin');
  end if;
  return false;
end;
$$;

revoke all on function public.can_use_attachment_path(text) from public, anon;
revoke all on function public.can_write_avatar_path(text) from public, anon;
grant execute on function public.can_use_attachment_path(text) to authenticated;
grant execute on function public.can_write_avatar_path(text) to authenticated;

do $$
declare
  dono text;
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
  on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
  insert into storage.buckets (id, name, public, file_size_limit)
  values ('attachments', 'attachments', false, 8388608)
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

  -- Coluna do dono do arquivo (owner_id nas versoes novas do Storage; owner nas antigas).
  if exists (select 1 from information_schema.columns
             where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner_id') then
    dono := 'owner_id = auth.uid()::text';
  else
    dono := 'owner = auth.uid()';
  end if;

  execute 'drop policy if exists "gr_avatars_gravar" on storage.objects';
  execute 'create policy "gr_avatars_gravar" on storage.objects for insert to authenticated '
    || 'with check (bucket_id = ''avatars'' and public.can_write_avatar_path(name))';
  execute 'drop policy if exists "gr_avatars_atualizar" on storage.objects';
  execute 'create policy "gr_avatars_atualizar" on storage.objects for update to authenticated '
    || 'using (bucket_id = ''avatars'' and public.can_write_avatar_path(name)) '
    || 'with check (bucket_id = ''avatars'' and public.can_write_avatar_path(name))';
  execute 'drop policy if exists "gr_avatars_apagar" on storage.objects';
  execute 'create policy "gr_avatars_apagar" on storage.objects for delete to authenticated '
    || 'using (bucket_id = ''avatars'' and public.can_write_avatar_path(name))';

  execute 'drop policy if exists "gr_anexos_ler" on storage.objects';
  execute 'create policy "gr_anexos_ler" on storage.objects for select to authenticated '
    || 'using (bucket_id = ''attachments'' and public.can_use_attachment_path(name))';
  execute 'drop policy if exists "gr_anexos_gravar" on storage.objects';
  execute 'create policy "gr_anexos_gravar" on storage.objects for insert to authenticated '
    || 'with check (bucket_id = ''attachments'' and public.can_use_attachment_path(name))';
  execute 'drop policy if exists "gr_anexos_apagar" on storage.objects';
  execute 'create policy "gr_anexos_apagar" on storage.objects for delete to authenticated '
    || 'using (bucket_id = ''attachments'' and ' || dono || ')';
end;
$$;
