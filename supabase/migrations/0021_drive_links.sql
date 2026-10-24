-- Google Drive links on tasks and projects.
-- Paste a shared Drive folder (or file) link and its files show in the app, ready to open or
-- download. The app reads them with a Google key that a manager adds once in
-- Settings > Google Drive; the folder has to be shared as "Anyone with the link".

create table if not exists public.drive_links (
  id uuid primary key default gen_random_uuid(),
  task_id uuid,
  project_id uuid,
  -- A link set up with a repeating task comes with every copy (like its files).
  recurring_id uuid,
  url text not null,
  drive_id text not null,
  resource_key text,
  kind text not null check (kind in ('folder', 'file')),
  title text not null,
  mime text,
  added_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  -- Taking a link off keeps the row (and who did it) instead of removing it.
  removed_at timestamptz,
  removed_by uuid
);
create index if not exists drive_links_task_idx on public.drive_links (task_id) where removed_at is null;
create index if not exists drive_links_project_idx on public.drive_links (project_id) where removed_at is null;
create index if not exists drive_links_recurring_idx on public.drive_links (recurring_id) where removed_at is null;

alter table public.drive_links enable row level security;
create policy "team sees drive links" on public.drive_links
  for select to authenticated using (public.is_member());
create policy "team adds drive links" on public.drive_links
  for insert to authenticated with check (public.is_member() and added_by = auth.uid() and removed_at is null);
create policy "adder or seniors take links off" on public.drive_links
  for update to authenticated using (public.is_member() and (added_by = auth.uid() or public.can_assign()));

-- Only taking a link off (or putting it back) can change an existing link.
create or replace function public.drive_link_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  if (new.task_id, new.project_id, new.recurring_id, new.url, new.drive_id, new.resource_key, new.kind, new.title, new.added_by, new.created_at)
     is distinct from (old.task_id, old.project_id, old.recurring_id, old.url, old.drive_id, old.resource_key, old.kind, old.title, old.added_by, old.created_at) then
    raise exception 'A Drive link can only be taken off. Add a new one instead.';
  end if;
  if new.removed_at is not null and old.removed_at is null then
    new.removed_by := auth.uid();
  elsif new.removed_at is null then
    new.removed_by := null;
  end if;
  return new;
end $$;

create trigger drive_links_guard before update on public.drive_links
  for each row execute function public.drive_link_guard();

alter publication supabase_realtime add table public.drive_links;

-- Whether a manager has added the Google key (the key itself stays in Vault).
alter table public.app_settings add column if not exists drive_key_added_at timestamptz;

create or replace function public.get_drive_config() returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets
  where name in ('drive_client_id', 'drive_client_secret', 'drive_refresh_token', 'drive_link_secret', 'drive_api_key');
$$;

-- An empty value clears a secret.
create or replace function public.set_drive_secret(p_name text, p_value text) returns void
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if p_name not in ('drive_client_id', 'drive_client_secret', 'drive_refresh_token', 'drive_link_secret', 'drive_api_key') then
    raise exception 'Unknown Drive setting %', p_name;
  end if;
  select id into sid from vault.secrets where name = p_name;
  if sid is null then
    perform vault.create_secret(coalesce(p_value, ''), p_name);
  else
    perform vault.update_secret(sid, coalesce(p_value, ''));
  end if;
end $$;

-- The key's date can only be set by the Drive function, like the other Drive settings.
create or replace function public.protect_drive_columns() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n jsonb := to_jsonb(new);
  o jsonb := to_jsonb(old);
begin
  if auth.uid() is null then return new; end if;
  if tg_table_name = 'app_settings'
     and (n -> 'drive_account', n -> 'drive_root_id', n -> 'drive_general_id', n -> 'drive_connected_at', n -> 'drive_key_added_at')
         is distinct from (o -> 'drive_account', o -> 'drive_root_id', o -> 'drive_general_id', o -> 'drive_connected_at', o -> 'drive_key_added_at') then
    raise exception 'Connect Google Drive from Settings > Google Drive';
  end if;
  if tg_table_name = 'projects' and (n -> 'drive_folder_id') is distinct from (o -> 'drive_folder_id') then
    raise exception 'The Drive folder is set automatically';
  end if;
  return new;
end $$;

revoke execute on function public.get_drive_config() from public, anon, authenticated;
revoke execute on function public.set_drive_secret(text, text) from public, anon, authenticated;
revoke execute on function public.drive_link_guard() from public, anon, authenticated;
grant execute on function public.get_drive_config() to service_role;
grant execute on function public.set_drive_secret(text, text) to service_role;
