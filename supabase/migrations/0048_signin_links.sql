-- A record of every one-tap sign-in link a manager makes for someone (migration 0048). The link
-- itself is single-use and expiring and is never stored; this only notes who made a link for whom
-- and when, so there's a trail. Managers can read it; the Edge Function (service role) writes it.

create table if not exists public.signin_links (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  target_id uuid references public.profiles (id) on delete set null,
  to_path text,
  created_at timestamptz not null default now()
);

create index if not exists signin_links_created_idx on public.signin_links (created_at desc);

alter table public.signin_links enable row level security;

-- Managers can see the trail; nobody writes it from the client (only the service-role function does).
drop policy if exists signin_links_read on public.signin_links;
create policy signin_links_read on public.signin_links for select using (public.is_manager());
