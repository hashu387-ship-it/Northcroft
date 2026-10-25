-- Lunch break rules and the 12:35 office check.
--
-- Lunch is from 12:00 to 1:00 (managers can change the start, the length and the check time in
-- Settings > Working hours). It applies to people who check in, follow break rules (a profile
-- switch, on for everyone but Hassan), aren't on leave, and are checked in and not yet checked out.
--
--   12:00  everyone it applies to gets a message: going out, tap Start break; staying in, you'll be
--          asked to confirm at 12:35.
--   Start break / Close break  only when leaving the office. Each tap takes the phone's location.
--          One lunch break a day. Closing it away from the office (outside the radius of an office,
--          or of the place they checked in at that day) tells the attendance watchers.
--   5 minutes before the end  "5 minutes left of your break".
--   At the end                "Your break is over. Tap Close break now."
--   15 minutes over           the watchers are told.
--   12:35  anyone who hasn't started a break or confirmed gets "Are you in the office?". Confirming
--          takes the location: inside the radius is confirmed, outside tells the watchers.
--   12:50  the watchers get one list of who still hasn't confirmed or started a break, and each of
--          those people gets a reminder.
--
-- Location is only taken when someone taps Start break, Close break or Confirm. Nothing runs in the
-- background on the phone.
--
-- Attendance watchers are the people who can see the team's check-in times: managers and seniors
-- with "Sees check-in times" (today that's Hassan). Managers who only see present or absent don't
-- see break times or places.
--
-- break_tick() runs every minute from 9:00 to 17:59 Riyadh time and sends each message once: every
-- message has its own stamp on lunch_breaks (per person) or lunch_days (per day). It takes the time
-- as a parameter so it can be tested with any time of day.

/* ---------------------------------------------------------------- settings and the profile switch */

alter table public.app_settings
  add column if not exists break_rules_on boolean not null default true,
  add column if not exists break_start time not null default '12:00',
  add column if not exists break_minutes integer not null default 60,
  add column if not exists break_confirm_at time not null default '12:35';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_settings_break_minutes_check') then
    alter table public.app_settings
      add constraint app_settings_break_minutes_check check (break_minutes between 15 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'app_settings_break_start_check') then
    alter table public.app_settings
      add constraint app_settings_break_start_check check (break_start between '10:00' and '15:00');
  end if;
end $$;

comment on column public.app_settings.break_rules_on is 'Lunch break rules and the office check are on.';
comment on column public.app_settings.break_start is 'When the lunch break starts (team time).';
comment on column public.app_settings.break_minutes is 'How long the lunch break is, in minutes.';
comment on column public.app_settings.break_confirm_at is 'When people who haven''t gone out are asked to confirm they''re in the office.';

alter table public.profiles
  add column if not exists break_rules boolean not null default true;

comment on column public.profiles.break_rules is 'Follows the lunch break rules and the office check.';

-- Hassan doesn't follow break rules.
update public.profiles set break_rules = false where id = '3b537d99-9b94-4d26-9485-8c373605b55d';

-- Only a manager can switch break rules on or off for someone. This keeps the daily_update line
-- from 0028 (daily updates), which must be applied before this migration.
create or replace function public.protect_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if not public.is_manager() then
    if new.role is distinct from old.role
       or new.can_assign is distinct from old.can_assign
       or new.active is distinct from old.active
       or new.email is distinct from old.email
       or new.title is distinct from old.title
       or new.attendance_exempt is distinct from old.attendance_exempt
       or new.attendance_times is distinct from old.attendance_times
       or new.assignable is distinct from old.assignable
       or new.annual_leave_days is distinct from old.annual_leave_days
       or new.daily_update is distinct from old.daily_update
       or new.break_rules is distinct from old.break_rules then
      raise exception 'Only the manager can change roles, titles, access or leave allowances';
    end if;
  elsif old.role = 'manager' and (new.role <> 'manager' or not new.active)
        and (select count(*) from public.profiles where role = 'manager' and active) <= 1 then
    raise exception 'The team needs at least one active manager';
  end if;
  return new;
end $$;

/* ---------------------------------------------------------------- tables */

-- One row per person per day: the 12:00 message, the office check and the lunch break.
create table if not exists public.lunch_breaks (
  user_id uuid not null references public.profiles (id),
  work_date date not null,

  -- messages sent to this person (each once)
  prompted_at timestamptz,         -- 12:00 "Lunch break from 12 to 1"
  confirm_asked_at timestamptz,    -- 12:35 "Are you in the office?"
  missed_at timestamptz,           -- 12:50 reminder, and on the watchers' list

  -- office check
  confirmed_at timestamptz,
  confirm_lat double precision,
  confirm_lng double precision,
  confirm_accuracy double precision,
  confirm_address text,
  confirm_place_name text,
  confirm_place_kind text,
  confirm_in_office boolean,
  confirm_distance_m integer,
  outside_at timestamptz,          -- first time they confirmed from outside (watchers told then)

  -- lunch break
  break_start_at timestamptz,
  start_lat double precision,
  start_lng double precision,
  start_accuracy double precision,
  start_address text,
  start_place_name text,
  start_place_kind text,
  break_end_at timestamptz,
  end_lat double precision,
  end_lng double precision,
  end_accuracy double precision,
  end_address text,
  end_place_name text,
  end_place_kind text,
  end_in_office boolean,
  end_distance_m integer,

  -- break reminders (each once)
  reminded_left_at timestamptz,    -- 5 minutes left
  reminded_over_at timestamptz,    -- break over
  watchers_told_at timestamptz,    -- 15 minutes over, watchers told

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, work_date),
  check (break_end_at is null or break_start_at is not null)
);

