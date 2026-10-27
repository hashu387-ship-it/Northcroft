-- Team members make their own tasks (Hassan approves them first), tasks on hold, and Hassan's
-- choice to finish handed-in work himself or send it on to Fawaz.
--
-- Member tasks:
-- * Anyone on the team can make a task and put anyone who takes tasks on it. A task made by a team
--   member (not a manager or senior) waits for the approver's OK: approval = 'pending'.
-- * The approver is the first checker in Settings > Team > Task sign-off (Hassan). With no first
--   checker set, the managers approve.
-- * While it waits, only the person who made it and the approver see it. Nothing starts, nobody
--   else is told, and it isn't in reminders, lists, the calendar or the workload.
-- * The approver can change anything on it, then approve it (approval = null: a normal task, and
--   the people on it are told) or turn it down with a note (approval = 'declined').
-- * The person who made it can change it while it waits, take it back (delete it), and after a
--   no, change it and ask again.
-- * Once approved, it's signed off like every other task (Hassan checks, then Fawaz's final OK).
--
-- On hold:
-- * The people on an open task ask to put it on hold, with a reason (hold = 'asked'). The approver
--   decides: puts it on hold (hold = 'on') or keeps it going. The approver can also hold any open
--   task straight away, and takes it off hold.
-- * A task on hold keeps its status (To do or In progress), can't be started, handed in or
--   finished, and gets no due or overdue reminders.
--
-- Finish or send on:
-- * When the first checker (Hassan) approves handed-in work or marks a task done, they choose:
--   send it to the final checker (Fawaz) as before, or finish it themselves (finished_by_first).
--   The final checker isn't told about tasks finished that way.

alter table public.tasks add column if not exists approval text check (approval in ('pending', 'declined'));
alter table public.tasks add column if not exists approval_note text;
alter table public.tasks add column if not exists approval_at timestamptz;
alter table public.tasks add column if not exists approval_by uuid references public.profiles (id) on delete set null;
create index if not exists tasks_approval_idx on public.tasks (approval) where approval is not null;
alter table public.tasks add column if not exists hold text check (hold in ('asked', 'on'));
alter table public.tasks add column if not exists hold_reason text;
alter table public.tasks add column if not exists hold_by uuid references public.profiles (id) on delete set null;
alter table public.tasks add column if not exists hold_at timestamptz;
alter table public.tasks add column if not exists finished_by_first boolean not null default false;
create index if not exists tasks_hold_idx on public.tasks (hold) where hold is not null;

/* ---------------------------------------------------------------- who approves */
-- The approver: the first checker, or (with none set) the managers.
create or replace function public.is_task_approver()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_member() and coalesce(
    (select case when c.first_id is not null then c.first_id = auth.uid() else public.is_manager() end
       from public.signoff_checkers() c),
    public.is_manager());
$$;

-- Everyone who approves (for notifications).
create or replace function public.task_approver_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select case
    when (select first_id from public.signoff_checkers()) is not null then array[(select first_id from public.signoff_checkers())]
    else coalesce(array(select id from public.profiles where role = 'manager' and active), '{}')
  end;
$$;

-- A task this person asked for that's still waiting (or was turned down).
create or replace function public.my_task_request(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.tasks t where t.id = p_task and t.created_by = auth.uid() and t.approval is not null);
$$;

/* ---------------------------------------------------------------- rules */
alter policy "tasks readable" on public.tasks
  using (public.is_member() and (approval is null or created_by = auth.uid() or public.is_task_approver()));
alter policy "assigners add tasks" on public.tasks
  with check (public.can_assign() or (public.is_member() and created_by = auth.uid()));
alter policy "assigners or assignee edit tasks" on public.tasks
  using (public.can_assign() or auth.uid() = any (assignees) or (approval is not null and created_by = auth.uid()))
  with check (public.can_assign() or auth.uid() = any (assignees) or (approval is not null and created_by = auth.uid()));
alter policy "assigners delete tasks" on public.tasks
  using (public.can_assign() or (approval is not null and created_by = auth.uid()));

-- The person who asked can set up the checklist on their request.
alter policy "checklist add" on public.task_checklist
  with check (public.can_assign() or public.on_task(task_id) or public.my_task_request(task_id));
