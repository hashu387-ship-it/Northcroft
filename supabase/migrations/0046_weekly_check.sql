-- Checking the weekly update: once the Thursday week is written, each person is asked to check
-- theirs. It shows in their My tasks as "Check your weekly update", due Sunday at 12 pm Riyadh. They
-- can change the words (the summary, each project's line, other work, blockers) and add anything
-- missing, then send it back; the figures (days sent, task %, handed in) stay as counted from their
-- daily updates. What they send goes straight into the report, the team report is written again with
-- it, and managers and seniors are told. A reminder goes on Sunday at 9 am; after 12 pm the update
-- stays as it was written and shows as not checked. The weekly function never rewrites an update
-- someone has sent back.

/* ---------------------------------------------------------------- what's kept */
alter table public.weekly_updates add column if not exists check_sent_at timestamptz;
alter table public.weekly_updates add column if not exists check_due timestamptz;
alter table public.weekly_updates add column if not exists checked_at timestamptz;
alter table public.weekly_updates add column if not exists checked_by uuid references public.profiles (id) on delete set null;
alter table public.weekly_updates add column if not exists check_edited boolean not null default false;
-- The write-up as it was before the person changed it.
alter table public.weekly_updates add column if not exists written_summary jsonb;

/* ---------------------------------------------------------------- helpers */
-- When checking closes for a week: the Sunday after it, at 12 pm Riyadh.
create or replace function public.weekly_check_due(p_week_start date)
returns timestamptz
language sql
immutable
as $$
  select ((p_week_start + 7)::timestamp + time '12:00') at time zone 'Asia/Riyadh';
$$;

-- A person's write-up as plain words: trimmed, kept to sensible lengths, only the parts they may change.
create or replace function public.weekly_summary_words(p jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'summary', left(btrim(coalesce(p->>'summary', ''), E' \t\r\n'), 2000),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object('project', left(btrim(x->>'project', E' \t\r\n'), 200), 'summary', left(btrim(coalesce(x->>'summary', ''), E' \t\r\n'), 1500)) order by n)
        from jsonb_array_elements(case when jsonb_typeof(p->'projects') = 'array' then p->'projects' else '[]'::jsonb end) with ordinality as e(x, n)
       where n <= 30 and coalesce(btrim(x->>'project', E' \t\r\n'), '') <> ''), '[]'::jsonb),
    'other_work', left(btrim(coalesce(p->>'other_work', ''), E' \t\r\n'), 2000),
    'blockers', left(btrim(coalesce(p->>'blockers', ''), E' \t\r\n'), 2000),
    'added', left(btrim(coalesce(p->>'added', ''), E' \t\r\n'), 3000)
  );
$$;

