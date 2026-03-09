create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  estimated_storage_limit_bytes bigint not null default 1073741824,
  warning_threshold_percent integer not null default 80 check (warning_threshold_percent between 1 and 100),
  telegram_warnings_enabled boolean not null default true,
  notification_chat_id bigint,
  last_storage_warning_sent_at timestamptz,
  last_storage_warning_threshold_percent integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

create policy "Users can read their own preferences"
  on public.user_preferences for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can insert their own preferences"
  on public.user_preferences for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users can update their own preferences"
  on public.user_preferences for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.get_usage_estimate(p_user_id uuid default null)
returns table (
  message_count bigint,
  file_count bigint,
  estimated_database_bytes bigint,
  estimated_file_bytes bigint,
  estimated_total_bytes bigint,
  latest_message_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with resolved_user as (
    select case
      when auth.role() = 'service_role' then p_user_id
      else auth.uid()
    end as user_id
  ),
  usage_aggregate as (
    select
      count(*)::bigint as message_count,
      count(*) filter (where m.file_path is not null)::bigint as file_count,
      coalesce(sum(
        256
        + octet_length(coalesce(m.telegram_chat_title, ''))
        + octet_length(coalesce(m.topic_name, ''))
        + octet_length(coalesce(m.sender_name, ''))
        + octet_length(coalesce(m.sender_username, ''))
        + octet_length(coalesce(m.message_type, ''))
        + octet_length(coalesce(m.text_content, ''))
        + octet_length(coalesce(m.caption, ''))
        + octet_length(coalesce(m.forward_from_name, ''))
        + octet_length(coalesce(m.media_group_id, ''))
        + octet_length(coalesce(m.file_path, ''))
        + octet_length(coalesce(m.file_name, ''))
        + octet_length(coalesce(m.file_mime_type, ''))
        + octet_length(coalesce(m.content_hash, ''))
        + octet_length(m.raw_update::text)
      ), 0)::bigint as estimated_database_bytes,
      coalesce(sum(coalesce(m.file_size, 0)), 0)::bigint as estimated_file_bytes,
      max(m.updated_at) as latest_message_at
    from public.messages as m
    join resolved_user as ru on ru.user_id is not null and m.user_id = ru.user_id
  )
  select
    ua.message_count,
    ua.file_count,
    ua.estimated_database_bytes,
    ua.estimated_file_bytes,
    (ua.estimated_database_bytes + ua.estimated_file_bytes)::bigint as estimated_total_bytes,
    ua.latest_message_at
  from usage_aggregate as ua;
$$;
