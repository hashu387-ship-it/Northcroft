-- Notifications for people who only use the iPhone app.
--
-- dispatch_push() (0002) only handed a notification to the send-push function when the person
-- had a browser subscribed to Web Push. Someone who uses only the Northcroft iPhone app has a
-- phone in native_push_devices (0055) and no browser subscription, so nothing was sent to them.
-- Now either one is enough. Nothing else changes.
create or replace function public.dispatch_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  fn_url text;
  secret text;
begin
  if not exists (select 1 from public.push_subscriptions where user_id = new.user_id)
     and not exists (select 1 from public.native_push_devices where user_id = new.user_id) then
    return new;
  end if;
  select decrypted_secret into fn_url from vault.decrypted_secrets where name = 'push_function_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'push_webhook_secret';
  if fn_url is null or secret is null then
    return new;
  end if;
  perform net.http_post(
    url := fn_url,
    body := jsonb_build_object('notification_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', secret),
    timeout_milliseconds := 8000
  );
  return new;
end $$;
