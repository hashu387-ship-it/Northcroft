-- Northcroft QS workspace: triggers, notifications, attendance, reminders.

-- ---------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------
create or replace function public.actor_name(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select short_name from public.profiles where id = p_id;
$$;

create or replace function public.is_workday(d date) returns boolean
language sql stable security definer set search_path = public as $$
  select extract(dow from d)::int = any (coalesce((select work_days from public.app_settings where id = 1), '{0,1,2,3,4}'));
$$;

create or replace function public.next_workday(d date) returns date
language plpgsql stable security definer set search_path = public as $$
declare x date := d;
begin
  for i in 1..14 loop
    exit when public.is_workday(x);
    x := x + 1;
  end loop;
  return x;
end $$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger projects_touch before update on public.projects for each row execute function public.touch_updated_at();
create trigger variations_touch before update on public.variations for each row execute function public.touch_updated_at();
create trigger boq_touch before update on public.boq_packages for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.app_settings for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- New users get a profile from their sign-up metadata
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, email, full_name, short_name, title, role, can_assign, color, must_change_password)
  values (
    new.id,
    new.email,
    coalesce(m->>'full_name', split_part(new.email, '@', 1)),
    coalesce(m->>'short_name', m->>'full_name', split_part(new.email, '@', 1)),
    coalesce(m->>'title', 'Quantity Surveyor'),
    coalesce(m->>'role', 'member'),
    coalesce((m->>'can_assign')::boolean, false),
    coalesce(m->>'color', '#0a84ff'),
    coalesce((m->>'must_change_password')::boolean, true)
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only the manager can change roles, titles, access and emails.
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
       or new.title is distinct from old.title then
      raise exception 'Only the manager can change roles, titles or access';
    end if;
  elsif old.role = 'manager' and (new.role <> 'manager' or not new.active)
        and (select count(*) from public.profiles where role = 'manager' and active) <= 1 then
    raise exception 'The team needs at least one active manager';
  end if;
  return new;
end $$;

create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile();

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create or replace function public.notify(
  p_user uuid, p_type text, p_title text, p_body text, p_link text, p_actor uuid,
  p_task uuid default null, p_project uuid default null, p_announcement uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or (p_actor is not null and p_user = p_actor) then
    return;
  end if;
  if not exists (select 1 from public.profiles where id = p_user and active) then
    return;
  end if;
  insert into public.notifications (user_id, type, title, body, link, actor_id, task_id, project_id, announcement_id)
  values (p_user, p_type, left(p_title, 200), left(p_body, 400), p_link, p_actor, p_task, p_project, p_announcement);
end $$;

-- Hand every new notification to the push sender Edge Function.
create or replace function public.dispatch_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  fn_url text;
  secret text;
begin
  if not exists (select 1 from public.push_subscriptions where user_id = new.user_id) then
    return new;
  end if;
  select decrypted_secret into fn_url from vault.decrypted_secrets where name = 'push_function_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'push_webhook_secret';
  if fn_url is null or secret is null then
    return new;
  end if;
  perform net.http_post(
    url := fn_url,
    body := jsonb_build_object('notification_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', secret),
    timeout_milliseconds := 8000
  );
  return new;
end $$;

create trigger notifications_push after insert on public.notifications
  for each row execute function public.dispatch_push();

-- Read by the Edge Function with the service role only.
create or replace function public.get_push_config() returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets
  where name in ('vapid_public_key', 'vapid_private_key', 'vapid_subject', 'push_webhook_secret', 'app_url');
$$;

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
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
      if uid is distinct from old.assignee_id then
        raise exception 'You can only update tasks assigned to you';
      end if;
      if (new.title, new.description, new.priority, new.assignee_id, new.reviewer_id, new.due_date,
          new.project_id, new.estimate_hours, new.created_by, new.recurring_id)
         is distinct from
         (old.title, old.description, old.priority, old.assignee_id, old.reviewer_id, old.due_date,
          old.project_id, old.estimate_hours, old.created_by, old.recurring_id) then
        raise exception 'Only Hassan or a senior can change task details';
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

create trigger tasks_guard before insert or update on public.tasks
  for each row execute function public.guard_task();

create or replace function public.task_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := coalesce(auth.uid(), new.created_by);
  aname text := coalesce(public.actor_name(actor), 'Northcroft');
  pname text;
  link text := '/tasks/' || new.id;
  due_txt text := case when new.due_date is null then null else 'Due ' || to_char(new.due_date, 'Dy DD Mon') end;
begin
  select name into pname from public.projects where id = new.project_id;

  if tg_op = 'INSERT' then
    insert into public.activity (project_id, task_id, entity, entity_id, actor_id, action, details)
    values (new.project_id, new.id, 'task', new.id, actor, 'created',
            jsonb_build_object('title', new.title, 'assignee_id', new.assignee_id, 'due_date', new.due_date));
    insert into public.task_watchers (task_id, user_id)
      select distinct new.id, u from unnest(array[new.assignee_id, new.reviewer_id, new.created_by]) u
      where u is not null
      on conflict do nothing;
    if new.assignee_id is not null then
      perform public.notify(new.assignee_id, 'task_assigned', aname || ' assigned you: ' || new.title,
        concat_ws(' · ', pname, due_txt), link, actor, new.id, new.project_id);
    end if;
    return new;
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    insert into public.activity (project_id, task_id, entity, entity_id, actor_id, action, details)
    values (new.project_id, new.id, 'task', new.id, actor, 'reassigned',
            jsonb_build_object('from', old.assignee_id, 'to', new.assignee_id));
    if new.assignee_id is not null then
      insert into public.task_watchers (task_id, user_id) values (new.id, new.assignee_id) on conflict do nothing;
      perform public.notify(new.assignee_id, 'task_assigned', aname || ' assigned you: ' || new.title,
        concat_ws(' · ', pname, due_txt), link, actor, new.id, new.project_id);
    end if;
  end if;

  if new.status is distinct from old.status then
    insert into public.activity (project_id, task_id, entity, entity_id, actor_id, action, details)
    values (new.project_id, new.id, 'task', new.id, actor, 'status',
            jsonb_build_object('from', old.status, 'to', new.status, 'note', new.changes_note));
    if new.status = 'in_review' then
      perform public.notify(coalesce(new.reviewer_id, new.created_by), 'task_submitted',
        aname || ' submitted for review: ' || new.title, pname, link, actor, new.id, new.project_id);
    elsif new.status = 'done' then
      perform public.notify(new.assignee_id, 'task_approved', 'Approved: ' || new.title,
        aname || ' marked it done', link, actor, new.id, new.project_id);
    elsif old.status = 'in_review' and new.changes_note is not null then
      perform public.notify(new.assignee_id, 'task_changes', 'Changes requested: ' || new.title,
        new.changes_note, link, actor, new.id, new.project_id);
    elsif old.status = 'done' then
      perform public.notify(new.assignee_id, 'task_reopened', 'Reopened: ' || new.title,
        aname || ' reopened this task', link, actor, new.id, new.project_id);
    end if;
  end if;

  if new.due_date is distinct from old.due_date then
    insert into public.activity (project_id, task_id, entity, entity_id, actor_id, action, details)
    values (new.project_id, new.id, 'task', new.id, actor, 'due_changed',
            jsonb_build_object('from', old.due_date, 'to', new.due_date));
    if new.status <> 'done' and new.assignee_id is not distinct from old.assignee_id then
      perform public.notify(new.assignee_id, 'task_updated', 'New due date: ' || new.title,
        coalesce(due_txt, 'No due date'), link, actor, new.id, new.project_id);
    end if;
  end if;

  if new.priority is distinct from old.priority then
    insert into public.activity (project_id, task_id, entity, entity_id, actor_id, action, details)
    values (new.project_id, new.id, 'task', new.id, actor, 'priority',
            jsonb_build_object('from', old.priority, 'to', new.priority));
    if new.priority = 'urgent' and new.status <> 'done' then
      perform public.notify(new.assignee_id, 'task_updated', 'Marked urgent: ' || new.title,
        aname || ' raised the priority', link, actor, new.id, new.project_id);
    end if;
  end if;

  if new.title is distinct from old.title or new.description is distinct from old.description then
    insert into public.activity (project_id, task_id, entity, entity_id, actor_id, action, details)
    values (new.project_id, new.id, 'task', new.id, actor, 'edited', jsonb_build_object('title', new.title));
  end if;

  return new;
end $$;

create trigger tasks_after after insert or update on public.tasks
  for each row execute function public.task_after_change();

-- Checklist items
create or replace function public.checklist_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.done and (tg_op = 'INSERT' or not old.done) then
    new.done_by := auth.uid();
    new.done_at := now();
  elsif not new.done then
    new.done_by := null;
    new.done_at := null;
  end if;
  return new;
end $$;

create trigger checklist_before before insert or update on public.task_checklist
  for each row execute function public.checklist_before();

create or replace function public.checklist_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t record;
  actor uuid := auth.uid();
begin
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    select id, title, project_id into t from public.tasks where id = new.task_id;
    insert into public.task_watchers (task_id, user_id) values (new.task_id, new.assignee_id) on conflict do nothing;
    perform public.notify(new.assignee_id, 'checklist_assigned',
      coalesce(public.actor_name(actor), 'Northcroft') || ' gave you a step on ' || t.title,
      new.text, '/tasks/' || new.task_id, actor, new.task_id, t.project_id);
  end if;
  return new;
end $$;

create trigger checklist_after after insert or update on public.task_checklist
  for each row execute function public.checklist_after();

-- ---------------------------------------------------------------------------
-- Comments and mentions
-- ---------------------------------------------------------------------------
create or replace function public.comment_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.task_id is not null then
    select project_id into new.project_id from public.tasks where id = new.task_id;
  end if;
  new.mentions := coalesce(array(
    select distinct m from unnest(new.mentions) m
    where exists (select 1 from public.profiles p where p.id = m and p.active)
  ), '{}');
  if tg_op = 'UPDATE' then
    new.edited_at := now();
  end if;
  return new;
end $$;

create trigger comments_before before insert or update on public.comments
  for each row execute function public.comment_before();

create or replace function public.comment_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  aname text := coalesce(public.actor_name(new.author_id), 'Someone');
  snippet text := left(regexp_replace(new.body, '\s+', ' ', 'g'), 160);
  t record;
  place text;
  link text;
  u uuid;
begin
  if new.task_id is not null then
    select id, title, project_id into t from public.tasks where id = new.task_id;
    link := '/tasks/' || new.task_id;
    insert into public.task_watchers (task_id, user_id)
      select new.task_id, x from unnest(array_append(new.mentions, new.author_id)) x
      on conflict do nothing;
    foreach u in array new.mentions loop
      perform public.notify(u, 'mention', aname || ' mentioned you on ' || t.title, snippet, link,
        new.author_id, new.task_id, t.project_id);
    end loop;
    for u in
      select w.user_id from public.task_watchers w
      where w.task_id = new.task_id and w.user_id <> new.author_id and not (w.user_id = any (new.mentions))
    loop
      perform public.notify(u, 'comment', aname || ' commented on ' || t.title, snippet, link,
        new.author_id, new.task_id, t.project_id);
    end loop;
  else
    if new.project_id is not null then
      select name into place from public.projects where id = new.project_id;
      link := '/projects/' || new.project_id || '/chat';
    else
      place := 'team chat';
      link := '/chat';
    end if;
    foreach u in array new.mentions loop
      perform public.notify(u, 'mention', aname || ' mentioned you in ' || place, snippet, link,
        new.author_id, null, new.project_id);
    end loop;
  end if;
  return new;
end $$;

create trigger comments_after after insert on public.comments
  for each row execute function public.comment_after();

-- ---------------------------------------------------------------------------
-- Announcements
-- ---------------------------------------------------------------------------
create or replace function public.announcement_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p record;
begin
  for p in select id from public.profiles where active and id <> coalesce(new.author_id, '00000000-0000-0000-0000-000000000000'::uuid) loop
    perform public.notify(p.id, 'announcement',
      case when new.important then 'Important: ' else '' end || new.title,
      left(new.body, 200), '/announcements?id=' || new.id, new.author_id, null, new.project_id, new.id);
  end loop;
  return new;
end $$;

create trigger announcements_after after insert on public.announcements
  for each row execute function public.announcement_after();

create or replace function public.nudge_announcement(p_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  a record;
  p record;
  n int := 0;
begin
  if auth.uid() is not null and not public.can_assign() then
    raise exception 'Only Hassan or a senior can send reminders';
  end if;
  select * into a from public.announcements where id = p_id;
  if a.id is null then
    raise exception 'Announcement not found';
  end if;
  for p in
    select pr.id from public.profiles pr
    where pr.active and pr.id is distinct from a.author_id
      and not exists (select 1 from public.announcement_acks k where k.announcement_id = a.id and k.user_id = pr.id)
  loop
    perform public.notify(p.id, 'ack_nudge', 'Please acknowledge: ' || a.title, left(a.body, 160),
      '/announcements?id=' || a.id, auth.uid(), null, a.project_id, a.id);
    n := n + 1;
  end loop;
  update public.announcements set nudged_at = now() where id = a.id;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Calendar events
-- ---------------------------------------------------------------------------
create or replace function public.event_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  u uuid;
  aname text := coalesce(public.actor_name(new.created_by), 'Someone');
  when_txt text := to_char(new.event_date, 'Dy DD Mon') || coalesce(' at ' || to_char(new.start_time, 'HH24:MI'), '');
begin
  foreach u in array new.attendees loop
    if tg_op = 'INSERT' or not (u = any (old.attendees)) then
      perform public.notify(u, 'event', aname || ' added you to ' || new.title,
        concat_ws(' · ', when_txt, new.location), '/calendar?date=' || new.event_date, new.created_by,
        null, new.project_id);
    end if;
  end loop;
  return new;
end $$;

create trigger events_after after insert or update on public.events
  for each row execute function public.event_after();

-- ---------------------------------------------------------------------------
-- Variations and BOQ packages
-- ---------------------------------------------------------------------------
create or replace function public.vo_status_label(s text) returns text
language sql immutable set search_path = public as $$
  select case s
    when 'identified' then 'Identified'
    when 'requested' then 'Proposal requested'
    when 'quoted' then 'Quotation received'
    when 'evaluation' then 'QS evaluation'
    when 'recommended' then 'Recommended'
    when 'approved' then 'Approved'
    when 'agreed' then 'Value agreed'
    when 'closed' then 'Closed'
    when 'rejected' then 'Rejected'
    when 'withdrawn' then 'Withdrawn'
    when 'disputed' then 'Disputed'
    else s end;
$$;

create or replace function public.boq_status_label(s text) returns text
language sql immutable set search_path = public as $$
  select case s
    when 'not_started' then 'Not started'
    when 'measuring' then 'Measuring'
    when 'pricing' then 'Pricing'
    when 'checked' then 'Checked'
    when 'issued' then 'Issued'
    else s end;
$$;

create or replace function public.variation_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := coalesce(auth.uid(), new.created_by);
  aname text := coalesce(public.actor_name(actor), 'Someone');
  link text := '/projects/' || new.project_id || '/variations?vo=' || new.id;
  label text := new.vo_number || ' ' || new.title;
begin
  if tg_op = 'INSERT' then
    insert into public.activity (project_id, entity, entity_id, actor_id, action, details)
    values (new.project_id, 'variation', new.id, actor, 'created',
            jsonb_build_object('vo_number', new.vo_number, 'title', new.title, 'status', new.status));
    perform public.notify(new.owner_id, 'vo_assigned', aname || ' gave you ' || label,
      public.vo_status_label(new.status), link, actor, null, new.project_id);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.activity (project_id, entity, entity_id, actor_id, action, details)
    values (new.project_id, 'variation', new.id, actor, 'status',
            jsonb_build_object('vo_number', new.vo_number, 'from', old.status, 'to', new.status));
    if new.owner_id is not distinct from old.owner_id then
      perform public.notify(new.owner_id, 'vo_update', label || ' is now ' || public.vo_status_label(new.status),
        aname || ' updated the status', link, actor, null, new.project_id);
    end if;
  end if;

  if new.owner_id is distinct from old.owner_id and new.owner_id is not null then
    perform public.notify(new.owner_id, 'vo_assigned', aname || ' gave you ' || label,
      public.vo_status_label(new.status), link, actor, null, new.project_id);
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

create trigger variations_after after insert or update on public.variations
  for each row execute function public.variation_after();

create or replace function public.boq_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  aname text := coalesce(public.actor_name(actor), 'Someone');
  link text := '/projects/' || new.project_id || '/boq';
begin
  if tg_op = 'INSERT' then
    insert into public.activity (project_id, entity, entity_id, actor_id, action, details)
    values (new.project_id, 'boq', new.id, actor, 'created', jsonb_build_object('name', new.name, 'status', new.status));
    perform public.notify(new.owner_id, 'boq_assigned', aname || ' gave you the ' || new.name || ' BOQ',
      public.boq_status_label(new.status), link, actor, null, new.project_id);
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.activity (project_id, entity, entity_id, actor_id, action, details)
    values (new.project_id, 'boq', new.id, actor, 'status',
            jsonb_build_object('name', new.name, 'from', old.status, 'to', new.status));
    if new.owner_id is not distinct from old.owner_id then
      perform public.notify(new.owner_id, 'boq_update', new.name || ' BOQ is now ' || public.boq_status_label(new.status),
        aname || ' updated the status', link, actor, null, new.project_id);
    end if;
  end if;
  if new.owner_id is distinct from old.owner_id and new.owner_id is not null then
    perform public.notify(new.owner_id, 'boq_assigned', aname || ' gave you the ' || new.name || ' BOQ',
      public.boq_status_label(new.status), link, actor, null, new.project_id);
  end if;
  return new;
end $$;

create trigger boq_after after insert or update on public.boq_packages
  for each row execute function public.boq_after();

-- ---------------------------------------------------------------------------
-- Push subscriptions and test push
-- ---------------------------------------------------------------------------
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, last_seen_at)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300), now())
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, last_seen_at = now();
end $$;