alter policy "checklist edit" on public.task_checklist
  using (public.can_assign() or assignee_id = auth.uid() or public.on_task(task_id) or public.my_task_request(task_id));
alter policy "checklist delete" on public.task_checklist
  using (public.can_assign() or exists (select 1 from public.tasks t where t.id = task_checklist.task_id and t.assignee_id = auth.uid()) or public.my_task_request(task_id));

/* ---------------------------------------------------------------- the task guard */
create or replace function public.guard_task()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid();
  assigner boolean;
  c record;
  who text;
  -- True when this approval moved the task on to the final checker.
  passed_on boolean := false;
  -- The first checker chose to finish it themselves instead of sending it to the final checker.
  finish_here boolean := false;
  approver boolean;
  aname text;
begin
  select * into c from public.signoff_checkers();

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, uid);
    new.hold := null;
    new.hold_reason := null;
    new.hold_by := null;
    new.hold_at := null;
    new.finished_by_first := false;
    new.approval_note := null;
    new.approval_at := null;
    new.approval_by := null;
    if uid is not null and not public.can_assign() then
      -- A team member's own task waits for the approver's OK before anything starts.
      if new.created_by is distinct from uid then
        raise exception 'You can only make tasks as yourself';
      end if;
      new.approval := 'pending';
      new.status := 'todo';
      new.recurring_id := null;
      new.reviewer_id := coalesce((public.task_approver_ids())[1], new.created_by);
    else
      new.approval := null;
    end if;
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

  -- A task waiting for approval (or turned down).
  if uid is not null and (old.approval is not null or new.approval is not null) then
    if old.approval is null then
      raise exception 'This task has already been approved';
    end if;
    if public.is_task_approver() then
      if new.approval is distinct from old.approval then
        if new.approval is null then
          new.approval_note := null;
          new.approval_at := now();
          new.approval_by := uid;
        elsif new.approval = 'declined' then
          new.approval_at := now();
          new.approval_by := uid;
        else
          new.approval_note := null;
          new.approval_at := null;
          new.approval_by := null;
        end if;
      else
        new.approval_note := coalesce(new.approval_note, old.approval_note);
        new.approval_at := old.approval_at;
        new.approval_by := old.approval_by;
      end if;
    elsif uid = old.created_by then
      -- The person who asked changes their request, or asks again after a no.
      if new.approval is null then
        select short_name into who from public.profiles where id = (public.task_approver_ids())[1];
        raise exception '% approves the tasks the team makes', coalesce(who, 'A manager');
      end if;
      if old.approval = 'declined' and new.approval = 'pending' then
        new.approval_note := null;
        new.approval_at := null;
        new.approval_by := null;
      else
        new.approval := old.approval;
        new.approval_note := old.approval_note;
        new.approval_at := old.approval_at;
        new.approval_by := old.approval_by;
      end if;
      new.created_by := old.created_by;
      new.recurring_id := old.recurring_id;
      new.reviewer_id := old.reviewer_id;
    else
      raise exception 'This task is waiting for approval';
    end if;

    if new.approval is not null then
      -- Nothing starts until it's approved.
      new.status := old.status;
      new.review_stage := old.review_stage;
      new.first_ok_by := old.first_ok_by;
      new.first_ok_at := old.first_ok_at;
      new.submitted_at := old.submitted_at;
      new.completed_at := old.completed_at;
      new.approved_by := old.approved_by;
      new.changes_note := old.changes_note;
      return new;
    end if;
    -- Approved just now: from here it's an ordinary task.
  end if;

  -- On hold: the people on it ask, the approver decides (and can hold any open task).
  if uid is not null then
    approver := public.is_task_approver();
    select short_name into aname from public.profiles where id = (public.task_approver_ids())[1];
    if new.hold is distinct from old.hold then
      if new.hold is not null and old.status not in ('todo', 'in_progress') then
        raise exception 'Only open tasks can go on hold';
      end if;
      if approver then
        if new.hold = 'asked' then
          new.hold := 'on';
        end if;
        if new.hold = 'on' then
          new.hold_reason := coalesce(nullif(btrim(new.hold_reason), ''), old.hold_reason);
          new.hold_by := case when old.hold = 'asked' then old.hold_by else uid end;
          new.hold_at := now();
        else
          -- Off hold, or an ask turned down (hold_reason then carries the approver's note).
          new.hold_reason := case when old.hold = 'asked' then nullif(btrim(new.hold_reason), '') else null end;
          new.hold_by := null;
          new.hold_at := null;
        end if;
      elsif old.hold is null and new.hold = 'asked' and uid = any (old.assignees) then
        if coalesce(btrim(new.hold_reason), '') = '' then
          raise exception 'Say why it needs to go on hold';
        end if;
        new.hold_reason := btrim(new.hold_reason);
        new.hold_by := uid;
        new.hold_at := now();
      elsif old.hold = 'asked' and new.hold is null and old.hold_by = uid then
        -- Taking back their own ask.
        new.hold_reason := null;
        new.hold_by := null;
        new.hold_at := null;
      else
        raise exception '% decides on holds. Ask to put it on hold instead.', coalesce(aname, 'A manager');
      end if;
    else
      new.hold_reason := old.hold_reason;
      new.hold_by := old.hold_by;
      new.hold_at := old.hold_at;
    end if;
    if new.hold = 'on' and new.status is distinct from old.status then
      raise exception 'This task is on hold. % takes it off hold first.', coalesce(aname, 'A manager');
    end if;

    -- Only the first checker can finish a task without the final checker.
    finish_here := coalesce(new.finished_by_first, false) and not coalesce(old.finished_by_first, false)
                   and c.first_id is not null and uid = c.first_id;
    new.finished_by_first := old.finished_by_first;
  end if;

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
        if not (c.final_id = any (new.assignees)) and not finish_here then
          passed_on := true;
        end if;
      elsif old.status = 'in_review' and old.review_stage = 'final' then
        if uid is distinct from c.final_id then
          select short_name into who from public.profiles where id = c.final_id;
          raise exception '% gives the final OK on this one.', coalesce(who, 'The final checker');
        end if;
      elsif uid is distinct from c.final_id and not (c.final_id = any (new.assignees)) and not finish_here then
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
      new.finished_by_first := finish_here and not passed_on;
    end if;
    if new.status not in ('todo', 'in_progress') and new.hold = 'asked' then
      new.hold := null;
      new.hold_reason := null;
      new.hold_by := null;
      new.hold_at := null;
    end if;
    if new.status not in ('in_review', 'done') then
      new.review_stage := null;
      new.first_ok_by := null;
      new.first_ok_at := null;
    end if;
    if old.status = 'done' and new.status <> 'done' then
      new.completed_at := null;
      new.approved_by := null;
      new.finished_by_first := false;
    end if;
  end if;
  return new;
end $function$;

/* ---------------------------------------------------------------- history and notifications */
create or replace function public.task_after_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  cname text := coalesce(public.actor_name(new.created_by), 'Someone');
begin
  select name into pname from public.projects where id = new.project_id;

  -- Waiting for approval: only the person who asked and the approver hear about it.
  if new.approval is not null then
    if tg_op = 'INSERT' then
      insert into public.task_watchers (task_id, user_id)
        select distinct new.id, x from unnest(array[new.created_by] || public.task_approver_ids()) x
        where x is not null
        on conflict do nothing;
      foreach u in array public.task_approver_ids() loop
        perform public.notify(u, 'task_request', cname || ' made a task for your OK: ' || new.title,
          concat_ws(' · ', pname, due_txt, case when new.assignees = array[new.created_by] then null
                                                else 'for ' || public.name_list(new.assignees) end),
          link, actor, new.id, new.project_id);
      end loop;
    elsif new.approval = 'declined' and old.approval is distinct from 'declined' then
      perform public.notify(new.created_by, 'task_request_declined', aname || ' turned down your task: ' || new.title,
        coalesce(new.approval_note, 'Open it to change it and ask again'), link, actor, new.id, new.project_id);
    elsif new.approval = 'pending' and old.approval = 'declined' then
      foreach u in array public.task_approver_ids() loop
        perform public.notify(u, 'task_request', cname || ' changed a task and asked again: ' || new.title,
          concat_ws(' · ', pname, due_txt), link, actor, new.id, new.project_id);
      end loop;
    end if;
    return new;
  end if;

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

  if old.approval is not null then
    -- Approved: from now on it's a normal task, and the people on it are told.
    insert into public.activity (project_id, task_id, entity, entity_id, actor_id, action, details)
    values (new.project_id, new.id, 'task', new.id, new.created_by, 'created',
            jsonb_build_object('title', new.title, 'assignee_id', new.assignee_id, 'assignees', new.assignees, 'due_date', new.due_date));
    insert into public.activity (project_id, task_id, entity, entity_id, actor_id, action, details)
    values (new.project_id, new.id, 'task', new.id, actor, 'request_approved', jsonb_build_object('title', new.title, 'by', new.created_by));
    insert into public.task_watchers (task_id, user_id)
      select distinct new.id, x from unnest(new.assignees || array[new.reviewer_id, new.created_by]) x
      where x is not null
      on conflict do nothing;
    perform public.notify(new.created_by, 'task_request_approved', aname || ' approved your task: ' || new.title,
      concat_ws(' · ', pname, due_txt), link, actor, new.id, new.project_id);
    foreach u in array new.assignees loop
      if u is distinct from new.created_by then
        perform public.notify(u, 'task_assigned', cname || ' added you to: ' || new.title,
          concat_ws(' · ', pname, due_txt, 'Approved by ' || aname), link, actor, new.id, new.project_id);
      end if;
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

  if new.hold is distinct from old.hold then
    insert into public.activity (project_id, task_id, entity, entity_id, actor_id, action, details)
    values (new.project_id, new.id, 'task', new.id, actor, 'hold',
            jsonb_build_object('from', old.hold, 'to', new.hold, 'reason', coalesce(new.hold_reason, old.hold_reason)));
    if new.hold = 'asked' then
      foreach u in array public.task_approver_ids() loop
        perform public.notify(u, 'task_hold', aname || ' asked to put on hold: ' || new.title,
          new.hold_reason, link, actor, new.id, new.project_id);
      end loop;
    elsif new.hold = 'on' then
      foreach u in array array(select distinct x from unnest(new.assignees || array[new.hold_by]) x where x is not null) loop
        perform public.notify(u, 'task_hold', 'On hold: ' || new.title,
          concat_ws(' · ', aname || ' put it on hold', new.hold_reason), link, actor, new.id, new.project_id);
      end loop;
    elsif old.hold = 'on' then
      foreach u in array new.assignees loop
        perform public.notify(u, 'task_hold', 'Off hold: ' || new.title,
          aname || ' took it off hold. Carry on with it.', link, actor, new.id, new.project_id);
      end loop;
    elsif old.hold = 'asked' and actor is distinct from old.hold_by then
      perform public.notify(old.hold_by, 'task_hold', aname || ' kept it going: ' || new.title,
        coalesce(new.hold_reason, 'Not on hold. Carry on with it.'), link, actor, new.id, new.project_id);
    end if;
  end if;

  if new.status is distinct from old.status then
    insert into public.activity (project_id, task_id, entity, entity_id, actor_id, action, details)
    values (new.project_id, new.id, 'task', new.id, actor, 'status',
            jsonb_build_object('from', old.status, 'to', new.status, 'note', new.changes_note, 'stage', new.review_stage,
                               'finished_by_first', new.finished_by_first));
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
            case when new.first_ok_by is not null then aname || ' gave the final OK'
                 when new.finished_by_first and old.status = 'in_review' then aname || ' approved it'
                 else aname || ' marked it done' end,
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
end $function$;

/* ---------------------------------------------------------------- reminders skip waiting tasks */
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
    perform public.notify(r.uid, 'due_today', 'Due today: ' || r.title, r.pname, '/tasks/' || r.id, null, r.id, r.project_id);
  end loop;

  for r in
    select t.*, u.uid, pr.name as pname
    from public.tasks t cross join lateral unnest(t.assignees) as u(uid)
    left join public.projects pr on pr.id = t.project_id
    where t.status in ('todo', 'in_progress') and t.due_date > today and t.due_date <= nextday and t.approval is null and t.hold is distinct from 'on'
  loop
    perform public.notify(r.uid, 'due_soon',
      'Due ' || case when r.due_date = today + 1 then 'tomorrow' else trim(to_char(r.due_date, 'Day')) end || ': ' || r.title,
      r.pname, '/tasks/' || r.id, null, r.id, r.project_id);
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

revoke all on function public.my_task_request(uuid) from public;
grant execute on function public.my_task_request(uuid) to authenticated;
grant execute on function public.is_task_approver() to authenticated;
