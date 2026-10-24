-- Forward and pin messages, and polls in chats and announcements.
--
-- Forward: a copy of a message goes into one or more chats the person is in, marked as forwarded.
--   It carries the text, the voice note (with its English text), Drive files and Drive links.
--   Drive files are linked again (the same file in Google Drive); voice notes and files kept in the
--   app's storage are copied into the new chat's own folder by the app first (a quick copy inside
--   storage, nothing is uploaded again), so private chat files stay private and deleting the original
--   never breaks a forwarded copy.
-- Pin: up to 3 pinned messages per chat, newest first. Groups: their admins. One-to-one chats: either
--   person. Team chat and project chats: managers and seniors. Unpinning keeps the row (unpinned_at).
-- Polls: a question with 2 to 10 answers, one answer or several. In a chat a poll is a message (so it
--   gets the usual notification and unread count); in an announcement it sits under the text. Votes
--   are named, can be changed until the poll is closed, and send no notifications. The creator or a
--   manager closes it.

/* ------------------------------------------------------------------ forwarding */

alter table public.comments add column if not exists forwarded_from uuid;

-- Messages keep their place; a forwarded message must come from one the person can see.
create or replace function public.comment_before()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r record;
  f record;
begin
  if new.task_id is not null then
    select project_id into new.project_id from public.tasks where id = new.task_id;
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
    select task_id, project_id, conversation_id into r from public.comments where id = new.reply_to;
    if not found
       or r.task_id is distinct from new.task_id
       or r.project_id is distinct from new.project_id
       or r.conversation_id is distinct from new.conversation_id then
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
end $function$;

-- A forwarded voice note keeps its English text instead of being written out again. Runs after
-- comments_voice_before (triggers of the same kind run in name order), which clears the text.
create or replace function public.comment_forward_voice()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  s record;
begin
  if new.forwarded_from is null or new.voice_path is null then
    return new;
  end if;
  select transcript, transcript_status, conversation_id into s from public.comments where id = new.forwarded_from;
  if found and s.transcript_status = 'done'
     and (s.conversation_id is null or auth.uid() is null or public.in_conversation(s.conversation_id)) then
    new.transcript := s.transcript;
    new.transcript_status := 'done';
  end if;
  return new;
end $function$;

create trigger comments_voice_forward
  before insert on public.comments
  for each row execute function public.comment_forward_voice();

-- Ask for the English text only when it isn't there yet (a forwarded note already has it).
create or replace function public.voice_after()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.voice_path is not null
     and new.transcript_status is distinct from 'done'
     and (tg_op = 'INSERT' or new.voice_path is distinct from old.voice_path) then
    perform public.request_transcript(tg_argv[0], new.id);
  end if;
  return new;
end $function$;

