-- Files over 50 MB go to the manager's Google Drive, in a Northcroft folder with a subfolder per
-- project (plus General). Smaller files stay in Supabase Storage. Drive files are private: the
-- `drive` Edge Function streams them to signed-in team members only.
--
-- Secrets (Google OAuth client, refresh token, link-signing key) live in Supabase Vault and are
-- read and written only by the Edge Function (service role) through the functions below.

alter table public.app_settings
  add column if not exists drive_account text,
  add column if not exists drive_root_id text,
  add column if not exists drive_general_id text,
  add column if not exists drive_connected_at timestamptz;

alter table public.projects add column if not exists drive_folder_id text;
alter table public.attachments add column if not exists drive_file_id text;

-- Only the Edge Function adds Drive attachments, after checking the upload in Drive.
alter policy "add attachments" on public.attachments
  with check (uploaded_by = auth.uid() and is_member() and drive_file_id is null);

-- The Drive columns are set only by the Edge Function (service role), never from the app.
create or replace function public.protect_drive_columns() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_table_name = 'app_settings'
     and (new.drive_account, new.drive_root_id, new.drive_general_id, new.drive_connected_at)
         is distinct from (old.drive_account, old.drive_root_id, old.drive_general_id, old.drive_connected_at) then
    raise exception 'Connect Google Drive from Settings > Google Drive';
  end if;
  if tg_table_name = 'projects' and new.drive_folder_id is distinct from old.drive_folder_id then
    raise exception 'The Drive folder is set automatically';
  end if;
  return new;
end $$;

create trigger app_settings_protect_drive before update on public.app_settings
  for each row execute function public.protect_drive_columns();
create trigger projects_protect_drive before update on public.projects
  for each row execute function public.protect_drive_columns();

-- Vault helpers for the Edge Function only.
create or replace function public.get_drive_config() returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets
  where name in ('drive_client_id', 'drive_client_secret', 'drive_refresh_token', 'drive_link_secret');
$$;

-- An empty value clears a secret.
create or replace function public.set_drive_secret(p_name text, p_value text) returns void
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if p_name not in ('drive_client_id', 'drive_client_secret', 'drive_refresh_token', 'drive_link_secret') then
    raise exception 'Unknown Drive setting %', p_name;
  end if;
  select id into sid from vault.secrets where name = p_name;
  if sid is null then
    perform vault.create_secret(coalesce(p_value, ''), p_name);
  else
    perform vault.update_secret(sid, coalesce(p_value, ''));
  end if;
end $$;

revoke execute on function public.get_drive_config() from public, anon, authenticated;
revoke execute on function public.set_drive_secret(text, text) from public, anon, authenticated;
revoke execute on function public.protect_drive_columns() from public, anon, authenticated;
grant execute on function public.get_drive_config() to service_role;
grant execute on function public.set_drive_secret(text, text) to service_role;

-- A random key that signs the short-lived "open this file" links.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'drive_link_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'drive_link_secret');
  end if;
end $$;