-- Asks the weekly function to write the team report again for a week (after someone changed theirs).
create or replace function public.request_weekly_team(p_week_start date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  fn_url text;
  secret text;
begin
  select replace(decrypted_secret, '/send-push', '/weekly') into fn_url from vault.decrypted_secrets where name = 'push_function_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'push_webhook_secret';
  if fn_url is null or secret is null then
    return;
  end if;
  perform net.http_post(
    url := fn_url,
    body := jsonb_build_object('mode', 'team', 'week_start', p_week_start),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', secret),
    timeout_milliseconds := 10000
  );
end $$;
revoke all on function public.request_weekly_team(date) from public, anon, authenticated;

/* ---------------------------------------------------------------- telling people, and asking them to check */
-- Each person whose week is written is asked to check it (until Sunday 12 pm); managers and seniors
-- are told once about the team's. Someone already told before checking existed is asked now too.
create or replace function public.weekly_update_notify(p_week_start date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  label text := to_char(p_week_start, 'FMDy FMDD Mon') || ' to ' || to_char(p_week_start + 4, 'FMDy FMDD Mon');
  link text := '/updates/report?kind=week&from=' || p_week_start || '&to=' || (p_week_start + 4);
  check_link text := '/updates/check?week=' || p_week_start;
  due timestamptz := public.weekly_check_due(p_week_start);
  r record;
  m record;
  n integer := 0;
begin
  for r in
    select w.id, w.user_id, w.facts, w.notified_at
      from public.weekly_updates w
     where w.kind = 'week' and w.period_start = p_week_start and w.user_id is not null and w.status = 'ready'
       and (w.notified_at is null or (w.check_sent_at is null and now() < due))
  loop
    if now() < due then
      update public.weekly_updates set check_sent_at = now(), check_due = due, notified_at = coalesce(notified_at, now()) where id = r.id;
      perform public.notify(r.user_id, 'weekly_check', 'Check your weekly update',
        label || ' · Change or add anything, then send it back by Sunday 12 pm.', check_link, null);
    else
      update public.weekly_updates set notified_at = now() where id = r.id;
      perform public.notify(r.user_id, 'weekly_update', 'Your weekly update is ready',
        label || coalesce(' · ' || nullif(r.facts->>'line', ''), ''), link, null);
    end if;
    n := n + 1;
  end loop;

  for r in
    select w.id, w.facts
      from public.weekly_updates w
     where w.kind = 'week' and w.period_start = p_week_start and w.user_id is null and w.status = 'ready' and w.notified_at is null
  loop
    for m in select p.id from public.profiles p where p.active and (p.role = 'manager' or p.can_assign) loop
      perform public.notify(m.id, 'weekly_update', 'The team''s weekly update is ready',
        label || coalesce(' · ' || nullif(r.facts->>'line', ''), ''), link, null);
      n := n + 1;
    end loop;
    update public.weekly_updates set notified_at = now() where id = r.id;
  end loop;
  return n;
end $$;
revoke all on function public.weekly_update_notify(date) from public, anon, authenticated;
grant execute on function public.weekly_update_notify(date) to service_role;

/* ---------------------------------------------------------------- sending it back */
-- The person whose update it is sends back the words (changed or as they were), before Sunday 12 pm.
create or replace function public.weekly_update_send_back(p_id uuid, p_summary jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  w public.weekly_updates%rowtype;
  words jsonb;
  edited boolean;
  moved boolean;
  who text;
  label text;
  m record;
begin
  if me is null then
    raise exception 'Please sign in again.';
  end if;
  select * into w from public.weekly_updates where id = p_id for update;
  if not found or w.kind <> 'week' or w.user_id is distinct from me then
    raise exception 'This weekly update isn''t yours to send back.';
  end if;
  if w.check_sent_at is null or w.check_due is null then
    raise exception 'This weekly update hasn''t been sent to you to check yet.';
  end if;
  if now() > w.check_due then
    raise exception 'Sunday 12 pm has passed, so your weekly update stays as it was written.';
  end if;

  words := public.weekly_summary_words(p_summary);
  -- Changed, compared with how it was written (not with an earlier send-back).
  edited := words is distinct from public.weekly_summary_words(coalesce(w.written_summary, w.summary, '{}'::jsonb));
  -- Different from what's in the report now (the first time, the same as edited).
  moved := words is distinct from public.weekly_summary_words(coalesce(w.summary, '{}'::jsonb));

  update public.weekly_updates
     set written_summary = coalesce(written_summary, summary),
         summary = words,
         checked_at = now(),
         checked_by = me,
         check_edited = edited,
         updated_at = now()
   where id = p_id;

  select coalesce(short_name, full_name, 'Someone') into who from public.profiles where id = me;
  label := to_char(w.period_start, 'FMDy FMDD Mon') || ' to ' || to_char(w.period_end, 'FMDy FMDD Mon');
  for m in select p.id from public.profiles p where p.active and (p.role = 'manager' or p.can_assign) loop
    perform public.notify(m.id, 'weekly_checked',
      case when edited then who || ' changed and sent back their weekly update' else who || ' checked their weekly update' end,
      label || case when moved then ' · The team report is being written again with it.' when edited then ' · Sent back again, no new changes.' else ' · Sent back as it was.' end,
      '/updates/report?kind=week&from=' || w.period_start || '&to=' || w.period_end || '&who=' || me, me);
  end loop;

  if moved then
    perform public.request_weekly_team(w.period_start);
  end if;

  return jsonb_build_object('id', p_id, 'checked_at', now(), 'edited', edited);
end $$;
revoke all on function public.weekly_update_send_back(uuid, jsonb) from public, anon;
grant execute on function public.weekly_update_send_back(uuid, jsonb) to authenticated;

/* ---------------------------------------------------------------- Sunday reminder */
create or replace function public.weekly_check_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select w.user_id, w.period_start, w.period_end
      from public.weekly_updates w
     where w.kind = 'week' and w.user_id is not null and w.check_sent_at is not null and w.checked_at is null
       and w.check_due > now() and w.check_due - now() < interval '8 hours'
  loop
    perform public.notify(r.user_id, 'weekly_check', 'Check your weekly update by 12 pm today',
      to_char(r.period_start, 'FMDy FMDD Mon') || ' to ' || to_char(r.period_end, 'FMDy FMDD Mon')
        || ' · Send it back, changed or as it is. After 12 pm it stays as written.',
      '/updates/check?week=' || r.period_start, null);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.weekly_check_reminders() from public, anon, authenticated;

-- Sunday 06:00 UTC = 9:00 am Riyadh.
select cron.schedule('northcroft-weekly-check-reminder', '0 6 * * 0', $c$select public.weekly_check_reminders()$c$);
