-- Submissions: a deadline for something the team has to send. A VO revision ("EI-263 Rev 1,
-- send on Sunday"), a BOQ, a payment application, a letter. Each one has a days-left timer in the
-- app, its own files and a conversation, and the project's team hears about it:
--   * when it's added, its deadline moves, it's marked sent (or no longer needed, or open again),
--     a file is added or someone comments;
--   * reminders on working days at 08:05 Riyadh: 3 days before, the working day before, on the day,
--     and once when it's overdue.
-- Managers, seniors and the project's own team can add and change them; everyone can see them.
-- A VO submission marked sent becomes that VO's next revision in the VO log (with the sent date);
-- reopened by mistake, that revision goes again as long as nobody has added anything to it.

/* ---------------------------------------------------------------- the table */
create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  variation_id uuid references public.variations(id) on delete set null,
  kind text not null default 'other' check (kind in ('vo', 'boq', 'payment', 'letter', 'other')),
  title text not null check (length(btrim(title)) between 1 and 200),
  rev text check (rev is null or length(rev) <= 40),
  details text check (details is null or length(details) <= 4000),
  due_on date not null,
  status text not null default 'open' check (status in ('open', 'sent', 'cancelled')),
  sent_on date,
  sent_by uuid references public.profiles(id) on delete set null,
  -- The VO revision made when it was marked sent.
  revision_key text,
  -- Reminders already sent for the current deadline ('3d', 'next', 'today', 'late').
  reminded text[] not null default '{}',
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists submissions_project_idx on public.submissions (project_id);
create index if not exists submissions_variation_idx on public.submissions (variation_id);
create index if not exists submissions_open_idx on public.submissions (due_on) where status = 'open';

/* ---------------------------------------------------------------- who can change them */
-- Managers and seniors on any project; everyone else on the projects they're on the team of.
create or replace function public.submission_editor(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_assign() or exists (
    select 1
      from public.project_members m
      join public.profiles p on p.id = m.user_id
     where m.project_id = p_project and m.user_id = auth.uid() and p.active
  );
$$;
revoke all on function public.submission_editor(uuid) from public, anon;
grant execute on function public.submission_editor(uuid) to authenticated;

alter table public.submissions enable row level security;

drop policy if exists "submissions readable" on public.submissions;
create policy "submissions readable" on public.submissions
  for select using (public.is_member());

drop policy if exists "team adds submissions" on public.submissions;
create policy "team adds submissions" on public.submissions
  for insert with check (public.is_member() and created_by = auth.uid() and public.submission_editor(project_id));

drop policy if exists "team edits submissions" on public.submissions;
create policy "team edits submissions" on public.submissions
  for update using (public.submission_editor(project_id)) with check (public.submission_editor(project_id));

drop policy if exists "remove submissions" on public.submissions;
create policy "remove submissions" on public.submissions
  for delete using (public.is_member() and (created_by = auth.uid() or public.can_assign()));

/* ---------------------------------------------------------------- words for notifications */
-- "EI-263 · Revised quotation"
create or replace function public.submission_label(p_submission uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select concat_ws(' · ', v.vo_number, s.title)
    from public.submissions s
    left join public.variations v on v.id = s.variation_id
   where s.id = p_submission;
$$;

-- "due today", "due tomorrow", "2 days overdue", "due Sun 2 Nov (5 days left)"
create or replace function public.submission_due_text(p_due date)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when p_due = public.riyadh_today() then 'due today'
    when p_due = public.riyadh_today() + 1 then 'due tomorrow'
    when p_due < public.riyadh_today() then
      (public.riyadh_today() - p_due) || case when public.riyadh_today() - p_due = 1 then ' day' else ' days' end || ' overdue'
    else 'due ' || to_char(p_due, 'Dy FMDD Mon') || ' (' || (p_due - public.riyadh_today()) || ' days left)'
  end;
$$;

-- Who hears about a submission: the project's team and whoever added it.
create or replace function public.submission_people(p_submission uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id
    from public.submissions s
    join public.project_members m on m.project_id = s.project_id
   where s.id = p_submission
  union
  select s.created_by
    from public.submissions s
   where s.id = p_submission and s.created_by is not null;
$$;
revoke all on function public.submission_label(uuid) from public, anon, authenticated;
revoke all on function public.submission_due_text(date) from public, anon, authenticated;
revoke all on function public.submission_people(uuid) from public, anon, authenticated;

/* ---------------------------------------------------------------- keeping a submission tidy */
create or replace function public.submission_before()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  k text;
  changed boolean;
begin
  new.title := btrim(new.title);
  new.rev := nullif(btrim(coalesce(new.rev, '')), '');
  new.details := nullif(btrim(coalesce(new.details, '')), '');

  -- A VO submission belongs to the VO's project.
  if new.variation_id is not null and (tg_op = 'INSERT' or new.variation_id is distinct from old.variation_id or new.project_id is distinct from old.project_id) then
    select id, project_id into v from public.variations where id = new.variation_id;
    if not found then
      raise exception 'That VO is no longer there';
    end if;
    new.project_id := v.project_id;
  end if;
  if new.variation_id is not null then
    new.kind := 'vo';
  elsif tg_op = 'INSERT' and new.kind = 'vo' then
    new.kind := 'other';
  end if;

  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    new.updated_by := new.created_by;
    new.reminded := '{}';
    new.revision_key := null;
    new.sent_by := null;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    -- Reminders start again for a new deadline.
    if new.due_on is distinct from old.due_on then
      new.reminded := '{}';
    end if;
    changed := (new.project_id, new.variation_id, new.kind, new.title, new.rev, new.details, new.due_on, new.status, new.sent_on)
               is distinct from (old.project_id, old.variation_id, old.kind, old.title, old.rev, old.details, old.due_on, old.status, old.sent_on);
    if changed then
      new.updated_at := now();
      new.updated_by := coalesce(auth.uid(), old.updated_by);
    else
      new.updated_at := old.updated_at;
      new.updated_by := old.updated_by;
    end if;
  end if;

  if new.status = 'sent' and (tg_op = 'INSERT' or old.status <> 'sent') then
    -- Just marked sent.
    new.sent_on := coalesce(new.sent_on, public.riyadh_today());
    new.sent_by := auth.uid();
    if new.variation_id is not null then
      -- It becomes the VO's next revision, so the VO log's latest submission is up to date.
      k := gen_random_uuid()::text;
      update public.variations
         set submissions = coalesce(submissions, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
               'key', k,
               -- Its own revision name if it has one; otherwise the log calls it "3rd submission".
               'rev', new.rev,
               'sent', new.sent_on,
               'sent_note', null,
               'submitted_value', null,
               'assessed_value', null,
               'response', null,
               'response_on', null))
       where id = new.variation_id;
      new.revision_key := k;
    end if;
  elsif new.status = 'sent' then
    -- Still sent: the sent date can be corrected, and the VO revision follows it.
    new.sent_by := old.sent_by;
    new.revision_key := old.revision_key;
    new.sent_on := coalesce(new.sent_on, old.sent_on);
    if new.sent_on is distinct from old.sent_on and new.revision_key is not null and new.variation_id is not null then
      update public.variations x
         set submissions = (
           select coalesce(jsonb_agg(case when e.r->>'key' = new.revision_key then e.r || jsonb_build_object('sent', new.sent_on) else e.r end
                                     order by e.o), '[]'::jsonb)
             from jsonb_array_elements(x.submissions) with ordinality as e(r, o))
       where x.id = new.variation_id;
    end if;
  else
    if tg_op = 'UPDATE' and old.status = 'sent' and old.revision_key is not null and old.variation_id is not null then
      -- Opened again (or no longer needed) after being marked sent: the revision it added goes,
      -- unless someone has added files, links, amounts or ECJV's reply to it since.
      update public.variations x
         set submissions = (
           select coalesce(jsonb_agg(e.r order by e.o), '[]'::jsonb)
             from jsonb_array_elements(x.submissions) with ordinality as e(r, o)
            where e.r->>'key' is distinct from old.revision_key)
       where x.id = old.variation_id
         and exists (select 1 from jsonb_array_elements(x.submissions) e(r)
                      where e.r->>'key' = old.revision_key
                        and e.r->>'submitted_value' is null and e.r->>'assessed_value' is null
                        and e.r->>'response' is null and e.r->>'response_on' is null)
         and not exists (select 1 from public.attachments a where a.variation_id = old.variation_id and a.vo_round = old.revision_key)
         and not exists (select 1 from public.drive_links l where l.variation_id = old.variation_id and l.vo_round = old.revision_key and l.removed_at is null);
    end if;
    new.sent_on := null;
    new.sent_by := null;
    new.revision_key := null;
  end if;
  return new;
end $$;

drop trigger if exists submissions_before on public.submissions;
create trigger submissions_before before insert or update on public.submissions
  for each row execute function public.submission_before();

/* ---------------------------------------------------------------- telling the team */
create or replace function public.submission_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  aname text := coalesce(public.actor_name(auth.uid()), 'Someone');
  label text := public.submission_label(new.id);
  pname text;
  head text;
  body text;
  u uuid;
begin
  select name into pname from public.projects where id = new.project_id;
  if tg_op = 'INSERT' then
    if new.status = 'sent' then
      head := aname || ' added a sent submission: ' || label;
      body := pname || ' · sent ' || to_char(new.sent_on, 'Dy FMDD Mon');
    else
      head := aname || ' added a submission: ' || label;
      body := pname || ' · ' || public.submission_due_text(new.due_on);
    end if;
  elsif new.status is distinct from old.status then
    if new.status = 'sent' then
      head := label || ' was sent';
      body := pname || ' · marked sent by ' || aname;
    elsif new.status = 'cancelled' then
      head := label || ' is no longer needed';
      body := pname || ' · ' || aname || ' took it off';
    else
      head := label || ' is open again';
      body := pname || ' · ' || public.submission_due_text(new.due_on);
    end if;
  elsif new.due_on is distinct from old.due_on and new.status = 'open' then
    head := label || ': deadline moved to ' || to_char(new.due_on, 'FMDay FMDD Mon');
    body := pname || ' · ' || aname || ' changed it · ' || public.submission_due_text(new.due_on);
  else
    return null;
  end if;
  for u in select x from public.submission_people(new.id) x loop
    perform public.notify(u, 'submission', head, body, '/submissions?id=' || new.id, actor, null, new.project_id);
  end loop;
  return null;
end $$;

drop trigger if exists submissions_after on public.submissions;
create trigger submissions_after after insert or update on public.submissions
  for each row execute function public.submission_after();

/* ---------------------------------------------------------------- files on a submission */
alter table public.attachments add column if not exists submission_id uuid references public.submissions(id) on delete cascade;
create index if not exists attachments_submission_idx on public.attachments (submission_id);

create or replace function public.attachment_before()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  root uuid;
begin
  -- A file on a message lives wherever the message is.
  if new.comment_id is not null then
    select conversation_id into new.conversation_id from public.comments where id = new.comment_id;
  end if;
  -- A file on a submission belongs to the submission's project.
  if new.submission_id is not null then
    select project_id into new.project_id from public.submissions where id = new.submission_id;
    if not found then
      raise exception 'That submission is no longer there';
    end if;
  end if;
  if new.version_of is null then
    new.version := 1;
    return new;
  end if;
  select id, version_of, conversation_id into o from public.attachments where id = new.version_of;
  if o.id is null then
    raise exception 'The original file is no longer there';
  end if;
  -- Signed-in people can only make a version of a file they can see (the Drive function checks
  -- this itself before it saves).
  if auth.uid() is not null and o.conversation_id is not null and not public.in_conversation(o.conversation_id) then
    raise exception 'The original file is no longer there';
  end if;
  -- A version of a private chat file stays in that chat.
  if o.conversation_id is not null and new.conversation_id is distinct from o.conversation_id then
    raise exception 'An edited copy of a chat file has to stay in that chat';
  end if;
  root := coalesce(o.version_of, o.id);
  new.version_of := root;
  new.version := coalesce((select max(a.version) from public.attachments a where a.id = root or a.version_of = root), 1) + 1;
  return new;
end $$;

-- Submission files aren't files of the project itself, so they never go in its folders.
create or replace function public.attachment_project_folder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  project_level boolean := new.project_id is not null and new.task_id is null and new.comment_id is null
    and new.conversation_id is null and new.recurring_id is null and new.variation_id is null
    and new.announcement_id is null and new.leave_id is null and new.submission_id is null;
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

create or replace function public.attachment_submission_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := coalesce(auth.uid(), new.uploaded_by);
  label text;
  u uuid;
begin
  if new.submission_id is null then
    return null;
  end if;
  label := public.submission_label(new.submission_id);
  for u in select x from public.submission_people(new.submission_id) x loop
    perform public.notify(u, 'submission', coalesce(public.actor_name(actor), 'Someone') || ' added a file to ' || label,
      new.name, '/submissions?id=' || new.submission_id, actor, null, new.project_id);
  end loop;
  return null;
end $$;

drop trigger if exists attachments_submission_after on public.attachments;
create trigger attachments_submission_after after insert on public.attachments
  for each row execute function public.attachment_submission_after();

/* ---------------------------------------------------------------- the conversation on a submission */
alter table public.comments add column if not exists submission_id uuid references public.submissions(id) on delete cascade;
create index if not exists comments_submission_idx on public.comments (submission_id);

create or replace function public.comment_before()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  f record;
begin
  if new.task_id is not null then
    select project_id into new.project_id from public.tasks where id = new.task_id;
  end if;
  -- A comment on a submission belongs to the submission's project (but never shows in its chat).
  if new.submission_id is not null then
    select project_id into new.project_id from public.submissions where id = new.submission_id;
    if not found then
      raise exception 'That submission is no longer there';
    end if;
    new.task_id := null;
    new.conversation_id := null;
  end if;
  -- Mentions: active people only, and in a private chat only people in it.
  new.mentions := coalesce(array(
    select distinct m from unnest(new.mentions) m
    where exists (select 1 from public.profiles p where p.id = m and p.active)
      and (new.conversation_id is null or exists (
        select 1 from public.conversation_members cm
        where cm.conversation_id = new.conversation_id and cm.user_id = m and cm.left_at is null))
  ), '{}');
  if tg_op = 'UPDATE' then
    if new.conversation_id is distinct from old.conversation_id
       or new.submission_id is distinct from old.submission_id
       or new.event is distinct from old.event
       or new.reply_to is distinct from old.reply_to
       or new.forwarded_from is distinct from old.forwarded_from then
      raise exception 'Messages can''t be moved to another chat';
    end if;
    new.edited_at := now();
    return new;
  end if;
  -- A reply quotes a message from the same chat.
  if new.reply_to is not null then
    select task_id, project_id, conversation_id, submission_id into r from public.comments where id = new.reply_to;
    if not found
       or r.task_id is distinct from new.task_id
       or r.project_id is distinct from new.project_id
       or r.conversation_id is distinct from new.conversation_id
       or r.submission_id is distinct from new.submission_id then
      raise exception 'You can only reply to a message in the same chat';
    end if;
  end if;
  -- A forwarded message comes from a message the person can see.
  if new.forwarded_from is not null and auth.uid() is not null then
    select conversation_id, event into f from public.comments where id = new.forwarded_from;
    if not found or f.event is not null
       or (f.conversation_id is not null and not public.in_conversation(f.conversation_id)) then
      raise exception 'You can only forward a message you can see';
    end if;
  end if;
  return new;
end $$;

create or replace function public.comment_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  aname text := coalesce(public.actor_name(new.author_id), 'Someone');
  snippet text := left(regexp_replace(new.body, '\s+', ' ', 'g'), 160);
  t record;
  cv record;
  place text;
  link text;
  label text;
  u uuid;
begin
  if new.conversation_id is not null then
    update public.conversations set last_message_at = greatest(last_message_at, new.created_at)
    where id = new.conversation_id;
    if new.event is not null then
      return new;
    end if;
    select kind, name into cv from public.conversations where id = new.conversation_id;
    link := '/chats/' || new.conversation_id;
    for u in
      select m.user_id from public.conversation_members m
      where m.conversation_id = new.conversation_id and m.left_at is null and m.user_id <> new.author_id
    loop
      if cv.kind = 'group' and u = any (new.mentions) then
        perform public.notify(u, 'mention', aname || ' mentioned you in ' || cv.name, snippet, link,
          new.author_id, null, null);
      else
        perform public.notify(u, 'chat', case when cv.kind = 'direct' then aname else aname || ' in ' || cv.name end,
          snippet, link, new.author_id, null, null);
      end if;
    end loop;
  elsif new.submission_id is not null then
    -- The submission's team (and whoever added it), plus anyone mentioned.
    label := public.submission_label(new.submission_id);
    link := '/submissions?id=' || new.submission_id;
    foreach u in array new.mentions loop
      perform public.notify(u, 'mention', aname || ' mentioned you on ' || label, snippet, link,
        new.author_id, null, new.project_id);
    end loop;
    for u in
      select x from public.submission_people(new.submission_id) x
      where x <> new.author_id and not (x = any (new.mentions))
    loop
      perform public.notify(u, 'comment', aname || ' commented on ' || label, snippet, link,
        new.author_id, null, new.project_id);
    end loop;
  elsif new.task_id is not null then
    select id, title, project_id into t from public.tasks where id = new.task_id;
    link := '/tasks/' || new.task_id;
    insert into public.task_watchers (task_id, user_id)
      select new.task_id, x from unnest(array_append(new.mentions, new.author_id)) x
      on conflict do nothing;
    foreach u in array new.mentions loop
      perform public.notify(u, 'mention', aname || ' mentioned you on ' || t.title, snippet, link,
        new.author_id, new.task_id, t.project_id);
    end loop;
    for u in
      select w.user_id from public.task_watchers w
      where w.task_id = new.task_id and w.user_id <> new.author_id and not (w.user_id = any (new.mentions))
    loop
      perform public.notify(u, 'comment', aname || ' commented on ' || t.title, snippet, link,
        new.author_id, new.task_id, t.project_id);
    end loop;
  else
    if new.project_id is not null then
      select name into place from public.projects where id = new.project_id;
      link := '/projects/' || new.project_id || '/chat';
    else
      place := 'team chat';
      link := '/chat';
    end if;
    for u in
      select p.id from public.profiles p
      where p.active and p.id is distinct from new.author_id
    loop
      if u = any (new.mentions) then
        perform public.notify(u, 'mention', aname || ' mentioned you in ' || place, snippet, link,
          new.author_id, null, new.project_id);
      else
        perform public.notify(u, 'chat', aname || ' in ' || place, snippet, link,
          new.author_id, null, new.project_id);
      end if;
    end loop;
  end if;
  return new;
end $$;

-- The chat list: a project's chat doesn't count submission comments (they're in the submission).
do $m$
declare
  d text := pg_get_functiondef('public.my_chats()'::regprocedure);
  a text := 'where x.project_id = p.id and x.task_id is null and x.author_id <> auth.uid()';
  b text := 'where c.project_id = p.id and c.task_id is null';
begin
  if position(a in d) = 0 or position(b in d) = 0 then
    raise exception 'my_chats has changed; update this migration';
  end if;
  d := replace(d, a, 'where x.project_id = p.id and x.task_id is null and x.submission_id is null and x.author_id <> auth.uid()');
  d := replace(d, b, 'where c.project_id = p.id and c.task_id is null and c.submission_id is null');
  execute d;
end $m$;

-- Search: a submission comment opens its submission.
do $m$
declare
  d text := pg_get_functiondef('public.search_everything(text, text, integer)'::regprocedure);
  a text := 'when c.task_id is not null then ''/tasks/'' || c.task_id || ''?m='' || c.id';
  b text := 'when c.task_id is not null then tk.title';
  c text := 'when c.task_id is not null then ''task''';
begin
  if position(a in d) = 0 or position(b in d) = 0 or position(c in d) = 0 then
    raise exception 'search_everything has changed; update this migration';
  end if;
  d := replace(d, a, 'when c.submission_id is not null then ''/submissions?id='' || c.submission_id || ''&m='' || c.id
            ' || a);
  d := replace(d, b, 'when c.submission_id is not null then (select s.title from public.submissions s where s.id = c.submission_id)
              ' || b);
  d := replace(d, c, 'when c.submission_id is not null then ''submission''
              ' || c);
  execute d;
end $m$;

/* ---------------------------------------------------------------- reminders */
create or replace function public.submission_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := public.riyadh_today();
  nextday date;
  r record;
  stage text;
  days int;
  head text;
  u uuid;
begin
  if not public.is_workday(today) then
    return;
  end if;
  nextday := public.next_workday(today + 1);
  for r in
    select s.id, s.title, s.due_on, s.project_id, s.reminded, v.vo_number, p.name as pname
      from public.submissions s
      join public.projects p on p.id = s.project_id
      left join public.variations v on v.id = s.variation_id
     where s.status = 'open' and s.due_on <= today + 3
  loop
    days := r.due_on - today;
    stage := null;
    -- The most urgent reminder not sent yet for this deadline.
    if days < 0 then
      if not ('late' = any (r.reminded)) then stage := 'late'; end if;
    elsif days = 0 then
      if not ('today' = any (r.reminded)) then stage := 'today'; end if;
    elsif r.due_on <= nextday then
      if not ('next' = any (r.reminded)) then stage := 'next'; end if;
    elsif not ('3d' = any (r.reminded)) then
      stage := '3d';
    end if;
    continue when stage is null;

    head := case stage
      when 'late' then concat_ws(' · ', r.vo_number, r.title) || ' is ' || (-days) || case when days = -1 then ' day' else ' days' end || ' overdue'
      when 'today' then 'Due today: ' || concat_ws(' · ', r.vo_number, r.title)
      when 'next' then 'Due ' || case when days = 1 then 'tomorrow' else trim(to_char(r.due_on, 'Day')) end || ': ' || concat_ws(' · ', r.vo_number, r.title)
      else concat_ws(' · ', r.vo_number, r.title) || ' is due in ' || days || ' days'
    end;
    for u in select x from public.submission_people(r.id) x loop
      perform public.notify(u, 'submission_due', head, r.pname || ' · ' || to_char(r.due_on, 'FMDay FMDD Mon'),
        '/submissions?id=' || r.id, null, null, r.project_id);
    end loop;
    update public.submissions
       set reminded = array(select distinct x from unnest(reminded || case stage
             when 'late' then array['3d', 'next', 'today', 'late']
             when 'today' then array['3d', 'next', 'today']
             when 'next' then array['3d', 'next']
             else array['3d'] end) x)
     where id = r.id;
  end loop;
end $$;
revoke all on function public.submission_reminders() from public, anon, authenticated;
revoke all on function public.submission_before() from public, anon, authenticated;
revoke all on function public.submission_after() from public, anon, authenticated;
revoke all on function public.attachment_submission_after() from public, anon, authenticated;

-- 05:05 UTC = 08:05 Riyadh, just after the task reminders.
select cron.schedule('northcroft-submission-reminders', '5 5 * * *', $c$select public.submission_reminders()$c$);

/* ---------------------------------------------------------------- live updates */
do $m$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'submissions') then
    alter publication supabase_realtime add table public.submissions;
  end if;
end $m$;
