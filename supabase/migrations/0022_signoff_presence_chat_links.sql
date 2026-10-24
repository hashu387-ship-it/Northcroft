-- Two-step sign-off, presence-only attendance, and Drive links in messages.
--
-- 1. Task sign-off in two steps. app_settings.first_checker_id (Hassan) checks handed-in work
--    first; app_settings.final_checker_id (Fawaz) then gives the final OK, and only then is the
--    task done. While a task is in review, tasks.review_stage says whose turn it is:
--      first   waiting for the first checker
--      final   waiting for the final checker (first_ok_by and first_ok_at say who checked it)
--      null    a single reviewer, as before (no final checker set, or both checkers on the task)
--    The first checker's own tasks go straight to the final OK. The final checker's own tasks
--    finish at the first checker's OK. Approve and Mark done both go through this, so a task
--    can't skip a step.
-- 2. profiles.attendance_times: false for someone who sees who is present, absent or on leave,
--    but not check-in or check-out times or places (Fawaz). team_presence() gives them that.
-- 3. Drive links in messages: drive_links.comment_id. A link in a message is seen by exactly
--    the people who can see the message, so links in a private chat stay in that chat.

alter table public.app_settings
  add column if not exists first_checker_id uuid references public.profiles(id),
  add column if not exists final_checker_id uuid references public.profiles(id);

alter table public.tasks
  add column if not exists review_stage text check (review_stage in ('first', 'final')),
  add column if not exists first_ok_by uuid references public.profiles(id),
  add column if not exists first_ok_at timestamptz;

alter table public.profiles
  add column if not exists attendance_times boolean not null default true;

-- ---------------------------------------------------------------------------
-- Sign-off helpers
-- ---------------------------------------------------------------------------
-- The two checkers, if they still have access.
create or replace function public.signoff_checkers(out first_id uuid, out final_id uuid)
language sql stable security definer set search_path = public as $$
  select (select p.id from public.profiles p where p.id = s.first_checker_id and p.active),
         (select p.id from public.profiles p where p.id = s.final_checker_id and p.active)
  from public.app_settings s where s.id = 1;
$$;

-- Whose turn it is when a task with these people on it is handed in.
create or replace function public.review_stage_for(p_people uuid[], p_first uuid, p_final uuid) returns text
language sql immutable set search_path = public as $$
  select case
    when p_final is null then null
    when p_first is not null and p_first <> p_final and not (p_first = any (coalesce(p_people, '{}'))) then 'first'
    when not (p_final = any (coalesce(p_people, '{}'))) then 'final'
    else null
  end;
$$;

