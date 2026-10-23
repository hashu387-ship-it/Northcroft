-- Fix: saving app settings or a project from the app failed with
-- 'record "new" has no field ...'. The one guard function serves two tables and named each
-- table's own columns directly; PL/pgSQL resolves those names even when the table check is false.
-- Reading the columns through jsonb works for both tables.
create or replace function public.protect_drive_columns() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n jsonb := to_jsonb(new);
  o jsonb := to_jsonb(old);
begin
  if auth.uid() is null then return new; end if;
  if tg_table_name = 'app_settings'
     and (n -> 'drive_account', n -> 'drive_root_id', n -> 'drive_general_id', n -> 'drive_connected_at')
         is distinct from (o -> 'drive_account', o -> 'drive_root_id', o -> 'drive_general_id', o -> 'drive_connected_at') then
    raise exception 'Connect Google Drive from Settings > Google Drive';
  end if;
  if tg_table_name = 'projects' and (n -> 'drive_folder_id') is distinct from (o -> 'drive_folder_id') then
    raise exception 'The Drive folder is set automatically';
  end if;
  return new;
end $$;
