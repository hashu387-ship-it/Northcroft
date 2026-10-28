-- Daily updates: when someone changes a line of their own update after a manager or senior
-- changed it, the line no longer says "Changed by". Otherwise submit_daily_update is as in 0028.

create or replace function public.submit_daily_update(p_items jsonb, p_other text default null, p_blockers text default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  today date := public.riyadh_today();
  upd uuid;
  it jsonb;
  t record;
  pct int;
  note text;
  handed int := 0;
  n int := 0;
begin
  if uid is null or not public.is_member() then
    raise exception 'Please sign in again';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Something went wrong with the update. Try again.';
  end if;

  insert into public.daily_updates (user_id, work_date, other_work, blockers, submitted_at)
  values (uid, today, nullif(btrim(coalesce(p_other, '')), ''), nullif(btrim(coalesce(p_blockers, '')), ''), now())
  on conflict (user_id, work_date) do update
    set other_work = excluded.other_work, blockers = excluded.blockers, submitted_at = now(), updated_at = now()
  returning id into upd;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    select id, title, project_id, status, progress, assignees into t
      from public.tasks where id = (it->>'task_id')::uuid;
    if not found then
      continue;
    end if;
    if not (uid = any (t.assignees)) then
      raise exception 'You can only update tasks you''re on';
    end if;
    pct := greatest(0, least(100, coalesce((it->>'progress')::int, t.progress)));
    note := nullif(btrim(coalesce(it->>'note', '')), '');

    insert into public.daily_update_items (update_id, task_id, task_title, project_id, progress_before, progress, note)
    values (upd, t.id, t.title, t.project_id, t.progress, pct, note)
    on conflict (update_id, task_id) do update
      set progress = excluded.progress, note = excluded.note, task_title = excluded.task_title, updated_at = now(),
          -- Their own change to the % or note takes over from a manager's change.
          edited_by = case when (daily_update_items.progress, daily_update_items.note) is distinct from (excluded.progress, excluded.note)
                           then null else daily_update_items.edited_by end,
          edited_at = case when (daily_update_items.progress, daily_update_items.note) is distinct from (excluded.progress, excluded.note)
                           then null else daily_update_items.edited_at end;
    n := n + 1;

    -- The task keeps its latest %; work started moves it on; 100% hands it in for review.
    if t.status in ('todo', 'in_progress') then
      update public.tasks
         set progress = pct,
             progress_at = now(),
             status = case when pct = 100 then 'in_review'
                           when pct > 0 and t.status = 'todo' then 'in_progress'
                           else t.status end
       where id = t.id;
      if pct = 100 then
        update public.daily_update_items set handed_in = true where update_id = upd and task_id = t.id;
        handed := handed + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('update_id', upd, 'tasks', n, 'handed_in', handed);
end $$;
revoke all on function public.submit_daily_update(jsonb, text, text) from public, anon;
grant execute on function public.submit_daily_update(jsonb, text, text) to authenticated;
