-- Project teams, and a second email that signs in to the same account.
--
-- 1. Project teams (project_members): who works on each project. Shown on the project and on its
--    card in Projects, listed first in "Assign to" when a task is for that project, and each
--    person's own projects come first in Projects. Everyone on the team can see the teams;
--    managers and seniors (can_assign) change them.
--
-- 2. Login aliases: an old email that still signs in to someone's account after their email was
--    changed. The sign-in screen asks login_email() only when a sign-in fails, and then signs in
--    with the account's main email (the password is the same). Nothing else uses the old email.
--
-- 3. Rimash's email becomes arrimash@northcroftme.com (sign-in and the contact shown in the app);
--    his old email, rimaashahamed@gmail.com, keeps signing him in.
--
-- 4. The first teams: KSU Rimash and Hameed; Capella Najeefar and Imthath; HOAS Saheeb and Inzam;
--    Bawabah Riswan.

/* ---------------------------------------------------------------- project teams */
create table if not exists public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  added_by uuid references public.profiles (id) on delete set null default auth.uid(),
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_members_user_idx on public.project_members (user_id);

alter table public.project_members enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_members' and policyname = 'project teams readable') then
    create policy "project teams readable" on public.project_members for select using (public.is_member());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_members' and policyname = 'seniors add to project teams') then
    create policy "seniors add to project teams" on public.project_members for insert with check (public.can_assign());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_members' and policyname = 'seniors take off project teams') then
    create policy "seniors take off project teams" on public.project_members for delete using (public.can_assign());
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_members') then
    alter publication supabase_realtime add table public.project_members;
  end if;
end $$;

insert into public.project_members (project_id, user_id, added_by)
select pr.id, pf.id, null
  from (values ('KSU', 'Rimash'), ('KSU', 'Hameed'),
               ('Capella', 'Najeefar'), ('Capella', 'Imthath'),
               ('HOAS', 'Saheeb'), ('HOAS', 'Inzam'),
               ('Bawabah', 'Riswan')) as v (project, person)
  join public.projects pr on pr.name = v.project
  join public.profiles pf on pf.short_name = v.person and pf.active
on conflict do nothing;

/* ---------------------------------------------------------------- login aliases */
create table if not exists public.login_aliases (
  alias text primary key check (alias = lower(alias)),
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
-- Nobody reads or writes this directly; login_email() is the only way in.
alter table public.login_aliases enable row level security;

-- The main email of the account an old email belongs to, or null.
create or replace function public.login_email(p_email text)
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.email
    from public.login_aliases a
    join auth.users u on u.id = a.user_id
    join public.profiles p on p.id = a.user_id and p.active
   where a.alias = lower(btrim(p_email));
$$;
revoke all on function public.login_email(text) from public;
grant execute on function public.login_email(text) to anon, authenticated;

/* ---------------------------------------------------------------- Rimash's email */
do $$
declare
  old_email constant text := 'rimaashahamed@gmail.com';
  new_email constant text := 'arrimash@northcroftme.com';
  uid uuid;
begin
  select id into uid from auth.users where lower(email) = old_email;
  if uid is null or exists (select 1 from auth.users where lower(email) = new_email) then
    return;
  end if;
  update auth.users
     set email = new_email,
         raw_user_meta_data = case when raw_user_meta_data ? 'email'
                                   then raw_user_meta_data || jsonb_build_object('email', new_email)
                                   else raw_user_meta_data end,
         updated_at = now()
   where id = uid;
  update auth.identities
     set identity_data = identity_data || jsonb_build_object('email', new_email),
         updated_at = now()
   where user_id = uid and provider = 'email';
  update public.profiles set email = new_email where id = uid;
  insert into public.login_aliases (alias, user_id) values (old_email, uid) on conflict (alias) do nothing;
end $$;
