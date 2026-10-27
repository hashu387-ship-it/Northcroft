-- Who approves team members' tasks is only for people signed in. The task rules and
-- notifications call this as the database owner, so they're unaffected.
revoke execute on function public.task_approver_ids() from public, anon;
grant execute on function public.task_approver_ids() to authenticated;
