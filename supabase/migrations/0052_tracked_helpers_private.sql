-- The tracked-task helpers are for the database's own use (reminders and the daily update), not
-- for anyone to call from outside. tracked_progress stays callable when signed in, because the
-- daily update runs as the person sending it.
revoke all on function public.tracked_line(uuid) from public, anon, authenticated;
revoke all on function public.tracked_note(uuid, uuid) from public, anon, authenticated;
revoke all on function public.tracked_progress(uuid) from public, anon;
grant execute on function public.tracked_progress(uuid) to authenticated;
