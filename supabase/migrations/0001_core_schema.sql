-- Northcroft QS workspace: core tables, helpers and row level security.
-- Time zone for the team is Asia/Riyadh. Week runs Sunday (0) to Thursday (4).

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- Settings (single row)
-- ---------------------------------------------------------------------------
create table public.app_settings (
  id int primary key default 1 check (id = 1),
  company_name text not null default 'Northcroft',
  timezone text not null default 'Asia/Riyadh',
  currency text not null default 'SAR',
  work_start time not null default '08:30',
  work_end time not null default '17:30',
  grace_minutes int not null default 10 check (grace_minutes between 0 and 120),
  work_days int[] not null default '{0,1,2,3,4}',
  weekly_task_capacity int not null default 8 check (weekly_task_capacity between 1 and 100),
  updated_at timestamptz not null default now()
);
insert into public.app_settings default values;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  short_name text not null,
  email text not null,
  title text not null default 'Quantity Surveyor',
  role text not null default 'member' check (role in ('manager', 'member')),
  can_assign boolean not null default false,
  color text not null default '#0a84ff',
  active boolean not null default true,
  must_change_password boolean not null default false,
  phone text,
  created_at timestamptz not null default now()
);

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'manager' and active);
$$;

create or replace function public.can_assign() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active and (role = 'manager' or can_assign)
  );
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active);
$$;

create or replace function public.riyadh_today() returns date
language sql stable set search_path = public as $$
  select (now() at time zone coalesce((select timezone from public.app_settings where id = 1), 'Asia/Riyadh'))::date;
$$;

-- ---------------------------------------------------------------------------
-- Projects and QS registers
-- ---------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  code text,
  name text not null,
  client text,
  city text,
  contract_value numeric(16, 2),
  status text not null default 'active' check (status in ('active', 'on_hold', 'completed')),
  color text not null default '#0a84ff',
  start_date date,
  end_date date,
  description text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.variations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  vo_number text not null,
  title text not null,
  description text,
  status text not null default 'identified' check (status in (
    'identified', 'requested', 'quoted', 'evaluation', 'recommended',
    'approved', 'agreed', 'closed', 'rejected', 'withdrawn', 'disputed')),
  initiated_by text,
  submitted_value numeric(16, 2),
  assessed_value numeric(16, 2),
  approved_value numeric(16, 2),
  submitted_date date,
  approved_date date,
  response_due date,
  owner_id uuid references public.profiles(id) on delete set null,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, vo_number)
);

create table public.boq_packages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  trade text,
  status text not null default 'not_started' check (status in ('not_started', 'measuring', 'pricing', 'checked', 'issued')),
  owner_id uuid references public.profiles(id) on delete set null,
  due_date date,
  value numeric(16, 2),
  notes text,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
create table public.recurring_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  title text not null,
  description text,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assignee_id uuid references public.profiles(id) on delete set null,
  reviewer_id uuid references public.profiles(id) on delete set null,
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly')),
  weekday int check (weekday between 0 and 6),
  month_day int check (month_day between 1 and 28),
  due_offset_days int not null default 0 check (due_offset_days between 0 and 60),
  estimate_hours numeric(6, 1),
  checklist text[] not null default '{}',
  next_run date not null,
  last_run date,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'in_review', 'done')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assignee_id uuid references public.profiles(id) on delete set null,
  reviewer_id uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  due_date date,
  estimate_hours numeric(6, 1),
  changes_note text,
  submitted_at timestamptz,
  completed_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  recurring_id uuid references public.recurring_tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_assignee_idx on public.tasks (assignee_id, status);
create index tasks_project_idx on public.tasks (project_id, status);
create index tasks_due_idx on public.tasks (due_date) where status <> 'done';

