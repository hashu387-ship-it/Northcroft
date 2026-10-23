-- Voice notes on chat messages, task comments and announcements.
-- The audio lives in the private 'files' bucket under voice/<user id>/.
-- When a voice note is posted, the database asks the 'transcribe' Edge Function to write it
-- out in English (Groq Whisper). The text appears under the voice note a few seconds later.

alter table public.comments
  add column if not exists voice_path text,
  add column if not exists voice_seconds numeric(6, 1),
  add column if not exists voice_peaks smallint[],
  add column if not exists transcript text,
  add column if not exists transcript_status text;

alter table public.announcements
  add column if not exists voice_path text,
  add column if not exists voice_seconds numeric(6, 1),
  add column if not exists voice_peaks smallint[],
  add column if not exists transcript text,
  add column if not exists transcript_status text;

alter table public.comments
  add constraint comments_transcript_status_check check (transcript_status in ('pending', 'done', 'failed', 'off')),
  add constraint comments_voice_seconds_check check (voice_seconds is null or voice_seconds between 0 and 600);
alter table public.announcements
  add constraint announcements_transcript_status_check check (transcript_status in ('pending', 'done', 'failed', 'off')),
  add constraint announcements_voice_seconds_check check (voice_seconds is null or voice_seconds between 0 and 600);

-- "Voice note, 0:42"
create or replace function public.voice_label(p_seconds numeric) returns text
language sql immutable set search_path = public as $$
  select 'Voice note, ' || (round(coalesce(p_seconds, 0))::int / 60) || ':'
         || lpad((round(coalesce(p_seconds, 0))::int % 60)::text, 2, '0');
$$;

-- Ask the transcribe function to write a voice note out, using the same shared secret as push.
create or replace function public.request_transcript(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  fn_url text;
  secret text;
begin
  select replace(decrypted_secret, '/send-push', '/transcribe') into fn_url from vault.decrypted_secrets where name = 'push_function_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'push_webhook_secret';
  if fn_url is null or secret is null then
    return;
  end if;
  perform net.http_post(
    url := fn_url,
    body := jsonb_build_object('kind', p_kind, 'id', p_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', secret),
    timeout_milliseconds := 60000
  );
end $$;

-- A new or replaced voice note starts as 'pending'; removing it clears the text.
create or replace function public.voice_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.voice_path is null then
    new.transcript := null;
    new.transcript_status := null;
    new.voice_seconds := null;
    new.voice_peaks := null;
  elsif tg_op = 'INSERT' or new.voice_path is distinct from old.voice_path then
    new.transcript := null;
    new.transcript_status := 'pending';
  end if;
  return new;
end $$;

create or replace function public.voice_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.voice_path is not null and (tg_op = 'INSERT' or new.voice_path is distinct from old.voice_path) then
    perform public.request_transcript(tg_argv[0], new.id);
  end if;
  return new;
end $$;

create trigger comments_voice_before before insert or update of voice_path on public.comments
  for each row execute function public.voice_before();
create trigger comments_voice_after after insert or update of voice_path on public.comments
  for each row execute function public.voice_after('comment');
create trigger announcements_voice_before before insert or update of voice_path on public.announcements
  for each row execute function public.voice_before();
create trigger announcements_voice_after after insert or update of voice_path on public.announcements
  for each row execute function public.voice_after('announcement');

-- "Try again" when a voice note couldn't be written out: the sender (or Hassan) for chat,
-- Hassan or a senior for announcements.
create or replace function public.retry_transcript(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  allowed boolean;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_kind = 'comment' then
    select (author_id = auth.uid() or public.is_manager()) into allowed
    from public.comments where id = p_id and voice_path is not null;
    if not coalesce(allowed, false) then
      raise exception 'Only the sender can do this';
    end if;
    update public.comments set transcript_status = 'pending' where id = p_id;
  elsif p_kind = 'announcement' then
    select public.can_assign() into allowed
    from public.announcements where id = p_id and voice_path is not null;
    if not coalesce(allowed, false) then
      raise exception 'Only Hassan or a senior can do this';
    end if;
    update public.announcements set transcript_status = 'pending' where id = p_id;
  else
    raise exception 'Unknown item';
  end if;
  perform public.request_transcript(p_kind, p_id);
end $$;

-- Announcements that are only a voice note still say something useful in the notification.
create or replace function public.announcement_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p record;
  summary text := left(coalesce(nullif(btrim(new.body), ''),
                                case when new.voice_path is not null then public.voice_label(new.voice_seconds) end, ''), 200);
begin
  for p in select id from public.profiles where active and id <> coalesce(new.author_id, '00000000-0000-0000-0000-000000000000'::uuid) loop
    perform public.notify(p.id, 'announcement',
      case when new.important then 'Important: ' else '' end || new.title,
      summary, '/announcements?id=' || new.id, new.author_id, null, new.project_id, new.id);
  end loop;
  return new;
end $$;

create or replace function public.nudge_announcement(p_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  a record;
  p record;
  n int := 0;
begin
  if auth.uid() is not null and not public.can_assign() then
    raise exception 'Only Hassan or a senior can send reminders';
  end if;
  select * into a from public.announcements where id = p_id;
  if a.id is null then
    raise exception 'Announcement not found';
  end if;
  for p in
    select pr.id from public.profiles pr
    where pr.active and pr.id is distinct from a.author_id
      and not exists (select 1 from public.announcement_acks k where k.announcement_id = a.id and k.user_id = pr.id)
  loop
    perform public.notify(p.id, 'ack_nudge', 'Please acknowledge: ' || a.title,
      left(coalesce(nullif(btrim(a.body), ''), case when a.voice_path is not null then public.voice_label(a.voice_seconds) end, ''), 160),
      '/announcements?id=' || a.id, auth.uid(), null, a.project_id, a.id);
    n := n + 1;
  end loop;
  update public.announcements set nudged_at = now() where id = a.id;
  return n;
end $$;

revoke execute on function public.request_transcript(text, uuid) from public, anon, authenticated;
revoke execute on function public.voice_before() from public, anon, authenticated;
revoke execute on function public.voice_after() from public, anon, authenticated;
revoke execute on function public.retry_transcript(text, uuid) from public, anon;
grant execute on function public.retry_transcript(text, uuid) to authenticated;
grant execute on function public.voice_label(numeric) to authenticated;