revoke execute on function public.signoff_checkers() from public, anon, authenticated;
revoke execute on function public.review_stage_for(uuid[], uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Who can change a task, now with the two-step sign-off
-- ---------------------------------------------------------------------------
create or replace function public.guard_task() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  assigner boolean;
  c record;
  who text;
  -- True when this approval moved the task on to the final checker.
  passed_on boolean := false;
begin
  select * into c from public.signoff_checkers();

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, uid);
    new.reviewer_id := coalesce(new.reviewer_id, new.created_by);
    new.review_stage := null;
    new.first_ok_by := null;
    new.first_ok_at := null;
    if new.status = 'in_review' then
      new.submitted_at := now();
      new.review_stage := public.review_stage_for(new.assignees, c.first_id, c.final_id);
    end if;
    if new.status = 'done' then new.completed_at := now(); new.approved_by := coalesce(uid, new.created_by); end if;
    return new;
  end if;

  new.updated_at := now();
  if uid is not null then
    -- Only this trigger moves a task through the sign-off.
    new.review_stage := old.review_stage;
    new.first_ok_by := old.first_ok_by;
    new.first_ok_at := old.first_ok_at;

    assigner := public.can_assign();
    if not assigner then
      if not (uid = any (old.assignees)) then
        raise exception 'You can only update tasks you''re on';
      end if;
      if (new.assignees, new.reviewer_id, new.created_by, new.recurring_id)
         is distinct from (old.assignees, old.reviewer_id, old.created_by, old.recurring_id) then
        raise exception 'Only a manager or a senior can change who''s on a task';
      end if;
      if new.status = 'done' and old.status <> 'done' then
        raise exception 'Submit the task for review instead of closing it';
      end if;
      if old.status = 'done' and new.status <> 'done' then
        raise exception 'Only a reviewer can reopen a finished task';
      end if;
    end if;

    -- Two steps: the first checker, then the final checker.
    if c.final_id is not null and new.status = 'done' and old.status <> 'done' then
      if old.status = 'in_review' and old.review_stage = 'first' then
        if uid is distinct from c.first_id then
          select short_name into who from public.profiles where id = c.first_id;
          raise exception '% checks this first. It comes to you after that.', coalesce(who, 'The first checker');
        end if;
        if not (c.final_id = any (new.assignees)) then
          passed_on := true;
        end if;
      elsif old.status = 'in_review' and old.review_stage = 'final' then
        if uid is distinct from c.final_id then
          select short_name into who from public.profiles where id = c.final_id;
          raise exception '% gives the final OK on this one.', coalesce(who, 'The final checker');
        end if;
      elsif uid is distinct from c.final_id and not (c.final_id = any (new.assignees)) then
        -- Approved or marked done by anyone else: it goes on to the final checker.
        passed_on := true;
      end if;
      if passed_on then
        new.status := 'in_review';
        new.review_stage := 'final';
        new.first_ok_by := uid;
        new.first_ok_at := now();
      end if;
    end if;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'in_review' then
      new.submitted_at := now();
      new.changes_note := null;
      if not passed_on then
        -- Handed in: whose turn is it?
        new.review_stage := public.review_stage_for(new.assignees, c.first_id, c.final_id);
        new.first_ok_by := null;
        new.first_ok_at := null;
        -- The first checker handing in their own task has checked it already.
        if new.review_stage = 'final' and c.first_id is not null and c.first_id = any (new.assignees) then
          new.first_ok_by := c.first_id;
          new.first_ok_at := now();
        end if;
      end if;
    end if;
    if new.status = 'done' then
      new.completed_at := now();
      new.approved_by := coalesce(uid, new.approved_by);
      new.review_stage := null;
    end if;
    if new.status not in ('in_review', 'done') then
      new.review_stage := null;
      new.first_ok_by := null;
      new.first_ok_at := null;
    end if;
    if old.status = 'done' and new.status <> 'done' then
      new.completed_at := null;
      new.approved_by := null;
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Task notifications, now telling the right checker
-- ---------------------------------------------------------------------------
create or replace function public.task_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := coalesce(auth.uid(), new.created_by);
  aname text := coalesce(public.actor_name(actor), 'Northcroft');
  pname text;
  link text := '/tasks/' || new.id;
  due_txt text := case when new.due_date is null then null else 'Due ' || to_char(new.due_date, 'Dy DD Mon') end;
  added uuid[] := '{}';
  removed uuid[] := '{}';
  u uuid;
  c record;
  target uuid;
  fname text;
