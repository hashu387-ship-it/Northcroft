-- WhatsApp-style chat: every team chat or project chat message notifies the rest of the team.
-- People who are @mentioned get a 'mention' notification; everyone else gets a 'chat' one.
-- Task comments work as before: mentions plus everyone following the task.

create or replace function public.comment_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  aname text := coalesce(public.actor_name(new.author_id), 'Someone');
  snippet text := left(regexp_replace(new.body, '\s+', ' ', 'g'), 160);
  t record;
  place text;
  link text;
  u uuid;
begin
  if new.task_id is not null then
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

-- The Settings test notification comes "from" you, so it shows your own name and photo.
create or replace function public.send_test_push() returns uuid
language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  insert into public.notifications (user_id, type, title, body, link, actor_id)
  values (auth.uid(), 'test', 'Notifications are working', 'This is how messages from the team will look.', '/settings', auth.uid())
  returning id into nid;
  return nid;
end $$;

-- Opening a chat or task marks its notifications read, so look them up quickly.
create index if not exists notifications_unread_link_idx
  on public.notifications (user_id, link) where read_at is null;
