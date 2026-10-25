-- Leave: annual leave after 3 months, and files on leave requests.
--
-- 1. Annual leave can be asked for once 3 months have passed since the person's account was made
--    in the app (profiles.created_at, Riyadh date, plus 3 months). Before that, an annual request
--    is refused with the date it opens. Other kinds of leave work as before.
--
-- 2. Files on a leave request (attachments.leave_id): a medical certificate for sick leave, a
--    ticket or a letter. The app asks for a file before sick leave can be sent; files go up right
--    after the request is made, and more can be added while it's waiting. A leave file is only
--    seen by the person who asked and the people who see the team's leave (managers and seniors,
--    which includes everyone who approves it), never the whole team. Leave files have no project,
--    so they never show on a project's Files tab. In the app's own storage they live under
--    leave/<request id>/, readable by the same people.

/* ---------------------------------------------------------------- annual leave after 3 months */

-- The first day someone can ask for annual leave.
create or replace function public.annual_leave_opens(p_user uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select ((p.created_at at time zone 'Asia/Riyadh')::date + interval '3 months')::date
    from public.profiles p
   where p.id = p_user;
$$;
revoke all on function public.annual_leave_opens(uuid) from public, anon;
grant execute on function public.annual_leave_opens(uuid) to authenticated;

-- The leave rules from 0023, with the 3-month rule for annual leave added after the first check.
create or replace function public.leave_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  c record;
  approvers uuid[];
  who text;
  today date := public.riyadh_today();
  opens date;
begin
  select * into c from public.signoff_checkers();

  if tg_op = 'INSERT' then
    if uid is not null then
      new.user_id := uid;
    end if;
    if not exists (select 1 from public.profiles p where p.id = new.user_id and p.active and not p.attendance_exempt) then
      raise exception 'Leave requests are for people who check in';
    end if;
    if new.kind = 'annual' then
      opens := public.annual_leave_opens(new.user_id);
      if opens is not null and today < opens then
        raise exception 'Annual leave opens on %, 3 months after you joined.', to_char(opens, 'Dy FMDD Mon YYYY');
      end if;
    end if;
    if new.start_date is null or new.end_date is null then
      raise exception 'Choose the first and last day of your leave';
    end if;
    if new.end_date < new.start_date then
      raise exception 'The last day must be on or after the first day';
    end if;
    if new.end_date - new.start_date > 366 then
      raise exception 'Choose up to a year at a time';
    end if;
    if new.start_date < today - 60 then
      raise exception 'Leave can only be recorded up to two months back';
    end if;
    new.days := public.leave_working_days(new.start_date, new.end_date);
    if new.days = 0 then
      raise exception 'Those dates are all weekend days. Pick at least one working day.';
    end if;
    if exists (select 1 from public.leave_requests r
               where r.user_id = new.user_id and r.status in ('pending', 'approved')
                 and r.start_date <= new.end_date and r.end_date >= new.start_date) then
      raise exception 'You already have leave booked or waiting for some of those days';
    end if;
    new.note := nullif(btrim(coalesce(new.note, '')), '');
    new.status := 'pending';
    new.stage := public.leave_first_stage(new.user_id);
    new.first_ok_by := null;
    new.first_ok_at := null;
    new.decided_by := null;
    new.decided_at := null;
    new.decision_note := null;
    new.cancelled_by := null;
    new.cancelled_at := null;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  new.updated_at := now();
  if uid is null then
    -- Maintenance from the server.
    return new;
  end if;

  -- The request itself never changes after it's sent: cancel it and ask again instead.
  new.user_id := old.user_id;
  new.kind := old.kind;
  new.start_date := old.start_date;
  new.end_date := old.end_date;
  new.days := old.days;
  new.note := old.note;
  new.created_at := old.created_at;
  -- Only the steps below move these.
  new.stage := old.stage;
  new.first_ok_by := old.first_ok_by;
  new.first_ok_at := old.first_ok_at;
  new.decided_by := old.decided_by;
  new.decided_at := old.decided_at;
  new.cancelled_by := old.cancelled_by;
  new.cancelled_at := old.cancelled_at;

  if new.status is not distinct from old.status then
    new.decision_note := old.decision_note;
    return new;
  end if;

  -- Approve: the first check, then the final OK.
  if old.status = 'pending' and new.status = 'approved' then
    approvers := public.leave_approvers(old.stage, old.user_id);
    if not (uid = any (approvers)) then
      if uid = old.user_id then
        raise exception 'You can''t approve your own leave';
      end if;
      select short_name into who from public.profiles where id = approvers[1];
      if old.stage = 'first' and cardinality(approvers) = 1 then
        raise exception '% checks this first. It comes to you after that.', coalesce(who, 'The first checker');
      elsif old.stage = 'final' and cardinality(approvers) = 1 then
        raise exception '% gives the final OK on this one.', coalesce(who, 'The final checker');
      end if;
      raise exception 'It isn''t your turn to approve this one';
    end if;
    new.decision_note := nullif(btrim(coalesce(new.decision_note, '')), '');
    if old.stage = 'first' and c.final_id is not null and c.final_id <> uid and c.final_id <> old.user_id then
      -- Checked: on to the final OK.
      new.status := 'pending';
      new.stage := 'final';
      new.first_ok_by := uid;
      new.first_ok_at := now();
    else
      new.stage := null;
      new.decided_by := uid;
      new.decided_at := now();
    end if;
    return new;
  end if;

  -- Decline, with a note: whoever's turn it is, or either checker.
  if old.status = 'pending' and new.status = 'declined' then
    if uid = old.user_id then
      raise exception 'Cancel the request instead';
    end if;
    if not (uid = any (public.leave_approvers(old.stage, old.user_id))
            or uid is not distinct from c.first_id or uid is not distinct from c.final_id) then
      raise exception 'Only the people who approve leave can decline it';
    end if;
    new.stage := null;
    new.decided_by := uid;
    new.decided_at := now();
    new.decision_note := nullif(btrim(coalesce(new.decision_note, '')), '');
    return new;
  end if;

  -- Cancel: the person (waiting, or approved and not started yet), or a manager or checker.
  if old.status in ('pending', 'approved') and new.status = 'cancelled' then
    if uid = old.user_id then
      if old.status = 'approved' and old.start_date <= today then
        select short_name into who from public.profiles where id = coalesce(c.first_id, old.decided_by);
        raise exception 'This leave has already started, so it can''t be cancelled here. Ask % to change it.', coalesce(who, 'your manager');
      end if;
      new.decision_note := old.decision_note;
    elsif public.is_manager() or uid is not distinct from c.first_id or uid is not distinct from c.final_id then
      new.decision_note := nullif(btrim(coalesce(new.decision_note, '')), '');
    else
      raise exception 'Only the person who asked can cancel this request';
    end if;
    new.stage := null;
    new.cancelled_by := uid;
    new.cancelled_at := now();
    return new;
  end if;

  raise exception 'That change isn''t possible for this request';
end $$;

/* ---------------------------------------------------------------- files on leave requests */

alter table public.attachments add column if not exists leave_id uuid;
create index if not exists attachments_leave_idx on public.attachments (leave_id);

-- Who may see or add files on a leave request: the person who asked, and the people who see the
-- team's leave (managers and seniors, including everyone who approves it).
create or replace function public.leave_file_ok(p_leave uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.leave_requests r
     where r.id = p_leave
       and (r.user_id = auth.uid() or public.can_assign())
  );
$$;
revoke all on function public.leave_file_ok(uuid) from public, anon;
grant execute on function public.leave_file_ok(uuid) to authenticated;

alter policy "attachments readable" on public.attachments
  using (public.is_member()
         and (conversation_id is null or public.in_conversation(conversation_id))
         and (leave_id is null or public.leave_file_ok(leave_id)));

alter policy "add attachments" on public.attachments
  with check (uploaded_by = auth.uid()
              and public.is_member()
              and drive_file_id is null
              and (conversation_id is null or public.in_conversation(conversation_id))
              and (leave_id is null or public.leave_file_ok(leave_id)));

-- The app's own storage: files under leave/<request id>/ follow the same rule.
create or replace function public.file_path_visible(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if split_part(p_name, '/', 1) = 'leave' then
    return public.leave_file_ok(split_part(p_name, '/', 2)::uuid);
  end if;
  if split_part(p_name, '/', 1) <> 'c' then
    return true;
  end if;
  return public.in_conversation(split_part(p_name, '/', 2)::uuid);
exception when invalid_text_representation then
  return false;
end $$;