-- Forward a message into chats ("team", "project:<id>", "conv:<id>"). p_voice_paths has, for each
-- chat, where the app copied the voice note (in that chat's own voice folder). Returns
-- [{chat, comment_id}] so the app can copy any files kept in its own storage across.
create or replace function public.forward_message(p_comment uuid, p_chats text[], p_voice_paths text[] default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  src public.comments;
  k text;
  i int;
  v_project uuid;
  v_conv uuid;
  v_path text;
  new_id uuid;
  made jsonb := '[]'::jsonb;
  me uuid := auth.uid();
begin
  if not public.is_member() then
    raise exception 'Please sign in again';
  end if;
  select * into src from public.comments where id = p_comment;
  if not found or src.event is not null
     or (src.conversation_id is not null and not public.in_conversation(src.conversation_id)) then
    raise exception 'That message is no longer there';
  end if;
  if exists (select 1 from public.polls p where p.comment_id = src.id) then
    raise exception 'Polls can''t be forwarded';
  end if;
  if coalesce(cardinality(p_chats), 0) = 0 then
    raise exception 'Pick a chat to forward to';
  end if;
  if cardinality(p_chats) > 20 then
    raise exception 'Forward to 20 chats or fewer at a time';
  end if;
  if (select count(distinct x) from unnest(p_chats) x) <> cardinality(p_chats) then
    raise exception 'Each chat can only be picked once';
  end if;

  for i in 1 .. cardinality(p_chats) loop
    k := p_chats[i];
    if k is null or not public.chat_visible(k) then
      raise exception 'You can only forward to chats you''re in';
    end if;
    v_project := case when k like 'project:%' then substr(k, 9)::uuid end;
    v_conv := case when k like 'conv:%' then substr(k, 6)::uuid end;

    v_path := null;
    if src.voice_path is not null then
      v_path := p_voice_paths[i];
      -- The copy has to sit in this person's voice folder for that chat, and actually be there.
      if v_path is null
         or v_path like '%..%'
         or not (case when v_conv is not null
                      then v_path like 'c/' || v_conv || '/voice/' || me || '-%'
                      else v_path like 'voice/' || me || '/%' end)
         or not exists (select 1 from storage.objects o where o.bucket_id = 'files' and o.name = v_path) then
        raise exception 'The voice note couldn''t be copied. Try again.';
      end if;
    end if;

    insert into public.comments (body, mentions, author_id, task_id, project_id, conversation_id,
                                 voice_path, voice_seconds, voice_peaks, forwarded_from)
    values (src.body, '{}', me, null, v_project, v_conv,
            v_path,
            case when v_path is not null then src.voice_seconds end,
            case when v_path is not null then src.voice_peaks end,
            src.id)
    returning id into new_id;

    -- Google Drive files: the same file in Drive, on the new message.
    insert into public.attachments (path, name, mime, size, project_id, comment_id, drive_file_id, uploaded_by)
    select 'drive/' || a.drive_file_id || '/fwd/' || gen_random_uuid(), a.name, a.mime, a.size, v_project, new_id,
           a.drive_file_id, me
    from public.attachments a
    where a.comment_id = src.id and a.drive_file_id is not null
    order by a.created_at;

    -- Shared Google Drive links.
    insert into public.drive_links (url, drive_id, resource_key, kind, title, mime, added_by, comment_id)
    select l.url, l.drive_id, l.resource_key, l.kind, l.title, l.mime, me, new_id
    from public.drive_links l
    where l.comment_id = src.id and l.removed_at is null
    order by l.created_at;

    made := made || jsonb_build_object('chat', k, 'comment_id', new_id);
  end loop;
  return made;
end $function$;

revoke all on function public.forward_message(uuid, text[], text[]) from public, anon;
grant execute on function public.forward_message(uuid, text[], text[]) to authenticated;

/* ------------------------------------------------------------------ pinned messages */

create table if not exists public.chat_pins (
  comment_id uuid primary key,
  chat text not null,
  pinned_by uuid not null,
  pinned_at timestamptz not null default now(),
  unpinned_at timestamptz,
  unpinned_by uuid
);
create index if not exists chat_pins_chat_idx on public.chat_pins (chat, pinned_at desc) where unpinned_at is null;
alter table public.chat_pins enable row level security;
-- Read only; pinning and unpinning go through pin_message.
create policy "see pins in own chats" on public.chat_pins
  for select to authenticated using (public.chat_visible(chat));

create or replace function public.pin_message(p_comment uuid, p_pin boolean default true)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  c public.comments;
  k text;
  v_kind text;
  v_admin boolean;
  allowed boolean;
begin
  if not public.is_member() then
    raise exception 'Please sign in again';
  end if;
  select * into c from public.comments where id = p_comment;
  if not found or c.event is not null or c.task_id is not null then
    raise exception 'That message can''t be pinned';
  end if;
  k := case when c.conversation_id is not null then 'conv:' || c.conversation_id
            when c.project_id is not null then 'project:' || c.project_id
            else 'team' end;
  if not public.chat_visible(k) then
    raise exception 'That message is no longer there';
  end if;
  if c.conversation_id is not null then
    select v.kind, m.is_admin into v_kind, v_admin
    from public.conversations v
    join public.conversation_members m on m.conversation_id = v.id and m.user_id = auth.uid() and m.left_at is null
    where v.id = c.conversation_id;
    allowed := v_kind = 'direct' or coalesce(v_admin, false);
  else
    allowed := public.can_assign();
  end if;
  if not coalesce(allowed, false) then
    raise exception '%', case when c.conversation_id is not null
                              then 'Only the group''s admins can pin messages'
                              else 'Only managers and seniors can pin messages here' end;
  end if;

  if p_pin then
    insert into public.chat_pins (comment_id, chat, pinned_by, pinned_at)
    values (c.id, k, auth.uid(), now())
    on conflict (comment_id) do update
      set pinned_by = excluded.pinned_by, pinned_at = excluded.pinned_at, unpinned_at = null, unpinned_by = null;
    -- Up to 3 per chat: the oldest makes way (and pins of messages since taken down go too).
    update public.chat_pins p set unpinned_at = now(), unpinned_by = auth.uid()
    where p.chat = k and p.unpinned_at is null
      and p.comment_id not in (
        select q.comment_id from public.chat_pins q
        join public.comments m on m.id = q.comment_id
        where q.chat = k and q.unpinned_at is null
        order by q.pinned_at desc
        limit 3);
  else
    update public.chat_pins set unpinned_at = now(), unpinned_by = auth.uid()
    where comment_id = c.id and unpinned_at is null;
  end if;
end $function$;

revoke all on function public.pin_message(uuid, boolean) from public, anon;
grant execute on function public.pin_message(uuid, boolean) to authenticated;

/* ------------------------------------------------------------------ polls */

create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid unique,
  announcement_id uuid unique,
  question text not null check (char_length(question) between 1 and 300),
  options text[] not null check (cardinality(options) between 2 and 10),
  multi boolean not null default false,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid,
  constraint polls_one_place check ((comment_id is null) <> (announcement_id is null))
);

-- One row per person per poll: the answers they picked (empty once they take their vote back).
create table if not exists public.poll_votes (
  poll_id uuid not null references public.polls (id),
  user_id uuid not null,
  choices smallint[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);

-- A poll is visible to whoever can see its message or announcement.
create or replace function public.poll_visible(p_poll uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select public.is_member() and exists (
    select 1 from public.polls p
    left join public.comments c on c.id = p.comment_id
    left join public.announcements a on a.id = p.announcement_id
    where p.id = p_poll
      and ((p.comment_id is not null and c.id is not null
            and (c.conversation_id is null or public.in_conversation(c.conversation_id)))
        or (p.announcement_id is not null and a.id is not null)));
$function$;

alter table public.polls enable row level security;
alter table public.poll_votes enable row level security;
-- Read only; creating, voting and closing go through the functions below.
create policy "see polls you can see" on public.polls
  for select to authenticated using (public.poll_visible(id));
create policy "see votes on polls you can see" on public.poll_votes
  for select to authenticated using (public.poll_visible(poll_id));

-- Tidy the answers: trimmed, no blanks, no repeats, 2 to 10 of them.
create or replace function public.poll_options_clean(p_options text[])
 returns text[]
 language plpgsql
 immutable
as $function$
declare
  v_opts text[] := '{}';
  o text;
begin
  foreach o in array coalesce(p_options, '{}'::text[]) loop
    o := btrim(regexp_replace(coalesce(o, ''), '\s+', ' ', 'g'));
    if o = '' then
      continue;
    end if;
    if char_length(o) > 120 then
      raise exception 'Keep each answer under 120 characters';
    end if;
    if lower(o) = any (select lower(x) from unnest(v_opts) x) then
      raise exception 'Each answer needs to be different';
    end if;
    v_opts := v_opts || o;
  end loop;
  if cardinality(v_opts) < 2 then
    raise exception 'A poll needs at least 2 answers';
  end if;
  if cardinality(v_opts) > 10 then
    raise exception 'A poll can have up to 10 answers';
  end if;
  return v_opts;
end $function$;

create or replace function public.poll_question_clean(p_question text)
 returns text
 language plpgsql
 immutable
as $function$
declare
  q text := btrim(regexp_replace(coalesce(p_question, ''), '\s+', ' ', 'g'));
begin
  if q = '' then
    raise exception 'Add a question';
  end if;
  if char_length(q) > 300 then
    raise exception 'Keep the question under 300 characters';
  end if;
  return q;
end $function$;

-- A poll in a chat ("team", "project:<id>", "conv:<id>"): a message, plus the poll. Returns the message id.
create or replace function public.create_chat_poll(p_chat text, p_question text, p_options text[], p_multi boolean default false)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  q text;
  opts text[];
  v_project uuid;
  v_conv uuid;
  cid uuid;
begin
  if not public.is_member() then
    raise exception 'Please sign in again';
  end if;
  if p_chat is null or not public.chat_visible(p_chat) then
    raise exception 'You can only start a poll in a chat you''re in';
  end if;
  q := public.poll_question_clean(p_question);
  opts := public.poll_options_clean(p_options);
  v_project := case when p_chat like 'project:%' then substr(p_chat, 9)::uuid end;
  v_conv := case when p_chat like 'conv:%' then substr(p_chat, 6)::uuid end;
  insert into public.comments (body, mentions, author_id, project_id, conversation_id)
  values ('Poll: ' || q, '{}', auth.uid(), v_project, v_conv)
  returning id into cid;
  insert into public.polls (comment_id, question, options, multi, created_by)
  values (cid, q, opts, coalesce(p_multi, false), auth.uid());
  return cid;
end $function$;

-- A poll under an announcement (whoever can post announcements). Returns the poll id.
create or replace function public.add_announcement_poll(p_announcement uuid, p_question text, p_options text[], p_multi boolean default false)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  q text;
  opts text[];
  pid uuid;
begin
  if not public.can_assign() then
    raise exception 'Only managers and seniors can add a poll to an announcement';
  end if;
  if not exists (select 1 from public.announcements a where a.id = p_announcement) then
    raise exception 'That announcement is no longer there';
  end if;
  if exists (select 1 from public.polls p where p.announcement_id = p_announcement) then
    raise exception 'This announcement already has a poll';
  end if;
  q := public.poll_question_clean(p_question);
  opts := public.poll_options_clean(p_options);
  insert into public.polls (announcement_id, question, options, multi, created_by)
  values (p_announcement, q, opts, coalesce(p_multi, false), auth.uid())
  returning id into pid;
  return pid;
end $function$;

-- Vote, change a vote, or take it back (no answers). Answers are numbered from 0.
create or replace function public.vote_poll(p_poll uuid, p_choices int[])
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  p public.polls;
  ch smallint[];
begin
  if not public.poll_visible(p_poll) then
    raise exception 'That poll is no longer there';
  end if;
  select * into p from public.polls where id = p_poll;
  if p.closed_at is not null then
    raise exception 'This poll is closed';
  end if;
  ch := coalesce(array(select distinct x::smallint from unnest(coalesce(p_choices, '{}'::int[])) x
                       where x is not null order by 1), '{}');
  if exists (select 1 from unnest(ch) x where x < 0 or x >= cardinality(p.options)) then
    raise exception 'That answer isn''t in the poll';
  end if;
  if not p.multi and cardinality(ch) > 1 then
    raise exception 'Pick one answer';
  end if;
  insert into public.poll_votes (poll_id, user_id, choices, updated_at)
  values (p_poll, auth.uid(), ch, now())
  on conflict (poll_id, user_id) do update set choices = excluded.choices, updated_at = excluded.updated_at;
end $function$;

-- Close a poll: no more voting, the results stay. The person who made it, or a manager.
create or replace function public.close_poll(p_poll uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  p public.polls;
begin
  if not public.poll_visible(p_poll) then
    raise exception 'That poll is no longer there';
  end if;
  select * into p from public.polls where id = p_poll;
  if p.created_by is distinct from auth.uid() and not public.is_manager() then
    raise exception 'Only the person who started the poll, or a manager, can close it';
  end if;
  update public.polls set closed_at = now(), closed_by = auth.uid() where id = p_poll and closed_at is null;
end $function$;

revoke all on function public.create_chat_poll(text, text, text[], boolean) from public, anon;
revoke all on function public.add_announcement_poll(uuid, text, text[], boolean) from public, anon;
revoke all on function public.vote_poll(uuid, int[]) from public, anon;
revoke all on function public.close_poll(uuid) from public, anon;
grant execute on function public.create_chat_poll(text, text, text[], boolean) to authenticated;
grant execute on function public.add_announcement_poll(uuid, text, text[], boolean) to authenticated;
grant execute on function public.vote_poll(uuid, int[]) to authenticated;
grant execute on function public.close_poll(uuid) to authenticated;

/* ------------------------------------------------------------------ live updates */

alter publication supabase_realtime add table public.chat_pins, public.polls, public.poll_votes;
