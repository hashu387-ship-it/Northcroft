-- One-to-one and group chats, replies, reactions, seen ticks, saved signatures, and new versions of
-- edited PDF and Excel files.
--
-- Team chat and project chats work as before: everyone on the team can read them.
-- One-to-one and group chats are private. Only the people in them can read their messages, files
-- and voice notes; managers can't see chats they aren't part of.
--
-- Group changes (create, add, remove, leave, rename, admins) go through the functions below, which
-- also post the grey lines such as "Hassan added Rimash". Leaving a chat stamps left_at, so the
-- member list keeps a record of who was in it. Nothing in this migration removes data.

-- ---------------------------------------------------------------------------
-- Conversations and their members
-- ---------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'group')),
  name text check (name is null or length(btrim(name)) between 1 and 80),
  -- "<smaller id>:<larger id>", so two people only ever have one chat together.
  direct_key text unique,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  constraint conversations_shape check (
    (kind = 'direct' and direct_key is not null and name is null)
    or (kind = 'group' and direct_key is null and name is not null))
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id),
  user_id uuid not null references public.profiles(id),
  is_admin boolean not null default false,
  added_by uuid references public.profiles(id),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on public.conversation_members (user_id) where left_at is null;

create or replace function public.in_conversation(p_conversation uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_member() and exists (
    select 1 from public.conversation_members m
    where m.conversation_id = p_conversation and m.user_id = auth.uid() and m.left_at is null);
$$;

create or replace function public.conversation_admin(p_conversation uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_member() and exists (
    select 1 from public.conversation_members m
    where m.conversation_id = p_conversation and m.user_id = auth.uid() and m.left_at is null and m.is_admin);
$$;

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
-- Reading only. Every change goes through the functions further down.
create policy "see own chats" on public.conversations for select to authenticated
  using (public.in_conversation(id));
create policy "see who is in own chats" on public.conversation_members for select to authenticated
  using (public.in_conversation(conversation_id));

-- ---------------------------------------------------------------------------
-- Messages: private chats, replies and the grey event lines
-- ---------------------------------------------------------------------------
alter table public.comments
  add column conversation_id uuid references public.conversations(id),
  -- No foreign key: a reply stays when the message it quotes is taken down ("Message removed").
  add column reply_to uuid,
  add column event text check (event in ('created', 'added', 'removed', 'left', 'renamed', 'admin')),
  add constraint comments_one_place check (conversation_id is null or (task_id is null and project_id is null));

create index comments_conversation_idx on public.comments (conversation_id, created_at) where conversation_id is not null;
create index comments_team_idx on public.comments (created_at)
  where task_id is null and project_id is null and conversation_id is null;

alter policy "comments readable" on public.comments
  using (public.is_member() and (conversation_id is null or public.in_conversation(conversation_id)));
-- Grey event lines are written only by the group functions.
alter policy "post comments" on public.comments
  with check (author_id = auth.uid() and public.is_member() and event is null
              and (conversation_id is null or public.in_conversation(conversation_id)));
alter policy "edit own comments" on public.comments
  using (author_id = auth.uid())
  with check (author_id = auth.uid() and event is null
              and (conversation_id is null or public.in_conversation(conversation_id)));

create or replace function public.comment_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
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
       or new.reply_to is distinct from old.reply_to then
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
  return new;
end $$;

-- Who gets a notification: everyone in a private chat except the sender; task comments and team
-- and project chats as before.
create or replace function public.comment_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  aname text := coalesce(public.actor_name(new.author_id), 'Someone');
  snippet text := left(regexp_replace(new.body, '\s+', ' ', 'g'), 160);
  t record;
  cv record;
  place text;
  link text;
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

-- ---------------------------------------------------------------------------
-- Seen ticks: when each person last read each chat
-- chat is 'team', 'project:<project id>' or 'conv:<conversation id>'
-- ---------------------------------------------------------------------------
create table public.chat_reads (
  user_id uuid not null references public.profiles(id),
  chat text not null check (chat ~ '^(team|project:[0-9a-f-]{36}|conv:[0-9a-f-]{36})$'),
  read_at timestamptz not null default now(),
  primary key (user_id, chat)
);
create index chat_reads_chat_idx on public.chat_reads (chat);

create or replace function public.chat_visible(p_chat text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member() then
    return false;
  end if;
  if p_chat = 'team' then
    return true;
  elsif p_chat like 'project:%' then
    return exists (select 1 from public.projects where id = substr(p_chat, 9)::uuid);
  elsif p_chat like 'conv:%' then
    return public.in_conversation(substr(p_chat, 6)::uuid);
  end if;
  return false;
exception when invalid_text_representation then
  return false;
end $$;

alter table public.chat_reads enable row level security;
create policy "see reads in own chats" on public.chat_reads for select to authenticated
  using (public.chat_visible(chat));

create or replace function public.mark_chat_read(p_chat text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.chat_visible(p_chat) then
    raise exception 'Chat not found';
  end if;
  insert into public.chat_reads (user_id, chat, read_at) values (auth.uid(), p_chat, now())
  on conflict (user_id, chat) do update set read_at = greatest(public.chat_reads.read_at, excluded.read_at);
end $$;

-- Everyone starts with the team chat and project chats read, so nothing old shows as unread.
insert into public.chat_reads (user_id, chat, read_at)
select p.id, 'team', now() from public.profiles p
on conflict do nothing;
insert into public.chat_reads (user_id, chat, read_at)
select p.id, 'project:' || pr.id, now() from public.profiles p cross join public.projects pr
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Reactions: one per person per message (reaction null = taken back)
-- ---------------------------------------------------------------------------
create table public.comment_reactions (
  comment_id uuid not null,
  user_id uuid not null default auth.uid() references public.profiles(id),
  reaction text check (reaction in ('like', 'done', 'love', 'haha', 'thanks', 'sad')),
  updated_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

alter table public.comment_reactions enable row level security;
create policy "see reactions on visible messages" on public.comment_reactions for select to authenticated
  using (exists (select 1 from public.comments c where c.id = comment_id));
create policy "react to visible messages" on public.comment_reactions for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.comments c where c.id = comment_id));
create policy "change own reaction" on public.comment_reactions for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.comments c where c.id = comment_id));

create or replace function public.reaction_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger comment_reactions_touch before insert or update on public.comment_reactions
  for each row execute function public.reaction_touch();

-- ---------------------------------------------------------------------------
-- Files: private chat files, and new versions of edited files
-- ---------------------------------------------------------------------------
alter table public.attachments
  add column conversation_id uuid references public.conversations(id),
  -- The first version of the file. No foreign key, so the edits stay if the original is taken down.
  add column version_of uuid,
  add column version int not null default 1 check (version between 1 and 9999);

create index attachments_conversation_idx on public.attachments (conversation_id) where conversation_id is not null;
create index attachments_version_idx on public.attachments (version_of) where version_of is not null;

create or replace function public.attachment_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o record;
  root uuid;
begin
  -- A file on a message lives wherever the message is.
  if new.comment_id is not null then
    select conversation_id into new.conversation_id from public.comments where id = new.comment_id;
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

create trigger attachments_before before insert on public.attachments
  for each row execute function public.attachment_before();

alter policy "attachments readable" on public.attachments
  using (public.is_member() and (conversation_id is null or public.in_conversation(conversation_id)));
alter policy "add attachments" on public.attachments
  with check (uploaded_by = auth.uid() and public.is_member() and drive_file_id is null
              and (conversation_id is null or public.in_conversation(conversation_id)));

-- Private chat files and voice notes are stored under c/<conversation id>/.
create or replace function public.file_path_visible(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if split_part(p_name, '/', 1) <> 'c' then
    return true;
  end if;
  return public.in_conversation(split_part(p_name, '/', 2)::uuid);
exception when invalid_text_representation then
  return false;
end $$;

alter policy "team reads files" on storage.objects
  using (bucket_id = 'files' and public.is_member() and public.file_path_visible(name));
alter policy "team uploads files" on storage.objects
  with check (bucket_id = 'files' and public.is_member() and public.file_path_visible(name));

-- ---------------------------------------------------------------------------
-- Saved signature and initials for signing PDFs (each person sees only their own)
-- ---------------------------------------------------------------------------
create table public.user_signatures (
  user_id uuid primary key default auth.uid() references public.profiles(id),
  signature text check (signature is null or (signature like 'data:image/png;base64,%' and length(signature) < 400000)),
  initials text check (initials is null or (initials like 'data:image/png;base64,%' and length(initials) < 400000)),
  updated_at timestamptz not null default now()
);
alter table public.user_signatures enable row level security;
create policy "see own signature" on public.user_signatures for select to authenticated
  using (user_id = auth.uid());
create policy "save own signature" on public.user_signatures for insert to authenticated
  with check (user_id = auth.uid() and public.is_member());
create policy "change own signature" on public.user_signatures for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create trigger user_signatures_touch before insert or update on public.user_signatures
  for each row execute function public.reaction_touch();

-- ---------------------------------------------------------------------------
-- Starting chats and running groups
-- ---------------------------------------------------------------------------
-- "Saheeb", "Saheeb and Imthath", "Saheeb, Imthath and Rimash"
create or replace function public.name_list(p_users uuid[]) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  names text[] := array(select coalesce(public.actor_name(u), 'someone') from unnest(p_users) with ordinality x(u, i) order by i);
  n int := cardinality(names);
begin
  if n = 0 then
    return '';
  elsif n = 1 then
    return names[1];
  end if;
  return array_to_string(names[1:n - 1], ', ') || ' and ' || names[n];
end $$;

-- A grey line in a group, such as "Hassan added Rimash".
create or replace function public.post_chat_event(p_conversation uuid, p_event text, p_body text) returns void
language sql security definer set search_path = public as $$
  insert into public.comments (conversation_id, author_id, body, event, mentions)
  values (p_conversation, auth.uid(), left(p_body, 400), p_event, '{}');
$$;

create or replace function public.start_direct_chat(p_user uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  k text;
  cid uuid;
begin
  if me is null or not public.is_member() then
    raise exception 'Please sign in again';
  end if;
  if p_user is null or p_user = me then
    raise exception 'Pick someone else to message';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and active) then
    raise exception 'That person no longer has access';
  end if;
  k := least(me::text, p_user::text) || ':' || greatest(me::text, p_user::text);
  insert into public.conversations (kind, direct_key, created_by) values ('direct', k, me)
  on conflict (direct_key) do nothing
  returning id into cid;
  if cid is null then
    select id into cid from public.conversations where direct_key = k;
  end if;
  insert into public.conversation_members (conversation_id, user_id, added_by)
  values (cid, me, me), (cid, p_user, me)
  on conflict (conversation_id, user_id) do nothing;
  return cid;
end $$;

create or replace function public.create_group(p_name text, p_members uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  nm text := btrim(coalesce(p_name, ''));
  people uuid[];
  cid uuid;
  u uuid;
begin
  if me is null or not public.is_member() then
    raise exception 'Please sign in again';
  end if;
  if nm = '' then
    raise exception 'Give the group a name';
  end if;
  if length(nm) > 80 then
    raise exception 'Keep the group name under 80 characters';
  end if;
  select coalesce(array_agg(distinct p.id), '{}') into people
  from public.profiles p
  where p.id = any (coalesce(p_members, '{}')) and p.active and p.id <> me;
  if cardinality(people) = 0 then
    raise exception 'Add at least one person to the group';
  end if;

  insert into public.conversations (kind, name, created_by) values ('group', nm, me) returning id into cid;
  insert into public.conversation_members (conversation_id, user_id, is_admin, added_by) values (cid, me, true, me);
  insert into public.conversation_members (conversation_id, user_id, added_by)
  select cid, x, me from unnest(people) x;

  perform public.post_chat_event(cid, 'created', public.actor_name(me) || ' created the group');
  perform public.post_chat_event(cid, 'added', public.actor_name(me) || ' added ' || public.name_list(people));
  foreach u in array people loop
    perform public.notify(u, 'group_added', public.actor_name(me) || ' added you to ' || nm,
      'Tap to open the group chat', '/chats/' || cid, me);
  end loop;
  return cid;
end $$;

create or replace function public.require_group_admin(p_conversation uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.conversations where id = p_conversation and kind = 'group') then
    raise exception 'Group not found';
  end if;
  if not public.conversation_admin(p_conversation) then
    raise exception 'Only a group admin can do this';
  end if;
end $$;

create or replace function public.rename_group(p_conversation uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare
  nm text := btrim(coalesce(p_name, ''));
begin
  perform public.require_group_admin(p_conversation);
  if nm = '' then
    raise exception 'Give the group a name';
  end if;
  if length(nm) > 80 then
    raise exception 'Keep the group name under 80 characters';
  end if;
  if nm = (select name from public.conversations where id = p_conversation) then
    return;
  end if;
  update public.conversations set name = nm where id = p_conversation;
  perform public.post_chat_event(p_conversation, 'renamed',
    public.actor_name(auth.uid()) || ' renamed the group to "' || nm || '"');
end $$;

create or replace function public.add_group_members(p_conversation uuid, p_users uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  nm text;
  people uuid[];
  u uuid;
begin
  perform public.require_group_admin(p_conversation);
  select name into nm from public.conversations where id = p_conversation;
  select coalesce(array_agg(distinct p.id), '{}') into people
  from public.profiles p
  where p.id = any (coalesce(p_users, '{}')) and p.active
    and not exists (select 1 from public.conversation_members m
                    where m.conversation_id = p_conversation and m.user_id = p.id and m.left_at is null);
  if cardinality(people) = 0 then
    return 0;
  end if;
  insert into public.conversation_members (conversation_id, user_id, added_by)
  select p_conversation, x, me from unnest(people) x
  on conflict (conversation_id, user_id)
  do update set left_at = null, is_admin = false, joined_at = now(), added_by = excluded.added_by;
  perform public.post_chat_event(p_conversation, 'added', public.actor_name(me) || ' added ' || public.name_list(people));
  foreach u in array people loop
    perform public.notify(u, 'group_added', public.actor_name(me) || ' added you to ' || nm,
      'Tap to open the group chat', '/chats/' || p_conversation, me);
  end loop;
  return cardinality(people);
end $$;

create or replace function public.remove_group_member(p_conversation uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_group_admin(p_conversation);
  if p_user = auth.uid() then
    raise exception 'Use Leave group to leave it yourself';
  end if;
  update public.conversation_members set left_at = now(), is_admin = false
  where conversation_id = p_conversation and user_id = p_user and left_at is null;
  if not found then
    raise exception 'That person isn''t in the group';
  end if;
  perform public.post_chat_event(p_conversation, 'removed',
    public.actor_name(auth.uid()) || ' removed ' || public.actor_name(p_user));
end $$;

create or replace function public.set_group_admin(p_conversation uuid, p_user uuid, p_admin boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_group_admin(p_conversation);
  if not p_admin and not exists (
    select 1 from public.conversation_members
    where conversation_id = p_conversation and left_at is null and is_admin and user_id <> p_user) then
    raise exception 'Make someone else an admin first';
  end if;
  update public.conversation_members set is_admin = p_admin
  where conversation_id = p_conversation and user_id = p_user and left_at is null and is_admin <> p_admin;
  if not found then
    return;
  end if;
  perform public.post_chat_event(p_conversation, 'admin',
    case when p_admin
      then public.actor_name(auth.uid()) || ' made ' || public.actor_name(p_user) || ' an admin'
      else public.actor_name(auth.uid()) || ' changed ' || public.actor_name(p_user) || ' to a member' end);
end $$;

create or replace function public.leave_group(p_conversation uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  heir uuid;
begin
  if not exists (select 1 from public.conversations where id = p_conversation and kind = 'group')
     or not public.in_conversation(p_conversation) then
    raise exception 'Group not found';
  end if;
  update public.conversation_members set left_at = now(), is_admin = false
  where conversation_id = p_conversation and user_id = me and left_at is null;
  perform public.post_chat_event(p_conversation, 'left', public.actor_name(me) || ' left');
  -- A group always keeps an admin: the longest-standing member takes over.
  if not exists (select 1 from public.conversation_members
                 where conversation_id = p_conversation and left_at is null and is_admin) then
    select user_id into heir from public.conversation_members
    where conversation_id = p_conversation and left_at is null
    order by joined_at limit 1;
    if heir is not null then
      update public.conversation_members set is_admin = true where conversation_id = p_conversation and user_id = heir;
      perform public.post_chat_event(p_conversation, 'admin', public.actor_name(heir) || ' is now an admin');
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The Chats list: team chat, project chats with messages, groups and one-to-one chats,
-- with the last message and how many are unread. Runs with the caller's own permissions.
-- ---------------------------------------------------------------------------
create or replace function public.my_chats()
returns table (
  chat text, kind text, conversation_id uuid, project_id uuid, name text, members uuid[], is_admin boolean,
  last_at timestamptz, last_body text, last_author uuid, last_voice boolean, last_event text, unread int)
language sql stable security invoker set search_path = public as $$
  with rd as (
    select r.chat as rchat, r.read_at from public.chat_reads r where r.user_id = auth.uid()
  )
  select 'team'::text, 'team'::text, null::uuid, null::uuid, 'Team chat'::text, null::uuid[], false,
         l.created_at, l.body, l.author_id, coalesce(l.voice_path is not null, false), l.event,
         (select count(*) from public.comments x
           where x.task_id is null and x.project_id is null and x.conversation_id is null
             and x.author_id <> auth.uid()
             and x.created_at > coalesce((select rd.read_at from rd where rd.rchat = 'team'), now()))::int
  from (select 1) one
  left join lateral (
    select c.created_at, c.body, c.author_id, c.voice_path, c.event from public.comments c
    where c.task_id is null and c.project_id is null and c.conversation_id is null
    order by c.created_at desc limit 1) l on true
  where public.is_member()
  union all
  select 'project:' || p.id, 'project', null, p.id, p.name, null, false,
         l.created_at, l.body, l.author_id, l.voice_path is not null, l.event,
         (select count(*) from public.comments x
           where x.project_id = p.id and x.task_id is null and x.author_id <> auth.uid()
             and x.created_at > coalesce((select rd.read_at from rd where rd.rchat = 'project:' || p.id), now()))::int
  from public.projects p
  join lateral (
    select c.created_at, c.body, c.author_id, c.voice_path, c.event from public.comments c
    where c.project_id = p.id and c.task_id is null
    order by c.created_at desc limit 1) l on true
  union all
  select 'conv:' || v.id, v.kind, v.id, null, v.name,
         array(select m.user_id from public.conversation_members m
               where m.conversation_id = v.id and m.left_at is null order by m.joined_at),
         mine.is_admin,
         coalesce(l.created_at, v.created_at), l.body, l.author_id, coalesce(l.voice_path is not null, false), l.event,
         (select count(*) from public.comments x
           where x.conversation_id = v.id and x.event is null and x.author_id <> auth.uid()
             and x.created_at > coalesce((select rd.read_at from rd where rd.rchat = 'conv:' || v.id), mine.joined_at))::int
  from public.conversations v
  join public.conversation_members mine
    on mine.conversation_id = v.id and mine.user_id = auth.uid() and mine.left_at is null
  left join lateral (
    select c.created_at, c.body, c.author_id, c.voice_path, c.event from public.comments c
    where c.conversation_id = v.id
    order by c.created_at desc limit 1) l on true
  where v.kind = 'group' or l.created_at is not null;
$$;

-- ---------------------------------------------------------------------------
-- Permissions and live updates
-- ---------------------------------------------------------------------------
revoke execute on function public.post_chat_event(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.require_group_admin(uuid) from public, anon, authenticated;
revoke execute on function public.comment_before() from public, anon, authenticated;
revoke execute on function public.attachment_before() from public, anon, authenticated;
revoke execute on function public.reaction_touch() from public, anon, authenticated;
revoke execute on function public.name_list(uuid[]) from public, anon, authenticated;
revoke execute on function public.in_conversation(uuid) from anon;
revoke execute on function public.conversation_admin(uuid) from anon;
revoke execute on function public.chat_visible(text) from anon;
revoke execute on function public.file_path_visible(text) from anon;
revoke execute on function public.mark_chat_read(text) from public, anon;
revoke execute on function public.start_direct_chat(uuid) from public, anon;
revoke execute on function public.create_group(text, uuid[]) from public, anon;
revoke execute on function public.rename_group(uuid, text) from public, anon;
revoke execute on function public.add_group_members(uuid, uuid[]) from public, anon;
revoke execute on function public.remove_group_member(uuid, uuid) from public, anon;
revoke execute on function public.set_group_admin(uuid, uuid, boolean) from public, anon;
revoke execute on function public.leave_group(uuid) from public, anon;
revoke execute on function public.my_chats() from public, anon;
grant execute on function public.mark_chat_read(text) to authenticated;
grant execute on function public.start_direct_chat(uuid) to authenticated;
grant execute on function public.create_group(text, uuid[]) to authenticated;
grant execute on function public.rename_group(uuid, text) to authenticated;
grant execute on function public.add_group_members(uuid, uuid[]) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
grant execute on function public.set_group_admin(uuid, uuid, boolean) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.my_chats() to authenticated;

alter publication supabase_realtime add table
  public.conversations, public.conversation_members, public.chat_reads, public.comment_reactions;
