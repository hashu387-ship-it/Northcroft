-- Missed check-in requests, and announcements seen.
--
-- Someone who forgot to check in or out asks for that day to be recorded: the day, the check-in
-- time, the check-out time (either or both) and a reason. The request goes to the first checker
-- (Hassan); his own go to the final checker (Fawaz); with neither, any manager answers. Approving
-- it writes the times into attendance (labelled "Approved by ..."), with late and early minutes
-- worked out the same way as a normal check-in. Declining it changes nothing.
--
-- Each person can have 3 days recorded this way a month (by the month of the day being fixed).
-- Only approved requests count, so a declined one gives the slot back; a request can't be sent
-- while approved plus waiting ones already make 3. Requests go back up to 7 days.
--
-- The approver gets a push for each new request and the person gets one with the answer. The app
-- shows both as a popup when it opens; seen_at records that the person has seen the answer.
--
-- announcement_views records that someone has seen an announcement in the popup, so one that
-- doesn't need acknowledging pops up once only.

create table if not exists public.checkin_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  work_date date not null,
  in_at timestamptz,
  out_at timestamptz,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'cancelled')),
  -- Who answers it (null: any manager).
  approver_id uuid references public.profiles (id) on delete set null,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (char_length(decision_note) <= 500),
  -- When the person saw the answer (the popup).
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint checkin_request_times check (in_at is not null or out_at is not null),
  constraint checkin_request_order check (in_at is null or out_at is null or out_at > in_at)
);
create index if not exists checkin_requests_user on public.checkin_requests (user_id, work_date desc);
create index if not exists checkin_requests_pending on public.checkin_requests (approver_id) where status = 'pending';
create unique index if not exists checkin_requests_one_pending on public.checkin_requests (user_id, work_date) where status = 'pending';

alter table public.checkin_requests enable row level security;
drop policy if exists "checkin requests readable" on public.checkin_requests;
create policy "checkin requests readable" on public.checkin_requests for select to authenticated
  using (user_id = auth.uid() or approver_id = auth.uid() or public.can_assign() or public.is_manager());
-- Every change goes through the functions below.

/** Who answers this person's requests: the first checker, the final checker for the first
 *  checker's own, or null (any manager). */
