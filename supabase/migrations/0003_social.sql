-- Os convites existentes continuam apontando para o grupo original.
alter table public.group_invites alter column expires_at drop not null,
  alter column max_uses drop not null, alter column max_uses drop default;
update public.group_invites set expires_at = null, max_uses = null
where expires_at is not null or max_uses is not null;

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
  validade timestamptz := null;
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
  where gm.user_id = uid for update of g;
  if grupo is null then
    raise exception using errcode = 'P0001', message = 'not_in_group';
  end if;
  if dono <> uid then
    raise exception using errcode = 'P0001', message = 'not_owner';
  end if;

  -- Reutiliza um dos códigos existentes, inclusive após atualização da aplicação.
  select gi.code into novo from public.group_invites gi
    where gi.group_id = grupo order by gi.code limit 1;
  if found then
    return query select novo, validade;
    return;
  end if;

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
  -- Não revela detalhes sobre códigos desconhecidos.
  if codigo !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$' then
    raise exception using errcode = 'P0001', message = 'invalid_invite';
  end if;

  select gi.group_id into grupo
  from public.group_invites gi
  where gi.code = codigo;
  if grupo is null then
    raise exception using errcode = 'P0001', message = 'invalid_invite';
  end if;

  -- Trava o grupo para contar os membros sem corrida.
  perform 1 from public.groups g where g.id = grupo for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'invalid_invite';
  end if;
  select count(*) into total from public.group_members gm where gm.group_id = grupo;
  if total >= 10 then
    raise exception using errcode = 'P0001', message = 'group_full';
  end if;

  begin
    insert into public.group_members (group_id, user_id) values (grupo, uid);
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'already_in_group';
  end;
  return grupo;
end;
$$;

-- Fotos raster pequenas. O cliente recorta, redimensiona e recodifica a imagem.
create or replace function public.valid_social_photo(p_photo text)
returns boolean language plpgsql immutable strict set search_path = '' as $$
declare
  bytes bytea;
  payload text;
begin
  if octet_length(p_photo) > 65536 or p_photo !~ '^data:image/jpeg;base64,/9j/[A-Za-z0-9+/]*={0,2}$' then
    return false;
  end if;
  payload := substr(p_photo, 24);
  begin
    bytes := decode(payload, 'base64');
  exception when data_exception then
    return false;
  end;
  return octet_length(bytes) >= 5
     and right(encode(bytes, 'hex'),4) = 'ffd9'
     and replace(encode(bytes,'base64'), chr(10), '') = payload;
end;
$$;
revoke all on function public.valid_social_photo(text) from public, anon, authenticated;
grant execute on function public.valid_social_photo(text) to authenticated;

alter table public.profiles add column if not exists photo text check(public.valid_social_photo(photo)),
  add column if not exists discoverable boolean not null default true;
alter table public.groups add column if not exists photo text check(public.valid_social_photo(photo));

create table if not exists public.friendships (
  user_low uuid not null references public.profiles(id) on delete cascade,
  user_high uuid not null references public.profiles(id) on delete cascade,
  sender uuid not null check (sender in (user_low, user_high)),
  accepted boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_low,user_high),
  check (user_low < user_high)
);
create index if not exists friendships_user_high_idx on public.friendships(user_high);
create index if not exists friendships_sent_idx on public.friendships(sender,created_at);
alter table public.friendships enable row level security;
revoke all on table public.friendships from public, anon, authenticated;

