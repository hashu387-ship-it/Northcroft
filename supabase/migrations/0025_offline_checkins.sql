-- Check in and check out with no signal.
--
-- With no signal, the phone keeps the time and place of a check-in or check-out and sends it once
-- it's back online. It's recorded at the time it happened, so late and early minutes are worked out
-- from that time, and flagged "sent later" with the time it actually arrived, because a phone's
-- clock can be changed. Managers see the mark on the attendance board, in history and in the
-- monthly export.
--
-- record_attendance_later() is the only way in for a saved check-in or check-out. It checks:
--   * the time isn't in the future (a few minutes' leeway for clocks that are slightly off)
--   * it isn't more than 24 hours old
--   * the day the phone says matches the day of that time in the team's timezone
--   * a check-out is after that day's check-in, and doesn't replace a later check-out
-- check_in() and check_out() are unchanged for online use, except that a fresh online check-out
-- clears the "sent later" mark of an earlier saved one it replaces.

alter table public.attendance
  add column if not exists in_sent_later boolean not null default false,
  add column if not exists in_received_at timestamptz,
  add column if not exists out_sent_later boolean not null default false,
  add column if not exists out_received_at timestamptz;

comment on column public.attendance.in_sent_later is 'The check-in was made with no signal and sent later; check_in_at is the phone''s time.';
comment on column public.attendance.in_received_at is 'When a check-in made with no signal actually reached the server.';
comment on column public.attendance.out_sent_later is 'The check-out was made with no signal and sent later; check_out_at is the phone''s time.';
comment on column public.attendance.out_received_at is 'When a check-out made with no signal actually reached the server.';

create or replace function public.record_attendance_later(
  p_kind text,
  p_at timestamptz,
  p_work_date date default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy double precision default null,
  p_address text default null,
  p_note text default null
)
returns public.attendance
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s public.app_settings;
  arrived timestamptz := now();
  d date;
  lt time;
  pl record;
  rec public.attendance;
  what text;
begin
  if auth.uid() is null or not public.is_member() then
    raise exception 'Not signed in';
  end if;
  if p_kind is null or p_kind not in ('in', 'out') then
    raise exception 'Unknown attendance entry: %', coalesce(p_kind, 'none');
  end if;
  what := case when p_kind = 'in' then 'check-in' else 'check-out' end;
  if p_at is null then
    raise exception 'This % has no time, so it can''t be sent.', what;
  end if;
  if p_at > arrived + interval '5 minutes' then
    raise exception 'This % is later than the real time. Check the date and time on your phone, then check % again.',
      what, case when p_kind = 'in' then 'in' else 'out' end;
  end if;
  if p_at < arrived - interval '24 hours' then
    raise exception 'This % was saved more than a day ago, so it can''t be sent now. Ask Hassan to add it for you.', what;
  end if;

  select * into s from public.app_settings where id = 1;
  d := (p_at at time zone s.timezone)::date;
  lt := (p_at at time zone s.timezone)::time;
  if p_work_date is not null and p_work_date <> d then
    raise exception 'The date on this % doesn''t match its time. Check the date and time on your phone.', what;
  end if;
  select * into pl from public.nearest_place(p_lat, p_lng);

  if p_kind = 'in' then
    insert into public.attendance (user_id, work_date, check_in_at, in_lat, in_lng, in_accuracy, in_address,
      in_place_id, in_place_name, in_place_kind, late_minutes, note, in_sent_later, in_received_at)
    values (auth.uid(), d, p_at, p_lat, p_lng, p_accuracy, left(p_address, 300),
      pl.id,
      coalesce(pl.name, case when p_lat is null then 'Location unavailable' else 'Elsewhere' end),
      case when pl.id is not null then pl.kind when p_lat is null then 'unknown' else 'elsewhere' end,
      case when public.is_workday(d) and lt > s.work_start + make_interval(mins => s.grace_minutes)
           then floor(extract(epoch from (lt - s.work_start)) / 60)::int else 0 end,
      left(p_note, 500),
      true, arrived)
    on conflict (user_id, work_date) do nothing
    returning * into rec;

    if rec.id is null then
      raise exception 'You had already checked in on %, so this check-in wasn''t needed.', to_char(d, 'FMDay FMDD FMMonth');
    end if;
    return rec;
  end if;

  update public.attendance a set
    check_out_at = p_at,
    out_lat = p_lat, out_lng = p_lng, out_accuracy = p_accuracy, out_address = left(p_address, 300),
    out_place_id = pl.id,
    out_place_name = coalesce(pl.name, case when p_lat is null then 'Location unavailable' else 'Elsewhere' end),
    out_place_kind = case when pl.id is not null then pl.kind when p_lat is null then 'unknown' else 'elsewhere' end,
    early_minutes = case when public.is_workday(d) and lt < s.work_end - make_interval(mins => s.grace_minutes)
                         then floor(extract(epoch from (s.work_end - lt)) / 60)::int else 0 end,
    note = coalesce(nullif(left(p_note, 500), ''), a.note),
    out_sent_later = true,
    out_received_at = arrived
  where a.user_id = auth.uid() and a.work_date = d
    and a.check_in_at < p_at
    and (a.check_out_at is null or a.check_out_at < p_at)
  returning * into rec;

  if rec.id is null then
    select * into rec from public.attendance a where a.user_id = auth.uid() and a.work_date = d;
    if rec.id is null then
      raise exception 'There''s no check-in on % to check out from.', to_char(d, 'FMDay FMDD FMMonth');
    elsif rec.check_in_at >= p_at then
      raise exception 'This check-out is earlier than your check-in, so it wasn''t saved.';
    else
      raise exception 'You had already checked out later than this, so this check-out wasn''t needed.';
    end if;
  end if;
  return rec;
