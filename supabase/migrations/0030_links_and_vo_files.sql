-- Links from anywhere, and files on each variation.
--
-- 1. Links. Besides Google Drive (whose files show inside the app), a OneDrive or SharePoint link,
--    or any web link (Dropbox, WeTransfer, a website), can be added wherever a Drive link can:
--    tasks, project Files, chats and the New task form. They show as a card with a name that opens
--    the link. provider: google | onedrive | web. site: the name shown on the card (OneDrive,
--    SharePoint, Dropbox, WeTransfer, or the website's address).
--
-- 2. Variations. Each submission round (revision) keeps a key, so files and links can belong to
--    it: what we sent (vo_side 'sent') and ECJV's assessment ('assessment'). Files and links on a
--    variation without a round are its supporting documents. Anyone on the team can add them; the
--    person who added one, or a manager or senior, can take it off. A round also keeps its own
--    amounts (submitted_value, assessed_value) in the submissions list, next to its dates and
--    ECJV's comments.

alter table public.drive_links
  add column if not exists provider text not null default 'google',
  add column if not exists site text,
  add column if not exists variation_id uuid,
  add column if not exists vo_round text,
  add column if not exists vo_side text;

alter table public.attachments
  add column if not exists variation_id uuid,
  add column if not exists vo_round text,
  add column if not exists vo_side text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'drive_links_provider_check') then
    alter table public.drive_links add constraint drive_links_provider_check
      check (provider in ('google', 'onedrive', 'web') and (provider = 'google' or url ~* '^https?://'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'drive_links_vo_check') then
    alter table public.drive_links add constraint drive_links_vo_check
      check ((vo_side is null or vo_side in ('sent', 'assessment'))
             and (vo_side is null or vo_round is not null)
             and (vo_round is null or variation_id is not null)
             and (vo_round is null or char_length(vo_round) <= 64));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'attachments_vo_check') then
    alter table public.attachments add constraint attachments_vo_check
      check ((vo_side is null or vo_side in ('sent', 'assessment'))
             and (vo_side is null or vo_round is not null)
             and (vo_round is null or variation_id is not null)
             and (vo_round is null or char_length(vo_round) <= 64));
  end if;
end $$;

create index if not exists drive_links_variation_idx on public.drive_links (variation_id) where removed_at is null;
create index if not exists attachments_variation_idx on public.attachments (variation_id);

-- Only taking a link off (or putting it back) can change an existing link.
create or replace function public.drive_link_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  if (new.task_id, new.project_id, new.recurring_id, new.url, new.drive_id, new.resource_key, new.kind, new.title, new.added_by, new.created_at,
      new.provider, new.site, new.variation_id, new.vo_round, new.vo_side)
     is distinct from
     (old.task_id, old.project_id, old.recurring_id, old.url, old.drive_id, old.resource_key, old.kind, old.title, old.added_by, old.created_at,
      old.provider, old.site, old.variation_id, old.vo_round, old.vo_side) then
    raise exception 'A link can only be taken off. Add a new one instead.';
  end if;
  if new.removed_at is not null and old.removed_at is null then
    new.removed_by := auth.uid();
  elsif new.removed_at is null then
    new.removed_by := null;
  end if;
  return new;
end $$;

-- Every submission round gets a key when it's saved, so its files stay with it.
create or replace function public.variation_round_keys()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if jsonb_typeof(new.submissions) = 'array'
     and exists (select 1 from jsonb_array_elements(new.submissions) x
                  where jsonb_typeof(x) = 'object' and coalesce(x->>'key', '') = '') then
    new.submissions := (
      select coalesce(jsonb_agg(
               case when jsonb_typeof(e.x) = 'object' and coalesce(e.x->>'key', '') = ''
                    then e.x || jsonb_build_object('key', gen_random_uuid()::text)
                    else e.x end
               order by e.ord), '[]'::jsonb)
        from jsonb_array_elements(new.submissions) with ordinality as e(x, ord));
  end if;
  return new;
end $$;

create or replace trigger variations_b_round_keys
  before insert or update of submissions on public.variations
  for each row execute function public.variation_round_keys();

-- The rounds already in the register get their keys now.
update public.variations
   set submissions = submissions
 where jsonb_array_length(submissions) > 0
   and exists (select 1 from jsonb_array_elements(submissions) x where coalesce(x->>'key', '') = '');