-- A busca retorna apenas nome, foto e o vínculo com quem está consultando.
create or replace function public.social_people(p_query text default null, p_after uuid default null)
returns table(id uuid, name text, photo text, state text, discoverable boolean)
language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as uid),
  mine as (
    select case when f.user_low = me.uid then f.user_high else f.user_low end as other,
      case when f.accepted then 'friend' when f.sender = me.uid then 'outgoing' else 'incoming' end as relation
    from public.friendships f cross join me where me.uid in (f.user_low,f.user_high)
  )
  select p.id, p.display_name, p.photo,
    case when p.id = me.uid then 'self' else coalesce(m.relation,'none') end,
    case when p.id = me.uid then p.discoverable end
  from public.profiles p cross join me left join mine m on m.other = p.id
  where me.uid is not null and (p_after is null or p.id > p_after)
    and ((p_query is null and (p.id = me.uid or m.other is not null))
      or (p.id <> me.uid and (p.discoverable or m.other is not null)
          and char_length(btrim(p_query)) between 2 and 64
          and strpos(lower(p.display_name),lower(btrim(p_query))) > 0))
  order by case when p_query is not null then lower(p.display_name) = lower(btrim(p_query)) end desc,
    p.id limit 12;
$$;

create or replace function public.social_friend(p_action text,p_target uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  lo uuid := least(uid,p_target);
  hi uuid := greatest(uid,p_target);
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_target is null or p_target = uid then raise exception 'invalid_user'; end if;
  if p_action = 'send' then
    perform pg_advisory_xact_lock(hashtext('gr_friend:' || uid::text));
    if not exists (select 1 from public.profiles p where p.id = p_target and p.discoverable) then
      raise exception 'invalid_user';
    end if;
    if (select count(*) from public.friendships f where f.sender = uid and f.created_at > now() - interval '1 minute') >= 20 then
      raise exception 'rate_limited';
    end if;
    insert into public.friendships(user_low,user_high,sender)
      values(lo,hi,uid) on conflict do nothing;
  elsif p_action = 'accept' then
    update public.friendships set accepted = true
      where user_low = lo and user_high = hi and sender = p_target;
    if not found then raise exception 'invalid_user'; end if;
  elsif p_action = 'remove' then
    delete from public.friendships where user_low = lo and user_high = hi;
  else
    raise exception 'invalid_user';
  end if;
end;
$$;

create or replace function public.social_photo(p_scope text,p_photo text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_photo is not null and not public.valid_social_photo(p_photo) then raise exception 'invalid_photo'; end if;
  if p_scope = 'profile' then
    update public.profiles set photo = p_photo where id = uid;
  elsif p_scope = 'group' then
    update public.groups set photo = p_photo where owner_id = uid and id = public.my_group_id();
    if not found then raise exception 'not_owner'; end if;
  else
    raise exception 'invalid_photo';
  end if;
end;
$$;

create or replace function public.social_privacy(p_discoverable boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  update public.profiles set discoverable = p_discoverable where id = auth.uid();
end;
$$;

revoke all on function public.social_people(text,uuid), public.social_friend(text,uuid),
  public.social_photo(text,text), public.social_privacy(boolean) from public, anon, authenticated;
grant execute on function public.social_people(text,uuid), public.social_friend(text,uuid),
  public.social_photo(text,text), public.social_privacy(boolean) to authenticated;

-- Com amizades reais, o ajuste "Amigos" considera apenas vínculos aceitos.
create or replace function public.can_read_social_mmr(p_owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    auth.uid() = p_owner or exists (
      select 1 from public.profiles p where p.id = p_owner and (
        (p.mmr_visibility = 'friends' and exists (
           select 1 from public.friendships f
           where f.user_low = least(auth.uid(),p_owner) and f.user_high = greatest(auth.uid(),p_owner)
             and f.accepted
        )) or (p.mmr_visibility = 'group' and exists (
           select 1 from public.group_members gm where gm.user_id = p_owner and gm.group_id = public.my_group_id()
        ))
      )
    )
  );
$$;
revoke all on function public.can_read_social_mmr(uuid) from public, anon, authenticated;
grant execute on function public.can_read_social_mmr(uuid) to authenticated;
drop policy if exists "mmr_snapshots_select" on public.mmr_snapshots;
create policy "mmr_snapshots_select" on public.mmr_snapshots for select to authenticated
  using (public.can_read_social_mmr(user_id));
