-- =============================================================================
-- LUMENEX (Etapa 7) — perfil personalizado e organizacao de voz por ADM
-- =============================================================================
-- Precisa da 0006_discord.sql aplicada. Pode rodar de novo sem erro e nao apaga dados.
--   * Avatar e banner de ate 40 MB (estaticos ou animados) no bucket avatars, com miniatura.
--   * Recorte do avatar, posicao do banner, moldura e efeito do perfil (8 de cada, gratis).
--   * Tema da conta (claro, escuro, meia-noite).
--   * Reorganizar canais (arrastar e soltar) e mover pessoas entre salas de voz: so dono/admin.
-- O app antigo (.exe da Etapa 6) continua funcionando: avatar em <uid>/<uuid>.<ext> segue valido.
-- =============================================================================

do $$
begin
  if to_regclass('public.channels') is null or to_regprocedure('public.need_admin(uuid)') is null then
    raise exception 'Rode antes a 0006_discord.sql.';
  end if;
end;
$$;

-- ===========================================================================
-- 1. Colunas novas do perfil
-- ===========================================================================
alter table public.profiles add column if not exists banner_path text;
alter table public.profiles add column if not exists avatar_thumb_path text;
alter table public.profiles add column if not exists banner_thumb_path text;
alter table public.profiles add column if not exists avatar_animated boolean not null default false;
alter table public.profiles add column if not exists banner_animated boolean not null default false;
alter table public.profiles add column if not exists avatar_crop jsonb;
alter table public.profiles add column if not exists banner_pos smallint not null default 50;
alter table public.profiles add column if not exists avatar_frame text;
alter table public.profiles add column if not exists profile_effect text;
alter table public.profiles add column if not exists appearance_theme text;

-- Recorte do avatar: ponto focal em % (0..100) e zoom (1..3). So essas 3 chaves, todas numeros.
create or replace function public.valid_avatar_crop(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is null or (
    jsonb_typeof(p) = 'object'
    and (select count(*) from jsonb_object_keys(p)) = 3
    and p ? 'x' and p ? 'y' and p ? 'zoom'
    and jsonb_typeof(p -> 'x') = 'number' and jsonb_typeof(p -> 'y') = 'number' and jsonb_typeof(p -> 'zoom') = 'number'
    and (p ->> 'x')::numeric between 0 and 100
    and (p ->> 'y')::numeric between 0 and 100
    and (p ->> 'zoom')::numeric between 1 and 3
  );
$$;
revoke all on function public.valid_avatar_crop(jsonb) from public, anon;
grant execute on function public.valid_avatar_crop(jsonb) to authenticated;

-- Caminho de imagem do perfil no bucket avatars.
--   antigo (Etapa 6): <uid>/<uuid>.<ext>            (so avatar)
--   novo:             <uid>/<avatar|banner>/<uuid>.<ext>
--   miniatura:        <uid>/<avatar|banner>/<uuid>.thumb.webp
create or replace function public.valid_profile_media_path(p_path text, p_kind text, p_thumb boolean)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  u constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
begin
  if p_path is null then
    return true;
  end if;
  if p_kind not in ('avatar', 'banner') then
    return false;
  end if;
  if p_thumb then
    return p_path ~ ('^' || u || '/' || p_kind || '/' || u || '\.thumb\.webp$');
  end if;
  if p_path ~ ('^' || u || '/' || p_kind || '/' || u || '\.(png|jpg|jpeg|webp|gif)$') then
    return true;
  end if;
  return p_kind = 'avatar' and p_path ~ ('^' || u || '/' || u || '\.(png|jpg|jpeg|webp|gif)$');
end;
$$;
revoke all on function public.valid_profile_media_path(text, text, boolean) from public, anon;
grant execute on function public.valid_profile_media_path(text, text, boolean) to authenticated;

alter table public.profiles drop constraint if exists profiles_avatar_path_check;
alter table public.profiles add constraint profiles_avatar_path_check
  check (public.valid_profile_media_path(avatar_path, 'avatar', false));
alter table public.profiles drop constraint if exists profiles_avatar_thumb_path_check;
alter table public.profiles add constraint profiles_avatar_thumb_path_check
  check (public.valid_profile_media_path(avatar_thumb_path, 'avatar', true));
alter table public.profiles drop constraint if exists profiles_banner_path_check;
alter table public.profiles add constraint profiles_banner_path_check
  check (public.valid_profile_media_path(banner_path, 'banner', false));
alter table public.profiles drop constraint if exists profiles_banner_thumb_path_check;
alter table public.profiles add constraint profiles_banner_thumb_path_check
  check (public.valid_profile_media_path(banner_thumb_path, 'banner', true));
alter table public.profiles drop constraint if exists profiles_avatar_crop_check;
alter table public.profiles add constraint profiles_avatar_crop_check check (public.valid_avatar_crop(avatar_crop));
alter table public.profiles drop constraint if exists profiles_banner_pos_check;
alter table public.profiles add constraint profiles_banner_pos_check check (banner_pos between 0 and 100);
alter table public.profiles drop constraint if exists profiles_avatar_frame_check;
alter table public.profiles add constraint profiles_avatar_frame_check
  check (avatar_frame is null or avatar_frame in ('gold', 'fire', 'lightning', 'arcane', 'shadow', 'ice', 'red', 'particles'));
alter table public.profiles drop constraint if exists profiles_profile_effect_check;
alter table public.profiles add constraint profiles_profile_effect_check
  check (profile_effect is null or profile_effect in ('burst', 'flames', 'sparks', 'magic', 'mist', 'crystal', 'waves', 'pulse'));
alter table public.profiles drop constraint if exists profiles_appearance_theme_check;
alter table public.profiles add constraint profiles_appearance_theme_check
  check (appearance_theme is null or appearance_theme in ('light', 'dark', 'midnight'));

-- Todo caminho de imagem fica dentro da pasta do proprio dono do perfil. Se o app antigo trocar
-- avatar_path direto (coluna liberada desde a 0006), a miniatura e a marca de animado antigas caem.
create or replace function public.profiles_media_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.avatar_path is not null and split_part(new.avatar_path, '/', 1) <> new.id::text)
     or (new.avatar_thumb_path is not null and split_part(new.avatar_thumb_path, '/', 1) <> new.id::text)
     or (new.banner_path is not null and split_part(new.banner_path, '/', 1) <> new.id::text)
     or (new.banner_thumb_path is not null and split_part(new.banner_thumb_path, '/', 1) <> new.id::text) then
    raise exception using errcode = 'P0001', message = 'invalid_media';
  end if;
  if tg_op = 'UPDATE' and new.avatar_path is distinct from old.avatar_path
     and new.avatar_thumb_path is not distinct from old.avatar_thumb_path then
    new.avatar_thumb_path := null;
    new.avatar_animated := false;
  end if;
  if new.avatar_path is null then
    new.avatar_thumb_path := null;
    new.avatar_animated := false;
  end if;
  if new.banner_path is null then
    new.banner_thumb_path := null;
    new.banner_animated := false;
  end if;
  return new;