create or replace function public.checkin_request_approver(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when c.first_id is not null and c.first_id <> p_user then c.first_id
    when c.final_id is not null and c.final_id <> p_user then c.final_id
    else null
  end
  from public.signoff_checkers() c;
$$;

/** Requests approved for the month a day falls in. */
create or replace function public.checkin_requests_approved(p_user uuid, p_day date)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.checkin_requests r
  where r.user_id = p_user and r.status = 'approved'
    and date_trunc('month', r.work_date) = date_trunc('month', p_day);
$$;

/** "8:20 am" in the office time zone. */
create or replace function public.checkin_clock(p_at timestamptz)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(to_char(p_at at time zone (select timezone from public.app_settings where id = 1), 'FMHH12:MI am'));
$$;

/** "In 8:20 am, out 5:35 pm" for a request. */
create or replace function public.checkin_request_times(r public.checkin_requests)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select concat_ws(', ',
    case when r.in_at is not null then 'in ' || public.checkin_clock(r.in_at) end,
    case when r.out_at is not null then 'out ' || public.checkin_clock(r.out_at) end);
$$;

/** Ask for a missed check-in or check-out to be recorded. Times are local (office time zone). */
create or replace function public.request_checkin_fix(p_date date, p_in time, p_out time, p_reason text)
returns public.checkin_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.app_settings;
  me public.profiles;
  today date;
  v_in timestamptz;
  v_out timestamptz;
  a public.attendance;
  approved int;
  waiting int;
  rec public.checkin_requests;
  approver uuid;
  who text;
  what text;
  m record;
begin
  if auth.uid() is null or not public.is_member() then
    raise exception 'Not signed in';
  end if;
  select * into me from public.profiles where id = auth.uid();
  if me.attendance_exempt then
    raise exception 'You don''t check in, so there''s nothing to fix.';
  end if;
  select * into s from public.app_settings where id = 1;
  today := (now() at time zone s.timezone)::date;

  if p_date is null then
    raise exception 'Pick the day you forgot.';
  end if;
  if p_date > today then
    raise exception 'You can only ask about today or an earlier day.';
  end if;
  if p_date < today - 7 then
    raise exception 'You can only ask about the last 7 days.';
  end if;
  if p_in is null and p_out is null then
    raise exception 'Add the time you came in, the time you left, or both.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Add a short reason, like "Phone battery died".';
  end if;
  if public.on_leave(auth.uid(), p_date) then
    raise exception 'You''re on leave that day.';
  end if;

  v_in := case when p_in is not null then (p_date + p_in) at time zone s.timezone end;
  v_out := case when p_out is not null then (p_date + p_out) at time zone s.timezone end;
  if (v_in is not null and v_in > now()) or (v_out is not null and v_out > now()) then
    raise exception 'That time hasn''t happened yet.';
  end if;

  select * into a from public.attendance where user_id = auth.uid() and work_date = p_date;
  if v_out is not null and v_out <= coalesce(v_in, a.check_in_at, v_out - interval '1 second') then
    raise exception 'The time you left has to be after the time you came in%.',
      case when v_in is null and a.check_in_at is not null then ' (' || public.checkin_clock(a.check_in_at) || ')' else '' end;
  end if;
  if v_in is null and a.id is null then
    raise exception 'There''s no check-in that day, so add the time you came in too.';
  end if;
  if v_in is not null and v_out is null and a.check_out_at is not null and a.check_out_at <= v_in then
    raise exception 'You checked out at % that day, so you came in before then.', public.checkin_clock(a.check_out_at);
  end if;

  if exists (select 1 from public.checkin_requests r where r.user_id = auth.uid() and r.work_date = p_date and r.status = 'pending') then
    raise exception 'You''ve already asked about that day. It''s waiting for an answer.';
  end if;

  approved := public.checkin_requests_approved(auth.uid(), p_date);
  select count(*)::int into waiting from public.checkin_requests r
    where r.user_id = auth.uid() and r.status = 'pending' and date_trunc('month', r.work_date) = date_trunc('month', p_date);
  if approved >= 3 then
    raise exception 'You''ve had 3 days recorded this way in %, which is the most for a month.', to_char(p_date, 'FMMonth');
  end if;
  if approved + waiting >= 3 then
    raise exception 'You already have % waiting for an answer, and only 3 can be recorded in %.',
      case when waiting = 1 then '1 request' else waiting || ' requests' end, to_char(p_date, 'FMMonth');
  end if;

  approver := public.checkin_request_approver(auth.uid());
  insert into public.checkin_requests (user_id, work_date, in_at, out_at, reason, approver_id)
  values (auth.uid(), p_date, v_in, v_out, btrim(p_reason), approver)
  returning * into rec;

  who := public.actor_name(auth.uid());
  what := case when v_in is not null and v_out is not null then 'to check in and out'
               when v_in is not null then 'to check in' else 'to check out' end;
  for m in
    select p.id from public.profiles p
    where p.active and p.id <> auth.uid()
      and (p.id = approver or (approver is null and p.role = 'manager'))
  loop
    perform public.notify(m.id, 'checkin_request',
      who || ' forgot ' || what,
      to_char(p_date, 'Dy FMDD Mon') || ': ' || public.checkin_request_times(rec) || '. ' || left(btrim(p_reason), 160),
      '/attendance?fix=' || rec.id, auth.uid());
  end loop;
  return rec;
end $$;

/** Approve (records the times) or decline a request. */
create or replace function public.decide_checkin_fix(p_id uuid, p_approve boolean, p_note text default null)
returns public.checkin_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.app_settings;
  r public.checkin_requests;
  a public.attendance;
  me_name text;
  label text;
  lt time;
  left_n int;
begin
  if auth.uid() is null or not public.is_member() then
    raise exception 'Not signed in';
  end if;
  select * into r from public.checkin_requests where id = p_id for update;
  if r.id is null then
    raise exception 'That request has been removed.';
  end if;
  if r.status <> 'pending' then
    raise exception 'That request has already been answered.';
  end if;
  if r.user_id = auth.uid() then
    raise exception 'Someone else has to answer your own request.';
  end if;
  if not (auth.uid() = r.approver_id or public.is_manager()) then
    raise exception 'Only % can answer this request.', coalesce(public.actor_name(r.approver_id), 'a manager');
  end if;

  select * into s from public.app_settings where id = 1;
  me_name := public.actor_name(auth.uid());

  if p_approve then
    if public.checkin_requests_approved(r.user_id, r.work_date) >= 3 then
      raise exception '% has already had 3 days recorded this way in %.', public.actor_name(r.user_id), to_char(r.work_date, 'FMMonth');
    end if;
    label := 'Approved by ' || split_part(me_name, ' ', 1);
    select * into a from public.attendance where user_id = r.user_id and work_date = r.work_date for update;

    if a.id is null then
      if r.in_at is null then
        raise exception 'There''s no check-in that day to add a check-out to.';
      end if;
      lt := (r.in_at at time zone s.timezone)::time;
      insert into public.attendance (user_id, work_date, check_in_at, in_place_name, in_place_kind, late_minutes,
                                     check_out_at, out_place_name, out_place_kind, early_minutes, note)
      values (r.user_id, r.work_date, r.in_at, label, 'approved',
        case when public.is_workday(r.work_date) and lt > s.work_start + make_interval(mins => s.grace_minutes)
             then floor(extract(epoch from (lt - s.work_start)) / 60)::int else 0 end,
        r.out_at,
        case when r.out_at is not null then label end,
        case when r.out_at is not null then 'approved' end,
        case when r.out_at is not null and public.is_workday(r.work_date)
                  and (r.out_at at time zone s.timezone)::time < s.work_end - make_interval(mins => s.grace_minutes)
             then floor(extract(epoch from (s.work_end - (r.out_at at time zone s.timezone)::time)) / 60)::int else 0 end,
        left('Recorded from a missed check-in request: ' || r.reason, 500));
    else
      if coalesce(r.out_at, a.check_out_at) is not null and coalesce(r.out_at, a.check_out_at) <= coalesce(r.in_at, a.check_in_at) then
        raise exception 'The check-out would be before the check-in that day.';
      end if;
      if r.in_at is not null then
        lt := (r.in_at at time zone s.timezone)::time;
        update public.attendance set
          check_in_at = r.in_at,
          in_lat = null, in_lng = null, in_accuracy = null, in_address = null, in_place_id = null,
          in_place_name = label, in_place_kind = 'approved',
          late_minutes = case when public.is_workday(r.work_date) and lt > s.work_start + make_interval(mins => s.grace_minutes)
                              then floor(extract(epoch from (lt - s.work_start)) / 60)::int else 0 end
        where id = a.id;
      end if;
      if r.out_at is not null then
        lt := (r.out_at at time zone s.timezone)::time;
        update public.attendance set
          check_out_at = r.out_at,
          out_lat = null, out_lng = null, out_accuracy = null, out_address = null, out_place_id = null,
          out_place_name = label, out_place_kind = 'approved',
          early_minutes = case when public.is_workday(r.work_date) and lt < s.work_end - make_interval(mins => s.grace_minutes)
                               then floor(extract(epoch from (s.work_end - lt)) / 60)::int else 0 end
        where id = a.id;
      end if;
    end if;
  end if;

  update public.checkin_requests set
    status = case when p_approve then 'approved' else 'declined' end,
    decided_by = auth.uid(), decided_at = now(),
    decision_note = nullif(left(btrim(coalesce(p_note, '')), 500), ''),
    updated_at = now()
  where id = r.id
  returning * into r;

  left_n := greatest(0, 3 - public.checkin_requests_approved(r.user_id, r.work_date));
  perform public.notify(r.user_id, 'checkin_answer',
    split_part(me_name, ' ', 1) || case when p_approve then ' approved' else ' declined' end || ' your request for ' || to_char(r.work_date, 'Dy FMDD Mon'),
    case when p_approve then 'Recorded: ' || public.checkin_request_times(r) || '. '
         else coalesce(r.decision_note || '. ', 'Nothing was changed. ') end
      || left_n || ' of 3 left for ' || to_char(r.work_date, 'FMMonth') || '.',
    '/attendance?fix=' || r.id, auth.uid());
  -- Clear the approver's own push about it.
  update public.notifications set read_at = now()
   where type = 'checkin_request' and link = '/attendance?fix=' || r.id and read_at is null;
  return r;
end $$;

/** The person takes back a request that's still waiting. */
create or replace function public.cancel_checkin_fix(p_id uuid)
returns public.checkin_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.checkin_requests;
begin
  update public.checkin_requests set status = 'cancelled', updated_at = now(), seen_at = now()
   where id = p_id and user_id = auth.uid() and status = 'pending'
  returning * into r;
  if r.id is null then
    raise exception 'That request has already been answered.';
  end if;
  update public.notifications set read_at = now()
   where type = 'checkin_request' and link = '/attendance?fix=' || r.id and read_at is null;
  return r;
end $$;

/** The person has seen these answers (the popup). */
create or replace function public.checkin_fix_seen(p_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update public.checkin_requests set seen_at = now()
   where id = any (p_ids) and user_id = auth.uid() and seen_at is null and status in ('approved', 'declined');
$$;

revoke all on function public.checkin_request_approver(uuid) from public, anon, authenticated;
revoke all on function public.checkin_requests_approved(uuid, date) from public, anon, authenticated;
revoke all on function public.checkin_clock(timestamptz) from public, anon, authenticated;
revoke all on function public.checkin_request_times(public.checkin_requests) from public, anon, authenticated;
revoke all on function public.request_checkin_fix(date, time, time, text) from public, anon;
revoke all on function public.decide_checkin_fix(uuid, boolean, text) from public, anon;
revoke all on function public.cancel_checkin_fix(uuid) from public, anon;
revoke all on function public.checkin_fix_seen(uuid[]) from public, anon;
grant execute on function public.request_checkin_fix(date, time, time, text) to authenticated;
grant execute on function public.decide_checkin_fix(uuid, boolean, text) to authenticated;
grant execute on function public.cancel_checkin_fix(uuid) to authenticated;
grant execute on function public.checkin_fix_seen(uuid[]) to authenticated;

-- A check-out recorded for an earlier day must not stop a stopwatch running today: only stretches
-- that started before the check-out stop.
create or replace function public.attendance_stop_stopwatch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.check_out_at is not null and old.check_out_at is null then
    update public.task_time_logs
       set stopped_at = greatest(started_at, new.check_out_at), auto_stopped = true
     where user_id = new.user_id and stopped_at is null and started_at < new.check_out_at;
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Announcements seen in the popup
-- ---------------------------------------------------------------------------
create table if not exists public.announcement_views (
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);
alter table public.announcement_views enable row level security;
drop policy if exists "own announcement views" on public.announcement_views;
create policy "own announcement views" on public.announcement_views for select to authenticated using (user_id = auth.uid());
drop policy if exists "mark announcement seen" on public.announcement_views;
create policy "mark announcement seen" on public.announcement_views for insert to authenticated
  with check (user_id = auth.uid() and public.is_member());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'checkin_requests') then
    alter publication supabase_realtime add table public.checkin_requests;
  end if;
end $$;
