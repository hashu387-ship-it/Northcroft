-- Fix for 0058: Android phones couldn't sign up for notifications.
--
-- 0058 checked Android device tokens with the pattern {32,512}, but Postgres allows at most 255
-- repeats in a pattern, so every Android sign-up failed with "invalid regular expression". The
-- allowed characters are now checked on their own and the length separately (still 32 to 512).
-- iPhones are unchanged.

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
declare
  v_platform text := coalesce(p_platform, 'ios');
  v_token text;
begin
  if auth.uid() is null or not public.is_member() then
    raise exception 'Not signed in';
  end if;
  if v_platform = 'android' then
    -- Firebase tokens are case-sensitive: kept exactly as given.
    if p_token is null or char_length(p_token) not between 32 and 512 or p_token !~ '^[A-Za-z0-9_:-]+$' then
      raise exception 'That is not a device token';
    end if;
    v_token := p_token;
  elsif v_platform = 'ios' then
    if p_token is null or p_token !~ '^[0-9a-fA-F]{32,200}$' then
      raise exception 'That is not a device token';
    end if;
    v_token := lower(p_token);
  else
    raise exception 'Unknown platform';
  end if;
  insert into public.native_push_devices (user_id, token, platform, device_name, app_version)
  values (auth.uid(), v_token, v_platform, left(p_device_name, 80), left(p_app_version, 40))
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        device_name = coalesce(excluded.device_name, native_push_devices.device_name),
        app_version = coalesce(excluded.app_version, native_push_devices.app_version),
        last_seen_at = now();
end $$;

revoke all on function public.register_native_push(text, text, text, text) from public, anon;
grant execute on function public.register_native_push(text, text, text, text) to authenticated;
