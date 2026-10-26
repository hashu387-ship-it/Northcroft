-- Check in and check out only at the office.
--
-- Everyone who checks in can only check in, and check out, inside the radius of an active office
-- in Settings > Places (Northcroft Office, 100 m). Outside it the check-in or check-out is refused
-- with how far away they are; with no location from the phone it's refused too, so switching
-- location off doesn't get round it. Project sites don't count.
--
-- The rule sits on the attendance table, so it covers every way in: the Check in and Check out
-- buttons, ones saved with no signal and sent later (those show "Not sent" with the reason), and
-- anything else that writes a person's own check-in or check-out. A manager fixing someone else's
-- day, and the server itself, aren't affected.
--
-- A manager can switch the rule off in Settings > Places (app_settings.office_only_checkin), for
-- an office move or a day everyone works from a site.

alter table public.app_settings
  add column if not exists office_only_checkin boolean not null default true;

-- The nearest active office to a spot, at any distance.
create or replace function public.nearest_office(p_lat double precision, p_lng double precision)
returns table (name text, radius_m int, distance_m double precision)
language sql
stable
security definer
set search_path = public
as $$
  select p.name, p.radius_m, d.m
  from public.places p
  cross join lateral (
    select 2 * 6371000 * asin(sqrt(
      power(sin(radians(p.lat - p_lat) / 2), 2)
      + cos(radians(p_lat)) * cos(radians(p.lat)) * power(sin(radians(p.lng - p_lng) / 2), 2)
    )) as m
  ) d
  where p.active and p.kind = 'office' and p_lat is not null and p_lng is not null
  order by d.m
  limit 1;
$$;

revoke all on function public.nearest_office(double precision, double precision) from public, anon;
grant execute on function public.nearest_office(double precision, double precision) to authenticated;

create or replace function public.attendance_office_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rule_on boolean;
  what text;
  v_lat double precision;
  v_lng double precision;
  v_acc double precision;
  o record;
begin
  -- Only a person's own check-in or check-out.
  if auth.uid() is null or auth.uid() <> new.user_id then
    return new;
  end if;
  if tg_op = 'INSERT' then
    what := 'check in';
    v_lat := new.in_lat;
    v_lng := new.in_lng;
    v_acc := new.in_accuracy;
  elsif new.check_out_at is not null and new.check_out_at is distinct from old.check_out_at then
    what := 'check out';
    v_lat := new.out_lat;
    v_lng := new.out_lng;
    v_acc := new.out_accuracy;
  else
    return new;
  end if;

  select s.office_only_checkin into rule_on from public.app_settings s where s.id = 1;
  if not coalesce(rule_on, true) then
    return new;
  end if;

  if not exists (select 1 from public.places p where p.active and p.kind = 'office') then
    raise exception 'The office location isn''t set up yet, so you can''t % here. Ask Hassan to add it in Settings > Places.', what;
  end if;
  if v_lat is null or v_lng is null then
    raise exception 'Turn on location for Northcroft, then % again. You can only % at the office.', what, what;
  end if;

  select * into o from public.nearest_office(v_lat, v_lng);
  if o.distance_m <= o.radius_m then
    return new;
  end if;
  raise exception 'You''re % from %. You can only % at the office.%',
    public.rough_distance(o.distance_m), o.name, what,
    case when v_acc is not null and v_acc > o.radius_m
         then format(' Your location was only accurate to about %s m, so step near a window and try again.', round(v_acc)::int)
         else '' end;
end $$;

revoke all on function public.attendance_office_only() from public, anon, authenticated;

create or replace trigger attendance_a_office_only
  before insert or update on public.attendance
  for each row execute function public.attendance_office_only();
