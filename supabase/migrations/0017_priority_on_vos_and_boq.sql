-- Priority on variations and BOQ packages, the same four levels as tasks.
-- Every existing row starts as Normal.

alter table public.variations
  add column if not exists priority text not null default 'normal';
alter table public.boq_packages
  add column if not exists priority text not null default 'normal';

alter table public.variations
  add constraint variations_priority_check check (priority in ('low', 'normal', 'high', 'urgent'));
alter table public.boq_packages
  add constraint boq_packages_priority_check check (priority in ('low', 'normal', 'high', 'urgent'));
