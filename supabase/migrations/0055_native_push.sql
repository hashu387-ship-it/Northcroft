-- Notifications for the Northcroft iPhone app.
--
-- The app gets notifications from Apple's push service (APNs) rather than Web Push. Each phone
-- registers its device token here (register_native_push, on every launch once notifications are
-- allowed); send-push sends every notification to the person's phones as well as their browsers,
-- with Approve/Decline buttons on missed check-in and leave requests and a Reply box on chats.
-- apns_env remembers whether the token belongs to Apple's production or test service (a phone
-- running a build straight from Xcode uses the test one); send-push fills it in.

create table if not exists public.native_push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  token text not null unique check (char_length(token) between 32 and 200),
  platform text not null default 'ios' check (platform in ('ios')),
  apns_env text check (apns_env in ('production', 'sandbox')),
  device_name text check (char_length(device_name) <= 80),
  app_version text check (char_length(app_version) <= 40),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists native_push_devices_user on public.native_push_devices (user_id);

alter table public.native_push_devices enable row level security;
drop policy if exists "own native devices" on public.native_push_devices;
create policy "own native devices" on public.native_push_devices for select to authenticated using (user_id = auth.uid());
drop policy if exists "remove own native device" on public.native_push_devices;
create policy "remove own native device" on public.native_push_devices for delete to authenticated using (user_id = auth.uid());

/** Saves this phone's device token for the signed-in person (a phone passed to someone else moves with them). */
create or replace function public.register_native_push(
  p_token text,
  p_platform text default 'ios',
  p_device_name text default null,
  p_app_version text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_member() then
    raise exception 'Not signed in';
  end if;
  if p_token is null or p_token !~ '^[0-9a-fA-F]{32,200}$' then
    raise exception 'That is not a device token';
  end if;
  insert into public.native_push_devices (user_id, token, platform, device_name, app_version)
  values (auth.uid(), lower(p_token), coalesce(p_platform, 'ios'), left(p_device_name, 80), left(p_app_version, 40))
  on conflict (token) do update
    set user_id = excluded.user_id,
        device_name = coalesce(excluded.device_name, native_push_devices.device_name),
        app_version = coalesce(excluded.app_version, native_push_devices.app_version),
        last_seen_at = now();
end $$;

revoke all on function public.register_native_push(text, text, text, text) from public, anon;
grant execute on function public.register_native_push(text, text, text, text) to authenticated;
