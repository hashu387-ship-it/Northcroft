-- Search everything, and action points on calendar meetings that become tasks.
--
-- 1. search_everything(q, kind, limit): one search across tasks (with their steps), chat messages
--    and task comments (with voice note text), files, projects, variations, BOQ packages, people,
--    announcements and calendar entries. It runs as the person searching (security invoker), so
--    the usual rules decide what they can find: private chats only show up for the people in them.
--    Every word typed has to appear (in any order, any case).
-- 2. event_actions: the action points of a meeting (what, who, by when). Anyone who made the entry,
--    anyone invited to it, and managers and seniors can add and edit them. Managers and seniors turn
--    them into tasks with make_tasks_from_actions(); each task remembers the meeting it came from.

/* ------------------------------------------------------------------ search helpers */

-- The words typed, each as an ILIKE pattern with % and _ taken literally.
create or replace function public.search_terms(p_q text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(
    array_agg('%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%'),
    '{}'::text[]
  )
  from regexp_split_to_table(lower(btrim(coalesce(p_q, ''))), '\s+') as w
  where w <> ''
$$;

-- True when every word appears somewhere in the text.
create or replace function public.search_match(p_hay text, p_terms text[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select cardinality(p_terms) > 0
     and not exists (select 1 from unnest(p_terms) as t where coalesce(p_hay, '') not ilike t)
$$;

-- About 140 characters of the text around the first word typed.
create or replace function public.search_snippet(p_text text, p_q text)
returns text
language sql
immutable
set search_path = public
as $$
  with t as (
    select regexp_replace(btrim(coalesce(p_text, '')), '\s+', ' ', 'g') as s,
           split_part(lower(btrim(coalesce(p_q, ''))), ' ', 1) as w
  ), p as (
    select s, greatest(strpos(lower(s), w) - 50, 1) as start from t
  )
  -- Starts on a whole word when it starts part-way through.
  select nullif(
    case when start > 1 then '…' || regexp_replace(substr(s, start, 150), '^\S*\s+', '') else substr(s, 1, 150) end
    || case when length(s) > start + 149 then '…' else '' end,
    '')
  from p
$$;

/* ------------------------------------------------------------------ meeting action points */

create table if not exists public.event_actions (
  id uuid primary key default gen_random_uuid(),
  -- The calendar entry it belongs to. (No foreign key: removing an entry leaves its points
  -- behind unseen, the same way Drive links work.)
  event_id uuid not null,
  body text not null check (length(btrim(body)) between 1 and 500),
  assignee_id uuid references public.profiles (id),
  due_date date,
  position integer not null default 0,
  -- The task made from it, once there is one.
  task_id uuid,
  -- A point that needed no task can simply be ticked off.
  done_at timestamptz,
  done_by uuid references public.profiles (id),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Taking a point off keeps the row (and who did it) instead of removing it.
  removed_at timestamptz,
  removed_by uuid references public.profiles (id)
);
create index if not exists event_actions_event_idx on public.event_actions (event_id) where removed_at is null;
create index if not exists event_actions_task_idx on public.event_actions (task_id) where task_id is not null;

-- Who may work on a calendar entry's action points: whoever made the entry, anyone invited to it,
-- and managers and seniors.
create or replace function public.can_edit_event_actions(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_member() and (
    public.can_assign()
    or exists (select 1 from public.events e
                where e.id = p_event and (e.created_by = auth.uid() or auth.uid() = any (coalesce(e.attendees, '{}'))))
  )
$$;
revoke all on function public.can_edit_event_actions(uuid) from public, anon;
grant execute on function public.can_edit_event_actions(uuid) to authenticated;

alter table public.event_actions enable row level security;

create policy "team sees action points" on public.event_actions
  for select to authenticated using (public.is_member());
create policy "meeting people add action points" on public.event_actions
  for insert to authenticated
  with check (created_by = auth.uid() and task_id is null and public.can_edit_event_actions(event_id));
create policy "meeting people edit action points" on public.event_actions
  for update to authenticated
  using (public.can_edit_event_actions(event_id))
  with check (public.can_edit_event_actions(event_id));

-- Keep the bookkeeping honest whatever screen is used: the task link only changes through
-- make_tasks_from_actions, and done/removed stamps record who did it.
create or replace function public.event_action_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.task_id := null;
    new.done_at := null;
    new.done_by := null;
    new.removed_at := null;
    new.removed_by := null;
  else
    new.event_id := old.event_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if new.task_id is distinct from old.task_id and coalesce(current_setting('northcroft.making_tasks', true), '') <> 'on' then
      new.task_id := old.task_id;
    end if;
    if new.done_at is not null and old.done_at is null then
      new.done_at := now();
      new.done_by := auth.uid();
    elsif new.done_at is null then
      new.done_by := null;
    else
      new.done_at := old.done_at;
      new.done_by := old.done_by;
    end if;
    -- Taking a point off is final.
    if old.removed_at is not null then
      new.removed_at := old.removed_at;
      new.removed_by := old.removed_by;
    elsif new.removed_at is not null then
      new.removed_at := now();
      new.removed_by := auth.uid();
    else
      new.removed_by := null;
    end if;
    new.updated_at := now();
  end if;
  if new.assignee_id is not null and not exists (
    select 1 from public.profiles p where p.id = new.assignee_id and p.active
  ) then
    raise exception 'That person is no longer on the team.';
  end if;
  return new;
end;
$$;

create or replace trigger event_action_guard
  before insert or update on public.event_actions
  for each row execute function public.event_action_guard();

grant select, insert, update on public.event_actions to authenticated;

-- Turn action points into tasks (managers and seniors). Each one becomes a task for the person it
-- names, due when it says, in the meeting's project, with a note of the meeting it came from.
-- Points that already have a task, are ticked off or taken off are skipped. Returns how many
-- tasks were made.
create or replace function public.make_tasks_from_actions(p_actions uuid[])
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  a record;
  new_task uuid;
  made integer := 0;
begin
  if not public.can_assign() then
    raise exception 'Only managers and seniors can turn action points into tasks.';
  end if;
  perform set_config('northcroft.making_tasks', 'on', true);
  for a in
    select x.id, x.body, x.assignee_id, x.due_date, e.title as meeting, e.event_date, e.project_id
      from public.event_actions x
      join public.events e on e.id = x.event_id
     where x.id = any (p_actions)
       and x.task_id is null and x.done_at is null and x.removed_at is null
     order by x.position, x.created_at
     for update of x
  loop
    if a.assignee_id is null then
      raise exception 'Pick who "%" is for before making it a task.', left(a.body, 60);
    end if;
    insert into public.tasks (title, description, project_id, assignees, reviewer_id, priority, due_date, created_by)
    values (
      left(btrim(a.body), 200),
      'From the meeting "' || a.meeting || '" on ' || to_char(a.event_date, 'FMDD Mon YYYY') || '.',
      a.project_id,
      array[a.assignee_id],
      auth.uid(),
      'normal',
      a.due_date,
      auth.uid()
    )
    returning id into new_task;
    update public.event_actions set task_id = new_task where id = a.id;
    made := made + 1;
  end loop;
  perform set_config('northcroft.making_tasks', 'off', true);
  return made;
end;
$$;
revoke all on function public.make_tasks_from_actions(uuid[]) from public, anon;
grant execute on function public.make_tasks_from_actions(uuid[]) to authenticated;

/* ------------------------------------------------------------------ search */

create or replace function public.search_everything(p_q text, p_kind text default null, p_limit integer default 8)
returns table (
  kind text,
  id uuid,
  title text,
  snippet text,
  project_id uuid,
  project_name text,
  link text,
  at timestamptz,
  meta jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with s as (
    select public.search_terms(p_q) as terms,
           least(greatest(coalesce(p_limit, 8), 1), 50) as lim
    where public.is_member() and length(btrim(coalesce(p_q, ''))) >= 2
  )
  -- Tasks: title, details and steps.
  (select 'task'::text, t.id, t.title,
          case when public.search_match(t.title, s.terms) then null else public.search_snippet(t.description, p_q) end,
          t.project_id, pr.name, '/tasks/' || t.id, coalesce(t.updated_at, t.created_at),
          jsonb_build_object('status', t.status, 'due', t.due_date, 'assignees', t.assignees, 'priority', t.priority)
     from public.tasks t
     cross join s
     left join public.projects pr on pr.id = t.project_id
    where (p_kind is null or p_kind = 'task')
      and public.search_match(
            t.title || ' ' || coalesce(t.description, '') || ' ' ||
            coalesce((select string_agg(c.text, ' ') from public.task_checklist c where c.task_id = t.id and c.removed_at is null), ''),
            s.terms)
    order by public.search_match(t.title, s.terms) desc, (t.status = 'done'), coalesce(t.updated_at, t.created_at) desc
    limit (select lim from s))
  union all
  -- Messages in every chat the person is in, and task comments (voice notes by their text).
  (select 'message'::text, c.id, coalesce(au.short_name, 'Former team member'),
          public.search_snippet(case when c.voice_path is not null then coalesce(c.transcript, c.body) else c.body end, p_q),
          coalesce(c.project_id, tk.project_id), pr.name,
          case
            when c.task_id is not null then '/tasks/' || c.task_id || '?m=' || c.id
            when c.conversation_id is not null then '/chats/' || c.conversation_id || '?m=' || c.id
            when c.project_id is not null then '/chats/project/' || c.project_id || '?m=' || c.id
            else '/chat?m=' || c.id
          end,
          c.created_at,
          jsonb_build_object(
            'author', c.author_id,
            'voice', c.voice_path is not null,
            'where', case
              when c.task_id is not null then tk.title
              when cv.kind = 'direct' then (
                select p.short_name from public.conversation_members m join public.profiles p on p.id = m.user_id
                 where m.conversation_id = c.conversation_id and m.user_id <> auth.uid()
                 order by m.joined_at limit 1)
              when c.conversation_id is not null then cv.name
              when c.project_id is not null then pr.name
              else 'Team chat'
            end,
            'where_kind', case
              when c.task_id is not null then 'task'
              when cv.kind = 'direct' then 'direct'
              when c.conversation_id is not null then 'group'
              when c.project_id is not null then 'project'
              else 'team'
            end)
     from public.comments c
     cross join s
     left join public.profiles au on au.id = c.author_id
     left join public.tasks tk on tk.id = c.task_id
     left join public.projects pr on pr.id = coalesce(c.project_id, tk.project_id)
     left join public.conversations cv on cv.id = c.conversation_id
    where (p_kind is null or p_kind = 'message')
      and c.event is null
      and public.search_match(coalesce(c.body, '') || ' ' || coalesce(c.transcript, ''), s.terms)
    order by c.created_at desc
    limit (select lim from s))
  union all
  -- Files: the newest version of each.
  (select 'file'::text, f.id, f.name, null::text,
          coalesce(f.project_id, tk.project_id), pr.name, '/files/' || f.id, f.created_at,
          jsonb_build_object('mime', f.mime, 'size', f.size, 'task', tk.title, 'by', f.uploaded_by,
                             'version', f.version, 'chat', f.conversation_id is not null)
     from (
       select distinct on (coalesce(a.version_of, a.id)) a.*
         from public.attachments a
         cross join s
        where (p_kind is null or p_kind = 'file')
          and public.search_match(a.name, s.terms)
        order by coalesce(a.version_of, a.id), a.version desc nulls last, a.created_at desc
     ) f
     left join public.tasks tk on tk.id = f.task_id
     left join public.projects pr on pr.id = coalesce(f.project_id, tk.project_id)
    order by f.created_at desc
    limit (select lim from s))
  union all
  -- Projects.
  (select 'project'::text, p.id, p.name,
          concat_ws(' · ', nullif(p.code, ''), nullif(p.client, ''), nullif(p.city, '')),
          p.id, p.name, '/projects/' || p.id, p.updated_at,
          jsonb_build_object('status', p.status, 'color', p.color)
     from public.projects p
     cross join s
    where (p_kind is null or p_kind = 'project')
      and public.search_match(concat_ws(' ', p.name, p.code, p.client, p.city, p.description), s.terms)
    order by public.search_match(p.name, s.terms) desc, (p.status = 'completed'), p.name
    limit (select lim from s))
  union all
  -- Variations.
  (select 'vo'::text, v.id, concat_ws(' ', nullif(v.vo_number, ''), v.title),
          case when public.search_match(concat_ws(' ', v.vo_number, v.title), s.terms) then null
               else public.search_snippet(concat_ws(' ', v.description, v.notes), p_q) end,
          v.project_id, pr.name, '/projects/' || v.project_id || '/variations?vo=' || v.id, v.updated_at,
          jsonb_build_object('status', v.status, 'value', coalesce(v.approved_value, v.assessed_value, v.submitted_value))
     from public.variations v
     cross join s
     left join public.projects pr on pr.id = v.project_id
    where (p_kind is null or p_kind = 'vo')
      and public.search_match(concat_ws(' ', v.vo_number, v.title, v.description, v.notes), s.terms)
    order by public.search_match(concat_ws(' ', v.vo_number, v.title), s.terms) desc, v.updated_at desc
    limit (select lim from s))
  union all
  -- BOQ packages.
  (select 'boq'::text, b.id, b.name,
          case when public.search_match(b.name, s.terms) then nullif(b.trade, '') else public.search_snippet(concat_ws(' ', b.trade, b.notes), p_q) end,
          b.project_id, pr.name, '/projects/' || b.project_id || '/boq', b.updated_at,
          jsonb_build_object('status', b.status, 'due', b.due_date)
     from public.boq_packages b
     cross join s
     left join public.projects pr on pr.id = b.project_id
    where (p_kind is null or p_kind = 'boq')
      and public.search_match(concat_ws(' ', b.name, b.trade, b.notes), s.terms)
    order by public.search_match(b.name, s.terms) desc, b.updated_at desc
    limit (select lim from s))
  union all
  -- People.
  (select 'person'::text, pf.id, pf.full_name, pf.title, null::uuid, null::text, null::text, pf.created_at,
          jsonb_build_object('short_name', pf.short_name)
     from public.profiles pf
     cross join s
    where (p_kind is null or p_kind = 'person')
      and pf.active
      and public.search_match(concat_ws(' ', pf.full_name, pf.short_name, pf.title, pf.email, pf.phone), s.terms)
    order by pf.full_name
    limit (select lim from s))
  union all
  -- Announcements.
  (select 'announcement'::text, an.id, an.title,
          public.search_snippet(case when an.voice_path is not null then coalesce(an.transcript, an.body) else an.body end, p_q),
          an.project_id, pr.name, '/announcements?id=' || an.id, an.created_at,
          jsonb_build_object('author', an.author_id)
     from public.announcements an
     cross join s
     left join public.projects pr on pr.id = an.project_id
    where (p_kind is null or p_kind = 'announcement')
      and public.search_match(concat_ws(' ', an.title, an.body, an.transcript), s.terms)
    order by an.created_at desc
    limit (select lim from s))
  union all
  -- Calendar entries (meetings, site visits, submissions, leave), with their action points.
  (select 'event'::text, e.id, e.title,
          case when public.search_match(e.title, s.terms) then nullif(e.location, '')
               else public.search_snippet(concat_ws(' ', e.location, e.notes,
                      (select string_agg(x.body, ' ') from public.event_actions x where x.event_id = e.id and x.removed_at is null)), p_q) end,
          e.project_id, pr.name, '/calendar?date=' || e.event_date || '&event=' || e.id,
          (e.event_date + coalesce(e.start_time, time '08:00'))::timestamp at time zone 'Asia/Riyadh',
          jsonb_build_object('kind', e.kind, 'date', e.event_date, 'start', e.start_time)
     from public.events e
     cross join s
     left join public.projects pr on pr.id = e.project_id
    where (p_kind is null or p_kind = 'event')
      and public.search_match(concat_ws(' ', e.title, e.location, e.notes,
            (select string_agg(x.body, ' ') from public.event_actions x where x.event_id = e.id and x.removed_at is null)), s.terms)
    order by e.event_date desc
    limit (select lim from s))
$$;

revoke all on function public.search_everything(text, text, integer) from public, anon;
grant execute on function public.search_everything(text, text, integer) to authenticated;
grant execute on function public.search_terms(text) to authenticated;
grant execute on function public.search_match(text, text[]) to authenticated;
grant execute on function public.search_snippet(text, text) to authenticated;


-- Live updates for the meeting sheet.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'event_actions') then
    alter publication supabase_realtime add table public.event_actions;
  end if;
end $$;
