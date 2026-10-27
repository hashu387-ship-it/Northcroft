-- Project folder: a project's own files and links, in folders the team makes.
--
-- The Files tab of a project has two parts:
--   * Project folder: files and links added to the project itself (contract, drawings, specs,
--     quotations), in folders anyone on the team can make, and folders inside folders.
--   * From tasks and VOs: files and links added on the project's tasks, VOs, announcements and
--     project chat, as before.
--
-- Rules:
--   * Anyone on the team makes folders, adds files and links, and moves them between folders.
--   * Whoever made a folder, or a manager or senior (can_assign), renames or removes it.
--   * Removing a folder moves what's in it (files, links and folders) up to the folder it was in.
--     Nothing is deleted from Google Drive, and the folder itself is only marked removed.
--   * A new version of a file stays in the same folder.

/* ---------------------------------------------------------------- folders */
create table if not exists public.project_folders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- null: at the top of the Project folder.
  parent_id uuid references public.project_folders (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles (id) on delete set null
);
create index if not exists project_folders_project_idx on public.project_folders (project_id);
create index if not exists project_folders_parent_idx on public.project_folders (parent_id);

alter table public.project_folders enable row level security;

-- Renaming changes the name only; moving and removing go through the functions below.
revoke update on public.project_folders from anon, authenticated;
grant update (name) on public.project_folders to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_folders' and policyname = 'project folders readable') then
    create policy "project folders readable" on public.project_folders for select using (public.is_member());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_folders' and policyname = 'team makes project folders') then
    create policy "team makes project folders" on public.project_folders for insert with check (
      public.is_member()
      and created_by = auth.uid()
      and removed_at is null
      and (parent_id is null or exists (
        select 1 from public.project_folders p
         where p.id = project_folders.parent_id and p.project_id = project_folders.project_id and p.removed_at is null))
    );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_folders' and policyname = 'maker or seniors rename project folders') then
    create policy "maker or seniors rename project folders" on public.project_folders for update
      using (public.is_member() and removed_at is null and (created_by = auth.uid() or public.can_assign()))
      with check (removed_at is null);
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_folders') then
    alter publication supabase_realtime add table public.project_folders;
  end if;
end $$;

/* ---------------------------------------------------------------- files and links in folders */
alter table public.attachments add column if not exists project_folder_id uuid references public.project_folders (id) on delete set null;
alter table public.drive_links add column if not exists project_folder_id uuid references public.project_folders (id) on delete set null;
create index if not exists attachments_project_folder_idx on public.attachments (project_folder_id) where project_folder_id is not null;
create index if not exists drive_links_project_folder_idx on public.drive_links (project_folder_id) where project_folder_id is not null;

-- A folder of this project that's still there.
create or replace function public.project_folder_open(p_folder uuid, p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.project_folders f where f.id = p_folder and f.project_id = p_project and f.removed_at is null);
$$;

-- Only a file added to the project itself (not on a task, VO, announcement, message or leave) goes
-- in a folder. A new version of a project file goes in the original's folder.
create or replace function public.attachment_project_folder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  project_level boolean := new.project_id is not null and new.task_id is null and new.comment_id is null
    and new.conversation_id is null and new.recurring_id is null and new.variation_id is null
    and new.announcement_id is null and new.leave_id is null;
begin
  if tg_op = 'INSERT' and new.project_folder_id is null and new.version_of is not null and project_level then
    select a.project_folder_id into new.project_folder_id
      from public.attachments a
     where a.id = new.version_of and a.project_id = new.project_id
       and public.project_folder_open(a.project_folder_id, new.project_id);
  end if;
  if new.project_folder_id is null then
    return new;
  end if;
  if not project_level then
    raise exception 'Only files added to the project itself go in its folders.';
  end if;
  if not public.project_folder_open(new.project_folder_id, new.project_id) then
    raise exception 'That folder is no longer there. Pick another one.';
  end if;
  return new;
end;
$$;

create or replace trigger attachments_project_folder
  before insert or update of project_folder_id on public.attachments
  for each row execute function public.attachment_project_folder();

create or replace function public.drive_link_project_folder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.project_folder_id is null then
    return new;
  end if;
  if new.project_id is null or new.task_id is not null or new.recurring_id is not null or new.comment_id is not null
     or new.variation_id is not null or new.announcement_id is not null then
    raise exception 'Only links added to the project itself go in its folders.';
  end if;
  if not public.project_folder_open(new.project_folder_id, new.project_id) then
    raise exception 'That folder is no longer there. Pick another one.';
  end if;
  return new;
end;
$$;

create or replace trigger drive_links_project_folder
  before insert or update of project_folder_id on public.drive_links
  for each row execute function public.drive_link_project_folder();

/* ---------------------------------------------------------------- moving and removing */
-- Anyone on the team moves a project file into a folder (p_folder null: the top of the Project folder).
create or replace function public.move_project_file(p_attachment uuid, p_folder uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_member() then
    raise exception 'Sign in again to move files.';
  end if;
  update public.attachments set project_folder_id = p_folder where id = p_attachment;
  if not found then
    raise exception 'That file is no longer there.';
  end if;
end;
$$;

create or replace function public.move_project_link(p_link uuid, p_folder uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_member() then
    raise exception 'Sign in again to move links.';
  end if;
  update public.drive_links set project_folder_id = p_folder where id = p_link and removed_at is null;
  if not found then
    raise exception 'That link is no longer there.';
  end if;
end;
$$;

-- Whoever made the folder, or a manager or senior, removes it. What's in it moves up a level.
create or replace function public.remove_project_folder(p_folder uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.project_folders;
begin
  select * into f from public.project_folders where id = p_folder and removed_at is null for update;
  if not found then
    raise exception 'That folder is no longer there.';
  end if;
  if not (public.is_member() and (f.created_by = auth.uid() or public.can_assign())) then
    raise exception 'Only whoever made this folder, Hassan or a senior can remove it.';
  end if;
  update public.project_folders set parent_id = f.parent_id where parent_id = f.id and removed_at is null;
  update public.attachments set project_folder_id = f.parent_id where project_folder_id = f.id;
  update public.drive_links set project_folder_id = f.parent_id where project_folder_id = f.id;
  update public.project_folders set removed_at = now(), removed_by = auth.uid() where id = f.id;
end;
$$;

revoke all on function public.move_project_file(uuid, uuid) from public;
revoke all on function public.move_project_link(uuid, uuid) from public;
revoke all on function public.remove_project_folder(uuid) from public;
grant execute on function public.move_project_file(uuid, uuid) to authenticated;
grant execute on function public.move_project_link(uuid, uuid) to authenticated;
grant execute on function public.remove_project_folder(uuid) to authenticated;
