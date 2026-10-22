-- Project cover photos: a site photo or render shown on project cards and the project page.
-- Stored in a public bucket under covers/<project id>/ with random file names.
-- Anyone on the team can see them; only Hassan and seniors (who can edit projects) can change them.

alter table public.projects add column if not exists cover_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "assigners upload covers" on storage.objects for insert to authenticated
  with check (bucket_id = 'covers' and public.can_assign());
create policy "assigners replace covers" on storage.objects for update to authenticated
  using (bucket_id = 'covers' and public.can_assign());
create policy "assigners remove covers" on storage.objects for delete to authenticated
  using (bucket_id = 'covers' and public.can_assign());
create policy "team sees covers" on storage.objects for select to authenticated
  using (bucket_id = 'covers' and public.is_member());