begin
  select name into pname from public.projects where id = new.project_id;

  if tg_op = 'INSERT' then
    insert into public.activity (project_id, task_id, entity, entity_id, actor_id, action, details)
    values (new.project_id, new.id, 'task', new.id, actor, 'created',
            jsonb_build_object('title', new.title, 'assignee_id', new.assignee_id, 'assignees', new.assignees, 'due_date', new.due_date));
    insert into public.task_watchers (task_id, user_id)
      select distinct new.id, x from unnest(new.assignees || array[new.reviewer_id, new.created_by]) x
      where x is not null
      on conflict do nothing;
    foreach u in array new.assignees loop
      perform public.notify(u, 'task_assigned', aname || ' assigned you: ' || new.title,
        concat_ws(' · ', pname, due_txt, 'with ' || public.others_on(new.assignees, u)), link, actor, new.id, new.project_id);
    end loop;
    return new;
  end if;

  select * into c from public.signoff_checkers();
  select short_name into fname from public.profiles where id = c.final_id;

  if new.assignees is distinct from old.assignees then
    added := array(select x from unnest(new.assignees) x where not (x = any (old.assignees)));
    removed := array(select x from unnest(old.assignees) x where not (x = any (new.assignees)));
    insert into public.activity (project_id, task_id, entity, entity_id, actor_id, action, details)
    values (new.project_id, new.id, 'task', new.id, actor, 'reassigned',
            jsonb_build_object('from', old.assignee_id, 'to', new.assignee_id, 'added', added, 'removed', removed, 'assignees', new.assignees));
    insert into public.task_watchers (task_id, user_id)
      select new.id, x from unnest(added) x on conflict do nothing;
    foreach u in array added loop
      perform public.notify(u, 'task_assigned', aname || ' assigned you: ' || new.title,
        concat_ws(' · ', pname, due_txt, 'with ' || public.others_on(new.assignees, u)), link, actor, new.id, new.project_id);
    end loop;
  end if;

  if new.status is distinct from old.status then
    insert into public.activity (project_id, task_id, entity, entity_id, actor_id, action, details)
    values (new.project_id, new.id, 'task', new.id, actor, 'status',
            jsonb_build_object('from', old.status, 'to', new.status, 'note', new.changes_note, 'stage', new.review_stage));
    if new.status = 'in_review' then
      target := case new.review_stage
        when 'first' then c.first_id
        when 'final' then c.final_id
        else coalesce(new.reviewer_id, new.created_by)
      end;
      if new.review_stage = 'final' then
        perform public.notify(target, 'task_submitted',
          aname || ' sent for your final OK: ' || new.title, pname, link, actor, new.id, new.project_id);
      else
        perform public.notify(target, 'task_submitted',
          aname || ' submitted for review: ' || new.title, pname, link, actor, new.id, new.project_id);
      end if;
      -- The others on a shared task hear that it went in.
      foreach u in array new.assignees loop
        if u is distinct from target then
          perform public.notify(u, 'task_updated',
            case when new.review_stage = 'final' then 'With ' || coalesce(fname, 'the final checker') || ' for the final OK: ' else 'Submitted for review: ' end || new.title,
            aname || ' sent it', link, actor, new.id, new.project_id);
        end if;
      end loop;
    else
      foreach u in array new.assignees loop
        if new.status = 'done' then
          perform public.notify(u, 'task_approved', 'Approved: ' || new.title,
            case when new.first_ok_by is not null then aname || ' gave the final OK' else aname || ' marked it done' end,
            link, actor, new.id, new.project_id);
        elsif old.status = 'in_review' and new.changes_note is not null then
          perform public.notify(u, 'task_changes', 'Changes requested: ' || new.title,
            new.changes_note, link, actor, new.id, new.project_id);
        elsif old.status = 'done' then
          perform public.notify(u, 'task_reopened', 'Reopened: ' || new.title,
            aname || ' reopened this task', link, actor, new.id, new.project_id);
        end if;
      end loop;
      -- The first checker hears how the final OK went.
      if new.status = 'done' and new.first_ok_by is not null and not (new.first_ok_by = any (new.assignees)) then
        perform public.notify(new.first_ok_by, 'task_approved', 'Final OK: ' || new.title,
          aname || ' approved it', link, actor, new.id, new.project_id);
      elsif old.status = 'in_review' and new.changes_note is not null and old.first_ok_by is not null
            and not (old.first_ok_by = any (new.assignees)) then
        perform public.notify(old.first_ok_by, 'task_changes', 'Sent back: ' || new.title,
          aname || ': ' || new.changes_note, link, actor, new.id, new.project_id);
      end if;
    end if;
  elsif new.status = 'in_review' and new.review_stage = 'final' and old.review_stage is distinct from 'final' then
    -- Checked by the first checker: on to the final checker.
    insert into public.activity (project_id, task_id, entity, entity_id, actor_id, action, details)
    values (new.project_id, new.id, 'task', new.id, actor, 'first_ok',
            jsonb_build_object('title', new.title, 'final', c.final_id));
    perform public.notify(c.final_id, 'task_submitted',
      aname || ' checked it and sent it for your final OK: ' || new.title, pname, link, actor, new.id, new.project_id);
    foreach u in array new.assignees loop
      if u is distinct from c.final_id then
        perform public.notify(u, 'task_updated', aname || ' approved: ' || new.title,
          'Now with ' || coalesce(fname, 'the final checker') || ' for the final OK', link, actor, new.id, new.project_id);
      end if;
    end loop;
  end if;

  if new.due_date is distinct from old.due_date then
    insert into public.activity (project_id, task_id, entity, entity_id, actor_id, action, details)
    values (new.project_id, new.id, 'task', new.id, actor, 'due_changed',
            jsonb_build_object('from', old.due_date, 'to', new.due_date));
    if new.status <> 'done' then
      foreach u in array new.assignees loop
        if not (u = any (added)) then
          perform public.notify(u, 'task_updated', 'New due date: ' || new.title,
            coalesce(due_txt, 'No due date'), link, actor, new.id, new.project_id);
        end if;
      end loop;
    end if;
  end if;

  if new.priority is distinct from old.priority then
    insert into public.activity (project_id, task_id, entity, entity_id, actor_id, action, details)
    values (new.project_id, new.id, 'task', new.id, actor, 'priority',
            jsonb_build_object('from', old.priority, 'to', new.priority));
    if new.priority = 'urgent' and new.status <> 'done' then
      foreach u in array new.assignees loop
        perform public.notify(u, 'task_updated', 'Marked urgent: ' || new.title,
          aname || ' raised the priority', link, actor, new.id, new.project_id);
      end loop;
    end if;
  end if;

  if new.title is distinct from old.title or new.description is distinct from old.description then
    insert into public.activity (project_id, task_id, entity, entity_id, actor_id, action, details)
    values (new.project_id, new.id, 'task', new.id, actor, 'edited', jsonb_build_object('title', new.title));
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Morning reminders: the review digest goes to whoever's turn it is
-- ---------------------------------------------------------------------------
create or replace function public.daily_reminders() returns void
language plpgsql security definer set search_path = public as $$
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
    where t.status in ('todo', 'in_progress') and t.due_date = today
  loop
    perform public.notify(r.uid, 'due_today', 'Due today: ' || r.title, r.pname, '/tasks/' || r.id, null, r.id, r.project_id);
  end loop;

  for r in
    select t.*, u.uid, pr.name as pname
    from public.tasks t cross join lateral unnest(t.assignees) as u(uid)
    left join public.projects pr on pr.id = t.project_id
    where t.status in ('todo', 'in_progress') and t.due_date > today and t.due_date <= nextday
  loop
    perform public.notify(r.uid, 'due_soon',
      'Due ' || case when r.due_date = today + 1 then 'tomorrow' else trim(to_char(r.due_date, 'Day')) end || ': ' || r.title,
      r.pname, '/tasks/' || r.id, null, r.id, r.project_id);
  end loop;

  for r in
    select u.uid, count(*) as n, string_agg(t.title, ', ' order by t.due_date) as titles
    from public.tasks t cross join lateral unnest(t.assignees) as u(uid)
    where t.status in ('todo', 'in_progress') and t.due_date < today
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
end $$;

