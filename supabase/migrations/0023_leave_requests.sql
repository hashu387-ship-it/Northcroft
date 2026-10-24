-- Leave requests.
--   Anyone who checks in asks for leave (annual, sick, emergency, unpaid or other), whole working
--   days from one date to another. Approval follows the task sign-off: the first checker (Hassan)
--   approves, then the final checker (Fawaz) gives the final OK. The first checker's own request
--   goes straight to the final checker. With no final checker, the first approval is final; with no
--   first checker, any manager approves first. Either of them can decline with a note. The person can
--   cancel a request that's waiting, or approved leave that hasn't started; a manager can cancel
--   approved leave at any time.
--   Approved leave counts like a Leave entry on the Calendar: the check-in and check-out reminders
--   skip those people, and the attendance views show them as on leave.
--   Each person has a yearly annual leave allowance (21 days unless a manager changes it). Annual
--   leave taken counts against it, by working days in each calendar year.
-- leave_guard enforces all of this whatever screen is used.

alter table public.profiles add column if not exists annual_leave_days integer not null default 21
  check (annual_leave_days between 0 and 365);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id),
  kind text not null default 'annual' check (kind in ('annual', 'sick', 'emergency', 'unpaid', 'other')),
  start_date date not null,
  end_date date not null,
  -- Working days in the request (set by leave_guard from the work days in Settings).
  days integer not null default 0,
  note text check (char_length(note) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'cancelled')),
  -- Whose turn it is while pending: 'first' (the first checker) or 'final' (the final OK).
  stage text check (stage in ('first', 'final')),
  first_ok_by uuid references public.profiles (id),
  first_ok_at timestamptz,
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text check (char_length(decision_note) <= 1000),
  cancelled_by uuid references public.profiles (id),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leave_dates check (end_date >= start_date and end_date - start_date <= 366)
);
create index if not exists leave_requests_user on public.leave_requests (user_id, start_date);
create index if not exists leave_requests_dates on public.leave_requests (start_date, end_date) where status in ('pending', 'approved');

/** Working days from one date to another, inclusive (the work days in Settings). */
create or replace function public.leave_working_days(p_from date, p_to date)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_from is null or p_to is null or p_to < p_from then 0
    else (select count(*)::int from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g(d)
          where public.is_workday(g.d::date))
  end;
$$;

/** Is this person on leave on this day: approved leave, or a Leave entry on the Calendar. */
create or replace function public.on_leave(p_user uuid, p_day date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.leave_requests r
                 where r.user_id = p_user and r.status = 'approved' and p_day between r.start_date and r.end_date)
      or exists (select 1 from public.events e where e.kind = 'leave' and e.event_date = p_day and p_user = any (e.attendees));
$$;