create index if not exists lunch_breaks_work_date_idx on public.lunch_breaks (work_date);

comment on table public.lunch_breaks is 'Each person''s lunch break and office check for the day. Written only by start_break(), close_break(), confirm_in_office() and break_tick().';

alter table public.lunch_breaks enable row level security;

create policy "lunch breaks: own or attendance watchers" on public.lunch_breaks
  for select to authenticated
  using (user_id = auth.uid() or public.can_see_team_attendance());

-- Messages that go once a day for the whole team (the watchers' 12:50 list).
create table if not exists public.lunch_days (
  work_date date primary key,
  digest_sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.lunch_days enable row level security;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lunch_breaks') then
    alter publication supabase_realtime add table public.lunch_breaks;
  end if;
end $$;

/* ---------------------------------------------------------------- helpers */

-- People who see the team's check-in times, and so hear about breaks and the office check.
create or replace function public.attendance_watchers()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.profiles
  where active and attendance_times
    and (role = 'manager' or (can_assign and not attendance_exempt));
$$;

-- Whether the lunch rules apply to someone today: follows break rules, checks in, isn't on leave,
-- and is checked in and not checked out.
create or replace function public.lunch_applies(p_user uuid, p_day date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles pr
    join public.attendance a on a.user_id = pr.id and a.work_date = p_day
    where pr.id = p_user and pr.active and pr.break_rules and not pr.attendance_exempt
      and a.check_out_at is null
  ) and not public.on_leave(p_user, p_day);
$$;

-- Is a spot in the office? Inside the radius of an active office, or of the place the person
-- checked in at that day. Also gives the distance to the nearest of those places.
create or replace function public.office_check(p_user uuid, p_day date, p_lat double precision, p_lng double precision)
returns table (inside boolean, distance_m double precision, office_name text)
language sql
stable
security definer
set search_path = public
as $$
  with c as (
    select p.name, p.radius_m,
           2 * 6371000 * asin(sqrt(
             power(sin(radians(p.lat - p_lat) / 2), 2)
             + cos(radians(p_lat)) * cos(radians(p.lat)) * power(sin(radians(p.lng - p_lng) / 2), 2)
           )) as m
    from public.places p
    where p_lat is not null and p_lng is not null
      and ((p.active and p.kind = 'office')
           or p.id = (select a.in_place_id from public.attendance a where a.user_id = p_user and a.work_date = p_day))
  )
  select coalesce(bool_or(c.m <= c.radius_m), false),
         min(c.m),
         (select c2.name from c c2 order by c2.m limit 1)
  from c;
$$;

-- "about 350 m" or "about 1.2 km"
create or replace function public.rough_distance(p_m double precision)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_m is null then null
    when p_m < 1000 then 'about ' || (greatest(10, round(p_m / 10) * 10))::int || ' m'
    else 'about ' || trim(to_char(round((p_m / 1000)::numeric, 1), 'FM999990.0')) || ' km'
  end;
$$;

-- A time of day as the team reads it at lunch: "12:05", "1:40".
create or replace function public.lunch_clock(p_at timestamptz)
returns text
language sql
stable
set search_path = public
as $$
  select to_char(p_at at time zone coalesce((select timezone from public.app_settings where id = 1), 'Asia/Riyadh'), 'FMHH12:MI');
$$;

-- "12" or "12:30" for the 12:00 message.
create or replace function public.lunch_hour(p_t time)
returns text
language sql
immutable
set search_path = public
as $$
  select case when extract(minute from p_t) = 0 then to_char(p_t, 'FMHH12') else to_char(p_t, 'FMHH12:MI') end;
$$;

-- Checks shared by the three buttons. Returns the settings and the person's day.
create or replace function public.lunch_guard(out s public.app_settings, out d date, out local_t time)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me public.profiles;
  a public.attendance;
begin
  select * into s from public.app_settings where id = 1;
  d := (now() at time zone coalesce(s.timezone, 'Asia/Riyadh'))::date;
  local_t := (now() at time zone coalesce(s.timezone, 'Asia/Riyadh'))::time;
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or not me.active then
    raise exception 'Sign in again to carry on';
  end if;
  if not coalesce(s.break_rules_on, false) then
    raise exception 'Lunch break rules are switched off';
  end if;
  if me.attendance_exempt or not me.break_rules then
    raise exception 'Lunch break rules don''t apply to you';
  end if;
  if not public.is_workday(d) then
    raise exception 'There''s no lunch break today, it isn''t a working day';
  end if;
  select * into a from public.attendance where user_id = me.id and work_date = d;
  if a.id is null then
    raise exception 'Check in first, then you can use the lunch break buttons';
  end if;
  if a.check_out_at is not null then
    raise exception 'You''ve already checked out today';
  end if;
end $$;

/* ---------------------------------------------------------------- the three buttons */

-- Start break: only when leaving the office, once a day, during the lunch window.
create or replace function public.start_break(
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy double precision default null,
  p_address text default null
)
returns public.lunch_breaks
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  lb public.lunch_breaks;
  pl record;
  win_end time;
begin
  select * into g from public.lunch_guard();
  win_end := (g.s).break_start + make_interval(mins => (g.s).break_minutes);
  if g.local_t < (g.s).break_start then
    raise exception 'Lunch break starts at %', to_char((g.s).break_start, 'FMHH12:MI am');
  end if;
  if g.local_t >= win_end then
    raise exception 'Lunch break was from % to %', to_char((g.s).break_start, 'FMHH12:MI am'), to_char(win_end, 'FMHH12:MI am');
  end if;

  select * into lb from public.lunch_breaks where user_id = auth.uid() and work_date = g.d for update;
  if lb.break_end_at is not null then
    raise exception 'You''ve already had your lunch break today';
  end if;
  if lb.break_start_at is not null then
    return lb;
  end if;

  select * into pl from public.nearest_place(p_lat, p_lng);

  insert into public.lunch_breaks as x (user_id, work_date, break_start_at, start_lat, start_lng, start_accuracy,
                                        start_address, start_place_name, start_place_kind)
  values (auth.uid(), g.d, now(), p_lat, p_lng, p_accuracy, nullif(trim(p_address), ''),
          coalesce(pl.name, case when p_lat is null then 'Location unavailable' else 'Elsewhere' end),
          case when pl.id is not null then pl.kind when p_lat is null then 'unknown' else 'elsewhere' end)
  on conflict (user_id, work_date) do update
    set break_start_at = excluded.break_start_at,
        start_lat = excluded.start_lat,
        start_lng = excluded.start_lng,
        start_accuracy = excluded.start_accuracy,
        start_address = excluded.start_address,
        start_place_name = excluded.start_place_name,
        start_place_kind = excluded.start_place_kind,
        updated_at = now()
  returning * into lb;
  return lb;
end $$;

-- Close break: back in the office. Closing it anywhere else tells the watchers.
create or replace function public.close_break(
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy double precision default null,
  p_address text default null
)
returns public.lunch_breaks
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  lb public.lunch_breaks;
  pl record;
  oc record;
  who text;
  w uuid;
  where_text text;
begin
  select * into g from public.lunch_guard();
  select * into lb from public.lunch_breaks where user_id = auth.uid() and work_date = g.d for update;
  if lb.break_start_at is null then
    raise exception 'You haven''t started a break today';
  end if;
  if lb.break_end_at is not null then
    return lb;
  end if;

  select * into pl from public.nearest_place(p_lat, p_lng);
  select * into oc from public.office_check(auth.uid(), g.d, p_lat, p_lng);

  update public.lunch_breaks
     set break_end_at = now(),
         end_lat = p_lat,
         end_lng = p_lng,
         end_accuracy = p_accuracy,
         end_address = nullif(trim(p_address), ''),
         end_place_name = coalesce(pl.name, case when p_lat is null then 'Location unavailable' else 'Elsewhere' end),
         end_place_kind = case when pl.id is not null then pl.kind when p_lat is null then 'unknown' else 'elsewhere' end,
         end_in_office = coalesce(oc.inside, false),
         end_distance_m = round(oc.distance_m)::int,
         updated_at = now()
   where user_id = auth.uid() and work_date = g.d
  returning * into lb;

  if not lb.end_in_office then
    select short_name into who from public.profiles where id = auth.uid();
    where_text := case
      when p_lat is null then 'No location was shared.'
      else 'At ' || lb.end_place_name
           || coalesce(', ' || public.rough_distance(oc.distance_m) || ' from the office', '') || '.'
    end;
    for w in select public.attendance_watchers() loop
      perform public.notify(w, 'break_away', who || ' closed the break away from the office',
        where_text || ' Break ' || public.lunch_clock(lb.break_start_at) || ' to ' || public.lunch_clock(lb.break_end_at) || '.',
        '/attendance', auth.uid());
    end loop;
  end if;
  return lb;
end $$;

-- Confirm I'm in the office: for people staying in at lunch. Outside the radius tells the watchers.
create or replace function public.confirm_in_office(
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy double precision default null,
  p_address text default null
)
returns public.lunch_breaks
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  lb public.lunch_breaks;
  pl record;
  oc record;
  who text;
  w uuid;
  win_end time;
  first_outside boolean;
begin
  select * into g from public.lunch_guard();
  win_end := (g.s).break_start + make_interval(mins => (g.s).break_minutes);
  if g.local_t < (g.s).break_start or g.local_t >= win_end then
    raise exception 'You can confirm from % until %', to_char((g.s).break_start, 'FMHH12:MI am'), to_char(win_end, 'FMHH12:MI am');
  end if;
  if p_lat is null or p_lng is null then
    raise exception 'We need your location to confirm you''re in the office. Turn on location and try again';
  end if;

  select * into lb from public.lunch_breaks where user_id = auth.uid() and work_date = g.d for update;
  if lb.break_end_at is not null then
    raise exception 'Your lunch break is already recorded';
  end if;
  if lb.break_start_at is not null then
    raise exception 'You''re on your break. Tap Close break when you''re back';
  end if;
  if lb.confirm_in_office then
    return lb;
  end if;

  select * into pl from public.nearest_place(p_lat, p_lng);
  select * into oc from public.office_check(auth.uid(), g.d, p_lat, p_lng);
  first_outside := not coalesce(oc.inside, false) and lb.outside_at is null;

  insert into public.lunch_breaks as x (user_id, work_date, confirmed_at, confirm_lat, confirm_lng, confirm_accuracy,
                                        confirm_address, confirm_place_name, confirm_place_kind, confirm_in_office,
                                        confirm_distance_m, outside_at)
  values (auth.uid(), g.d, now(), p_lat, p_lng, p_accuracy, nullif(trim(p_address), ''),
          coalesce(pl.name, 'Elsewhere'), coalesce(pl.kind, 'elsewhere'), coalesce(oc.inside, false),
          round(oc.distance_m)::int, case when coalesce(oc.inside, false) then null else now() end)
  on conflict (user_id, work_date) do update
    set confirmed_at = excluded.confirmed_at,
        confirm_lat = excluded.confirm_lat,
        confirm_lng = excluded.confirm_lng,
        confirm_accuracy = excluded.confirm_accuracy,
        confirm_address = excluded.confirm_address,
        confirm_place_name = excluded.confirm_place_name,
        confirm_place_kind = excluded.confirm_place_kind,
        confirm_in_office = excluded.confirm_in_office,
        confirm_distance_m = excluded.confirm_distance_m,
        outside_at = coalesce(x.outside_at, excluded.outside_at),
        updated_at = now()
  returning * into lb;

  if first_outside then
    select short_name into who from public.profiles where id = auth.uid();
    for w in select public.attendance_watchers() loop
      perform public.notify(w, 'office_outside', who || ' confirmed from outside the office',
        'At ' || lb.confirm_place_name || coalesce(', ' || public.rough_distance(oc.distance_m) || ' from the office', '')
          || ', at ' || public.lunch_clock(lb.confirmed_at) || '.',
        '/attendance', auth.uid());
    end loop;
  end if;
  return lb;
end $$;

/* ---------------------------------------------------------------- the minute job */

create or replace function public.break_tick(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.app_settings;
  tz text;
  d date;
  t_start timestamptz;
  t_end timestamptz;
  t_confirm timestamptz;
  t_digest timestamptz;
  r record;
  w uuid;
  missed text[];
  n_prompt int := 0;
  n_ask int := 0;
  n_left int := 0;
  n_over int := 0;
  n_late int := 0;
begin
  select * into s from public.app_settings where id = 1;
  if s.id is null or not coalesce(s.break_rules_on, false) then
    return jsonb_build_object('skipped', 'rules off');
  end if;
  tz := coalesce(s.timezone, 'Asia/Riyadh');
  d := (p_now at time zone tz)::date;
  if not public.is_workday(d) then
    return jsonb_build_object('skipped', 'not a working day');
  end if;

  t_start := (d + s.break_start) at time zone tz;
  t_end := t_start + make_interval(mins => s.break_minutes);
  t_confirm := (d + s.break_confirm_at) at time zone tz;
  t_digest := t_confirm + interval '15 minutes';

  if p_now < t_start then
    return jsonb_build_object('skipped', 'before lunch');
  end if;

  -- 12:00: the lunch message, once per person, until the lunch window ends.
  if p_now < t_end then
    for r in
      select pr.id
      from public.profiles pr
      left join public.lunch_breaks lb on lb.user_id = pr.id and lb.work_date = d
      where public.lunch_applies(pr.id, d)
        and lb.prompted_at is null and lb.break_start_at is null
    loop
      insert into public.lunch_breaks (user_id, work_date, prompted_at) values (r.id, d, p_now)
      on conflict (user_id, work_date) do update set prompted_at = excluded.prompted_at, updated_at = now();
      perform public.notify(r.id, 'break_prompt',
        'Lunch break from ' || public.lunch_hour(s.break_start) || ' to ' || public.lunch_hour((s.break_start + make_interval(mins => s.break_minutes))::time),
        'Going out? Tap Start break before you leave. Staying in the office? You''ll be asked to confirm at '
          || to_char(s.break_confirm_at, 'FMHH12:MI') || '.',
        '/attendance', null);
      n_prompt := n_prompt + 1;
    end loop;
  end if;

  -- 12:35: "Are you in the office?" to anyone who hasn't gone out or confirmed.
  if p_now >= t_confirm and p_now < t_digest then
    for r in
      select pr.id
      from public.profiles pr
      left join public.lunch_breaks lb on lb.user_id = pr.id and lb.work_date = d
      where public.lunch_applies(pr.id, d)
        and lb.break_start_at is null and lb.confirmed_at is null and lb.confirm_asked_at is null
    loop
      insert into public.lunch_breaks (user_id, work_date, confirm_asked_at) values (r.id, d, p_now)
      on conflict (user_id, work_date) do update set confirm_asked_at = excluded.confirm_asked_at, updated_at = now();
      perform public.notify(r.id, 'office_confirm', 'Are you in the office?', 'Tap to confirm.', '/attendance?lunch=confirm', null);
      n_ask := n_ask + 1;
    end loop;
  end if;

  -- 12:50: one list for the watchers, and a reminder to each person on it. Once a day.
  if p_now >= t_digest and p_now < t_digest + interval '1 hour' then
    insert into public.lunch_days (work_date) values (d) on conflict (work_date) do nothing;
    perform 1 from public.lunch_days where work_date = d and digest_sent_at is null for update;
    if found then
      select coalesce(array_agg(pr.short_name order by pr.short_name), '{}') into missed
      from public.profiles pr
      left join public.lunch_breaks lb on lb.user_id = pr.id and lb.work_date = d
      where public.lunch_applies(pr.id, d)
        and lb.break_start_at is null and lb.confirmed_at is null;

      for r in
        select pr.id
        from public.profiles pr
        left join public.lunch_breaks lb on lb.user_id = pr.id and lb.work_date = d
        where public.lunch_applies(pr.id, d)
          and lb.break_start_at is null and lb.confirmed_at is null
      loop
        insert into public.lunch_breaks (user_id, work_date, missed_at) values (r.id, d, p_now)
        on conflict (user_id, work_date) do update set missed_at = excluded.missed_at, updated_at = now();
        perform public.notify(r.id, 'office_missed', 'You haven''t confirmed you''re in the office',
          'Tap to confirm now. If you''ve gone out for lunch, tap Start break.', '/attendance?lunch=confirm', null);
      end loop;

      if array_length(missed, 1) > 0 then
        for w in select public.attendance_watchers() loop
          perform public.notify(w, 'lunch_digest', 'Not confirmed in the office: ' || array_to_string(missed, ', '),
            'No office check or break since ' || to_char(s.break_confirm_at, 'FMHH12:MI') || '.', '/attendance', null);
        end loop;
      end if;

      update public.lunch_days set digest_sent_at = p_now where work_date = d;
    end if;
  end if;

  -- Open breaks: 5 minutes left, over, and 15 minutes over (watchers).
  for r in
    select lb.user_id, lb.break_start_at, lb.reminded_left_at, lb.reminded_over_at, lb.watchers_told_at, pr.short_name,
           exists (select 1 from public.attendance a where a.user_id = lb.user_id and a.work_date = d and a.check_out_at is not null) as gone
    from public.lunch_breaks lb
    join public.profiles pr on pr.id = lb.user_id
    where lb.work_date = d and lb.break_start_at is not null and lb.break_end_at is null
    for update of lb
  loop
    if r.gone then
      continue;
    end if;

    if r.reminded_left_at is null and p_now >= r.break_start_at + make_interval(mins => s.break_minutes - 5) then
      update public.lunch_breaks set reminded_left_at = p_now, updated_at = now() where user_id = r.user_id and work_date = d;
      -- If the minute job was late and the break is already over, skip straight to "over".
      if p_now < r.break_start_at + make_interval(mins => s.break_minutes) then
        perform public.notify(r.user_id, 'break_left', '5 minutes left of your break',
          'Tap Close break when you''re back in the office.', '/attendance', null);
        n_left := n_left + 1;
      end if;
    end if;

    if r.reminded_over_at is null and p_now >= r.break_start_at + make_interval(mins => s.break_minutes) then
      update public.lunch_breaks set reminded_over_at = p_now, updated_at = now() where user_id = r.user_id and work_date = d;
      perform public.notify(r.user_id, 'break_over', 'Your break is over', 'Tap Close break now.', '/attendance', null);
      n_over := n_over + 1;
    end if;

    if r.watchers_told_at is null and p_now >= r.break_start_at + make_interval(mins => s.break_minutes + 15) then
      update public.lunch_breaks set watchers_told_at = p_now, updated_at = now() where user_id = r.user_id and work_date = d;
      for w in select public.attendance_watchers() loop
        perform public.notify(w, 'break_late', r.short_name || '''s break is 15 minutes over',
          'Out since ' || public.lunch_clock(r.break_start_at) || ' and the break isn''t closed yet.', '/attendance', r.user_id);
      end loop;
      n_late := n_late + 1;
    end if;
  end loop;

  return jsonb_build_object('prompt', n_prompt, 'ask', n_ask, 'missed', to_jsonb(missed),
                            'left', n_left, 'over', n_over, 'late', n_late);
end $$;

/* ---------------------------------------------------------------- who can call what */

revoke execute on function public.break_tick(timestamptz) from public, anon, authenticated;
revoke execute on function public.attendance_watchers() from public, anon, authenticated;
revoke execute on function public.lunch_applies(uuid, date) from public, anon, authenticated;
revoke execute on function public.office_check(uuid, date, double precision, double precision) from public, anon, authenticated;
revoke execute on function public.lunch_guard() from public, anon, authenticated;
revoke execute on function public.start_break(double precision, double precision, double precision, text) from public, anon;
revoke execute on function public.close_break(double precision, double precision, double precision, text) from public, anon;
revoke execute on function public.confirm_in_office(double precision, double precision, double precision, text) from public, anon;
grant execute on function public.start_break(double precision, double precision, double precision, text) to authenticated;
grant execute on function public.close_break(double precision, double precision, double precision, text) to authenticated;
grant execute on function public.confirm_in_office(double precision, double precision, double precision, text) to authenticated;

/* ---------------------------------------------------------------- every minute, 9:00 to 17:59 Riyadh time */

select cron.schedule('northcroft-lunch-breaks', '* 6-14 * * *', $$select public.break_tick()$$);
