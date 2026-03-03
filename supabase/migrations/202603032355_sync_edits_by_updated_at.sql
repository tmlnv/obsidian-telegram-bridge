alter table public.sync_clients
  add column if not exists last_processed_message_updated_at timestamptz;

update public.sync_clients
set last_processed_message_updated_at = coalesce(
  last_processed_message_updated_at,
  last_processed_message_created_at
)
where last_processed_message_updated_at is distinct from coalesce(
  last_processed_message_updated_at,
  last_processed_message_created_at
);

drop index if exists public.idx_messages_cursor;

create index if not exists idx_messages_cursor
  on public.messages (user_id, updated_at, id);

drop function if exists public.fetch_messages_after_cursor(timestamptz, bigint, integer);

create function public.fetch_messages_after_cursor(
  p_last_processed_message_updated_at timestamptz default null,
  p_last_processed_message_id bigint default null,
  p_limit integer default 50
)
returns setof public.messages
language sql
security invoker
set search_path = public
as $$
  select m.*
  from public.messages as m
  where m.user_id = auth.uid()
    and (
      p_last_processed_message_updated_at is null
      or m.updated_at > p_last_processed_message_updated_at
      or (
        m.updated_at = p_last_processed_message_updated_at
        and m.id > coalesce(p_last_processed_message_id, 0)
      )
    )
  order by m.updated_at asc, m.id asc
  limit greatest(p_limit, 1);
$$;
