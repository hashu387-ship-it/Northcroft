-- Weekly updates. On Friday morning each person's daily updates from Sunday to Thursday become
-- their weekly update: a short write-up of the week, what they did on each project, every task with
-- where it started and finished the week, other work and anything that blocked them. Managers and
-- seniors also get the team's week in one report, with each person's, and can download it as Excel.
--   * The weekly Edge Function writes them (with Claude); the counting (days sent, tasks, %) is done
--     in code from the daily updates, so the figures are exact.
--   * Friday 08:00 Riyadh it runs for the week just finished, and again at 08:30 and 10:00 for
--     anything that didn't finish. A manager or senior can write any week again from the app.
--   * Each person sees only their own; managers and seniors see everyone's and the team report.
--   * Once the week is over, each person is told their weekly update is ready, and managers and
--     seniors are told the team's is ready. Running it again doesn't tell them twice.

/* ---------------------------------------------------------------- the table */
create table if not exists public.weekly_updates (
  id uuid primary key default gen_random_uuid(),
  -- The Sunday the week starts on, and the Thursday it ends on.
  week_start date not null check (extract(dow from week_start) = 0),
  week_end date not null,
  -- Whose week it is; empty for the team report.
  user_id uuid references public.profiles (id) on delete cascade,
  -- pending: being written; ready; empty: no daily updates that week; failed: try again.
  status text not null default 'pending' check (status in ('pending', 'ready', 'empty', 'failed')),
  -- Counted from the daily updates: days sent, each task's % at the start and end of the week, etc.
  facts jsonb not null default '{}'::jsonb,
  -- The written part: the summary, each project, other work, blockers (team: headline, projects, points to look at).
  summary jsonb,
  error text,
  generated_at timestamptz,
  -- Who asked for it again; empty when it ran on its own on Friday.
  generated_by uuid references public.profiles (id) on delete set null,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists weekly_updates_one_per_week
  on public.weekly_updates (week_start, (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)));
create index if not exists weekly_updates_user_idx on public.weekly_updates (user_id, week_start desc);

alter table public.weekly_updates enable row level security;
drop policy if exists "see weekly updates" on public.weekly_updates;
create policy "see weekly updates" on public.weekly_updates
  for select to authenticated using (public.is_member() and (user_id = auth.uid() or public.can_assign()));
-- Only the Edge Function writes them (with the service role).
revoke all on public.weekly_updates from authenticated, anon;
grant select on public.weekly_updates to authenticated;

/* ---------------------------------------------------------------- what the function reads */
-- Everything for one week: the work days, and for everyone who sends daily updates (or sent one that
-- week) their projects, days on leave and each day's update with its tasks, blockers and replies.
create or replace function public.weekly_update_source(p_week_start date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with days as (
    select d::date as day
      from generate_series(p_week_start, p_week_start + 4, interval '1 day') d
     where public.is_workday(d::date)
  ),
  people as (
    select p.id, p.full_name, p.short_name, p.title
      from public.profiles p
     where p.active and coalesce(p.daily_update, false) and not coalesce(p.attendance_exempt, false)
    union
    select p.id, p.full_name, p.short_name, p.title
      from public.profiles p
      join public.daily_updates u on u.user_id = p.id
     where u.work_date between p_week_start and p_week_start + 4
  )
  select jsonb_build_object(
    'week_start', p_week_start,
    'week_end', p_week_start + 4,
    'work_days', coalesce((select jsonb_agg(day order by day) from days), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pe.id,
        'name', pe.full_name,
        'short_name', pe.short_name,
        'title', pe.title,
        'projects', coalesce((
          select jsonb_agg(pr.name order by pr.name)
            from public.project_members m join public.projects pr on pr.id = m.project_id
           where m.user_id = pe.id), '[]'::jsonb),
        'leave_days', coalesce((
          select jsonb_agg(distinct d.day)
            from days d
           where exists (select 1 from public.leave_requests r
                          where r.user_id = pe.id and r.status = 'approved' and d.day between r.start_date and r.end_date)
              or exists (select 1 from public.events e
                          where e.kind = 'leave' and e.event_date = d.day and pe.id = any (e.attendees))), '[]'::jsonb),
        'updates', coalesce((
          select jsonb_agg(jsonb_build_object(
            'date', u.work_date,
            'sent_at', u.submitted_at,
            'other_work', u.other_work,
            'blockers', u.blockers,
            'blocker_cleared', u.blocker_cleared_at is not null,
            'replies', coalesce((
              select jsonb_agg(jsonb_build_object('by', coalesce(a.short_name, 'Someone'), 'body', rp.body) order by rp.created_at)
                from public.daily_update_replies rp left join public.profiles a on a.id = rp.author_id
               where rp.update_id = u.id), '[]'::jsonb),
            'items', coalesce((
              select jsonb_agg(jsonb_build_object(
                'task_id', i.task_id,
                'title', i.task_title,
                'project', pr.name,
                'before', i.progress_before,
                'progress', i.progress,
                'note', i.note,
                'handed_in', i.handed_in,
                'task_status', t.status) order by i.created_at)
                from public.daily_update_items i
                left join public.projects pr on pr.id = i.project_id
                left join public.tasks t on t.id = i.task_id
               where i.update_id = u.id), '[]'::jsonb)
          ) order by u.work_date)
            from public.daily_updates u
           where u.user_id = pe.id and u.work_date between p_week_start and p_week_start + 4), '[]'::jsonb)
      ) order by pe.full_name)
        from people pe), '[]'::jsonb)
  );
