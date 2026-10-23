-- Claude and Groq API keys can live in Supabase Vault (encrypted at rest) as well as in
-- Edge Function secrets. The functions use an Edge Function secret when one is set, and
-- otherwise read the key from Vault through this function.
--
-- The keys themselves are never stored in this repository. To add or change one, run in the
-- SQL editor (replace the placeholder; update_secret needs the id from vault.secrets):
--   select vault.create_secret('<key>', 'anthropic_api_key', 'Claude API key for Edge Functions');
--   select vault.create_secret('<key>', 'groq_api_key', 'Groq API key for voice-to-text');

create or replace function public.get_ai_keys() returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets
  where name in ('anthropic_api_key', 'groq_api_key');
$$;

-- Edge Functions only (service role). Signed-in people and the public can't call it.
revoke execute on function public.get_ai_keys() from public, anon, authenticated;
grant execute on function public.get_ai_keys() to service_role;
