-- In-app voice calls, and the site visit log from the iPhone app's GPS.
--
-- calls: one row per call. The caller adds it ("ringing"); the person called answers or declines;
-- either ends it. The two phones connect directly (WebRTC), passing the connection details over a
-- Realtime channel named after the call, so no audio goes through the database. A ringing call
-- notifies the person called (so it reaches a phone that isn't on the app), and a missed call
-- leaves a "Missed call" notification.
--
-- site_visits: when the iPhone app notices someone arriving at and leaving a project site (the
-- sites in Settings > Places), the times are kept here for visit reports. People see their own;
-- managers and those who assign tasks see everyone's.

-- ---------------------------------------------------------------------------- calls
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  caller_id uuid not null references public.profiles (id) on delete cascade,
  callee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'ringing'
    check (status in ('ringing', 'answered', 'declined', 'missed', 'ended', 'cancelled', 'busy')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  check (caller_id <> callee_id)
);
create index if not exists calls_callee on public.calls (callee_id, created_at desc);
create index if not exists calls_caller on public.calls (caller_id, created_at desc);

alter table public.calls enable row level security;
drop policy if exists "see own calls" on public.calls;
create policy "see own calls" on public.calls for select to authenticated
  using (auth.uid() in (caller_id, callee_id));
drop policy if exists "start a call" on public.calls;
create policy "start a call" on public.calls for insert to authenticated
  with check (caller_id = auth.uid() and status = 'ringing' and is_member());
drop policy if exists "update own calls" on public.calls;
create policy "update own calls" on public.calls for update to authenticated
  using (auth.uid() in (caller_id, callee_id))
  with check (auth.uid() in (caller_id, callee_id));

do $$
begin
  alter publication supabase_realtime add table public.calls;
exception when duplicate_object then null;
end $$;

-- Ringing: a notification to the person called. Missed: a "Missed call" notification.
create or replace function public.notify_call() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text;
begin
  select short_name into who from public.profiles where id = new.caller_id;
  who := coalesce(who, 'Someone');
  if tg_op = 'INSERT' and new.status = 'ringing' then
    perform public.notify(new.callee_id, 'call', who || ' is calling', 'Northcroft voice call. Tap to answer.', '/call/' || new.id, new.caller_id);
  elsif tg_op = 'UPDATE' and old.status = 'ringing' and new.status = 'missed' then
    perform public.notify(new.callee_id, 'missed_call', 'Missed call from ' || who, null, '/calls', new.caller_id);
  end if;
  return new;
end $$;

drop trigger if exists calls_notify on public.calls;
create trigger calls_notify after insert or update of status on public.calls
  for each row execute function public.notify_call();
revoke execute on function public.notify_call() from public, anon, authenticated;

-- A call left ringing for more than a minute (the caller's phone lost signal, say) counts as missed.
-- For a scheduled job; the app marks its own unanswered calls missed after 45 seconds.
create or replace function public.expire_ringing_calls() returns void
language sql security definer set search_path = public as $$
  update public.calls set status = 'missed', ended_at = now()
  where status = 'ringing' and created_at < now() - interval '1 minute';
$$;
revoke execute on function public.expire_ringing_calls() from public, anon, authenticated;

-- ---------------------------------------------------------------------------- site visits
create table if not exists public.site_visits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  place_id uuid references public.places (id) on delete set null,
  place_name text not null check (char_length(place_name) <= 120),
  project_id uuid references public.projects (id) on delete set null,
  arrived_at timestamptz not null,
  left_at timestamptz,
  source text not null default 'gps' check (source in ('gps', 'trip')),
  created_at timestamptz not null default now(),
  check (left_at is null or left_at >= arrived_at)
);
create index if not exists site_visits_user on public.site_visits (user_id, arrived_at desc);
create index if not exists site_visits_place on public.site_visits (place_id, arrived_at desc);

alter table public.site_visits enable row level security;
drop policy if exists "see site visits" on public.site_visits;
create policy "see site visits" on public.site_visits for select to authenticated
  using (user_id = auth.uid() or can_assign());
drop policy if exists "log own site visits" on public.site_visits;
create policy "log own site visits" on public.site_visits for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "finish own site visits" on public.site_visits;
create policy "finish own site visits" on public.site_visits for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
