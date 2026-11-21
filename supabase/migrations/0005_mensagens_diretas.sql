-- Conversas individuais entre amigos confirmados.
create table if not exists public.direct_messages (
  id bigint generated always as identity primary key,
  sender uuid not null references auth.users(id) on delete cascade,
  recipient uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  sent_at timestamptz not null default now(),
  check (sender <> recipient)
);
create index if not exists dm_conversation_idx on public.direct_messages
  (least(sender,recipient),greatest(sender,recipient),id desc);
create index if not exists dm_sender_time_idx on public.direct_messages (sender,sent_at);
alter table public.direct_messages enable row level security;
revoke all on public.direct_messages from public, anon, authenticated;
revoke all on sequence public.direct_messages_id_seq from public, anon, authenticated;

create or replace function public.social_dm(p_peer uuid, p_body text default null, p_before bigint default null)
returns table(id bigint, mine boolean, body text, sent_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  perform 1 from public.friendships f where f.user_low = least(uid,p_peer)
    and f.user_high = greatest(uid,p_peer) and f.accepted for share;
  if not found then raise exception 'invalid_user'; end if;
  if p_body is not null then
    if char_length(p_body) > 1000 or btrim(p_body) = '' or p_before is not null then
      raise exception 'invalid_message';
    end if;
    perform pg_advisory_xact_lock(hashtext('gr_dm:' || uid::text));
    if (select count(*) from public.direct_messages m where m.sender=uid
        and m.sent_at > now() - interval '10 seconds') >= 10 then raise exception 'rate_limited'; end if;
    insert into public.direct_messages(sender,recipient,body) values(uid,p_peer,btrim(p_body));
  end if;
  return query select m.id,m.sender=uid,m.body,m.sent_at from public.direct_messages m
    where least(m.sender,m.recipient)=least(uid,p_peer)
      and greatest(m.sender,m.recipient)=greatest(uid,p_peer)
      and (p_before is null or m.id<p_before) order by m.id desc limit 50;
end; $$;
revoke all on function public.social_dm(uuid,text,bigint) from public,anon;
grant execute on function public.social_dm(uuid,text,bigint) to authenticated;
