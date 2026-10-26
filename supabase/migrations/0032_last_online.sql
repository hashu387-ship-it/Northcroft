-- Who's online, and when everyone was last on.
--
-- Online right now comes from Realtime presence (the "online" channel): the app joins it while
-- it's open on the screen and the person has used it in the last 10 minutes. Nothing about that
-- is saved.
--
-- Last online is saved here: the app refreshes it every minute while the person is online, and
-- once more when they go (the app goes to the background, the screen locks, or they stop using it
-- for 10 minutes, which saves the time they last touched it). Everyone on the team can read it;
-- only mark_online() writes it, and only for the person signed in.

create table if not exists public.last_online (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  seen_at timestamptz not null default now()
);

alter table public.last_online enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'last_online' and policyname = 'last online readable') then
    create policy "last online readable" on public.last_online for select using (public.is_member());
  end if;
end $$;

-- Saves "I'm on now" (or the time I last used the app, when going idle). A time from the future
-- becomes now, one more than an hour back counts as an hour ago, and the saved time never goes backwards
-- (another phone of the same person may have saved a later one).
create or replace function public.mark_online(p_at timestamptz default null)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_at timestamptz := least(coalesce(p_at, now()), now());
  saved timestamptz;
begin
  if auth.uid() is null or not public.is_member() then
    return null;
  end if;
  if v_at < now() - interval '1 hour' then
    v_at := now() - interval '1 hour';
  end if;
  insert into public.last_online as l (user_id, seen_at)
  values (auth.uid(), v_at)
  on conflict (user_id) do update set seen_at = greatest(l.seen_at, excluded.seen_at)
  returning l.seen_at into saved;
  return saved;
end $$;

revoke all on function public.mark_online(timestamptz) from public, anon;
grant execute on function public.mark_online(timestamptz) to authenticated;
