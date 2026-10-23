-- Check-in and check-out reminders.
--   At the start of the working day (8:30): anyone who checks in, hasn't yet, and isn't on leave.
--   At the end of the day (5:30), and an hour later (6:30): anyone still checked in.
-- Only on work days, only for people set to check in. The times follow the work hours in
-- Settings: changing them moves the reminders too.

-- One row per person, day and reminder, so nobody gets the same reminder twice.
create table if not exists public.attendance_reminders (
  user_id uuid not null references public.profiles (id),
  work_date date not null,
  kind text not null check (kind in ('in', 'out', 'out_again')),
  sent_at timestamptz not null default now(),
  primary key (user_id, work_date, kind)
);
alter table public.attendance_reminders enable row level security;
create policy "see your own reminders" on public.attendance_reminders
  for select to authenticated using (user_id = auth.uid());

create or replace function public.attendance_reminders(p_kind text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.app_settings;
  d date;
  at_time text;
  r record;
  n int := 0;
begin
  select * into s from public.app_settings where id = 1;
  d := (now() at time zone s.timezone)::date;
  if not public.is_workday(d) then
    return 0;
  end if;

  if p_kind = 'in' then
    at_time := to_char(s.work_start::interval, 'FMHH12:MI');
    for r in
      select p.id, p.short_name
      from public.profiles p
      where p.active and not p.attendance_exempt
        and not exists (select 1 from public.attendance a where a.user_id = p.id and a.work_date = d)
        and not exists (select 1 from public.events e where e.kind = 'leave' and e.event_date = d and p.id = any (e.attendees))
    loop
      insert into public.attendance_reminders (user_id, work_date, kind) values (r.id, d, 'in') on conflict do nothing;
      if found then
        perform public.notify(r.id, 'checkin_reminder', 'Time to check in',
          'Good morning ' || r.short_name || '. It''s ' || at_time || ' and you haven''t checked in yet. Tap to check in.',
          '/attendance', null);
        n := n + 1;
      end if;
    end loop;

  elsif p_kind in ('out', 'out_again') then
    at_time := to_char((s.work_end + case when p_kind = 'out_again' then interval '1 hour' else interval '0 minutes' end)::interval, 'FMHH12:MI');
    for r in
      select p.id, p.short_name
      from public.profiles p
      join public.attendance a on a.user_id = p.id and a.work_date = d
      where p.active and not p.attendance_exempt
        and a.check_in_at is not null and a.check_out_at is null
    loop
      insert into public.attendance_reminders (user_id, work_date, kind) values (r.id, d, p_kind) on conflict do nothing;
      if found then
        perform public.notify(r.id, 'checkout_reminder',
          case when p_kind = 'out' then 'Time to check out' else 'Still checked in' end,
          case when p_kind = 'out'
            then 'It''s ' || at_time || '. Remember to check out when you leave.'
            else 'It''s ' || at_time || ' and you''re still checked in. Check out when you leave.'
          end,
          '/attendance', null);
        n := n + 1;
      end if;
    end loop;

  else
    raise exception 'Unknown reminder: %', p_kind;
  end if;
  return n;
end $$;

-- The reminders run at the work-hour times in Settings (stored in Riyadh time; the scheduler runs in UTC).
create or replace function public.schedule_attendance_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.app_settings;
  base date := (now() at time zone 'UTC')::date;
  t_in timestamp;
  t_out timestamp;
  t_again timestamp;
begin
  select * into s from public.app_settings where id = 1;
  t_in := ((base + s.work_start) at time zone s.timezone) at time zone 'UTC';
  t_out := ((base + s.work_end) at time zone s.timezone) at time zone 'UTC';
  t_again := t_out + interval '1 hour';
  perform cron.schedule('northcroft-checkin-reminder',
    format('%s %s * * *', extract(minute from t_in)::int, extract(hour from t_in)::int),
    'select public.attendance_reminders(''in'')');
  perform cron.schedule('northcroft-checkout-reminder',
    format('%s %s * * *', extract(minute from t_out)::int, extract(hour from t_out)::int),
    'select public.attendance_reminders(''out'')');
  perform cron.schedule('northcroft-checkout-again',
    format('%s %s * * *', extract(minute from t_again)::int, extract(hour from t_again)::int),
    'select public.attendance_reminders(''out_again'')');
end $$;

create or replace function public.settings_reschedule_reminders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.schedule_attendance_reminders();
  return new;
end $$;

create trigger settings_reminder_times after update on public.app_settings
  for each row
  when (old.work_start is distinct from new.work_start
        or old.work_end is distinct from new.work_end
        or old.timezone is distinct from new.timezone)
  execute function public.settings_reschedule_reminders();

-- Checking in (or out) marks that day's reminder as read, so it doesn't sit unread in the Inbox.
create or replace function public.attendance_clear_reminders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.check_in_at is not null and (tg_op = 'INSERT' or old.check_in_at is null) then
    update public.notifications set read_at = now()
      where user_id = new.user_id and type = 'checkin_reminder' and read_at is null
        and created_at > now() - interval '18 hours';
  end if;
  if new.check_out_at is not null and (tg_op = 'INSERT' or old.check_out_at is null) then
    update public.notifications set read_at = now()
      where user_id = new.user_id and type = 'checkout_reminder' and read_at is null
        and created_at > now() - interval '18 hours';
  end if;
  return new;
end $$;

create trigger attendance_clear_reminders after insert or update on public.attendance
  for each row execute function public.attendance_clear_reminders();

revoke execute on function public.attendance_reminders(text) from public, anon, authenticated;
revoke execute on function public.schedule_attendance_reminders() from public, anon, authenticated;
revoke execute on function public.settings_reschedule_reminders() from public, anon, authenticated;
revoke execute on function public.attendance_clear_reminders() from public, anon, authenticated;

select public.schedule_attendance_reminders();
