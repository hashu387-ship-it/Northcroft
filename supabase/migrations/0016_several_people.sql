-- Several people on a task, a repeating task, a variation or a BOQ package.
--
-- A task can have one, two, three or more people. All of them see it in My tasks, get its
-- notifications, and can update it, edit its details, steps and files, and submit it for review.
-- Only managers and seniors change who's on it, and approve it.
-- Variations and BOQ packages can have several owners; all of them get their notifications.
--
-- assignee_id and owner_id stay in step with the first person on the list, so anything still
-- reading them keeps working. Removing a checklist step now marks it removed (removed_at),
-- so everyone on the task can do it.

-- ---------------------------------------------------------------------------
-- The lists
-- ---------------------------------------------------------------------------
alter table public.tasks add column assignees uuid[] not null default '{}';
alter table public.recurring_tasks add column assignees uuid[] not null default '{}';
alter table public.variations add column owners uuid[] not null default '{}';
alter table public.boq_packages add column owners uuid[] not null default '{}';

update public.tasks set assignees = array[assignee_id] where assignee_id is not null;
update public.recurring_tasks set assignees = array[assignee_id] where assignee_id is not null;
update public.variations set owners = array[owner_id] where owner_id is not null;
update public.boq_packages set owners = array[owner_id] where owner_id is not null;

create index tasks_assignees_idx on public.tasks using gin (assignees);
create index variations_owners_idx on public.variations using gin (owners);
create index boq_owners_idx on public.boq_packages using gin (owners);

-- No blanks or repeats, first-chosen order kept.
create or replace function public.clean_people(p uuid[]) returns uuid[]
language sql immutable set search_path = public as $$
  select coalesce(array_agg(x order by i), '{}')
  from (select x, min(i) as i from unnest(p) with ordinality u(x, i) where x is not null group by x) d;
$$;

-- The list is what counts; the single column follows its first person. An older screen that
-- only sets the single column replaces the list with that one person.
create or replace function public.sync_task_people() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if cardinality(new.assignees) = 0 and new.assignee_id is not null then
      new.assignees := array[new.assignee_id];
    end if;
  elsif new.assignees is not distinct from old.assignees and new.assignee_id is distinct from old.assignee_id then
    new.assignees := case when new.assignee_id is null then '{}'::uuid[] else array[new.assignee_id] end;
  end if;
  new.assignees := public.clean_people(new.assignees);
  new.assignee_id := new.assignees[1];
  return new;
end $$;

create or replace function public.sync_owners() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if cardinality(new.owners) = 0 and new.owner_id is not null then
      new.owners := array[new.owner_id];
    end if;
  elsif new.owners is not distinct from old.owners and new.owner_id is distinct from old.owner_id then
    new.owners := case when new.owner_id is null then '{}'::uuid[] else array[new.owner_id] end;
  end if;
  new.owners := public.clean_people(new.owners);
  new.owner_id := new.owners[1];
  return new;
end $$;

-- Named to run before the other checks on these tables (triggers run in name order).
create trigger tasks_a_people before insert or update on public.tasks
  for each row execute function public.sync_task_people();
create trigger recurring_a_people before insert or update on public.recurring_tasks
  for each row execute function public.sync_task_people();
create trigger variations_a_owners before insert or update on public.variations
  for each row execute function public.sync_owners();
create trigger boq_a_owners before insert or update on public.boq_packages
  for each row execute function public.sync_owners();

-- ---------------------------------------------------------------------------
-- Nobody else can put someone who doesn't take tasks (Fawaz) on a task
-- ---------------------------------------------------------------------------
create or replace function public.guard_assignee() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text;
  me uuid := coalesce(auth.uid(), new.created_by);
begin
  select string_agg(p.short_name, ', ') into who
  from public.profiles p
  where p.id = any (new.assignees) and not p.assignable and p.id is distinct from me
    and (tg_op = 'INSERT' or not (p.id = any (old.assignees)));
  if who is not null then
    raise exception '% gives out tasks but doesn''t take them in the app', who;
  end if;
  return new;
end $$;

create trigger tasks_people_guard before insert or update of assignees on public.tasks
  for each row execute function public.guard_assignee();
create trigger recurring_people_guard before insert or update of assignees on public.recurring_tasks
  for each row execute function public.guard_assignee();

-- ---------------------------------------------------------------------------
-- Who can change a task
-- ---------------------------------------------------------------------------
create or replace function public.on_task(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tasks t where t.id = p_task and auth.uid() = any (t.assignees));
$$;

alter policy "assigners or assignee edit tasks" on public.tasks
  using (public.can_assign() or auth.uid() = any (assignees))
  with check (public.can_assign() or auth.uid() = any (assignees));

