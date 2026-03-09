create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create schema if not exists util;

create table public.internal_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table public.pending_usage_warning_checks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now()
);

create or replace function util.usage_warning_check_url()
returns text
language sql
security definer
set search_path = public
as $$
  select value
  from public.internal_settings
  where key = 'usage_warning_check_url'
  order by updated_at desc
  limit 1;
$$;

create or replace function util.invoke_usage_warning_check()
returns bigint
language plpgsql
security definer
set search_path = public, extensions, util
as $$
declare
  request_id bigint;
  function_url text;
begin
  function_url := util.usage_warning_check_url();

  if function_url is null or function_url = '' then
    return null;
  end if;

  select net.http_post(
    url := function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'triggered_at', now()
    ),
    timeout_milliseconds := 5000
  )
  into request_id;

  return request_id;
end;
$$;

create or replace function public.enqueue_usage_warning_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
begin
  target_user_id := coalesce(new.user_id, old.user_id);

  if target_user_id is null then
    return coalesce(new, old);
  end if;

  insert into public.pending_usage_warning_checks (user_id, requested_at)
  values (target_user_id, now())
  on conflict (user_id) do update
    set requested_at = excluded.requested_at;

  return coalesce(new, old);
end;
$$;

drop trigger if exists enqueue_usage_warning_check_on_messages on public.messages;
create trigger enqueue_usage_warning_check_on_messages
after insert or update on public.messages
for each row execute function public.enqueue_usage_warning_check();

drop trigger if exists enqueue_usage_warning_check_on_user_preferences on public.user_preferences;
create trigger enqueue_usage_warning_check_on_user_preferences
after insert or update of estimated_storage_limit_bytes, warning_threshold_percent, telegram_warnings_enabled, notification_chat_id
on public.user_preferences
for each row execute function public.enqueue_usage_warning_check();

select cron.schedule(
  'usage-warning-check-every-15-minutes',
  '*/15 * * * *',
  $$select util.invoke_usage_warning_check();$$
);
