-- EIs and registers, part two (migration 0050): the team's own status words, and sub tasks.
--
--   * Statuses: Open, In progress, Prepared, Submitted, Waiting, On hold, Closed.
--   * Sub tasks: any item can hold a short list of sub tasks ("Paint take-off from the shop
--     drawing"), each with one person and a done tick. Anyone on the team adds and ticks them; managers,
--     seniors and whoever added one can remove it.
--   * Alerts: the person given a sub task hears about it, and the item's Northcroft responsible
--     person hears when one is ticked done.

/* ---------------------------------------------------------------- statuses */
alter table public.register_items drop constraint if exists register_items_status_check;
alter table public.register_items add constraint register_items_status_check
  check (status in ('open', 'in_progress', 'prepared', 'submitted', 'waiting', 'on_hold', 'closed'));

create or replace function public.register_status_label(p text)
returns text language sql immutable as $$
  select case p when 'open' then 'Open' when 'in_progress' then 'In progress'
                when 'prepared' then 'Prepared' when 'submitted' then 'Submitted'
                when 'waiting' then 'Waiting' when 'on_hold' then 'On hold'
                when 'closed' then 'Closed' else p end
$$;

/* ---------------------------------------------------------------- sub tasks */
create table if not exists public.register_subtasks (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.register_items (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 300),
  assignee_id uuid references public.profiles (id) on delete set null,
  done boolean not null default false,
  done_at timestamptz,
  done_by uuid references public.profiles (id) on delete set null,
  sort int not null default 0,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists register_subtasks_item_idx on public.register_subtasks (item_id);
create index if not exists register_subtasks_project_idx on public.register_subtasks (project_id);
create index if not exists register_subtasks_assignee_idx on public.register_subtasks (assignee_id);

alter table public.register_subtasks enable row level security;
revoke update on public.register_subtasks from anon, authenticated;
grant update (title, assignee_id, done, sort) on public.register_subtasks to authenticated;

drop policy if exists "register sub tasks readable" on public.register_subtasks;
create policy "register sub tasks readable" on public.register_subtasks
  for select to authenticated using (public.is_member());
drop policy if exists "team adds register sub tasks" on public.register_subtasks;
create policy "team adds register sub tasks" on public.register_subtasks
  for insert to authenticated with check (public.is_member() and created_by = auth.uid());
drop policy if exists "team edits register sub tasks" on public.register_subtasks;
create policy "team edits register sub tasks" on public.register_subtasks
  for update to authenticated using (public.is_member()) with check (public.is_member());
drop policy if exists "adder or seniors remove register sub tasks" on public.register_subtasks;
create policy "adder or seniors remove register sub tasks" on public.register_subtasks
  for delete to authenticated using (public.can_assign() or created_by = auth.uid());

-- Tidy the title, take the project from the item, and keep who ticked it and when.
create or replace function public.register_subtask_before()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  item_project uuid;
begin
  new.title := btrim(new.title);
  if tg_op = 'INSERT' then
    select project_id into item_project from public.register_items where id = new.item_id;
    if item_project is null then
      raise exception 'That item is no longer there';
    end if;
    new.project_id := item_project;
    if new.done then
      new.done_at := now();
      new.done_by := coalesce(auth.uid(), new.created_by);
    else
      new.done_at := null;
      new.done_by := null;
    end if;
  else
    new.item_id := old.item_id;
    new.project_id := old.project_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if new.done and not old.done then
      new.done_at := now();
      new.done_by := auth.uid();
    elsif not new.done then
      new.done_at := null;
      new.done_by := null;
    else
      new.done_at := old.done_at;
      new.done_by := old.done_by;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists register_subtasks_before on public.register_subtasks;
create trigger register_subtasks_before before insert or update on public.register_subtasks
  for each row execute function public.register_subtask_before();

create or replace function public.register_subtask_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  i record;
  actor uuid := coalesce(auth.uid(), new.created_by);
  aname text := coalesce(public.actor_name(actor), 'Someone');
  label text;
  link text;
  pname text;
begin
  select id, project_id, category_id, ref, title, responsible_id into i from public.register_items where id = new.item_id;
  if i.id is null then
    return null;
  end if;
  label := public.register_item_label(i.ref, i.title, i.category_id);
  link := public.register_item_link(i.project_id, i.category_id, i.id);
  pname := coalesce((select name from public.projects where id = i.project_id), 'a project');

  -- Given a sub task that still needs doing.
  if new.assignee_id is not null and not new.done
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    perform public.notify(new.assignee_id, 'register', aname || ' gave you a sub task on ' || label,
      new.title || ' · ' || pname, link, actor, null, i.project_id);
  end if;
  -- Ticked done: the Northcroft responsible person hears.
  if tg_op = 'UPDATE' and new.done and not old.done and i.responsible_id is not null then
    perform public.notify(i.responsible_id, 'register', aname || ' finished a sub task on ' || label,
      new.title || ' · ' || pname, link, actor, null, i.project_id);
  end if;
  return null;
end $$;

drop trigger if exists register_subtasks_after on public.register_subtasks;
create trigger register_subtasks_after after insert or update on public.register_subtasks
  for each row execute function public.register_subtask_after();

/* ---------------------------------------------------------------- live updates */
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'register_subtasks') then
    alter publication supabase_realtime add table public.register_subtasks;
  end if;
end $$;
