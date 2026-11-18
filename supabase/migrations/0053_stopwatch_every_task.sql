-- The stopwatch on every task.
--   Anyone on an open task can time their work on it (before, only tracked tasks had a stopwatch).
--   Still one stopwatch running at a time per person, and it still stops at check-out, when the
--   task is handed in, and at 11:55 pm. A task waiting for approval or on hold can't be timed.

create or replace function public.stopwatch_start(p_task uuid)
returns public.task_time_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  t record;
  v_log public.task_time_logs;
begin
  if uid is null or not public.is_member() then
    raise exception 'Please sign in again';
  end if;
  select id, assignees, status, approval, hold into t from public.tasks where id = p_task;
  if not found or not (uid = any (t.assignees)) then
    raise exception 'You can only time tasks you''re on';
  end if;
  if t.approval is not null then
    raise exception 'This task is waiting for approval';
  end if;
  if t.hold = 'on' then
    raise exception 'This task is on hold';
  end if;
  if t.status not in ('todo', 'in_progress') then
    raise exception 'This task has been handed in';
  end if;
  update public.task_time_logs set stopped_at = now() where user_id = uid and stopped_at is null;
  insert into public.task_time_logs (task_id, user_id) values (p_task, uid) returning * into v_log;
  -- Starting the stopwatch on a task not started yet starts the task.
  update public.tasks set status = 'in_progress' where id = p_task and status = 'todo';
  return v_log;
end $$;
revoke all on function public.stopwatch_start(uuid) from public, anon;
grant execute on function public.stopwatch_start(uuid) to authenticated;

-- The Time report reads stretches by day.
create index if not exists task_time_logs_started_idx on public.task_time_logs (started_at);
