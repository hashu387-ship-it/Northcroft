-- The weekly update, written in sections. Each person's week comes out as short lines under Finished,
-- In progress, Blocked or waiting and Next week, each line with its project; the team's report is one
-- block per project. For that the writer now also gets each person's open tasks (with due dates, for
-- Next week) and the team's projects (to put work under the right project and spell names as in the
-- app). When someone corrected an earlier version of their week, their corrections are kept and
-- given to the writer if that week is written again. The send-back check keeps the new layout, and
-- still accepts the old one for weeks written before this.

alter table public.weekly_updates add column if not exists corrections jsonb;

/* ---------------------------------------------------------------- what the writer reads */
create or replace function public.weekly_update_source(p_start date, p_end date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with days as (
    select d::date as day
      from generate_series(p_start, p_end, interval '1 day') d
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
     where u.work_date between p_start and p_end
  )
  select jsonb_build_object(
    'start', p_start,
    'end', p_end,
    'work_days', coalesce((select jsonb_agg(day order by day) from days), '[]'::jsonb),
    -- The team's projects, so work can be put under the right one and names spelt as in the app.
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object('name', pr.name, 'code', pr.code, 'client', pr.client) order by pr.name)
        from public.projects pr where pr.status <> 'completed'), '[]'::jsonb),
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
        -- Their open tasks due in the next two weeks (or with no date), for "Next week".
        'open_tasks', coalesce((
          select jsonb_agg(jsonb_build_object(
            'title', t.title,
            'project', pr.name,
            'due', t.due_date,
            'progress', t.progress,
            'status', t.status,
            'on_hold', coalesce(t.hold = 'on', false)) order by t.due_date nulls last, t.title)
            from (select t0.* from public.tasks t0
                   where t0.status in ('todo', 'in_progress', 'in_review')
                     and (pe.id = any (t0.assignees) or t0.assignee_id = pe.id)
                     and coalesce(t0.approval, '') <> 'declined'
                     and (t0.due_date is null or t0.due_date <= p_end + 14)
                   order by t0.due_date nulls last, t0.created_at
                   limit 15) t
            left join public.projects pr on pr.id = t.project_id), '[]'::jsonb),
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
            -- The last time anything in it changed: sent again, a task edited, a reply under a blocker.
            'changed_at', greatest(u.submitted_at, u.updated_at, u.blocker_cleared_at,
              (select max(i.updated_at) from public.daily_update_items i where i.update_id = u.id),
              (select max(rp.created_at) from public.daily_update_replies rp where rp.update_id = u.id)),
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
           where u.user_id = pe.id and u.work_date between p_start and p_end), '[]'::jsonb)
      ) order by pe.full_name)
        from people pe), '[]'::jsonb)
  );
$$;
revoke all on function public.weekly_update_source(date, date) from public, anon, authenticated;
grant execute on function public.weekly_update_source(date, date) to service_role;

/* ---------------------------------------------------------------- the words someone may change */
-- One section's lines: { project, text }, trimmed, kept to sensible lengths, empty lines dropped.
create or replace function public.weekly_summary_lines(a jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
             'project', left(coalesce(nullif(btrim(coalesce(x->>'project', ''), E' \t\r\n'), ''), 'General'), 200),
             'text', left(btrim(coalesce(x->>'text', ''), E' \t\r\n'), 400)) order by n)
      from jsonb_array_elements(case when jsonb_typeof(a) = 'array' then a else '[]'::jsonb end) with ordinality as e(x, n)
     where n <= 40 and jsonb_typeof(x) = 'object' and btrim(coalesce(x->>'text', ''), E' \t\r\n') <> ''), '[]'::jsonb);
$$;

-- A person's write-up as plain words, in the sectioned layout or the older one (weeks written before).
create or replace function public.weekly_summary_words(p jsonb)
returns jsonb
language sql
immutable
as $$
  select case when p ? 'headline' or p ? 'finished' then
    jsonb_build_object(
      'headline', left(btrim(coalesce(p->>'headline', ''), E' \t\r\n'), 600),
      'finished', public.weekly_summary_lines(p->'finished'),
      'in_progress', public.weekly_summary_lines(p->'in_progress'),
      'waiting', public.weekly_summary_lines(p->'waiting'),
      'next', public.weekly_summary_lines(p->'next'),
      'added', left(btrim(coalesce(p->>'added', ''), E' \t\r\n'), 3000))
  else
    jsonb_build_object(
      'summary', left(btrim(coalesce(p->>'summary', ''), E' \t\r\n'), 2000),
      'projects', coalesce((
        select jsonb_agg(jsonb_build_object('project', left(btrim(x->>'project', E' \t\r\n'), 200), 'summary', left(btrim(coalesce(x->>'summary', ''), E' \t\r\n'), 1500)) order by n)
          from jsonb_array_elements(case when jsonb_typeof(p->'projects') = 'array' then p->'projects' else '[]'::jsonb end) with ordinality as e(x, n)
         where n <= 30 and coalesce(btrim(x->>'project', E' \t\r\n'), '') <> ''), '[]'::jsonb),
      'other_work', left(btrim(coalesce(p->>'other_work', ''), E' \t\r\n'), 2000),
      'blockers', left(btrim(coalesce(p->>'blockers', ''), E' \t\r\n'), 2000),
      'added', left(btrim(coalesce(p->>'added', ''), E' \t\r\n'), 3000))
  end;
$$;

/* ---------------------------------------------------------------- writing a closed week again */
-- 'rewrite' writes the last closed week again for everyone who hasn't sent theirs back (used when
-- the way it's written changes); the others are as before.
create or replace function public.request_weekly_updates(p_mode text default 'missing')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  fn_url text;
  secret text;
  mode text := case when p_mode in ('topup', 'rolling', 'rewrite') then p_mode else 'missing' end;
begin
  if mode = 'rolling' then
    delete from public.weekly_updates where kind = 'rolling' and period_end < current_date - 14;
  end if;
  select replace(decrypted_secret, '/send-push', '/weekly') into fn_url from vault.decrypted_secrets where name = 'push_function_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'push_webhook_secret';
  if fn_url is null or secret is null then
    return;
  end if;
  perform net.http_post(
    url := fn_url,
    body := jsonb_build_object('mode', mode),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', secret),
    timeout_milliseconds := 10000
  );
end $$;
revoke all on function public.request_weekly_updates(text) from public, anon, authenticated;
