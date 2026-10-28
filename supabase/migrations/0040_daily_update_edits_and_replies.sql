-- Daily updates: managers and seniors change someone's update, and reply to what's blocking them.
--
-- Changing a task in someone's update (managers and seniors, on the Team tab):
-- * The %, a tick for done (100%) and the note. The task's own % follows, and 100% hands an open
--   task in for review, the same as when the person does it themselves. A task on hold keeps its
--   status (only the % is kept).
-- * The line remembers who changed it (edited_by, edited_at) and the person is told.
--
-- Replies to a blocker:
-- * Under "Blocking" in someone's update, the person and any manager or senior can write a reply.
-- * A reply from someone else tells the person; the person's reply tells everyone who replied
--   before.

alter table public.daily_update_items add column if not exists edited_by uuid references public.profiles (id) on delete set null;
alter table public.daily_update_items add column if not exists edited_at timestamptz;

/* ---------------------------------------------------------------- change a task in someone's update */
create or replace function public.edit_daily_update_item(p_item uuid, p_progress integer, p_note text default null)
returns public.daily_update_items
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  it public.daily_update_items;
  u public.daily_updates;
  t record;
  pct int;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  aname text;
  handed boolean;
begin
  if uid is null or not public.is_member() then
    raise exception 'Please sign in again';
  end if;
  if not public.can_assign() then
    raise exception 'Only a manager or a senior can change someone''s update';
  end if;
  if char_length(coalesce(v_note, '')) > 1000 then
    raise exception 'Keep the note under 1000 characters';
  end if;

  select * into it from public.daily_update_items where id = p_item for update;
  if not found then
    raise exception 'That update line is gone. Refresh and try again.';
  end if;
  select * into u from public.daily_updates where id = it.update_id;
  pct := greatest(0, least(100, coalesce(p_progress, it.progress)));
  handed := it.handed_in;

  -- The task's own % follows; 100% hands an open task in for review (not while it's on hold).
  select id, title, status, hold into t from public.tasks where id = it.task_id;
  if found and t.status in ('todo', 'in_progress') then
    if t.hold is distinct from 'on' then
      update public.tasks
         set progress = pct,
             progress_at = now(),
             status = case when pct = 100 then 'in_review'
                           when pct > 0 and t.status = 'todo' then 'in_progress'
                           else t.status end
       where id = t.id;
      handed := handed or pct = 100;
    else
      update public.tasks set progress = pct, progress_at = now() where id = t.id;
    end if;
  end if;

  update public.daily_update_items
     set progress = pct, note = v_note, handed_in = handed, edited_by = uid, edited_at = now(), updated_at = now()
   where id = it.id
  returning * into it;

  if u.user_id is distinct from uid then
    aname := coalesce(public.actor_name(uid), 'A manager');
    perform public.notify(u.user_id, 'daily_update_edit', aname || ' changed your update: ' || it.task_title,
      concat_ws(' · ', 'Now ' || pct || '%', v_note), '/updates', uid, it.task_id);
  end if;
  return it;
end $$;
revoke all on function public.edit_daily_update_item(uuid, integer, text) from public, anon;
grant execute on function public.edit_daily_update_item(uuid, integer, text) to authenticated;

/* ---------------------------------------------------------------- replies to a blocker */
create table if not exists public.daily_update_replies (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.daily_updates (id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles (id),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists daily_update_replies_update_idx on public.daily_update_replies (update_id, created_at);
alter table public.daily_update_replies enable row level security;

-- Whoever can see the update (the person, managers and seniors) sees and writes replies.
create policy "see daily update replies" on public.daily_update_replies
  for select to authenticated using (exists (
    select 1 from public.daily_updates u where u.id = update_id and (u.user_id = auth.uid() or public.can_assign())));
create policy "reply to a daily update" on public.daily_update_replies
  for insert to authenticated with check (
    author_id = auth.uid() and public.is_member() and exists (
      select 1 from public.daily_updates u where u.id = update_id and (u.user_id = auth.uid() or public.can_assign())));
grant select, insert on public.daily_update_replies to authenticated;

create or replace function public.daily_update_reply_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  u public.daily_updates;
  aname text := coalesce(public.actor_name(new.author_id), 'Someone');
  r record;
begin
  select * into u from public.daily_updates where id = new.update_id;
  if new.author_id is distinct from u.user_id then
    perform public.notify(u.user_id, 'daily_update_reply', aname || ' replied to what''s blocking you',
      left(btrim(new.body), 300), '/updates', new.author_id);
  else
    for r in
      select distinct author_id from public.daily_update_replies
       where update_id = new.update_id and author_id is distinct from u.user_id and id <> new.id
    loop
      perform public.notify(r.author_id, 'daily_update_reply', aname || ' replied about what''s blocking them',
        left(btrim(new.body), 300), '/updates?tab=team&date=' || u.work_date, new.author_id);
    end loop;
  end if;
  return new;
end $$;
revoke all on function public.daily_update_reply_after() from public, anon, authenticated;
create or replace trigger daily_update_reply_after after insert on public.daily_update_replies
  for each row execute function public.daily_update_reply_after();

-- Replies show straight away on every open screen.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'daily_update_replies') then
    alter publication supabase_realtime add table public.daily_update_replies;
  end if;
end $$;
