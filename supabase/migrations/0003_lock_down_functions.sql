-- Nothing in this app is public: signed-out visitors can't call any function,
-- and internal helpers and trigger functions can't be called directly by anyone.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;

  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'announcement_after', 'boq_after', 'checklist_after', 'checklist_before', 'comment_after',
        'comment_before', 'dispatch_push', 'event_after', 'guard_task', 'handle_new_user',
        'protect_profile', 'recurring_before', 'task_after_change', 'variation_after', 'touch_updated_at',
        'actor_name', 'is_workday', 'next_workday', 'recurring_next_date', 'nearest_place',
        'notify', 'daily_reminders', 'get_push_config')
  loop
    execute format('revoke execute on function %s from authenticated', f.sig);
  end loop;
end $$;

grant execute on function public.get_push_config() to service_role;

-- New functions created later should not be callable by signed-out visitors either.
alter default privileges in schema public revoke execute on functions from public, anon;