-- ---------------------------------------------------------------------------
-- Attendance: times and places, or present / absent / on leave only
-- ---------------------------------------------------------------------------
-- Full attendance (times, places, map): managers and seniors who check in, unless they're set
-- to see presence only.
create or replace function public.can_see_team_attendance() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active and attendance_times
      and (role = 'manager' or (can_assign and not attendance_exempt))
  );
$$;

-- Who is present, absent or on leave: every manager and senior.
create or replace function public.can_see_team_presence() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active and (role = 'manager' or can_assign)
  );
$$;

-- One row per person who checks in, per day: did they check in, were they on leave. No times.
create or replace function public.team_presence(p_from date, p_to date)
returns table (user_id uuid, work_date date, present boolean, on_leave boolean)
language plpgsql stable security definer set search_path = public as $$
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
      exists (select 1 from public.events e where e.kind = 'leave' and e.event_date = d.day::date and p.id = any (e.attendees))
    from public.profiles p
    cross join generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as d(day)
    where p.active and not p.attendance_exempt
    order by 2, 1;
end $$;

revoke execute on function public.can_see_team_presence() from public, anon, authenticated;
revoke execute on function public.team_presence(date, date) from public, anon;
grant execute on function public.team_presence(date, date) to authenticated;

-- Only a manager can change roles, titles, access, emails, or the per-person settings.
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
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
       or new.assignable is distinct from old.assignable then
      raise exception 'Only the manager can change roles, titles or access';
    end if;
  elsif old.role = 'manager' and (new.role <> 'manager' or not new.active)
        and (select count(*) from public.profiles where role = 'manager' and active) <= 1 then
    raise exception 'The team needs at least one active manager';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Drive links in messages
-- ---------------------------------------------------------------------------
alter table public.drive_links add column if not exists comment_id uuid;
create index if not exists drive_links_comment_idx on public.drive_links (comment_id) where comment_id is not null;

alter policy "team sees drive links" on public.drive_links
  using (
    public.is_member()
    and (drive_links.comment_id is null
         or exists (select 1 from public.comments c where c.id = drive_links.comment_id))
  );
alter policy "team adds drive links" on public.drive_links
  with check (
    public.is_member() and added_by = auth.uid() and removed_at is null
    and (drive_links.comment_id is null
         or exists (select 1 from public.comments c where c.id = drive_links.comment_id and c.author_id = auth.uid()))
  );

create or replace function public.drive_link_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  if (new.task_id, new.project_id, new.recurring_id, new.comment_id, new.url, new.drive_id, new.resource_key, new.kind, new.title, new.added_by, new.created_at)
     is distinct from (old.task_id, old.project_id, old.recurring_id, old.comment_id, old.url, old.drive_id, old.resource_key, old.kind, old.title, old.added_by, old.created_at) then
    raise exception 'A Drive link can only be taken off. Add a new one instead.';
  end if;
  if new.removed_at is not null and old.removed_at is null then
    new.removed_by := auth.uid();
  elsif new.removed_at is null then
    new.removed_by := null;
  end if;
  return new;
end $$;