-- People on a task edit its details, steps and files; only managers and seniors change who's
-- on it or who reviews it, and approve or reopen it.
create or replace function public.guard_task() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  assigner boolean;
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, uid);
    new.reviewer_id := coalesce(new.reviewer_id, new.created_by);
    if new.status = 'in_review' then new.submitted_at := now(); end if;
    if new.status = 'done' then new.completed_at := now(); new.approved_by := coalesce(uid, new.created_by); end if;
    return new;
  end if;

  new.updated_at := now();
  if uid is not null then
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
  end if;

  if new.status is distinct from old.status then
    if new.status = 'in_review' then
      new.submitted_at := now();
      new.changes_note := null;
    end if;
    if new.status = 'done' then
      new.completed_at := now();
      new.approved_by := coalesce(uid, new.approved_by);
    end if;
    if old.status = 'done' and new.status <> 'done' then
      new.completed_at := null;
      new.approved_by := null;
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Task notifications go to everyone on the task
-- ---------------------------------------------------------------------------
-- "Saheeb and Imthath" for the other people on a task, leaving one person out.
create or replace function public.others_on(p_people uuid[], p_skip uuid) returns text
language sql stable security definer set search_path = public as $$
  select nullif(public.name_list(array(select x from unnest(p_people) x where x is distinct from p_skip)), '');
$$;

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
            jsonb_build_object('from', old.status, 'to', new.status, 'note', new.changes_note));
    if new.status = 'in_review' then
      perform public.notify(coalesce(new.reviewer_id, new.created_by), 'task_submitted',
        aname || ' submitted for review: ' || new.title, pname, link, actor, new.id, new.project_id);
      -- The others on a shared task hear that it went in.
      foreach u in array new.assignees loop
        if u is distinct from coalesce(new.reviewer_id, new.created_by) then
          perform public.notify(u, 'task_updated', 'Submitted for review: ' || new.title,
            aname || ' submitted it', link, actor, new.id, new.project_id);
        end if;
      end loop;
    else
      foreach u in array new.assignees loop
        if new.status = 'done' then
          perform public.notify(u, 'task_approved', 'Approved: ' || new.title,
            aname || ' marked it done', link, actor, new.id, new.project_id);
        elsif old.status = 'in_review' and new.changes_note is not null then
          perform public.notify(u, 'task_changes', 'Changes requested: ' || new.title,
            new.changes_note, link, actor, new.id, new.project_id);
        elsif old.status = 'done' then
          perform public.notify(u, 'task_reopened', 'Reopened: ' || new.title,
            aname || ' reopened this task', link, actor, new.id, new.project_id);
        end if;
      end loop;
    end if;
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
-- Variation and BOQ notifications go to every owner
-- ---------------------------------------------------------------------------
create or replace function public.variation_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := coalesce(auth.uid(), new.created_by);
  aname text := coalesce(public.actor_name(actor), 'Someone');
  link text := '/projects/' || new.project_id || '/variations?vo=' || new.id;
  label text := new.vo_number || ' ' || new.title;
  added uuid[] := '{}';
  u uuid;
begin
  if tg_op = 'INSERT' then
    insert into public.activity (project_id, entity, entity_id, actor_id, action, details)
    values (new.project_id, 'variation', new.id, actor, 'created',
            jsonb_build_object('vo_number', new.vo_number, 'title', new.title, 'status', new.status));
    foreach u in array new.owners loop
      perform public.notify(u, 'vo_assigned', aname || ' gave you ' || label,
        public.vo_status_label(new.status), link, actor, null, new.project_id);
    end loop;
    return new;
  end if;

  if new.owners is distinct from old.owners then
    added := array(select x from unnest(new.owners) x where not (x = any (old.owners)));
    foreach u in array added loop
      perform public.notify(u, 'vo_assigned', aname || ' gave you ' || label,
        public.vo_status_label(new.status), link, actor, null, new.project_id);
    end loop;
  end if;

  if new.status is distinct from old.status then
    insert into public.activity (project_id, entity, entity_id, actor_id, action, details)
    values (new.project_id, 'variation', new.id, actor, 'status',
            jsonb_build_object('vo_number', new.vo_number, 'from', old.status, 'to', new.status));
    foreach u in array new.owners loop
      if not (u = any (added)) then
        perform public.notify(u, 'vo_update', label || ' is now ' || public.vo_status_label(new.status),
          aname || ' updated the status', link, actor, null, new.project_id);
      end if;
    end loop;
  end if;

  if (new.submitted_value, new.assessed_value, new.approved_value)
     is distinct from (old.submitted_value, old.assessed_value, old.approved_value) then
    insert into public.activity (project_id, entity, entity_id, actor_id, action, details)
    values (new.project_id, 'variation', new.id, actor, 'values',
            jsonb_build_object('vo_number', new.vo_number,
              'submitted', new.submitted_value, 'assessed', new.assessed_value, 'approved', new.approved_value));
  end if;
  return new;
