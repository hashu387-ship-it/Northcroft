-- Files added when a repeating task is set up come with every copy of it.
-- They are stored once, on the repeating task, not copied for each run.

alter table public.attachments add column if not exists recurring_id uuid;
create index if not exists attachments_recurring_idx on public.attachments (recurring_id) where recurring_id is not null;

-- Which repeating task a task was made from. tasks.recurring_id is cleared if the repeating task
-- is removed; repeat_of stays, so the copies already made keep their files.
alter table public.tasks add column if not exists repeat_of uuid;
update public.tasks set repeat_of = recurring_id where recurring_id is not null and repeat_of is null;

create or replace function public.task_repeat_of()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.repeat_of is null then
    new.repeat_of := new.recurring_id;
  end if;
  return new;
end $$;

create trigger tasks_repeat_of before insert on public.tasks
  for each row execute function public.task_repeat_of();

revoke execute on function public.task_repeat_of() from public, anon, authenticated;
