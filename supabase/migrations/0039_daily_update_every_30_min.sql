-- Daily update reminders every 30 minutes until the update is in.
--   From 5:00 pm, anyone checked in today who sends a daily update and hasn't sent it yet gets a
--   reminder, then another every 30 minutes (5:30, 6:00 ... 9:00 pm, the last one). Sending the
--   update stops them. Days off and people on leave get none, as before.
--   Only one reminder is ever waiting: a new one marks the earlier unread ones as read, and on the
--   phone it replaces the last alert (send-push gives them one tag) while still buzzing.
--   The 6:00 pm summary to managers is unchanged.

-- One row per person, day and half hour, so nobody gets the same reminder twice.
create table if not exists public.daily_update_nudges (
  user_id uuid not null references public.profiles (id),
  work_date date not null,
  slot text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, work_date, slot)
);
alter table public.daily_update_nudges enable row level security;

-- The reminders for the half hour that p_at falls in (cron passes now()). Returns how many went out.
create or replace function public.daily_update_nudge(p_at timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  tz text := coalesce((select timezone from public.app_settings where id = 1), 'Asia/Riyadh');
  t timestamp := p_at at time zone tz;
  d date := t::date;
  mins int := extract(hour from t)::int * 60 + extract(minute from t)::int;
  slot_m int := (mins / 30) * 30;
  v_slot text;
  r record;
  n int := 0;
  v_title text;
  v_body text;
begin
  -- 5:00 pm to 9:00 pm only, on work days.
  if slot_m < 17 * 60 or slot_m > 21 * 60 or not public.is_workday(d) then
    return 0;
  end if;
  v_slot := lpad((slot_m / 60)::text, 2, '0') || ':' || lpad((slot_m % 60)::text, 2, '0');

  for r in
    select p.id, p.short_name
      from public.profiles p
      join public.attendance a on a.user_id = p.id and a.work_date = d
     where p.active and p.daily_update and not p.attendance_exempt
       and not public.on_leave(p.id, d)
       and not exists (select 1 from public.daily_updates u where u.user_id = p.id and u.work_date = d)
  loop
    insert into public.daily_update_nudges (user_id, work_date, slot) values (r.id, d, v_slot) on conflict do nothing;
    if found then
      if slot_m = 17 * 60 then
        v_title := 'Time for your daily update';
        v_body := 'How far did your tasks get today, ' || r.short_name || '? Tap to send your update before you check out.';
      elsif slot_m = 21 * 60 then
        v_title := 'Last reminder today: your daily update';
        v_body := r.short_name || ', it only takes a minute. Tap to send it now.';
      else
        v_title := 'Still waiting for your daily update';
        v_body := r.short_name || ', tap to send it. You''ll get a reminder every 30 minutes until it''s in.';
      end if;
      -- Only one reminder waiting at a time.
      update public.notifications
         set read_at = now()
       where user_id = r.id and type = 'daily_update' and read_at is null and link = '/updates'
         and title not like 'Daily updates:%';
      perform public.notify(r.id, 'daily_update', v_title, v_body, '/updates', null);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.daily_update_nudge(timestamptz) from public, anon, authenticated;

-- The 'remind' run now hands over to the half-hourly reminders; the 6 pm summary stays as it was.
create or replace function public.daily_update_reminders(p_kind text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  d date := public.riyadh_today();
  r record;
  n int := 0;
  missing_names text;
  sent_count int;
  due_count int;
begin
  if p_kind = 'remind' then
    return public.daily_update_nudge(now());
  end if;

  if not public.is_workday(d) then
    return 0;
  end if;

  if p_kind = 'summary' then
    select count(*) filter (where u.id is not null),
           count(*),
           string_agg(p.short_name, ', ' order by p.short_name) filter (where u.id is null)
      into sent_count, due_count, missing_names
      from public.profiles p
      join public.attendance a on a.user_id = p.id and a.work_date = d
      left join public.daily_updates u on u.user_id = p.id and u.work_date = d
     where p.active and p.daily_update and not p.attendance_exempt and not public.on_leave(p.id, d);
    if coalesce(due_count, 0) = 0 then
      return 0;
    end if;
    for r in select p.id from public.profiles p where p.active and p.role = 'manager' loop
      insert into public.daily_update_reminders (user_id, work_date, kind) values (r.id, d, 'summary') on conflict do nothing;
      if found then
        perform public.notify(r.id, 'daily_update', 'Daily updates: ' || sent_count || ' of ' || due_count || ' sent',
          case when missing_names is null then 'Everyone who came in today has sent their update.'
               else 'Not sent yet: ' || missing_names || '.' end,
          '/updates', null);
        n := n + 1;
      end if;
    end loop;
  else
    raise exception 'Unknown reminder: %', p_kind;
  end if;
  return n;
end $$;
revoke all on function public.daily_update_reminders(text) from public, anon, authenticated;

-- Every 30 minutes from 5:00 pm to 9:30 pm Riyadh (14:00 to 18:30 UTC); the function only sends
-- from 5:00 to 9:00 pm.
select cron.schedule('northcroft-daily-update-remind', '0,30 14-18 * * *', $c$select public.daily_update_reminders('remind')$c$);
