-- Registers in each project (migration 0049): EIs in every project, and any other categories a
-- project needs (RFIs, Claims, Letters...). Each item has a reference, a title, the date it came in,
-- a due date, a status, a Northcroft responsible person, the people assigned to it and notes. Its
-- files live in its own folder in the project's Files (Files > EIs > EI-242 Hardscaping), so files,
-- Google Drive and web links work exactly as they do everywhere else. VOs get a Northcroft
-- responsible person too.
--
-- Rules:
--   * Everyone can see them. Anyone on the team adds items and changes them (as with VOs).
--   * Managers and seniors (can_assign) add, rename and remove categories. EIs can't be removed,
--     and a category can only be removed once it has no items.
--   * Managers, seniors and whoever added an item can remove it. Its folder stays in Files while
--     it still holds files or links; an empty one goes with it.
--   * The Northcroft responsible person and the people assigned hear when an item is added or given
--     to them, when its status changes, and when a file is added to it.

/* ---------------------------------------------------------------- categories */
create table if not exists public.register_categories (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 40),
  -- What its references usually start with ("EI", "RFI"); a hint for the form, nothing more.
  prefix text check (prefix is null or length(btrim(prefix)) between 1 and 8),
  -- EIs: made for every project, can't be removed.
  builtin boolean not null default false,
  sort int not null default 100,
  -- Its folder in the project's Files, made with its first item.
  folder_id uuid references public.project_folders (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists register_categories_project_idx on public.register_categories (project_id);
create unique index if not exists register_categories_name_uq on public.register_categories (project_id, lower(btrim(name)));
create unique index if not exists register_categories_builtin_uq on public.register_categories (project_id) where builtin;

/* ---------------------------------------------------------------- items */
create table if not exists public.register_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  category_id uuid not null references public.register_categories (id) on delete cascade,
  ref text check (ref is null or length(btrim(ref)) <= 40),
  title text not null check (length(btrim(title)) between 1 and 300),
  description text check (description is null or length(description) <= 4000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'waiting', 'closed')),
  received_on date,
  due_on date,
  -- Northcroft responsible.
  responsible_id uuid references public.profiles (id) on delete set null,
  assignees uuid[] not null default '{}',
  notes text check (notes is null or length(notes) <= 4000),
  -- Its own folder in the project's Files, inside its category's folder.
  folder_id uuid references public.project_folders (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists register_items_category_idx on public.register_items (category_id);
create index if not exists register_items_project_idx on public.register_items (project_id);
create index if not exists register_items_responsible_idx on public.register_items (responsible_id);
create index if not exists register_items_assignees_idx on public.register_items using gin (assignees);
create index if not exists register_items_folder_idx on public.register_items (folder_id);

/* ---------------------------------------------------------------- VOs: Northcroft responsible */
alter table public.variations add column if not exists responsible_id uuid references public.profiles (id) on delete set null;

/* ---------------------------------------------------------------- who can do what */
alter table public.register_categories enable row level security;
alter table public.register_items enable row level security;

-- Only these can be changed after a row is made; everything else is set by the database.
revoke update on public.register_categories from anon, authenticated;
grant update (name, prefix, sort) on public.register_categories to authenticated;
revoke update on public.register_items from anon, authenticated;
grant update (ref, title, description, status, received_on, due_on, responsible_id, assignees, notes) on public.register_items to authenticated;

drop policy if exists "register categories readable" on public.register_categories;
create policy "register categories readable" on public.register_categories
  for select to authenticated using (public.is_member());
drop policy if exists "seniors add register categories" on public.register_categories;
create policy "seniors add register categories" on public.register_categories
  for insert to authenticated with check (public.can_assign() and not builtin and created_by = auth.uid());
drop policy if exists "seniors rename register categories" on public.register_categories;
create policy "seniors rename register categories" on public.register_categories
  for update to authenticated using (public.can_assign()) with check (public.can_assign());
drop policy if exists "seniors remove empty register categories" on public.register_categories;
create policy "seniors remove empty register categories" on public.register_categories
  for delete to authenticated using (
    public.can_assign() and not builtin
    and not exists (select 1 from public.register_items i where i.category_id = register_categories.id)
  );

drop policy if exists "register items readable" on public.register_items;
create policy "register items readable" on public.register_items
  for select to authenticated using (public.is_member());
drop policy if exists "team adds register items" on public.register_items;
create policy "team adds register items" on public.register_items
  for insert to authenticated with check (public.is_member() and created_by = auth.uid());
drop policy if exists "team edits register items" on public.register_items;
create policy "team edits register items" on public.register_items
  for update to authenticated using (public.is_member()) with check (public.is_member());
drop policy if exists "adder or seniors remove register items" on public.register_items;
create policy "adder or seniors remove register items" on public.register_items
  for delete to authenticated using (public.can_assign() or created_by = auth.uid());

/* ---------------------------------------------------------------- words for alerts */
create or replace function public.register_status_label(p text)
returns text language sql immutable as $$
  select case p when 'open' then 'Open' when 'in_progress' then 'In progress'
                when 'waiting' then 'Waiting' when 'closed' then 'Closed' else p end
$$;

-- "EI-242 Hardscaping take-off", or "RFIs: Ceiling heights" when there's no reference.
create or replace function public.register_item_label(p_ref text, p_title text, p_category uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when nullif(btrim(p_ref), '') is not null then btrim(p_ref) || ' ' || btrim(p_title)
              else coalesce((select name from public.register_categories where id = p_category), 'Item') || ': ' || btrim(p_title) end
$$;

create or replace function public.register_item_link(p_project uuid, p_category uuid, p_item uuid)
returns text language sql immutable as $$
  select '/projects/' || p_project::text || '/registers?cat=' || p_category::text || '&item=' || p_item::text
$$;

-- The folder name for an item: its reference and title, kept to the folder name limit.
create or replace function public.register_folder_name(p_ref text, p_title text)
returns text language sql immutable as $$
  select left(btrim(coalesce(nullif(btrim(p_ref), '') || ' ', '') || btrim(p_title)), 120)
$$;

/* ---------------------------------------------------------------- folders */
-- The category's folder at the top of the project's Files: the one it has, a folder already there
-- with the same name, or a new one.
create or replace function public.register_category_folder(p_category uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  f uuid;
begin
  select id, project_id, name, folder_id into c from public.register_categories where id = p_category for update;
  if c.id is null then
    raise exception 'That category is no longer there';
  end if;
  if c.folder_id is not null and public.project_folder_open(c.folder_id, c.project_id) then
    return c.folder_id;
  end if;
  select pf.id into f from public.project_folders pf
   where pf.project_id = c.project_id and pf.parent_id is null and pf.removed_at is null
     and lower(btrim(pf.name)) = lower(btrim(c.name))
   order by pf.created_at limit 1;
  if f is null then
    insert into public.project_folders (project_id, parent_id, name, created_by)
    values (c.project_id, null, left(btrim(c.name), 120), auth.uid())
    returning id into f;
  end if;
  update public.register_categories set folder_id = f where id = c.id;
  return f;
end $$;

-- The item's own folder, made again if someone removed it from Files. Anyone on the team can ask
-- (the item screen does, before adding files).
create or replace function public.register_item_folder(p_item uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  i record;
  parent uuid;
  f uuid;
begin
  if not public.is_member() then
    raise exception 'Not allowed';
  end if;
  select id, project_id, category_id, ref, title, folder_id into i from public.register_items where id = p_item for update;
  if i.id is null then
    raise exception 'That item is no longer there';
  end if;
  if i.folder_id is not null and public.project_folder_open(i.folder_id, i.project_id) then
    return i.folder_id;
  end if;
  parent := public.register_category_folder(i.category_id);
  insert into public.project_folders (project_id, parent_id, name, created_by)
  values (i.project_id, parent, public.register_folder_name(i.ref, i.title), auth.uid())
  returning id into f;
  update public.register_items set folder_id = f where id = i.id;
  return f;
end $$;
revoke execute on function public.register_item_folder(uuid) from public, anon;
grant execute on function public.register_item_folder(uuid) to authenticated;
-- Only used inside the database.
revoke execute on function public.register_category_folder(uuid) from public, anon, authenticated;
revoke execute on function public.register_item_label(text, text, uuid) from public, anon;

/* ---------------------------------------------------------------- categories: tidy, folder name */
create or replace function public.register_category_before()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.name := btrim(new.name);
  new.prefix := nullif(upper(btrim(coalesce(new.prefix, ''))), '');
  if tg_op = 'UPDATE' then
    new.project_id := old.project_id;
    new.builtin := old.builtin;
    if old.builtin then
      new.name := old.name;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists register_categories_before on public.register_categories;
create trigger register_categories_before before insert or update on public.register_categories
  for each row execute function public.register_category_before();

create or replace function public.register_category_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is distinct from old.name and new.folder_id is not null then
    update public.project_folders set name = left(new.name, 120)
     where id = new.folder_id and removed_at is null;
  end if;
  return null;
end $$;

drop trigger if exists register_categories_after on public.register_categories;
create trigger register_categories_after after update on public.register_categories
  for each row execute function public.register_category_after();

/* ---------------------------------------------------------------- items: tidy, folder */
create or replace function public.register_item_before()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cat_project uuid;
  parent uuid;
begin
  new.ref := nullif(btrim(coalesce(new.ref, '')), '');
  new.title := btrim(new.title);
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  new.assignees := coalesce((select array_agg(distinct x) from unnest(new.assignees) x where x is not null), '{}');
  if tg_op = 'INSERT' then
    select project_id into cat_project from public.register_categories where id = new.category_id;
    if cat_project is null then
      raise exception 'That category is no longer there';
    end if;
    new.project_id := cat_project;
    parent := public.register_category_folder(new.category_id);
    insert into public.project_folders (project_id, parent_id, name, created_by)
    values (new.project_id, parent, public.register_folder_name(new.ref, new.title), auth.uid())
    returning id into new.folder_id;
  else
    -- People can't change these (see the grants); folder_id is only set by register_item_folder().
    new.project_id := old.project_id;
    new.category_id := old.category_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists register_items_before on public.register_items;
create trigger register_items_before before insert or update on public.register_items
  for each row execute function public.register_item_before();

/* ---------------------------------------------------------------- items: alerts, folder name */
create or replace function public.register_item_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := coalesce(auth.uid(), new.created_by);
  aname text := coalesce(public.actor_name(actor), 'Someone');
  label text := public.register_item_label(new.ref, new.title, new.category_id);
  link text := public.register_item_link(new.project_id, new.category_id, new.id);
  pname text := coalesce((select name from public.projects where id = new.project_id), 'a project');
  u uuid;
  told uuid[] := '{}';
begin
  if tg_op = 'INSERT' then
    if new.responsible_id is not null then
      perform public.notify(new.responsible_id, 'register', aname || ' made you Northcroft responsible for ' || label, pname, link, actor, null, new.project_id);
      told := told || new.responsible_id;
    end if;
    foreach u in array new.assignees loop
      if not u = any(told) then
        perform public.notify(u, 'register', aname || ' gave you ' || label, pname, link, actor, null, new.project_id);
        told := told || u;
      end if;
    end loop;
    return null;
  end if;

  -- Newly responsible, or newly assigned.
  if new.responsible_id is not null and new.responsible_id is distinct from old.responsible_id then
    perform public.notify(new.responsible_id, 'register', aname || ' made you Northcroft responsible for ' || label, pname, link, actor, null, new.project_id);
    told := told || new.responsible_id;
  end if;
  foreach u in array new.assignees loop
    if not u = any(old.assignees) and not u = any(told) then
      perform public.notify(u, 'register', aname || ' gave you ' || label, pname, link, actor, null, new.project_id);
      told := told || u;
    end if;
  end loop;
  -- The status moved: everyone on it hears (except whoever just heard above).
  if new.status is distinct from old.status then
    for u in select distinct x from unnest(array_append(new.assignees, new.responsible_id)) x where x is not null loop
      if not u = any(told) then
        perform public.notify(u, 'register', label || ' is now ' || public.register_status_label(new.status),
          aname || ' · ' || pname, link, actor, null, new.project_id);
      end if;
    end loop;
  end if;
  -- Its reference or title changed: so does its folder's name.
  if (new.ref is distinct from old.ref or new.title is distinct from old.title) and new.folder_id is not null then
    update public.project_folders set name = public.register_folder_name(new.ref, new.title)
     where id = new.folder_id and removed_at is null;
  end if;
  return null;
end $$;

drop trigger if exists register_items_after on public.register_items;
create trigger register_items_after after insert or update on public.register_items
  for each row execute function public.register_item_after();

-- A removed item takes its folder with it only while the folder is empty.
create or replace function public.register_item_removed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.folder_id is not null
     and not exists (select 1 from public.attachments a where a.project_folder_id = old.folder_id)
     and not exists (select 1 from public.drive_links l where l.project_folder_id = old.folder_id)
     and not exists (select 1 from public.project_folders c where c.parent_id = old.folder_id and c.removed_at is null) then
    update public.project_folders set removed_at = now(), removed_by = auth.uid()
     where id = old.folder_id and removed_at is null;
  end if;
  return null;
end $$;

drop trigger if exists register_items_removed on public.register_items;
create trigger register_items_removed after delete on public.register_items
  for each row execute function public.register_item_removed();

/* ---------------------------------------------------------------- a file added to an item */
create or replace function public.attachment_register_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  i record;
  actor uuid := coalesce(auth.uid(), new.uploaded_by);
  u uuid;
begin
  if new.project_folder_id is null then
    return null;
  end if;
  select id, project_id, category_id, ref, title, responsible_id, assignees into i
    from public.register_items where folder_id = new.project_folder_id limit 1;
  if i.id is null then
    return null;
  end if;
  for u in select distinct x from unnest(array_append(i.assignees, i.responsible_id)) x where x is not null loop
    perform public.notify(u, 'register',
      coalesce(public.actor_name(actor), 'Someone') || ' added a file to ' || public.register_item_label(i.ref, i.title, i.category_id),
      new.name, public.register_item_link(i.project_id, i.category_id, i.id), actor, null, i.project_id);
  end loop;
  return null;
end $$;

drop trigger if exists attachments_register_after on public.attachments;
create trigger attachments_register_after after insert on public.attachments
  for each row execute function public.attachment_register_after();

/* ---------------------------------------------------------------- VOs: Northcroft responsible */
create or replace function public.variation_responsible_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if new.responsible_id is not null and (tg_op = 'INSERT' or new.responsible_id is distinct from old.responsible_id) then
    perform public.notify(new.responsible_id, 'register',
      coalesce(public.actor_name(actor), 'Someone') || ' made you Northcroft responsible for ' || new.vo_number || ' ' || new.title,
      coalesce((select name from public.projects where id = new.project_id), 'a project'),
      '/projects/' || new.project_id::text || '/variations?vo=' || new.id::text, actor, null, new.project_id);
  end if;
  return null;
end $$;

drop trigger if exists variations_responsible_after on public.variations;
create trigger variations_responsible_after after insert or update of responsible_id on public.variations
  for each row execute function public.variation_responsible_after();

/* ---------------------------------------------------------------- EIs in every project */
create or replace function public.project_add_eis()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.register_categories (project_id, name, prefix, builtin, sort, created_by)
  values (new.id, 'EIs', 'EI', true, 0, new.created_by)
  on conflict do nothing;
  return null;
end $$;

drop trigger if exists projects_add_eis on public.projects;
create trigger projects_add_eis after insert on public.projects
  for each row execute function public.project_add_eis();

insert into public.register_categories (project_id, name, prefix, builtin, sort, created_by)
select p.id, 'EIs', 'EI', true, 0, p.created_by
  from public.projects p
 where not exists (select 1 from public.register_categories c where c.project_id = p.id and c.builtin);

/* ---------------------------------------------------------------- live updates */
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'register_categories') then
    alter publication supabase_realtime add table public.register_categories;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'register_items') then
    alter publication supabase_realtime add table public.register_items;
  end if;
end $$;