end;
$$;
revoke all on function public.profiles_media_guard() from public, anon, authenticated;

drop trigger if exists profiles_media_guard on public.profiles;
create trigger profiles_media_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_media_guard();

-- As colunas novas NAO ganham grant de update: so mudam pelas RPCs abaixo (que validam tudo).
-- A leitura segue a politica atual de profiles (amigos, colegas de servidor, DMs, voce mesmo).

-- ===========================================================================
-- 2. RPCs do perfil
-- ===========================================================================
create or replace function public.set_profile_media(p_kind text, p_path text, p_thumb_path text, p_animated boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  pasta text;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_kind is null or p_kind not in ('avatar', 'banner') then
    raise exception using errcode = 'P0001', message = 'invalid_options';
  end if;
  perform public.rate_check('profile_media', 30, 3600);
  pasta := uid::text || '/' || p_kind || '/';
  if p_path is not null and (
       left(p_path, char_length(pasta)) <> pasta
       or not public.valid_profile_media_path(p_path, p_kind, false)
       or p_thumb_path is null
       or left(p_thumb_path, char_length(pasta)) <> pasta
       or not public.valid_profile_media_path(p_thumb_path, p_kind, true)) then
    raise exception using errcode = 'P0001', message = 'invalid_media';
  end if;
  if p_path is null and p_thumb_path is not null then
    raise exception using errcode = 'P0001', message = 'invalid_media';
  end if;
  if p_kind = 'avatar' then
    update public.profiles p set
      avatar_path = p_path,
      avatar_thumb_path = p_thumb_path,
      avatar_animated = (p_path is not null and coalesce(p_animated, false)),
      avatar_crop = case when p_path is null then null else p.avatar_crop end
    where p.id = uid;
  else
    update public.profiles p set
      banner_path = p_path,
      banner_thumb_path = p_thumb_path,
      banner_animated = (p_path is not null and coalesce(p_animated, false)),
      banner_pos = case when p_path is null then 50 else p.banner_pos end
    where p.id = uid;
  end if;
end;
$$;

create or replace function public.update_profile_look(p_frame text, p_effect text, p_avatar_crop jsonb, p_banner_pos int)
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
  perform public.rate_check('profile_look', 60, 60);
  if (p_frame is not null and p_frame not in ('gold', 'fire', 'lightning', 'arcane', 'shadow', 'ice', 'red', 'particles'))
     or (p_effect is not null and p_effect not in ('burst', 'flames', 'sparks', 'magic', 'mist', 'crystal', 'waves', 'pulse'))
     or not public.valid_avatar_crop(p_avatar_crop)
     or (p_banner_pos is not null and p_banner_pos not between 0 and 100) then
    raise exception using errcode = 'P0001', message = 'invalid_options';
  end if;
  update public.profiles p set
    avatar_frame = p_frame,
    profile_effect = p_effect,
    avatar_crop = p_avatar_crop,
    banner_pos = coalesce(p_banner_pos, 50)
  where p.id = uid;
end;
$$;

create or replace function public.reset_profile_look()
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
  perform public.rate_check('profile_look', 60, 60);
  update public.profiles p set avatar_frame = null, profile_effect = null, avatar_crop = null, banner_pos = 50
  where p.id = uid;
end;
$$;

create or replace function public.set_appearance_theme(p_theme text)
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
  if p_theme is not null and p_theme not in ('light', 'dark', 'midnight') then
    raise exception using errcode = 'P0001', message = 'invalid_options';
  end if;
  perform public.rate_check('theme', 60, 60);
  update public.profiles p set appearance_theme = p_theme where p.id = uid;
end;
$$;

-- ===========================================================================
-- 3. Organizacao de canais e salas de voz (so dono/admin)
-- ===========================================================================
-- p_channels: [{"id": uuid, "categoryId": uuid|null, "position": int}]
-- p_categories (opcional): [{"id": uuid, "position": int}]
-- Tudo ou nada: qualquer item invalido recusa a mudanca inteira.
create or replace function public.reorder_channels(p_group uuid, p_channels jsonb, p_categories jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  u constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  item jsonb;
  n_ch int := 0;
  n_cat int := 0;
begin
  perform public.need_admin(p_group);
  perform public.rate_check('reorder', 60, 60);
  if p_channels is null or jsonb_typeof(p_channels) <> 'array' or jsonb_array_length(p_channels) > 500
     or (p_categories is not null and (jsonb_typeof(p_categories) <> 'array' or jsonb_array_length(p_categories) > 200))
     or (jsonb_array_length(p_channels) = 0 and coalesce(jsonb_array_length(p_categories), 0) = 0) then
    raise exception using errcode = 'P0001', message = 'invalid_layout';
  end if;

  for item in select * from jsonb_array_elements(p_channels) loop
    if jsonb_typeof(item) <> 'object'
       or jsonb_typeof(item -> 'id') <> 'string' or (item ->> 'id') !~ u
       or jsonb_typeof(item -> 'position') <> 'number'
       or (item ->> 'position') !~ '^[0-9]{1,4}$' or (item ->> 'position')::int > 1000
       or not (item ? 'categoryId')
       or (jsonb_typeof(item -> 'categoryId') <> 'null'
           and (jsonb_typeof(item -> 'categoryId') <> 'string' or (item ->> 'categoryId') !~ u)) then
      raise exception using errcode = 'P0001', message = 'invalid_layout';
    end if;
    if not exists (select 1 from public.channels c where c.id = (item ->> 'id')::uuid and c.group_id = p_group) then
      raise exception using errcode = 'P0001', message = 'invalid_layout';
    end if;
    if item ->> 'categoryId' is not null and not exists (
      select 1 from public.channel_categories cc where cc.id = (item ->> 'categoryId')::uuid and cc.group_id = p_group
    ) then
      raise exception using errcode = 'P0001', message = 'invalid_layout';
    end if;
    n_ch := n_ch + 1;
  end loop;
  if (select count(distinct e ->> 'id') from jsonb_array_elements(p_channels) e) <> n_ch then
    raise exception using errcode = 'P0001', message = 'invalid_layout';
  end if;

  if p_categories is not null then
    for item in select * from jsonb_array_elements(p_categories) loop
      if jsonb_typeof(item) <> 'object'
         or jsonb_typeof(item -> 'id') <> 'string' or (item ->> 'id') !~ u
         or jsonb_typeof(item -> 'position') <> 'number'
         or (item ->> 'position') !~ '^[0-9]{1,4}$' or (item ->> 'position')::int > 1000 then
        raise exception using errcode = 'P0001', message = 'invalid_layout';
      end if;
      if not exists (
        select 1 from public.channel_categories cc where cc.id = (item ->> 'id')::uuid and cc.group_id = p_group
      ) then
        raise exception using errcode = 'P0001', message = 'invalid_layout';
      end if;
      n_cat := n_cat + 1;
    end loop;
    if (select count(distinct e ->> 'id') from jsonb_array_elements(p_categories) e) <> n_cat then
      raise exception using errcode = 'P0001', message = 'invalid_layout';
    end if;
  end if;

  update public.channels c set
    category_id = nullif(e ->> 'categoryId', '')::uuid,
    position = (e ->> 'position')::int
  from jsonb_array_elements(p_channels) e
  where c.id = (e ->> 'id')::uuid and c.group_id = p_group;

  if p_categories is not null then
    update public.channel_categories cc set position = (e ->> 'position')::int
    from jsonb_array_elements(p_categories) e
    where cc.id = (e ->> 'id')::uuid and cc.group_id = p_group;
  end if;
end;
$$;

-- Pede para a pessoa trocar de sala de voz. Quem esta conectado e o proprio app da pessoa:
-- o aviso vai so para ela, no topico privado me:<uid> (so ela le; nenhum cliente escreve nele).
create or replace function public.move_voice_member(p_group uuid, p_user uuid, p_channel uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  papel_alvo text;
begin
  perform public.need_admin(p_group);
  perform public.rate_check('voice_move', 60, 60);
  select gm.role into papel_alvo from public.group_members gm where gm.group_id = p_group and gm.user_id = p_user;
  if papel_alvo is null then
    raise exception using errcode = 'P0001', message = 'not_member';
  end if;
  if not exists (select 1 from public.channels c where c.id = p_channel and c.group_id = p_group and c.kind = 'voice') then
    raise exception using errcode = 'P0001', message = 'invalid_channel';
  end if;
  if papel_alvo = 'owner' and p_user <> auth.uid() and public.member_role(p_group) <> 'owner' then
    raise exception using errcode = 'P0001', message = 'cannot_target';
  end if;
  perform public.gr_notify('me:' || p_user::text, 'voice_move',
    jsonb_build_object('serverId', p_group, 'channelId', p_channel, 'by', auth.uid()));
end;
$$;

-- Permissoes: so authenticated executa as RPCs; as auxiliares de validacao sao imutaveis e sem dados.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.set_profile_media(text, text, text, boolean)',
    'public.update_profile_look(text, text, jsonb, integer)',
    'public.reset_profile_look()',
    'public.set_appearance_theme(text)',
    'public.reorder_channels(uuid, jsonb, jsonb)',
    'public.move_voice_member(uuid, uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

-- ===========================================================================
-- 4. Storage: avatars aceita ate 40 MB (41943040 bytes; 40 MB exatos passam) e as pastas novas
-- ===========================================================================
create or replace function public.can_write_avatar_path(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  u constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  ext_re constant text := '\.(png|jpg|jpeg|webp|gif)$';
begin
  if auth.uid() is null or p_name is null then
    return false;
  end if;
  -- Antigo (Etapa 6) e novo: <uid>/<uuid>.<ext>, <uid>/<avatar|banner>/<uuid>.<ext> e .thumb.webp.
  if p_name ~ ('^' || u || '/' || u || ext_re)
     or p_name ~ ('^' || u || '/(avatar|banner)/' || u || '(\.thumb\.webp|' || ext_re || ')') then
    return split_part(p_name, '/', 1) = auth.uid()::text;
  elsif p_name ~ ('^g_' || u || '/' || u || ext_re) then
    return coalesce(public.member_role(substr(split_part(p_name, '/', 1), 3)::uuid), '') in ('owner', 'admin');
  end if;
  return false;
end;
$$;
revoke all on function public.can_write_avatar_path(text) from public, anon;
grant execute on function public.can_write_avatar_path(text) to authenticated;

do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('avatars', 'avatars', true, 41943040, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
  on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
end;
$$;