create or replace function public.send_test_push() returns uuid
language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  insert into public.notifications (user_id, type, title, body, link)
  values (auth.uid(), 'test', 'Notifications are working', 'This is a test from Northcroft.', '/settings')
  returning id into nid;
  return nid;
end $$;

-- ---------------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------------
create or replace function public.nearest_place(p_lat double precision, p_lng double precision)
returns table (id uuid, name text, kind text, distance_m double precision)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.kind, d.m
  from public.places p
  cross join lateral (
    select 2 * 6371000 * asin(sqrt(
      power(sin(radians(p.lat - p_lat) / 2), 2)
      + cos(radians(p_lat)) * cos(radians(p.lat)) * power(sin(radians(p.lng - p_lng) / 2), 2)
    )) as m
  ) d
  where p.active and p_lat is not null and p_lng is not null and d.m <= p.radius_m
  order by d.m
  limit 1;
$$;

create or replace function public.check_in(
  p_lat double precision default null, p_lng double precision default null,
  p_accuracy double precision default null, p_address text default null, p_note text default null)
returns public.attendance
language plpgsql security definer set search_path = public as $$
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

  insert into public.attendance (user_id, work_date, check_in_at, in_lat, in_lng, in_accuracy, in_address,
    in_place_id, in_place_name, in_place_kind, late_minutes, note)
  values (auth.uid(), d, t, p_lat, p_lng, p_accuracy, left(p_address, 300),
    pl.id,
    coalesce(pl.name, case when p_lat is null then 'Location unavailable' else 'Elsewhere' end),
    case when pl.id is not null then pl.kind when p_lat is null then 'unknown' else 'elsewhere' end,
    case when public.is_workday(d) and lt > s.work_start + make_interval(mins => s.grace_minutes)
         then floor(extract(epoch from (lt - s.work_start)) / 60)::int else 0 end,
    left(p_note, 500))
  on conflict (user_id, work_date) do nothing
  returning * into rec;

  if rec.id is null then
    raise exception 'You have already checked in today';
  end if;
  return rec;
