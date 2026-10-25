-- Everything from the VO log on each variation, as fields the team keeps up to date in the app:
-- the log's own reference and status, scope, instruction date, the contractual submission date
-- (35 days), expected completion, QS remarks, and each submission with ECJV's response.
-- submissions is a list of rounds, oldest first:
--   { "sent": "YYYY-MM-DD" or null, "sent_note": text or null (when the log has words, not a date),
--     "response": ECJV's response or null, "response_on": "YYYY-MM-DD" or null }
-- Nothing here changes a variation's status, values or owners, so no notifications are sent.

alter table public.variations
  add column if not exists log_ref text,
  add column if not exists log_status text,
  add column if not exists scope text,
  add column if not exists instruction_date date,
  add column if not exists contract_due date,
  add column if not exists expected_completion date,
  add column if not exists qs_remarks text,
  add column if not exists submissions jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'variations_submissions_list' and conrelid = 'public.variations'::regclass) then
    alter table public.variations add constraint variations_submissions_list
      check (jsonb_typeof(submissions) = 'array' and jsonb_array_length(submissions) <= 20);
  end if;
end $$;

-- Search finds variations by these details too.
create or replace function public.search_everything(p_q text, p_kind text default null, p_limit integer default 8)
returns table (
  kind text,
  id uuid,
  title text,
  snippet text,
  project_id uuid,
  project_name text,
  link text,
  at timestamptz,
  meta jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with s as (
    select public.search_terms(p_q) as terms,
           least(greatest(coalesce(p_limit, 8), 1), 50) as lim
    where public.is_member() and length(btrim(coalesce(p_q, ''))) >= 2
  )
  -- Tasks: title, details and steps.
  (select 'task'::text, t.id, t.title,
          case when public.search_match(t.title, s.terms) then null else public.search_snippet(t.description, p_q) end,
          t.project_id, pr.name, '/tasks/' || t.id, coalesce(t.updated_at, t.created_at),
          jsonb_build_object('status', t.status, 'due', t.due_date, 'assignees', t.assignees, 'priority', t.priority)
     from public.tasks t
     cross join s
     left join public.projects pr on pr.id = t.project_id
    where (p_kind is null or p_kind = 'task')
      and public.search_match(
            t.title || ' ' || coalesce(t.description, '') || ' ' ||
            coalesce((select string_agg(c.text, ' ') from public.task_checklist c where c.task_id = t.id and c.removed_at is null), ''),
            s.terms)
    order by public.search_match(t.title, s.terms) desc, (t.status = 'done'), coalesce(t.updated_at, t.created_at) desc
    limit (select lim from s))
  union all
  -- Messages in every chat the person is in, and task comments (voice notes by their text).
  (select 'message'::text, c.id, coalesce(au.short_name, 'Former team member'),
          public.search_snippet(case when c.voice_path is not null then coalesce(c.transcript, c.body) else c.body end, p_q),
          coalesce(c.project_id, tk.project_id), pr.name,
          case
            when c.task_id is not null then '/tasks/' || c.task_id || '?m=' || c.id
            when c.conversation_id is not null then '/chats/' || c.conversation_id || '?m=' || c.id
            when c.project_id is not null then '/chats/project/' || c.project_id || '?m=' || c.id
            else '/chat?m=' || c.id
          end,
          c.created_at,
          jsonb_build_object(
            'author', c.author_id,
            'voice', c.voice_path is not null,
            'where', case
              when c.task_id is not null then tk.title
              when cv.kind = 'direct' then (
                select p.short_name from public.conversation_members m join public.profiles p on p.id = m.user_id
                 where m.conversation_id = c.conversation_id and m.user_id <> auth.uid()
                 order by m.joined_at limit 1)
              when c.conversation_id is not null then cv.name
              when c.project_id is not null then pr.name
              else 'Team chat'
            end,
            'where_kind', case
              when c.task_id is not null then 'task'
              when cv.kind = 'direct' then 'direct'
              when c.conversation_id is not null then 'group'
              when c.project_id is not null then 'project'
              else 'team'
            end)
     from public.comments c
     cross join s
     left join public.profiles au on au.id = c.author_id
     left join public.tasks tk on tk.id = c.task_id
     left join public.projects pr on pr.id = coalesce(c.project_id, tk.project_id)
     left join public.conversations cv on cv.id = c.conversation_id
    where (p_kind is null or p_kind = 'message')
      and c.event is null
      and public.search_match(coalesce(c.body, '') || ' ' || coalesce(c.transcript, ''), s.terms)
    order by c.created_at desc
    limit (select lim from s))
  union all
  -- Files: the newest version of each.
  (select 'file'::text, f.id, f.name, null::text,
          coalesce(f.project_id, tk.project_id), pr.name, '/files/' || f.id, f.created_at,
          jsonb_build_object('mime', f.mime, 'size', f.size, 'task', tk.title, 'by', f.uploaded_by,
                             'version', f.version, 'chat', f.conversation_id is not null)
     from (
       select distinct on (coalesce(a.version_of, a.id)) a.*
         from public.attachments a
         cross join s
        where (p_kind is null or p_kind = 'file')
          and public.search_match(a.name, s.terms)
        order by coalesce(a.version_of, a.id), a.version desc nulls last, a.created_at desc
     ) f
     left join public.tasks tk on tk.id = f.task_id
     left join public.projects pr on pr.id = coalesce(f.project_id, tk.project_id)
    order by f.created_at desc
    limit (select lim from s))
  union all
  -- Projects.
  (select 'project'::text, p.id, p.name,
          concat_ws(' · ', nullif(p.code, ''), nullif(p.client, ''), nullif(p.city, '')),
          p.id, p.name, '/projects/' || p.id, p.updated_at,
          jsonb_build_object('status', p.status, 'color', p.color)
     from public.projects p
     cross join s
    where (p_kind is null or p_kind = 'project')
      and public.search_match(concat_ws(' ', p.name, p.code, p.client, p.city, p.description), s.terms)
    order by public.search_match(p.name, s.terms) desc, (p.status = 'completed'), p.name
    limit (select lim from s))
  union all
  -- Variations, with everything from the VO log: scope, the log's reference and status, QS
  -- remarks, and each submission and ECJV response.
  (select 'vo'::text, v.id, concat_ws(' ', nullif(v.vo_number, ''), v.title),
          case when public.search_match(concat_ws(' ', v.vo_number, v.title), s.terms) then null
               else public.search_snippet(concat_ws(' ', v.scope, v.qs_remarks, v.description, v.notes, v.log_ref, v.log_status,
                      (select string_agg(concat_ws(' ', x->>'sent_note', x->>'response'), ' ') from jsonb_array_elements(v.submissions) x)), p_q) end,
          v.project_id, pr.name, '/projects/' || v.project_id || '/variations?vo=' || v.id, v.updated_at,
          jsonb_build_object('status', v.status, 'value', coalesce(v.approved_value, v.assessed_value, v.submitted_value))
     from public.variations v
     cross join s
     left join public.projects pr on pr.id = v.project_id
    where (p_kind is null or p_kind = 'vo')
      and public.search_match(concat_ws(' ', v.vo_number, v.title, v.description, v.notes, v.scope, v.log_ref, v.log_status, v.qs_remarks,
            (select string_agg(concat_ws(' ', x->>'sent_note', x->>'response'), ' ') from jsonb_array_elements(v.submissions) x)), s.terms)
    order by public.search_match(concat_ws(' ', v.vo_number, v.title), s.terms) desc, v.updated_at desc
    limit (select lim from s))
  union all
  -- BOQ packages.
  (select 'boq'::text, b.id, b.name,
          case when public.search_match(b.name, s.terms) then nullif(b.trade, '') else public.search_snippet(concat_ws(' ', b.trade, b.notes), p_q) end,
          b.project_id, pr.name, '/projects/' || b.project_id || '/boq', b.updated_at,
          jsonb_build_object('status', b.status, 'due', b.due_date)
     from public.boq_packages b
     cross join s
     left join public.projects pr on pr.id = b.project_id
    where (p_kind is null or p_kind = 'boq')
      and public.search_match(concat_ws(' ', b.name, b.trade, b.notes), s.terms)
    order by public.search_match(b.name, s.terms) desc, b.updated_at desc
    limit (select lim from s))
  union all
  -- People.
  (select 'person'::text, pf.id, pf.full_name, pf.title, null::uuid, null::text, null::text, pf.created_at,
          jsonb_build_object('short_name', pf.short_name)
     from public.profiles pf
     cross join s
    where (p_kind is null or p_kind = 'person')
      and pf.active
      and public.search_match(concat_ws(' ', pf.full_name, pf.short_name, pf.title, pf.email, pf.phone), s.terms)
    order by pf.full_name
    limit (select lim from s))
  union all
  -- Announcements.
  (select 'announcement'::text, an.id, an.title,
          public.search_snippet(case when an.voice_path is not null then coalesce(an.transcript, an.body) else an.body end, p_q),
          an.project_id, pr.name, '/announcements?id=' || an.id, an.created_at,
          jsonb_build_object('author', an.author_id)
     from public.announcements an
     cross join s
     left join public.projects pr on pr.id = an.project_id
    where (p_kind is null or p_kind = 'announcement')
      and public.search_match(concat_ws(' ', an.title, an.body, an.transcript), s.terms)
    order by an.created_at desc
    limit (select lim from s))
  union all
  -- Calendar entries (meetings, site visits, submissions, leave), with their action points.
  (select 'event'::text, e.id, e.title,
          case when public.search_match(e.title, s.terms) then nullif(e.location, '')
               else public.search_snippet(concat_ws(' ', e.location, e.notes,
                      (select string_agg(x.body, ' ') from public.event_actions x where x.event_id = e.id and x.removed_at is null)), p_q) end,
          e.project_id, pr.name, '/calendar?date=' || e.event_date || '&event=' || e.id,
          (e.event_date + coalesce(e.start_time, time '08:00'))::timestamp at time zone 'Asia/Riyadh',
          jsonb_build_object('kind', e.kind, 'date', e.event_date, 'start', e.start_time)
     from public.events e
     cross join s
     left join public.projects pr on pr.id = e.project_id
    where (p_kind is null or p_kind = 'event')
      and public.search_match(concat_ws(' ', e.title, e.location, e.notes,
            (select string_agg(x.body, ' ') from public.event_actions x where x.event_id = e.id and x.removed_at is null)), s.terms)
    order by e.event_date desc
    limit (select lim from s))
$$;

revoke all on function public.search_everything(text, text, integer) from public, anon;
grant execute on function public.search_everything(text, text, integer) to authenticated;