end $function$;

revoke execute on function public.record_attendance_later(text, timestamptz, date, double precision, double precision, double precision, text, text) from public, anon;
grant execute on function public.record_attendance_later(text, timestamptz, date, double precision, double precision, double precision, text, text) to authenticated;

-- Online check-out: as before, plus a fresh check-out clears the "sent later" mark of one it replaces.
create or replace function public.check_out(p_lat double precision default null::double precision, p_lng double precision default null::double precision, p_accuracy double precision default null::double precision, p_address text default null::text, p_note text default null::text)
 returns attendance
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  s public.app_settings;
  t timestamptz := now();
  d date;
  lt time;
  pl record;
  rec public.attendance;
begin
  if auth.uid() is null or not public.is_member() then
    raise exception 'Not signed in';
  end if;
  select * into s from public.app_settings where id = 1;
  d := (t at time zone s.timezone)::date;
  lt := (t at time zone s.timezone)::time;
  select * into pl from public.nearest_place(p_lat, p_lng);

  update public.attendance a set
    check_out_at = t,
    out_lat = p_lat, out_lng = p_lng, out_accuracy = p_accuracy, out_address = left(p_address, 300),
    out_place_id = pl.id,
    out_place_name = coalesce(pl.name, case when p_lat is null then 'Location unavailable' else 'Elsewhere' end),
    out_place_kind = case when pl.id is not null then pl.kind when p_lat is null then 'unknown' else 'elsewhere' end,
    early_minutes = case when public.is_workday(d) and lt < s.work_end - make_interval(mins => s.grace_minutes)
                         then floor(extract(epoch from (s.work_end - lt)) / 60)::int else 0 end,
    note = coalesce(nullif(left(p_note, 500), ''), a.note),
    out_sent_later = false,
    out_received_at = null
  where a.user_id = auth.uid() and a.work_date = d
  returning * into rec;

  if rec.id is null then
    raise exception 'Check in first, then you can check out';
  end if;
  return rec;
end $function$;