$$;
revoke all on function public.weekly_update_source(date) from public, anon, authenticated;
grant execute on function public.weekly_update_source(date) to service_role;

/* ---------------------------------------------------------------- saving one */
create or replace function public.weekly_update_save(
  p_week_start date, p_user uuid, p_status text, p_facts jsonb, p_summary jsonb, p_error text, p_by uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid;
begin
  insert into public.weekly_updates as w (week_start, week_end, user_id, status, facts, summary, error, generated_at, generated_by, updated_at)
  values (p_week_start, p_week_start + 4, p_user, p_status, coalesce(p_facts, '{}'::jsonb), p_summary, p_error,
          case when p_status in ('ready', 'empty') then now() end, p_by, now())
  on conflict (week_start, (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid))) do update
     set status = excluded.status,
         -- While it's being written again, the last version stays readable.
         facts = case when excluded.status = 'pending' then w.facts else excluded.facts end,
         summary = case when excluded.status = 'pending' then w.summary
                        when excluded.status = 'failed' then w.summary
                        else excluded.summary end,
         error = excluded.error,
         generated_at = case when excluded.status in ('ready', 'empty') then now() else w.generated_at end,
         generated_by = excluded.generated_by,
         updated_at = now()
  returning id into rid;
  return rid;
end $$;
revoke all on function public.weekly_update_save(date, uuid, text, jsonb, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.weekly_update_save(date, uuid, text, jsonb, jsonb, text, uuid) to service_role;

/* ---------------------------------------------------------------- telling people */
-- Each person whose week is written is told once; managers and seniors are told once about the team's.
create or replace function public.weekly_update_notify(p_week_start date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  label text := to_char(p_week_start, 'FMDy FMDD Mon') || ' to ' || to_char(p_week_start + 4, 'FMDy FMDD Mon');
  link text := '/updates?tab=week&week=' || p_week_start;
  r record;
  m record;
  n integer := 0;
begin
  for r in
    select w.id, w.user_id, w.facts
      from public.weekly_updates w
     where w.week_start = p_week_start and w.user_id is not null and w.status = 'ready' and w.notified_at is null
  loop
    perform public.notify(r.user_id, 'weekly_update', 'Your weekly update is ready',
      label || coalesce(' · ' || nullif(r.facts->>'line', ''), ''), link, null);
    update public.weekly_updates set notified_at = now() where id = r.id;
    n := n + 1;
  end loop;

  for r in
    select w.id, w.facts
      from public.weekly_updates w
     where w.week_start = p_week_start and w.user_id is null and w.status = 'ready' and w.notified_at is null
  loop
    for m in select p.id from public.profiles p where p.active and (p.role = 'manager' or p.can_assign) loop
      perform public.notify(m.id, 'weekly_update', 'The team''s weekly update is ready',
        label || coalesce(' · ' || nullif(r.facts->>'line', ''), ''), link || '&team=1', null);
      n := n + 1;
    end loop;
    update public.weekly_updates set notified_at = now() where id = r.id;
  end loop;
  return n;
end $$;
revoke all on function public.weekly_update_notify(date) from public, anon, authenticated;
grant execute on function public.weekly_update_notify(date) to service_role;

/* ---------------------------------------------------------------- Friday morning */
-- Asks the weekly function to write last week's updates, with the same shared secret as push.
create or replace function public.request_weekly_updates()
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
    body := jsonb_build_object('mode', 'missing'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', secret),
    timeout_milliseconds := 10000
  );
end $$;
revoke all on function public.request_weekly_updates() from public, anon, authenticated;

-- 05:00, 05:30 and 07:00 UTC on Friday = 08:00, 08:30 and 10:00 Riyadh. The later runs only do
-- what's missing (a write-up that failed or stopped part way), and tell anyone not yet told.
select cron.schedule('northcroft-weekly-updates', '0 5 * * 5', $c$select public.request_weekly_updates()$c$);
select cron.schedule('northcroft-weekly-updates-again', '30 5 * * 5', $c$select public.request_weekly_updates()$c$);
select cron.schedule('northcroft-weekly-updates-last', '0 7 * * 5', $c$select public.request_weekly_updates()$c$);

/* ---------------------------------------------------------------- live updates */
do $m$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'weekly_updates') then
    alter publication supabase_realtime add table public.weekly_updates;
  end if;
end $m$;
