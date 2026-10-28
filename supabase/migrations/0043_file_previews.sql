-- Big previews for PDFs and drawings (DWG, DXF) in file lists and chats, like photos have.
--
-- * A preview is a picture of the PDF's first page, or of the drawing as a black-on-white sheet.
--   It's made once, in the browser of whoever uploads the file (or, for files already in the app,
--   of the first person to see it in a list), and kept in the private "previews" bucket as
--   <file id>.jpg.
-- * attachments.preview says where it's at: null (not made yet), 'ready', or 'failed' (the file
--   couldn't be drawn, so nobody tries again and the list shows the plain file line).
-- * Anyone who can see the file can see and make its preview; nobody else can. The person who
--   added the file, or a manager or senior, can remove it (it goes when the file is deleted).

alter table public.attachments add column if not exists preview text check (preview in ('ready', 'failed'));
alter table public.attachments add column if not exists preview_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('previews', 'previews', false, 4194304, array['image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

/** The file a preview belongs to: "<uuid>.jpg" -> uuid, anything else -> null. */
create or replace function public.preview_attachment_id(p_name text)
returns uuid
language sql
immutable
set search_path = public
as $$
  select case when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
              then split_part(p_name, '.', 1)::uuid end
$$;

-- The attachments lookups below run as the person, so the file's own rules apply (private chats,
-- leave files): a preview is visible exactly when its file is. (objects.name, not name: inside the
-- lookup a bare name would be the attachment's file name.)
create policy "team sees previews" on storage.objects for select to authenticated
  using (bucket_id = 'previews' and public.is_member()
         and exists (select 1 from public.attachments a where a.id = public.preview_attachment_id(objects.name)));
create policy "team adds previews" on storage.objects for insert to authenticated
  with check (bucket_id = 'previews' and public.is_member()
              and exists (select 1 from public.attachments a where a.id = public.preview_attachment_id(objects.name)));
create policy "team replaces previews" on storage.objects for update to authenticated
  using (bucket_id = 'previews' and public.is_member()
         and exists (select 1 from public.attachments a where a.id = public.preview_attachment_id(objects.name)));
create policy "uploader or assigner removes previews" on storage.objects for delete to authenticated
  using (bucket_id = 'previews'
         and exists (select 1 from public.attachments a
                      where a.id = public.preview_attachment_id(objects.name)
                        and (a.uploaded_by = auth.uid() or public.can_assign())));

/* ---------------------------------------------------------------- record that a preview was made */
create or replace function public.set_attachment_preview(p_id uuid, p_state text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.attachments;
begin
  if auth.uid() is null or not public.is_member() then
    raise exception 'Please sign in again';
  end if;
  if p_state is null or p_state not in ('ready', 'failed') then
    raise exception 'Something went wrong with the preview';
  end if;
  select * into a from public.attachments where id = p_id;
  -- Same rule as reading the file: members, and for a private chat or leave file only the people in it.
  if not found
     or (a.conversation_id is not null and not public.in_conversation(a.conversation_id))
     or (a.leave_id is not null and not public.leave_file_ok(a.leave_id)) then
    raise exception 'That file isn''t available';
  end if;
  if p_state = 'ready' and not exists (
    select 1 from storage.objects o where o.bucket_id = 'previews' and o.name = p_id::text || '.jpg') then
    raise exception 'The preview didn''t save. Try again.';
  end if;
  -- A preview someone made isn't undone by another phone that couldn't draw the file.
  if p_state = 'failed' and a.preview = 'ready' then
    return;
  end if;
  update public.attachments set preview = p_state, preview_at = now() where id = p_id;
end $$;
revoke all on function public.set_attachment_preview(uuid, text) from public, anon;
grant execute on function public.set_attachment_preview(uuid, text) to authenticated;
