-- Two per-person settings, first used for Fawaz Ajireen (Commercial Manager):
--   attendance_exempt  doesn't check in or out: no Check in tab, and left off the attendance
--                      board, map, late list and monthly export.
--   assignable         false means nobody else can give this person a task (they can still
--                      give themselves one). Work flows down: Fawaz to Hassan, Hassan to the team.
-- Only a manager can change either setting.

alter table public.profiles
  add column if not exists attendance_exempt boolean not null default false,
  add column if not exists assignable boolean not null default true;

-- New accounts can be created with both settings (read from the sign-up metadata).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, email, full_name, short_name, title, role, can_assign, color, must_change_password,
                               attendance_exempt, assignable)
  values (
    new.id,
    new.email,
    coalesce(m->>'full_name', split_part(new.email, '@', 1)),
    coalesce(m->>'short_name', m->>'full_name', split_part(new.email, '@', 1)),
    coalesce(m->>'title', 'Quantity Surveyor'),
    coalesce(m->>'role', 'member'),
    coalesce((m->>'can_assign')::boolean, false),
    coalesce(m->>'color', '#0a84ff'),
    coalesce((m->>'must_change_password')::boolean, true),
    coalesce((m->>'attendance_exempt')::boolean, false),
    coalesce((m->>'assignable')::boolean, true)
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- Only a manager can change roles, titles, access, emails, or the two new settings.
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if not public.is_manager() then
    if new.role is distinct from old.role
       or new.can_assign is distinct from old.can_assign
       or new.active is distinct from old.active
       or new.email is distinct from old.email
       or new.title is distinct from old.title
       or new.attendance_exempt is distinct from old.attendance_exempt
       or new.assignable is distinct from old.assignable then
      raise exception 'Only the manager can change roles, titles or access';
    end if;
  elsif old.role = 'manager' and (new.role <> 'manager' or not new.active)
        and (select count(*) from public.profiles where role = 'manager' and active) <= 1 then
    raise exception 'The team needs at least one active manager';
  end if;
  return new;
end $$;

-- Nobody else can give a task (or a repeating task) to someone who doesn't take tasks.
-- Repeating tasks run by the scheduler count as made by whoever set them up.
create or replace function public.guard_assignee() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if new.assignee_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then return new; end if;
  if new.assignee_id = coalesce(auth.uid(), new.created_by) then return new; end if;
  select short_name into who from public.profiles where id = new.assignee_id and not assignable;
  if found then
    raise exception '% gives out tasks but doesn''t take them in the app', who;
  end if;
  return new;
end $$;

create trigger tasks_assignee_guard before insert or update of assignee_id on public.tasks
  for each row execute function public.guard_assignee();
create trigger recurring_assignee_guard before insert or update of assignee_id on public.recurring_tasks
  for each row execute function public.guard_assignee();

-- Same for checklist steps: only the person themselves can take a step.
create or replace function public.guard_step_assignee() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if new.assignee_id is null or auth.uid() is null or new.assignee_id = auth.uid() then return new; end if;
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then return new; end if;
  select short_name into who from public.profiles where id = new.assignee_id and not assignable;
  if found then
    raise exception '% gives out tasks but doesn''t take them in the app', who;
  end if;
  return new;
end $$;

create trigger checklist_assignee_guard before insert or update of assignee_id on public.task_checklist
  for each row execute function public.guard_step_assignee();

revoke execute on function public.guard_assignee() from public, anon, authenticated;
revoke execute on function public.guard_step_assignee() from public, anon, authenticated;