end $$;

create or replace function public.boq_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  aname text := coalesce(public.actor_name(actor), 'Someone');
  link text := '/projects/' || new.project_id || '/boq';
  added uuid[] := '{}';
  u uuid;
begin
  if tg_op = 'INSERT' then
    insert into public.activity (project_id, entity, entity_id, actor_id, action, details)
    values (new.project_id, 'boq', new.id, actor, 'created', jsonb_build_object('name', new.name, 'status', new.status));
    foreach u in array new.owners loop
      perform public.notify(u, 'boq_assigned', aname || ' gave you the ' || new.name || ' BOQ',
        public.boq_status_label(new.status), link, actor, null, new.project_id);
    end loop;
    return new;
  end if;
  if new.owners is distinct from old.owners then
    added := array(select x from unnest(new.owners) x where not (x = any (old.owners)));
    foreach u in array added loop
      perform public.notify(u, 'boq_assigned', aname || ' gave you the ' || new.name || ' BOQ',
        public.boq_status_label(new.status), link, actor, null, new.project_id);
    end loop;
  end if;
  if new.status is distinct from old.status then
    insert into public.activity (project_id, entity, entity_id, actor_id, action, details)
    values (new.project_id, 'boq', new.id, actor, 'status',
            jsonb_build_object('name', new.name, 'from', old.status, 'to', new.status));
    foreach u in array new.owners loop
      if not (u = any (added)) then
        perform public.notify(u, 'boq_update', new.name || ' BOQ is now ' || public.boq_status_label(new.status),
          aname || ' updated the status', link, actor, null, new.project_id);
      end if;
    end loop;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Repeating tasks carry all their people onto each new task
-- ---------------------------------------------------------------------------
create or replace function public.run_recurring() returns int
language plpgsql security definer set search_path = public as $$
declare
  r public.recurring_tasks;
  today date := public.riyadh_today();
  new_id uuid;
  due date;
  n int := 0;
begin
  if auth.uid() is not null and not public.can_assign() then
    raise exception 'Not allowed';
  end if;
  for r in select * from public.recurring_tasks where active and next_run <= today for update skip locked loop
    due := greatest(r.next_run, today) + r.due_offset_days;
    insert into public.tasks (project_id, title, description, priority, assignee_id, assignees, reviewer_id, created_by,
      due_date, estimate_hours, recurring_id)
    values (r.project_id, r.title, r.description, r.priority, r.assignee_id, r.assignees, r.reviewer_id, r.created_by,
      due, r.estimate_hours, r.id)
    returning id into new_id;
    insert into public.task_checklist (task_id, text, position)
      select new_id, x.item, x.ord::int from unnest(r.checklist) with ordinality as x(item, ord);
    update public.recurring_tasks
      set last_run = today,
          next_run = public.recurring_next_date(r.frequency, r.weekday, r.month_day, today)
      where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Morning reminders reach everyone on a task, and every owner of a VO or BOQ package
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
    select coalesce(reviewer_id, created_by) as uid, count(*) as n
    from public.tasks where status = 'in_review' group by 1
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
-- Checklist steps: everyone on the task can add, edit and remove them
-- ---------------------------------------------------------------------------
alter table public.task_checklist
  add column removed_at timestamptz,
  add column removed_by uuid references public.profiles(id);

alter policy "checklist add" on public.task_checklist
  with check (public.can_assign() or public.on_task(task_id));
alter policy "checklist edit" on public.task_checklist
  using (public.can_assign() or assignee_id = auth.uid() or public.on_task(task_id));

create or replace function public.checklist_removed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.removed_at is not null and old.removed_at is null then
    new.removed_by := auth.uid();
  elsif new.removed_at is null then
    new.removed_by := null;
  end if;
  return new;
end $$;
create trigger checklist_removed before update of removed_at on public.task_checklist
  for each row execute function public.checklist_removed();

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
revoke execute on function public.sync_task_people() from public, anon, authenticated;
revoke execute on function public.sync_owners() from public, anon, authenticated;
revoke execute on function public.checklist_removed() from public, anon, authenticated;
revoke execute on function public.others_on(uuid[], uuid) from public, anon, authenticated;
revoke execute on function public.on_task(uuid) from public, anon;
grant execute on function public.on_task(uuid) to authenticated;
grant execute on function public.clean_people(uuid[]) to authenticated;
