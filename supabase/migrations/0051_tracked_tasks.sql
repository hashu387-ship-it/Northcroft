-- Tracked tasks (the EI-116 ceiling, wall and wall finishes tasks first).
--   A tracked task splits the work between its people: each person has their own steps on the
--   task's checklist (one owner per step, which they name themselves). In their daily update each
--   person ticks the steps they finished and sends "3 of 5 done"; the task's % is everyone's steps.
--   Hassan and Fawaz get a push with each count. The 5 pm to 9 pm daily update reminders name the
--   tracked task, and the 8 am "due tomorrow" / "due today" pushes carry everyone's count.
--   A stopwatch on the task records each person's time on it: one running at a time per person,
--   stopped at check-out, when the task is handed in, and at 11:55 pm if it's still going.
--   The countdown in the app runs to the due date at the end of the working day (work_end).

alter table public.tasks add column if not exists tracked boolean not null default false;

alter table public.daily_update_items
  add column if not exists steps_done smallint,
  add column if not exists steps_total smallint,
  -- Their count at the end of the last day they sent one, so "up 2 today" reads right.
  add column if not exists steps_before smallint;

-- Only a manager or a senior turns tracking on or off.
create or replace function public.guard_tracked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.can_assign() then
    new.tracked := old.tracked;
  end if;
  return new;
end $$;
drop trigger if exists tasks_tracked_guard on public.tasks;
create trigger tasks_tracked_guard before update of tracked on public.tasks
  for each row execute function public.guard_tracked();

/* ---------------------------------------------------------------- steps and the task's % */

-- Everyone's steps on a tracked task: done / all, as a %.
create or replace function public.tracked_progress(p_task uuid)
returns smallint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(round(100.0 * count(*) filter (where c.done) / nullif(count(*), 0)), 0)::smallint
    from public.task_checklist c
   where c.task_id = p_task and c.removed_at is null and c.assignee_id is not null;
$$;

-- Ticking a step on a tracked task moves the task's % at once (handing in stays with the person).
create or replace function public.checklist_tracked_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tid uuid := coalesce(new.task_id, old.task_id);
  pct smallint;
begin
  if not exists (select 1 from public.tasks where id = tid and tracked and status in ('todo', 'in_progress')) then
    return null;
  end if;
  pct := public.tracked_progress(tid);
  update public.tasks
     set progress = pct,
         progress_at = now(),
         status = case when pct > 0 and status = 'todo' and hold is distinct from 'on' then 'in_progress' else status end
   where id = tid
     and (progress is distinct from pct or (pct > 0 and status = 'todo' and hold is distinct from 'on'));
  return null;
end $$;
drop trigger if exists checklist_tracked_sync on public.task_checklist;
create trigger checklist_tracked_sync after insert or update or delete on public.task_checklist
  for each row execute function public.checklist_tracked_sync();