end $$;

create or replace function public.check_out(
  p_lat double precision default null, p_lng double precision default null,
  p_accuracy double precision default null, p_address text default null, p_note text default null)
returns public.attendance
language plpgsql security definer set search_path = public as $$
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
    note = coalesce(nullif(left(p_note, 500), ''), a.note)
  where a.user_id = auth.uid() and a.work_date = d
  returning * into rec;

  if rec.id is null then
    raise exception 'Check in first, then you can check out';
  end if;
  return rec;
end $$;

-- ---------------------------------------------------------------------------
-- Recurring tasks
-- ---------------------------------------------------------------------------
create or replace function public.recurring_next_date(p_frequency text, p_weekday int, p_month_day int, p_after date)
returns date
language plpgsql stable security definer set search_path = public as $$
declare d date;
begin
  if p_frequency = 'daily' then
    return public.next_workday(p_after + 1);
  elsif p_frequency = 'weekly' then
    d := p_after + 1;
    while extract(dow from d)::int <> coalesce(p_weekday, 0) loop
      d := d + 1;
    end loop;
    return d;
  else
    d := make_date(extract(year from p_after)::int, extract(month from p_after)::int, coalesce(p_month_day, 1));
    if d <= p_after then
      d := (d + interval '1 month')::date;
    end if;
    return d;
  end if;
