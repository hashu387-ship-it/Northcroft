-- Daily updates, built on tasks.
--   Everyone with "Sends a daily update" on (the team; not Hassan or Fawaz) sends one update a day:
--   for each of their open tasks, how far it is (%) and what they did on it today, then any other
--   work and anything blocking them. Setting a task to 100% hands it in for review, the same as
--   tapping Submit, so the usual sign-off follows. Managers and seniors see everyone's updates.
--   A reminder goes at 5:00 pm to anyone checked in who hasn't sent theirs, and check-out asks for it
--   first. At 6:00 pm managers get one line saying who has and hasn't sent it.
--   Each task keeps its latest % (tasks.progress), shown on the task and in lists.

alter table public.profiles add column if not exists daily_update boolean not null default true;
update public.profiles set daily_update = false where role = 'manager' and daily_update;

alter table public.tasks
  add column if not exists progress smallint not null default 0 check (progress between 0 and 100),
  add column if not exists progress_at timestamptz;

create table if not exists public.daily_updates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id),
  work_date date not null,
  other_work text check (char_length(other_work) <= 2000),
  blockers text check (char_length(blockers) <= 2000),
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, work_date)
);

create table if not exists public.daily_update_items (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.daily_updates (id),
  task_id uuid not null,
  -- The task's title then, so the update still reads right if the task is renamed or removed.
  task_title text not null,
  project_id uuid,
  progress_before smallint not null default 0,
  progress smallint not null check (progress between 0 and 100),
  note text check (char_length(note) <= 1000),
  handed_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (update_id, task_id)
);
create index if not exists daily_updates_date_idx on public.daily_updates (work_date);
create index if not exists daily_update_items_task_idx on public.daily_update_items (task_id);

-- Once-only bookkeeping for the 5 pm reminders and the 6 pm summary.
create table if not exists public.daily_update_reminders (
  user_id uuid not null,
  work_date date not null,
  kind text not null check (kind in ('remind', 'summary')),
  sent_at timestamptz not null default now(),
  primary key (user_id, work_date, kind)
);
alter table public.daily_update_reminders enable row level security;

-- Your own updates; managers and seniors see everyone's.
alter table public.daily_updates enable row level security;
alter table public.daily_update_items enable row level security;
create policy "see daily updates" on public.daily_updates
  for select to authenticated using (user_id = auth.uid() or public.can_assign());
create policy "write own daily update" on public.daily_updates
  for insert to authenticated with check (user_id = auth.uid() and public.is_member());
create policy "change own daily update" on public.daily_updates
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "see daily update items" on public.daily_update_items
  for select to authenticated using (exists (
    select 1 from public.daily_updates u where u.id = update_id and (u.user_id = auth.uid() or public.can_assign())));
create policy "write own daily update items" on public.daily_update_items
  for insert to authenticated with check (exists (
    select 1 from public.daily_updates u where u.id = update_id and u.user_id = auth.uid()));
create policy "change own daily update items" on public.daily_update_items
  for update to authenticated using (exists (
    select 1 from public.daily_updates u where u.id = update_id and u.user_id = auth.uid()));
grant select, insert, update on public.daily_updates, public.daily_update_items to authenticated;