-- "EI-116 Ceiling (3 of 5 done)" for each open tracked task this person has steps on.
create or replace function public.tracked_line(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select string_agg(t.title || ' (' || x.d || ' of ' || x.n || ' done)', ', ' order by t.due_date nulls last, t.title)
    from public.tasks t
    join lateral (
      select count(*) filter (where c.done) as d, count(*) as n
        from public.task_checklist c
       where c.task_id = t.id and c.assignee_id = p_user and c.removed_at is null
    ) x on x.n > 0
   where t.tracked and t.status in ('todo', 'in_progress') and p_user = any (t.assignees);
$$;

-- For the 8 am due pushes: "You: 3 of 5 done · Hameed: 2 of 5 · ends Thu 5:30 pm".
create or replace function public.tracked_note(p_task uuid, p_user uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t record;
  mine text;
  others text;
  ends text;
begin
  select id, tracked, due_date into t from public.tasks where id = p_task;
  if not found or not t.tracked then
    return null;
  end if;
  with s as (
    select c.assignee_id, count(*) filter (where c.done) as d, count(*) as n
      from public.task_checklist c
     where c.task_id = p_task and c.removed_at is null and c.assignee_id is not null
     group by c.assignee_id
  )
  select (select 'You: ' || s.d || ' of ' || s.n || ' done' from s where s.assignee_id = p_user),
         (select string_agg(p.short_name || ': ' || s.d || ' of ' || s.n, ', ' order by p.short_name)
            from s join public.profiles p on p.id = s.assignee_id where s.assignee_id <> p_user)
    into mine, others;
  if mine is null and others is null then
    return null;
  end if;
  if t.due_date is not null then
    select 'ends ' || to_char(t.due_date, 'Dy') || ' '
           || to_char(('2000-01-01'::date + coalesce(a.work_end, '17:30'::time)), 'FMHH12:MI') || ' '
           || lower(to_char(('2000-01-01'::date + coalesce(a.work_end, '17:30'::time)), 'AM'))
      into ends
      from (select 1) x left join public.app_settings a on a.id = 1;
  end if;
  return nullif(concat_ws(' · ', mine, others, ends), '');
end $$;

/* ---------------------------------------------------------------- the daily update */

-- Send (or resend) today's update. On a tracked task the line is the person's own steps (their %
-- and "3 of 5"); the task's % is everyone's steps, and 100% of everyone's hands it in for review.
create or replace function public.submit_daily_update(p_items jsonb, p_other text default null, p_blockers text default null)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid();
  today date := public.riyadh_today();
  upd uuid;
  it jsonb;
  t record;
  pct int;
  item_pct int;
  before_pct int;
  sd int;
  st int;
  prev_sd int;
  prev_pct int;
  note text;
  handed int := 0;
  n int := 0;
begin
  if uid is null or not public.is_member() then
    raise exception 'Please sign in again';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Something went wrong with the update. Try again.';
  end if;

  insert into public.daily_updates (user_id, work_date, other_work, blockers, submitted_at)
  values (uid, today, nullif(btrim(coalesce(p_other, '')), ''), nullif(btrim(coalesce(p_blockers, '')), ''), now())
  on conflict (user_id, work_date) do update
    set other_work = excluded.other_work, blockers = excluded.blockers, submitted_at = now(), updated_at = now(),
        -- A different blocker is a new one: it shows as blocking again. The same text stays sorted.
        blocker_cleared_by = case when daily_updates.blockers is distinct from excluded.blockers
                                  then null else daily_updates.blocker_cleared_by end,
        blocker_cleared_at = case when daily_updates.blockers is distinct from excluded.blockers
                                  then null else daily_updates.blocker_cleared_at end
  returning id into upd;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    select id, title, project_id, status, progress, assignees, tracked into t
      from public.tasks where id = (it->>'task_id')::uuid;
    if not found then
      continue;
    end if;
    if not (uid = any (t.assignees)) then
      raise exception 'You can only update tasks you''re on';
    end if;
    pct := greatest(0, least(100, coalesce((it->>'progress')::int, t.progress)));
    item_pct := pct;
    before_pct := t.progress;
    sd := null;
    st := null;
    prev_sd := null;
    note := nullif(btrim(coalesce(it->>'note', '')), '');

    -- A tracked task: their own steps for the line, everyone's for the task.
    if t.tracked then
      select count(*) filter (where c.done), count(*) into sd, st
        from public.task_checklist c
       where c.task_id = t.id and c.assignee_id = uid and c.removed_at is null;
      if st > 0 then
        item_pct := round(100.0 * sd / st);
        pct := public.tracked_progress(t.id);
        select i.steps_done, i.progress into prev_sd, prev_pct
          from public.daily_update_items i
          join public.daily_updates u on u.id = i.update_id
         where i.task_id = t.id and u.user_id = uid and u.work_date < today and i.steps_total is not null
         order by u.work_date desc
         limit 1;
        before_pct := coalesce(prev_pct, 0);
        prev_sd := coalesce(prev_sd, 0);
      else
        sd := null;
        st := null;
      end if;
    end if;

    insert into public.daily_update_items (update_id, task_id, task_title, project_id, progress_before, progress, note,
                                           steps_done, steps_total, steps_before)
    values (upd, t.id, t.title, t.project_id, before_pct, item_pct, note, sd, st, prev_sd)
    on conflict (update_id, task_id) do update
      set progress = excluded.progress, note = excluded.note, task_title = excluded.task_title, updated_at = now(),
          steps_done = excluded.steps_done, steps_total = excluded.steps_total,
          -- Their own change to the % or note takes over from a manager's change.
          edited_by = case when (daily_update_items.progress, daily_update_items.note) is distinct from (excluded.progress, excluded.note)
                           then null else daily_update_items.edited_by end,
          edited_at = case when (daily_update_items.progress, daily_update_items.note) is distinct from (excluded.progress, excluded.note)
                           then null else daily_update_items.edited_at end;
    n := n + 1;

    -- The task keeps its latest %; work started moves it on; 100% hands it in for review.
    if t.status in ('todo', 'in_progress') then
      update public.tasks
         set progress = pct,
             progress_at = now(),
             status = case when pct = 100 then 'in_review'
                           when pct > 0 and t.status = 'todo' then 'in_progress'
                           else t.status end
       where id = t.id;
      if pct = 100 then
        update public.daily_update_items set handed_in = true where update_id = upd and task_id = t.id;
        handed := handed + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('update_id', upd, 'tasks', n, 'handed_in', handed);
end $function$;
revoke all on function public.submit_daily_update(jsonb, text, text) from public, anon;
grant execute on function public.submit_daily_update(jsonb, text, text) to authenticated;

-- Hassan and Fawaz hear each new count: "Rimash: EI-116 Ceiling, 3 of 5 done".
-- Sending the same count again the same day sends nothing new.
create or replace function public.daily_item_steps_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who uuid;
  wname text;
  t record;
  up int;
  m uuid;
begin
  if new.steps_total is null or new.steps_total = 0 then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.steps_done is not distinct from old.steps_done then
    return null;
  end if;
  select user_id into who from public.daily_updates where id = new.update_id;
  select short_name into wname from public.profiles where id = who;
  select title, project_id, due_date, progress into t from public.tasks where id = new.task_id;
  up := coalesce(new.steps_done, 0) - coalesce(new.steps_before, 0);
  for m in select id from public.profiles where active and role = 'manager' loop
    perform public.notify(m, 'task_updated',
      coalesce(wname, 'Someone') || ': ' || coalesce(t.title, new.task_title) || ', ' || new.steps_done || ' of ' || new.steps_total || ' done',
      concat_ws(' · ',
        case when up > 0 then 'Up ' || up || ' today' when up < 0 then 'Down ' || (-up) || ' today' else 'No change today' end,
        'Task ' || coalesce(t.progress, 0) || '% overall',
        case when t.due_date is not null then 'Due ' || to_char(t.due_date, 'Dy DD Mon') end,
        new.note),
      '/tasks/' || new.task_id, who, new.task_id, t.project_id);
  end loop;
  return null;
end $$;
drop trigger if exists daily_item_steps_after on public.daily_update_items;
create trigger daily_item_steps_after after insert or update of steps_done on public.daily_update_items
  for each row execute function public.daily_item_steps_after();

/* ---------------------------------------------------------------- reminders */

-- The 5 pm to 9 pm daily update reminders, now naming a tracked task and its count.
create or replace function public.daily_update_nudge(p_at timestamptz)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  v_steps text;
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
      v_steps := public.tracked_line(r.id);
      if slot_m = 17 * 60 then
        v_title := 'Time for your daily update';
        v_body := case when v_steps is not null
          then r.short_name || ', tick the steps you finished on ' || v_steps || ' and send your update before you check out.'
          else 'How far did your tasks get today, ' || r.short_name || '? Tap to send your update before you check out.' end;
      elsif slot_m = 21 * 60 then
        v_title := 'Last reminder today: your daily update';
        v_body := case when v_steps is not null
          then r.short_name || ', update ' || v_steps || ' now. It only takes a minute.'
          else r.short_name || ', it only takes a minute. Tap to send it now.' end;
      else
        v_title := 'Still waiting for your daily update';
        v_body := case when v_steps is not null
          then r.short_name || ', ' || v_steps || ' still needs today''s count. Tap to send it. You''ll get a reminder every 30 minutes until it''s in.'
          else r.short_name || ', tap to send it. You''ll get a reminder every 30 minutes until it''s in.' end;
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
end $function$;

-- The 8 am reminders, unchanged except that a tracked task's "due tomorrow" and "due today" pushes
-- carry everyone's count and the deadline time.
create or replace function public.daily_reminders()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  today date := public.riyadh_today();
  nextday date;
  r record;
  p record;
begin
  if not public.is_workday(today) then
    return;
  end if;
  nextday := public.next_workday(today + 1);

  for r in
    select t.*, u.uid, pr.name as pname
    from public.tasks t cross join lateral unnest(t.assignees) as u(uid)
    left join public.projects pr on pr.id = t.project_id
    where t.status in ('todo', 'in_progress') and t.due_date = today and t.approval is null and t.hold is distinct from 'on'
  loop
    perform public.notify(r.uid, 'due_today', 'Due today: ' || r.title,
      concat_ws(' · ', r.pname, public.tracked_note(r.id, r.uid)), '/tasks/' || r.id, null, r.id, r.project_id);
  end loop;

  for r in
    select t.*, u.uid, pr.name as pname
    from public.tasks t cross join lateral unnest(t.assignees) as u(uid)
    left join public.projects pr on pr.id = t.project_id
    where t.status in ('todo', 'in_progress') and t.due_date > today and t.due_date <= nextday and t.approval is null and t.hold is distinct from 'on'
  loop
    perform public.notify(r.uid, 'due_soon',
      'Due ' || case when r.due_date = today + 1 then 'tomorrow' else trim(to_char(r.due_date, 'Day')) end || ': ' || r.title,
      concat_ws(' · ', r.pname, public.tracked_note(r.id, r.uid)), '/tasks/' || r.id, null, r.id, r.project_id);
  end loop;

  for r in
    select u.uid, count(*) as n, string_agg(t.title, ', ' order by t.due_date) as titles
    from public.tasks t cross join lateral unnest(t.assignees) as u(uid)
    where t.status in ('todo', 'in_progress') and t.due_date < today and t.approval is null and t.hold is distinct from 'on'
    group by u.uid
  loop
    perform public.notify(r.uid, 'overdue',
      case when r.n = 1 then '1 task is overdue' else r.n || ' tasks are overdue' end,
      left(r.titles, 300), '/my-tasks', null);
  end loop;

  for r in
    select coalesce(case t.review_stage when 'first' then c.first_id when 'final' then c.final_id end,
                    t.reviewer_id, t.created_by) as uid,
           count(*) as n
    from public.tasks t cross join public.signoff_checkers() c
    where t.status = 'in_review'
    group by 1
  loop
    perform public.notify(r.uid, 'review_digest',
      r.n || case when r.n = 1 then ' task is' else ' tasks are' end || ' waiting for your review',
      null, '/my-tasks?view=review', null);
  end loop;

  -- Team members' tasks and hold asks still waiting for the approver's OK.
  for r in
    select u.uid, count(*) as n
    from public.tasks t cross join lateral unnest(public.task_approver_ids()) as u(uid)
    where t.approval = 'pending' or t.hold = 'asked'
    group by u.uid
  loop
    perform public.notify(r.uid, 'task_request',
      r.n || case when r.n = 1 then ' task is' else ' tasks are' end || ' waiting for your OK',
      null, '/my-tasks?view=approve', null);
  end loop;

  for r in
    select v.*, u.uid, pr.name as pname
    from public.variations v cross join lateral unnest(v.owners) as u(uid)
    join public.projects pr on pr.id = v.project_id
    where v.response_due <= today
      and v.status in ('identified', 'requested', 'quoted', 'evaluation', 'recommended', 'disputed')
  loop
    perform public.notify(r.uid, 'vo_due',
      r.vo_number || case when r.response_due = today then ' action due today' else ' action is overdue' end,
      r.title || ' · ' || r.pname, '/projects/' || r.project_id || '/variations?vo=' || r.id, null, null, r.project_id);
  end loop;

  for r in
    select b.*, u.uid, pr.name as pname
    from public.boq_packages b cross join lateral unnest(b.owners) as u(uid)
    join public.projects pr on pr.id = b.project_id
    where b.due_date <= today and b.status <> 'issued'
  loop
    perform public.notify(r.uid, 'boq_due',
      r.name || ' BOQ ' || case when r.due_date = today then 'due today' else 'is overdue' end,
      r.pname, '/projects/' || r.project_id || '/boq', null, null, r.project_id);
  end loop;

  for r in select * from public.events where event_date = today loop
    for p in select unnest(r.attendees) as uid loop
      perform public.notify(p.uid, 'event_today',
        'Today: ' || r.title || coalesce(' at ' || to_char(r.start_time, 'HH24:MI'), ''),
        r.location, '/calendar?date=' || r.event_date, null, null, r.project_id);
    end loop;
  end loop;

  for r in
    select * from public.announcements
    where requires_ack and nudged_at is null
      and created_at < now() - interval '12 hours' and created_at > now() - interval '14 days'
  loop
    perform public.nudge_announcement(r.id);
  end loop;
end $function$;

/* ---------------------------------------------------------------- the stopwatch */

create table if not exists public.task_time_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  stopped_at timestamptz,
  -- Stopped by the app (check-out, handed in, or end of day), not by the person.
  auto_stopped boolean not null default false,
  created_at timestamptz not null default now(),
  check (stopped_at is null or stopped_at >= started_at)
);
-- One stopwatch running at a time per person.
create unique index if not exists task_time_logs_one_running on public.task_time_logs (user_id) where stopped_at is null;
create index if not exists task_time_logs_task_idx on public.task_time_logs (task_id, user_id, started_at);

alter table public.task_time_logs enable row level security;
drop policy if exists "time logs readable" on public.task_time_logs;
create policy "time logs readable" on public.task_time_logs for select to authenticated using (public.is_member());
grant select on public.task_time_logs to authenticated;

-- Start my stopwatch on a tracked task I'm on (stopping any other one I have running).
create or replace function public.stopwatch_start(p_task uuid)
returns public.task_time_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  t record;
  row public.task_time_logs;
begin
  if uid is null or not public.is_member() then
    raise exception 'Please sign in again';
  end if;
  select id, assignees, tracked, status into t from public.tasks where id = p_task;
  if not found or not (uid = any (t.assignees)) then
    raise exception 'You can only time tasks you''re on';
  end if;
  if not t.tracked then
    raise exception 'This task has no stopwatch';
  end if;
  if t.status not in ('todo', 'in_progress') then
    raise exception 'This task has been handed in';
  end if;
  update public.task_time_logs set stopped_at = now() where user_id = uid and stopped_at is null;
  insert into public.task_time_logs (task_id, user_id) values (p_task, uid) returning * into row;
  return row;
end $$;

-- Stop my stopwatch. Returns how many seconds that stretch ran (0 if nothing was running).
create or replace function public.stopwatch_stop()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  secs int := 0;
begin
  if uid is null or not public.is_member() then
    raise exception 'Please sign in again';
  end if;
  update public.task_time_logs
     set stopped_at = now()
   where user_id = uid and stopped_at is null
  returning extract(epoch from (stopped_at - started_at))::int into secs;
  return coalesce(secs, 0);
end $$;
revoke all on function public.stopwatch_start(uuid) from public, anon;
revoke all on function public.stopwatch_stop() from public, anon;
grant execute on function public.stopwatch_start(uuid) to authenticated;
grant execute on function public.stopwatch_stop() to authenticated;

-- Checking out stops the stopwatch at the check-out time.
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
     where user_id = new.user_id and stopped_at is null;
  end if;
  return null;
end $$;
drop trigger if exists attendance_stop_stopwatch on public.attendance;
create trigger attendance_stop_stopwatch after update of check_out_at on public.attendance
  for each row execute function public.attendance_stop_stopwatch();

-- Handing the task in (or closing it) stops everyone's stopwatch on it.
create or replace function public.task_stop_stopwatch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status not in ('todo', 'in_progress') and old.status in ('todo', 'in_progress') then
    update public.task_time_logs set stopped_at = now(), auto_stopped = true
     where task_id = new.id and stopped_at is null;
  end if;
  return null;
end $$;
drop trigger if exists tasks_stop_stopwatch on public.tasks;
create trigger tasks_stop_stopwatch after update of status on public.tasks
  for each row execute function public.task_stop_stopwatch();

-- 11:55 pm: anything still running stops.
create or replace function public.stopwatch_close_day()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update public.task_time_logs set stopped_at = now(), auto_stopped = true where stopped_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.stopwatch_close_day() from public, anon, authenticated;
revoke all on function public.daily_item_steps_after() from public, anon, authenticated;
revoke all on function public.checklist_tracked_sync() from public, anon, authenticated;
revoke all on function public.attendance_stop_stopwatch() from public, anon, authenticated;
revoke all on function public.task_stop_stopwatch() from public, anon, authenticated;
revoke all on function public.guard_tracked() from public, anon, authenticated;

-- 20:55 UTC = 11:55 pm Riyadh.
select cron.schedule('northcroft-stopwatch-close', '55 20 * * *', $c$select public.stopwatch_close_day()$c$);

/* ---------------------------------------------------------------- live updates */
do $m$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_time_logs') then
    alter publication supabase_realtime add table public.task_time_logs;
  end if;
end $m$;