end $$;

create or replace function public.recurring_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or (new.frequency, new.weekday, new.month_day) is distinct from (old.frequency, old.weekday, old.month_day) then
    new.next_run := public.recurring_next_date(new.frequency, new.weekday, new.month_day, public.riyadh_today() - 1);
  end if;
  return new;
end $$;

create trigger recurring_before before insert or update on public.recurring_tasks
  for each row execute function public.recurring_before();

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
    insert into public.tasks (project_id, title, description, priority, assignee_id, reviewer_id, created_by,
      due_date, estimate_hours, recurring_id)
    values (r.project_id, r.title, r.description, r.priority, r.assignee_id, r.reviewer_id, r.created_by,
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
-- Morning reminders (08:00 Riyadh on working days)
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
    select t.*, pr.name as pname from public.tasks t left join public.projects pr on pr.id = t.project_id
    where t.status in ('todo', 'in_progress') and t.due_date = today and t.assignee_id is not null
  loop
    perform public.notify(r.assignee_id, 'due_today', 'Due today: ' || r.title, r.pname, '/tasks/' || r.id, null, r.id, r.project_id);
  end loop;

  for r in
    select t.*, pr.name as pname from public.tasks t left join public.projects pr on pr.id = t.project_id
    where t.status in ('todo', 'in_progress') and t.due_date > today and t.due_date <= nextday and t.assignee_id is not null
  loop
    perform public.notify(r.assignee_id, 'due_soon',
      'Due ' || case when r.due_date = today + 1 then 'tomorrow' else trim(to_char(r.due_date, 'Day')) end || ': ' || r.title,
      r.pname, '/tasks/' || r.id, null, r.id, r.project_id);
  end loop;

  for r in
    select assignee_id, count(*) as n, string_agg(title, ', ' order by due_date) as titles
    from public.tasks
    where status in ('todo', 'in_progress') and due_date < today and assignee_id is not null
    group by assignee_id
  loop
    perform public.notify(r.assignee_id, 'overdue',
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
    select v.*, pr.name as pname from public.variations v join public.projects pr on pr.id = v.project_id
    where v.response_due <= today and v.owner_id is not null
      and v.status in ('identified', 'requested', 'quoted', 'evaluation', 'recommended', 'disputed')
  loop
    perform public.notify(r.owner_id, 'vo_due',
      r.vo_number || case when r.response_due = today then ' action due today' else ' action is overdue' end,
      r.title || ' · ' || r.pname, '/projects/' || r.project_id || '/variations?vo=' || r.id, null, null, r.project_id);
  end loop;

  for r in
    select b.*, pr.name as pname from public.boq_packages b join public.projects pr on pr.id = b.project_id
    where b.due_date <= today and b.owner_id is not null and b.status <> 'issued'
  loop
    perform public.notify(r.owner_id, 'boq_due',
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
-- Function permissions
-- ---------------------------------------------------------------------------
revoke execute on function public.notify(uuid, text, text, text, text, uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.get_push_config() from public, anon, authenticated;
grant execute on function public.get_push_config() to service_role;
revoke execute on function public.daily_reminders() from public, anon, authenticated;
revoke execute on function public.actor_name(uuid) from anon;
revoke execute on function public.check_in(double precision, double precision, double precision, text, text) from anon;
revoke execute on function public.check_out(double precision, double precision, double precision, text, text) from anon;
revoke execute on function public.save_push_subscription(text, text, text, text) from anon;
revoke execute on function public.send_test_push() from anon;
revoke execute on function public.nudge_announcement(uuid) from anon;
revoke execute on function public.run_recurring() from anon;
revoke execute on function public.nearest_place(double precision, double precision) from anon;

-- ---------------------------------------------------------------------------
-- Schedules (UTC). 02:00 UTC = 05:00 Riyadh, 05:00 UTC = 08:00 Riyadh.
-- ---------------------------------------------------------------------------
select cron.schedule('northcroft-recurring', '0 2 * * *', $$select public.run_recurring()$$);
select cron.schedule('northcroft-reminders', '0 5 * * *', $$select public.daily_reminders()$$);
select cron.schedule('northcroft-cleanup', '30 3 * * 5',
  $$delete from public.notifications where created_at < now() - interval '180 days'$$);

-- ---------------------------------------------------------------------------
-- File storage
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 52428800)
on conflict (id) do nothing;

create policy "team reads files" on storage.objects for select to authenticated
  using (bucket_id = 'files' and public.is_member());
create policy "team uploads files" on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and public.is_member());
create policy "owner or assigner deletes files" on storage.objects for delete to authenticated
  using (bucket_id = 'files' and (owner = auth.uid() or public.can_assign()));

-- ---------------------------------------------------------------------------
-- Live updates
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table
  public.notifications, public.tasks, public.task_checklist, public.comments,
  public.announcements, public.announcement_acks, public.attendance, public.variations,
  public.boq_packages, public.events, public.projects, public.attachments, public.profiles;