create table public.task_checklist (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  text text not null,
  done boolean not null default false,
  assignee_id uuid references public.profiles(id) on delete set null,
  position int not null default 0,
  done_by uuid references public.profiles(id) on delete set null,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index task_checklist_task_idx on public.task_checklist (task_id);

create table public.task_watchers (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (task_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Conversation, files and history
-- ---------------------------------------------------------------------------
-- task_id set: comment on a task. Only project_id set: project chat.
-- Both null: team-wide chat.
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  body text not null check (length(body) between 1 and 8000),
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index comments_task_idx on public.comments (task_id, created_at);
create index comments_project_idx on public.comments (project_id, created_at);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  comment_id uuid references public.comments(id) on delete set null,
  path text not null unique,
  name text not null,
  mime text,
  size bigint,
  uploaded_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index attachments_task_idx on public.attachments (task_id);
create index attachments_project_idx on public.attachments (project_id);

create table public.activity (
  id bigint generated always as identity primary key,
  project_id uuid references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  entity text not null,
  entity_id uuid,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index activity_project_idx on public.activity (project_id, created_at desc);
create index activity_task_idx on public.activity (task_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Announcements
-- ---------------------------------------------------------------------------
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  author_id uuid references public.profiles(id) on delete set null default auth.uid(),
  project_id uuid references public.projects(id) on delete set null,
  important boolean not null default false,
  requires_ack boolean not null default true,
  pinned boolean not null default false,
  nudged_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.announcement_acks (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  acked_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Calendar events
-- ---------------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  kind text not null default 'meeting' check (kind in ('site_visit', 'meeting', 'submission', 'leave', 'other')),
  project_id uuid references public.projects(id) on delete cascade,
  event_date date not null,
  start_time time,
  end_time time,
  location text,
  notes text,
  attendees uuid[] not null default '{}',
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index events_date_idx on public.events (event_date);

-- ---------------------------------------------------------------------------
-- Notifications and push
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  actor_id uuid references public.profiles(id) on delete set null,
  task_id uuid references public.tasks(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  announcement_id uuid references public.announcements(id) on delete cascade,
  read_at timestamptz,
  archived_at timestamptz,
  push_status text,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------------
create table public.places (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('office', 'site')),
  project_id uuid references public.projects(id) on delete set null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  radius_m int not null default 200 check (radius_m between 25 and 5000),
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null,
  check_in_at timestamptz not null,
  in_lat double precision,
  in_lng double precision,
  in_accuracy double precision,
  in_address text,
  in_place_id uuid references public.places(id) on delete set null,
  in_place_name text,
  in_place_kind text,
  check_out_at timestamptz,
  out_lat double precision,
  out_lng double precision,
  out_accuracy double precision,
  out_address text,
  out_place_id uuid references public.places(id) on delete set null,
  out_place_name text,
  out_place_kind text,
  late_minutes int not null default 0,
  early_minutes int not null default 0,
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, work_date)
);
create index attendance_date_idx on public.attendance (work_date);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.app_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.variations enable row level security;
alter table public.boq_packages enable row level security;
alter table public.recurring_tasks enable row level security;
alter table public.tasks enable row level security;
alter table public.task_checklist enable row level security;
alter table public.task_watchers enable row level security;
alter table public.comments enable row level security;
alter table public.attachments enable row level security;
alter table public.activity enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_acks enable row level security;
alter table public.events enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.places enable row level security;
alter table public.attendance enable row level security;

-- Settings
create policy "settings readable" on public.app_settings for select to authenticated using (true);
create policy "manager updates settings" on public.app_settings for update to authenticated using (is_manager()) with check (is_manager());

-- Profiles
create policy "profiles readable" on public.profiles for select to authenticated using (is_member());
create policy "update own or manager" on public.profiles for update to authenticated
  using (id = auth.uid() or is_manager()) with check (id = auth.uid() or is_manager());

-- Projects
create policy "projects readable" on public.projects for select to authenticated using (is_member());
create policy "assigners add projects" on public.projects for insert to authenticated with check (can_assign());
create policy "assigners edit projects" on public.projects for update to authenticated using (can_assign()) with check (can_assign());
create policy "manager deletes projects" on public.projects for delete to authenticated using (is_manager());

-- Variations and BOQ: the whole QS team maintains them, assigners delete
create policy "variations readable" on public.variations for select to authenticated using (is_member());
create policy "team adds variations" on public.variations for insert to authenticated with check (is_member());
create policy "team edits variations" on public.variations for update to authenticated using (is_member()) with check (is_member());
create policy "assigners delete variations" on public.variations for delete to authenticated using (can_assign());

create policy "boq readable" on public.boq_packages for select to authenticated using (is_member());
create policy "team adds boq" on public.boq_packages for insert to authenticated with check (is_member());
create policy "team edits boq" on public.boq_packages for update to authenticated using (is_member()) with check (is_member());
create policy "assigners delete boq" on public.boq_packages for delete to authenticated using (can_assign());

-- Recurring task rules
create policy "recurring readable" on public.recurring_tasks for select to authenticated using (is_member());
create policy "assigners add recurring" on public.recurring_tasks for insert to authenticated with check (can_assign());
create policy "assigners edit recurring" on public.recurring_tasks for update to authenticated using (can_assign()) with check (can_assign());
create policy "assigners delete recurring" on public.recurring_tasks for delete to authenticated using (can_assign());

-- Tasks (finer rules live in the guard trigger)
create policy "tasks readable" on public.tasks for select to authenticated using (is_member());
create policy "assigners add tasks" on public.tasks for insert to authenticated with check (can_assign());
create policy "assigners or assignee edit tasks" on public.tasks for update to authenticated
  using (can_assign() or assignee_id = auth.uid()) with check (can_assign() or assignee_id = auth.uid());
create policy "assigners delete tasks" on public.tasks for delete to authenticated using (can_assign());

-- Checklist items
create policy "checklist readable" on public.task_checklist for select to authenticated using (is_member());
create policy "checklist add" on public.task_checklist for insert to authenticated with check (
  can_assign() or exists (select 1 from public.tasks t where t.id = task_id and t.assignee_id = auth.uid()));
create policy "checklist edit" on public.task_checklist for update to authenticated using (
  can_assign() or assignee_id = auth.uid()
  or exists (select 1 from public.tasks t where t.id = task_id and t.assignee_id = auth.uid()));
create policy "checklist delete" on public.task_checklist for delete to authenticated using (
  can_assign() or exists (select 1 from public.tasks t where t.id = task_id and t.assignee_id = auth.uid()));

-- Watchers
create policy "watchers readable" on public.task_watchers for select to authenticated using (is_member());
create policy "follow tasks" on public.task_watchers for insert to authenticated with check (user_id = auth.uid());
create policy "unfollow tasks" on public.task_watchers for delete to authenticated using (user_id = auth.uid());

-- Comments
create policy "comments readable" on public.comments for select to authenticated using (is_member());
create policy "post comments" on public.comments for insert to authenticated with check (author_id = auth.uid() and is_member());
create policy "edit own comments" on public.comments for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "delete own comments" on public.comments for delete to authenticated using (author_id = auth.uid() or is_manager());

-- Attachments
create policy "attachments readable" on public.attachments for select to authenticated using (is_member());
create policy "add attachments" on public.attachments for insert to authenticated with check (uploaded_by = auth.uid() and is_member());
create policy "delete attachments" on public.attachments for delete to authenticated using (uploaded_by = auth.uid() or can_assign());

-- Activity is written only by triggers
create policy "activity readable" on public.activity for select to authenticated using (is_member());

-- Announcements
create policy "announcements readable" on public.announcements for select to authenticated using (is_member());
create policy "assigners post" on public.announcements for insert to authenticated with check (can_assign() and author_id = auth.uid());
create policy "assigners edit" on public.announcements for update to authenticated using (can_assign()) with check (can_assign());
create policy "assigners delete" on public.announcements for delete to authenticated using (can_assign());

create policy "acks readable" on public.announcement_acks for select to authenticated using (is_member());
create policy "acknowledge" on public.announcement_acks for insert to authenticated with check (user_id = auth.uid() and is_member());

-- Events
create policy "events readable" on public.events for select to authenticated using (is_member());
create policy "add events" on public.events for insert to authenticated with check (is_member() and created_by = auth.uid());
create policy "edit events" on public.events for update to authenticated using (created_by = auth.uid() or can_assign());
create policy "delete events" on public.events for delete to authenticated using (created_by = auth.uid() or can_assign());

-- Notifications: own only. Inserted by triggers.
create policy "own notifications" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "update own notifications" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own notifications" on public.notifications for delete to authenticated using (user_id = auth.uid());

-- Push subscriptions: own only
create policy "own subscriptions" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy "delete own subscriptions" on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

-- Places
create policy "places readable" on public.places for select to authenticated using (is_member());
create policy "manager adds places" on public.places for insert to authenticated with check (is_manager());
create policy "manager edits places" on public.places for update to authenticated using (is_manager()) with check (is_manager());
create policy "manager deletes places" on public.places for delete to authenticated using (is_manager());

-- Attendance: own history, plus manager and seniors see everyone. Writes go through RPCs.
create policy "attendance readable" on public.attendance for select to authenticated using (user_id = auth.uid() or can_assign());
create policy "manager edits attendance notes" on public.attendance for update to authenticated using (is_manager()) with check (is_manager());
create policy "manager deletes attendance" on public.attendance for delete to authenticated using (is_manager());
