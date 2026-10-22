-- Remember which web address each device installed the app from,
-- so notification taps open the right site whatever domain it is hosted on.
alter table public.push_subscriptions add column if not exists origin text;

create or replace function public.register_push_device(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null, p_origin text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, origin, last_seen_at)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300),
          case when p_origin ~ '^https?://[a-zA-Z0-9.:-]+$' then p_origin else null end, now())
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent,
        origin = coalesce(excluded.origin, public.push_subscriptions.origin),
        last_seen_at = now();
end $$;

revoke execute on function public.register_push_device(text, text, text, text, text) from public, anon;
grant execute on function public.register_push_device(text, text, text, text, text) to authenticated;