/** Where a new request starts: with the first checker, or straight to the final OK for the first checker's own. */
create or replace function public.leave_first_stage(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when c.first_id is not null and c.first_id <> p_user then 'first'
    when c.final_id is not null and c.final_id <> p_user then 'final'
    else 'first'
  end
  from public.signoff_checkers() c;
$$;

/** Who can approve at this stage. Without the right checker set, any other manager. */
create or replace function public.leave_approvers(p_stage text, p_user uuid)
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c record;
  a uuid[];
begin
  if p_stage is null then
    return '{}';
  end if;
  select * into c from public.signoff_checkers();
  if p_stage = 'final' and c.final_id is not null and c.final_id <> p_user then
    return array[c.final_id];
  end if;
  if p_stage = 'first' and c.first_id is not null and c.first_id <> p_user then
    return array[c.first_id];
  end if;
  select coalesce(array_agg(p.id order by p.full_name), '{}') into a
    from public.profiles p where p.role = 'manager' and p.active and p.id <> p_user;
  if cardinality(a) = 0 then
    -- The only manager: they record their own leave.
    a := array[p_user];
  end if;
  return a;
end $$;

create or replace function public.leave_kind_label(p_kind text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_kind
    when 'annual' then 'Annual leave'
    when 'sick' then 'Sick leave'
    when 'emergency' then 'Emergency leave'
    when 'unpaid' then 'Unpaid leave'
    else 'Leave'
  end;
$$;

/** "Sun 2 Nov" or "Sun 2 Nov to Thu 6 Nov, 5 working days". */
create or replace function public.leave_when(p_from date, p_to date, p_days integer)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_from = p_to then to_char(p_from, 'Dy FMDD Mon')
    else to_char(p_from, 'Dy FMDD Mon') || ' to ' || to_char(p_to, 'Dy FMDD Mon')
         || ', ' || p_days || case when p_days = 1 then ' working day' else ' working days' end
  end;
$$;

create or replace function public.leave_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  c record;
  approvers uuid[];
  who text;
  today date := public.riyadh_today();
begin
  select * into c from public.signoff_checkers();

  if tg_op = 'INSERT' then
    if uid is not null then
      new.user_id := uid;
    end if;
    if not exists (select 1 from public.profiles p where p.id = new.user_id and p.active and not p.attendance_exempt) then
      raise exception 'Leave requests are for people who check in';
    end if;
    if new.start_date is null or new.end_date is null then
      raise exception 'Choose the first and last day of your leave';
    end if;
    if new.end_date < new.start_date then
      raise exception 'The last day must be on or after the first day';
    end if;
    if new.end_date - new.start_date > 366 then
      raise exception 'Choose up to a year at a time';
    end if;
    if new.start_date < today - 60 then
      raise exception 'Leave can only be recorded up to two months back';
    end if;
    new.days := public.leave_working_days(new.start_date, new.end_date);
    if new.days = 0 then
      raise exception 'Those dates are all weekend days. Pick at least one working day.';
    end if;
    if exists (select 1 from public.leave_requests r
               where r.user_id = new.user_id and r.status in ('pending', 'approved')
                 and r.start_date <= new.end_date and r.end_date >= new.start_date) then
      raise exception 'You already have leave booked or waiting for some of those days';
    end if;
    new.note := nullif(btrim(coalesce(new.note, '')), '');
    new.status := 'pending';
    new.stage := public.leave_first_stage(new.user_id);
    new.first_ok_by := null;
    new.first_ok_at := null;
    new.decided_by := null;
    new.decided_at := null;
    new.decision_note := null;
    new.cancelled_by := null;
    new.cancelled_at := null;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  new.updated_at := now();
  if uid is null then
    -- Maintenance from the server.
    return new;
  end if;

  -- The request itself never changes after it's sent: cancel it and ask again instead.
  new.user_id := old.user_id;
  new.kind := old.kind;
  new.start_date := old.start_date;
  new.end_date := old.end_date;
  new.days := old.days;
  new.note := old.note;
  new.created_at := old.created_at;
  -- Only the steps below move these.
  new.stage := old.stage;
  new.first_ok_by := old.first_ok_by;
  new.first_ok_at := old.first_ok_at;
  new.decided_by := old.decided_by;
  new.decided_at := old.decided_at;
  new.cancelled_by := old.cancelled_by;
  new.cancelled_at := old.cancelled_at;

  if new.status is not distinct from old.status then
    new.decision_note := old.decision_note;
    return new;
  end if;

  -- Approve: the first check, then the final OK.
  if old.status = 'pending' and new.status = 'approved' then
    approvers := public.leave_approvers(old.stage, old.user_id);
    if not (uid = any (approvers)) then
      if uid = old.user_id then
        raise exception 'You can''t approve your own leave';
      end if;
      select short_name into who from public.profiles where id = approvers[1];
      if old.stage = 'first' and cardinality(approvers) = 1 then
        raise exception '% checks this first. It comes to you after that.', coalesce(who, 'The first checker');
      elsif old.stage = 'final' and cardinality(approvers) = 1 then
        raise exception '% gives the final OK on this one.', coalesce(who, 'The final checker');
      end if;
      raise exception 'It isn''t your turn to approve this one';
    end if;
    new.decision_note := nullif(btrim(coalesce(new.decision_note, '')), '');
    if old.stage = 'first' and c.final_id is not null and c.final_id <> uid and c.final_id <> old.user_id then
      -- Checked: on to the final OK.
      new.status := 'pending';
      new.stage := 'final';
      new.first_ok_by := uid;
      new.first_ok_at := now();
    else
      new.stage := null;
      new.decided_by := uid;
      new.decided_at := now();
    end if;
    return new;
  end if;

  -- Decline, with a note: whoever's turn it is, or either checker.
  if old.status = 'pending' and new.status = 'declined' then
    if uid = old.user_id then
      raise exception 'Cancel the request instead';
    end if;
    if not (uid = any (public.leave_approvers(old.stage, old.user_id))
            or uid is not distinct from c.first_id or uid is not distinct from c.final_id) then
      raise exception 'Only the people who approve leave can decline it';
    end if;
    new.stage := null;
    new.decided_by := uid;
    new.decided_at := now();
    new.decision_note := nullif(btrim(coalesce(new.decision_note, '')), '');
    return new;
  end if;

  -- Cancel: the person (waiting, or approved and not started yet), or a manager or checker.
  if old.status in ('pending', 'approved') and new.status = 'cancelled' then
    if uid = old.user_id then
      if old.status = 'approved' and old.start_date <= today then
        select short_name into who from public.profiles where id = coalesce(c.first_id, old.decided_by);
        raise exception 'This leave has already started, so it can''t be cancelled here. Ask % to change it.', coalesce(who, 'your manager');
      end if;
      new.decision_note := old.decision_note;
    elsif public.is_manager() or uid is not distinct from c.first_id or uid is not distinct from c.final_id then
      new.decision_note := nullif(btrim(coalesce(new.decision_note, '')), '');
    else
      raise exception 'Only the person who asked can cancel this request';
    end if;
    new.stage := null;
    new.cancelled_by := uid;
    new.cancelled_at := now();
    return new;
  end if;

  raise exception 'That change isn''t possible for this request';
end $$;

create or replace trigger leave_guard before insert or update on public.leave_requests
  for each row execute function public.leave_guard();

-- Notifications: whoever's turn it is, the person when it's decided, and everyone involved when it's cancelled.
create or replace function public.leave_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  c record;
  person text := coalesce(public.actor_name(new.user_id), 'Someone');
  actor text := coalesce(public.actor_name(uid), 'Someone');
  what text := public.leave_kind_label(new.kind) || ', ' || public.leave_when(new.start_date, new.end_date, new.days);
  link text := '/attendance?leave=' || new.id;
  over text := '';
  r record;
begin
  select * into c from public.signoff_checkers();

  -- A request that's more than the annual allowance left says so to the approver.
  if new.kind = 'annual' and new.status = 'pending' then
    select case when b.remaining - new.days < 0
                then '. That''s ' || (new.days - greatest(b.remaining, 0)) || ' more than ' || person || ' has left this year'
                else '' end
      into over
      from public.leave_balance_of(new.user_id, extract(year from new.start_date)::int) b;
    over := coalesce(over, '');
  end if;

  if tg_op = 'INSERT' then
    for r in select distinct u from unnest(public.leave_approvers(new.stage, new.user_id)) u loop
      perform public.notify(r.u, 'leave_request', person || ' asked for leave', what || over, link, new.user_id);
    end loop;
    return new;
  end if;

  if new.status is not distinct from old.status and new.stage is not distinct from old.stage then
    return new;
  end if;

  if new.status = 'pending' and old.stage = 'first' and new.stage = 'final' then
    for r in select distinct u from unnest(public.leave_approvers('final', new.user_id)) u loop
      perform public.notify(r.u, 'leave_request', person || '''s leave is ready for your final OK',
        what || '. Checked by ' || actor || over, link, uid);
    end loop;
    perform public.notify(new.user_id, 'leave_update', actor || ' approved your leave',
      what || '. It''s now with ' || coalesce(public.actor_name(c.final_id), 'the final checker') || ' for the final OK.', link, uid);

  elsif new.status = 'approved' then
    perform public.notify(new.user_id, 'leave_approved', 'Your leave is approved',
      what || '. Approved by ' || actor || '.' || coalesce(' "' || new.decision_note || '"', ''), link, uid);
    if new.first_ok_by is not null and new.first_ok_by <> new.decided_by then
      perform public.notify(new.first_ok_by, 'leave_update', actor || ' gave the final OK on ' || person || '''s leave', what, link, uid);
    end if;

  elsif new.status = 'declined' then
    perform public.notify(new.user_id, 'leave_declined', actor || ' declined your leave request',
      what || coalesce('. "' || new.decision_note || '"', ''), link, uid);
    if new.first_ok_by is not null and new.first_ok_by <> uid then
      perform public.notify(new.first_ok_by, 'leave_update', actor || ' declined ' || person || '''s leave', what, link, uid);
    end if;

  elsif new.status = 'cancelled' then
    if uid is not distinct from new.user_id then
      for r in
        select distinct u from unnest(
          case when old.status = 'pending' then public.leave_approvers(old.stage, old.user_id) else '{}'::uuid[] end
          || array[old.first_ok_by, old.decided_by]) u
        where u is not null
      loop
        perform public.notify(r.u, 'leave_cancelled', person || ' cancelled their leave', what, link, uid);
      end loop;
    else
      perform public.notify(new.user_id, 'leave_cancelled', actor || ' cancelled your leave',
        what || coalesce('. "' || new.decision_note || '"', ''), link, uid);
    end if;
  end if;
  return new;
end $$;

/** One person's annual leave for a year: allowance, approved days taken, days waiting, days left. */
create or replace function public.leave_balance_of(p_user uuid, p_year integer)
returns table (user_id uuid, allowance integer, used integer, pending integer, remaining integer)
language sql
stable
security definer
set search_path = public
as $$
  with b as (select make_date(p_year, 1, 1) as y0, make_date(p_year, 12, 31) as y1),
  t as (
    select
      coalesce(sum(public.leave_working_days(greatest(r.start_date, b.y0), least(r.end_date, b.y1)))
               filter (where r.status = 'approved'), 0)::int as used,
      coalesce(sum(public.leave_working_days(greatest(r.start_date, b.y0), least(r.end_date, b.y1)))
               filter (where r.status = 'pending'), 0)::int as pending
    from b
    left join public.leave_requests r
      on r.user_id = p_user and r.kind = 'annual' and r.status in ('approved', 'pending')
     and r.start_date <= b.y1 and r.end_date >= b.y0
  )
  select p.id, p.annual_leave_days, t.used, t.pending, p.annual_leave_days - t.used
  from public.profiles p cross join t
  where p.id = p_user;
$$;

create or replace trigger leave_after after insert or update on public.leave_requests
  for each row execute function public.leave_after();

/** Annual leave balances for a year: your own, or everyone's for managers and seniors. */
create or replace function public.leave_balances(p_year integer default null)
returns table (user_id uuid, allowance integer, used integer, pending integer, remaining integer)
language sql
stable
security definer
set search_path = public
as $$
  select b.*
  from public.profiles p
  cross join lateral public.leave_balance_of(p.id, coalesce(p_year, extract(year from public.riyadh_today())::int)) b
  where p.active and not p.attendance_exempt
    and (p.id = auth.uid() or public.can_see_team_presence())
  order by p.full_name;
$$;

/** Who is on leave between two dates, for everyone in the team (the Calendar and the attendance
 *  board). Approved requests and Leave entries on the Calendar. The kind of leave only shows to the
 *  person and to managers and seniors; nobody else sees reasons or notes. */
create or replace function public.team_leave(p_from date, p_to date)
returns table (id uuid, user_id uuid, start_date date, end_date date, days integer, kind text, source text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  team boolean := public.can_see_team_presence();
begin
  if not public.is_member() then
    raise exception 'Sign in to see the team''s leave';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'Choose up to a year at a time';
  end if;
  return query
    select r.id, r.user_id, r.start_date, r.end_date, r.days,
           case when team or r.user_id = auth.uid() then r.kind end, 'request'::text
    from public.leave_requests r
    join public.profiles p on p.id = r.user_id and p.active
    where r.status = 'approved' and r.start_date <= p_to and r.end_date >= p_from
    union all
    select e.id, a.uid, e.event_date, e.event_date, 1, null::text, 'event'::text
    from public.events e cross join lateral unnest(e.attendees) a(uid)
    where e.kind = 'leave' and e.event_date between p_from and p_to
    order by 3, 2;
end $$;

-- Row access: your own requests; managers and seniors see everyone's. Everyone else sees who is
-- away through team_leave, without the reasons.
alter table public.leave_requests enable row level security;
create policy "see leave requests" on public.leave_requests
  for select to authenticated using (user_id = auth.uid() or public.can_assign());
create policy "ask for leave" on public.leave_requests
  for insert to authenticated with check (user_id = auth.uid() and public.is_member());
create policy "decide or cancel leave" on public.leave_requests
  for update to authenticated using (user_id = auth.uid() or public.can_assign());

alter publication supabase_realtime add table public.leave_requests;

-- Reminders: skip people on approved leave too (as well as Leave entries on the Calendar).
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
        and not public.on_leave(p.id, d)
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
        and not public.on_leave(p.id, d)
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

-- Presence (for managers who see present, absent or on leave only): approved leave counts too.
create or replace function public.team_presence(p_from date, p_to date)
returns table (user_id uuid, work_date date, present boolean, on_leave boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.can_see_team_presence() then
    raise exception 'Only managers and seniors can see the team''s attendance';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Choose up to two months at a time';
  end if;
  return query
    select p.id, d.day::date,
      exists (select 1 from public.attendance a where a.user_id = p.id and a.work_date = d.day::date),
      public.on_leave(p.id, d.day::date)
    from public.profiles p
    cross join generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as d(day)
    where p.active and not p.attendance_exempt
    order by 2, 1;
end $$;

-- Only managers change someone's annual leave allowance.
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
       or new.annual_leave_days is distinct from old.annual_leave_days then
      raise exception 'Only the manager can change roles, titles, access or leave allowances';
    end if;
  elsif old.role = 'manager' and (new.role <> 'manager' or not new.active)
        and (select count(*) from public.profiles where role = 'manager' and active) <= 1 then
    raise exception 'The team needs at least one active manager';
  end if;
  return new;
end $$;

revoke execute on function public.leave_guard() from public, anon, authenticated;
revoke execute on function public.leave_after() from public, anon, authenticated;
revoke execute on function public.leave_balance_of(uuid, integer) from public, anon, authenticated;
revoke execute on function public.leave_approvers(text, uuid) from public, anon;
revoke execute on function public.leave_first_stage(uuid) from public, anon;
revoke execute on function public.on_leave(uuid, date) from public, anon;
revoke execute on function public.leave_working_days(date, date) from public, anon;
revoke execute on function public.leave_balances(integer) from public, anon;
revoke execute on function public.team_leave(date, date) from public, anon;
grant execute on function public.leave_balances(integer) to authenticated;
grant execute on function public.team_leave(date, date) to authenticated;
grant execute on function public.leave_working_days(date, date) to authenticated;