-- Send (or resend) today's update. p_items: [{ "task_id": uuid, "progress": 0-100, "note": text }].
-- Runs as the person sending it, so the normal task rules apply. Returns how many tasks were handed in.
create or replace function public.submit_daily_update(p_items jsonb, p_other text default null, p_blockers text default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  today date := public.riyadh_today();
  upd uuid;
  it jsonb;
  t record;
  pct int;
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
    set other_work = excluded.other_work, blockers = excluded.blockers, submitted_at = now(), updated_at = now()
  returning id into upd;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    select id, title, project_id, status, progress, assignees into t
      from public.tasks where id = (it->>'task_id')::uuid;
    if not found then
      continue;
    end if;
    if not (uid = any (t.assignees)) then
      raise exception 'You can only update tasks you''re on';
    end if;
    pct := greatest(0, least(100, coalesce((it->>'progress')::int, t.progress)));
    note := nullif(btrim(coalesce(it->>'note', '')), '');

    insert into public.daily_update_items (update_id, task_id, task_title, project_id, progress_before, progress, note)
    values (upd, t.id, t.title, t.project_id, t.progress, pct, note)
    on conflict (update_id, task_id) do update
      set progress = excluded.progress, note = excluded.note, task_title = excluded.task_title, updated_at = now();
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
end $$;
revoke all on function public.submit_daily_update(jsonb, text, text) from public, anon;
grant execute on function public.submit_daily_update(jsonb, text, text) to authenticated;

-- 5 pm: a reminder to anyone checked in today who hasn't sent their update.
-- 6 pm: one line to the managers saying who has and hasn't.
create or replace function public.daily_update_reminders(p_kind text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  d date := public.riyadh_today();
  r record;
  n int := 0;
  sent_names text;
  missing_names text;
  sent_count int;
  due_count int;
begin
  if not public.is_workday(d) then
    return 0;
  end if;

  if p_kind = 'remind' then
    for r in
      select p.id, p.short_name
        from public.profiles p
        join public.attendance a on a.user_id = p.id and a.work_date = d
       where p.active and p.daily_update and not p.attendance_exempt
         and not public.on_leave(p.id, d)
         and not exists (select 1 from public.daily_updates u where u.user_id = p.id and u.work_date = d)
    loop
      insert into public.daily_update_reminders (user_id, work_date, kind) values (r.id, d, 'remind') on conflict do nothing;
      if found then
        perform public.notify(r.id, 'daily_update', 'Time for your daily update',
          'How far did your tasks get today, ' || r.short_name || '? Tap to send your update before you check out.',
          '/updates', null);
        n := n + 1;
      end if;
    end loop;

  elsif p_kind = 'summary' then
    select count(*) filter (where u.id is not null),
           count(*),
           string_agg(p.short_name, ', ' order by p.short_name) filter (where u.id is null)
      into sent_count, due_count, missing_names
      from public.profiles p
      join public.attendance a on a.user_id = p.id and a.work_date = d
      left join public.daily_updates u on u.user_id = p.id and u.work_date = d
     where p.active and p.daily_update and not p.attendance_exempt and not public.on_leave(p.id, d);
    if coalesce(due_count, 0) = 0 then
      return 0;
    end if;
    for r in select p.id from public.profiles p where p.active and p.role = 'manager' loop
      insert into public.daily_update_reminders (user_id, work_date, kind) values (r.id, d, 'summary') on conflict do nothing;
      if found then
        perform public.notify(r.id, 'daily_update', 'Daily updates: ' || sent_count || ' of ' || due_count || ' sent',
          case when missing_names is null then 'Everyone who came in today has sent their update.'
               else 'Not sent yet: ' || missing_names || '.' end,
          '/updates', null);
        n := n + 1;
      end if;
    end loop;

  else
    raise exception 'Unknown reminder: %', p_kind;
  end if;
  return n;
end $$;
revoke all on function public.daily_update_reminders(text) from public, anon, authenticated;

-- Only managers change who sends a daily update.
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
       or new.daily_update is distinct from old.daily_update then
      raise exception 'Only the manager can change roles, titles, access or leave allowances';
    end if;
  elsif old.role = 'manager' and (new.role <> 'manager' or not new.active)
        and (select count(*) from public.profiles where role = 'manager' and active) <= 1 then
    raise exception 'The team needs at least one active manager';
  end if;
  return new;
end $$;

-- 5:00 pm and 6:00 pm Riyadh (UTC+3), every day; the functions skip days off.
select cron.schedule('northcroft-daily-update-remind', '0 14 * * *', $c$select public.daily_update_reminders('remind')$c$);
select cron.schedule('northcroft-daily-update-summary', '0 15 * * *', $c$select public.daily_update_reminders('summary')$c$);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'daily_updates') then
    alter publication supabase_realtime add table public.daily_updates, public.daily_update_items;
  end if;
end $$;
