-- The chat permission checks are used by the database rules for signed-in people only.
revoke execute on function public.in_conversation(uuid) from public, anon;
revoke execute on function public.conversation_admin(uuid) from public, anon;
revoke execute on function public.chat_visible(text) from public, anon;
revoke execute on function public.file_path_visible(text) from public, anon;
grant execute on function public.in_conversation(uuid) to authenticated;
grant execute on function public.conversation_admin(uuid) to authenticated;
grant execute on function public.chat_visible(text) to authenticated;
grant execute on function public.file_path_visible(text) to authenticated;
