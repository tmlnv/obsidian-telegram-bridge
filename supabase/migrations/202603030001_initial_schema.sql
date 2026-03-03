create extension if not exists pgcrypto;

create table public.bot_connections (
  id bigint primary key generated always as identity,
  user_id uuid not null references auth.users(id) on delete cascade,
  telegram_bot_id bigint not null,
  bot_token_hash text not null,
  webhook_secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id),
  unique (telegram_bot_id),
  unique (webhook_secret)
);

create table public.topics (
  id bigint primary key generated always as identity,
  user_id uuid not null references auth.users(id) on delete cascade,
  telegram_chat_id bigint not null,
  topic_id bigint not null,
  topic_name text not null,
  updated_at timestamptz not null default now(),
  unique (user_id, telegram_chat_id, topic_id)
);

create table public.messages (
  id bigint primary key generated always as identity,
  user_id uuid not null references auth.users(id) on delete cascade,
  telegram_update_id bigint,
  telegram_message_id bigint not null,
  telegram_chat_id bigint not null,
  telegram_chat_title text,
  telegram_date timestamptz not null,
  topic_id bigint,
  topic_name text,
  sender_name text,
  sender_username text,
  sender_id bigint,
  message_type text not null,
  text_content text,
  caption text,
  entities jsonb,
  caption_entities jsonb,
  forward_from_name text,
  forward_date timestamptz,
  reply_to_message_id bigint,
  media_group_id text,
  file_path text,
  file_name text,
  file_size bigint,
  file_mime_type text,
  is_edit boolean not null default false,
  edit_date timestamptz,
  content_hash text,
  raw_update jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, telegram_chat_id, telegram_message_id)
);

create table public.sync_clients (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_name text not null,
  vault_fingerprint text,
  platform text,
  plugin_version text,
  last_processed_message_updated_at timestamptz,
  last_processed_message_id bigint,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_messages_cursor
  on public.messages (user_id, updated_at, id);

create index idx_messages_topic
  on public.messages (user_id, telegram_chat_id, topic_id);

create or replace function public.fetch_messages_after_cursor(
  p_last_processed_message_updated_at timestamptz default null,
  p_last_processed_message_id bigint default null,
  p_limit integer default 50
)
returns setof public.messages
language sql
security invoker
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

alter table public.bot_connections enable row level security;
alter table public.topics enable row level security;
alter table public.messages enable row level security;
alter table public.sync_clients enable row level security;

create policy "Users can read their own topics"
  on public.topics for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can read their own messages"
  on public.messages for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can read their own sync clients"
  on public.sync_clients for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can insert their own sync clients"
  on public.sync_clients for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users can update their own sync clients"
  on public.sync_clients for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

insert into storage.buckets (id, name, public)
values ('telegram-files', 'telegram-files', false)
on conflict (id) do nothing;

create policy "Users can read their own files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'telegram-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

alter publication supabase_realtime add table public.messages;
