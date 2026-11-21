-- A edição guarda a data do servidor. Mensagens anteriores continuam com edited_at nulo.
alter table public.messages add column if not exists edited_at timestamptz;

create or replace function public.mark_message_edited()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.edited_at := statement_timestamp();
  return new;
end;
$$;

revoke all on function public.mark_message_edited() from public, anon, authenticated;

drop trigger if exists messages_set_edited_at on public.messages;
create trigger messages_set_edited_at
  before update of body on public.messages
  for each row when (old.body is distinct from new.body)
  execute function public.mark_message_edited();

grant update (body) on public.messages to authenticated;

drop policy if exists messages_update_proprio on public.messages;
create policy messages_update_proprio on public.messages for update to authenticated
  using (user_id = auth.uid() and group_id = public.my_group_id())
  with check (user_id = auth.uid() and group_id = public.my_group_id());

drop policy if exists messages_delete_proprio on public.messages;
create policy messages_delete_proprio on public.messages for delete to authenticated
  using (user_id = auth.uid() and group_id = public.my_group_id());
