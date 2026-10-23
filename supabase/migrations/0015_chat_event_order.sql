-- Grey group lines written together ("created the group", then "added ...") keep their order:
-- each gets the actual clock time rather than the shared start time of the request.
create or replace function public.post_chat_event(p_conversation uuid, p_event text, p_body text) returns void
language sql security definer set search_path = public as $$
  insert into public.comments (conversation_id, author_id, body, event, mentions, created_at)
  values (p_conversation, auth.uid(), left(p_body, 400), p_event, '{}', clock_timestamp());
$$;
revoke execute on function public.post_chat_event(uuid, text, text) from public, anon, authenticated;
