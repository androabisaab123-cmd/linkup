-- LINKUP hosted accounts, member profiles, events, and admin moderation.
-- Run this migration in the Supabase SQL editor for the project used by Vercel.

create extension if not exists pgcrypto;

create or replace function public.valid_linkup_skills(p_skills jsonb)
returns boolean
language sql immutable
set search_path = ''
as $$
  select jsonb_typeof(p_skills) = 'object'
    and (select count(*) = 6 and bool_and(
      key = any(array['Sports','Outdoors','Food & drink','Culture','Gaming','Social']::text[])
      and value = any(array['1','2','3','4','5']::text[])
    ) from jsonb_each_text(p_skills));
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  age smallint,
  city text not null default '',
  bio text not null default '',
  interests text[] not null default '{}',
  activity_skills jsonb not null default '{}',
  availability text[] not null default '{}',
  profile_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_age_range check (age is null or age between 16 and 110),
  constraint profiles_availability_days check (
    availability <@ array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']::text[]
  ),
  constraint profiles_complete_fields check (
    not profile_complete or (
      char_length(trim(display_name)) between 2 and 60
      and age is not null
      and age between 16 and 110
      and char_length(trim(city)) between 2 and 100
      and cardinality(availability) > 0
      and public.valid_linkup_skills(activity_skills)
    )
  )
);

create table if not exists public.private_demographics (
  user_id uuid primary key references auth.users(id) on delete cascade,
  gender text not null default 'prefer_not_to_say'
    check (gender in ('woman','man','non_binary','self_described','prefer_not_to_say')),
  self_described_gender text,
  updated_at timestamptz not null default now(),
  constraint demographics_self_described check (
    (gender = 'self_described' and char_length(trim(coalesce(self_described_gender,''))) between 1 and 40)
    or (gender <> 'self_described' and self_described_gender is null)
  )
);

create table if not exists public.profile_locations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  approximate_latitude numeric(4,2) not null check (approximate_latitude between -90 and 90),
  approximate_longitude numeric(5,2) not null check (approximate_longitude between -180 and 180),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','member')) default 'member',
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 3 and 100),
  category text not null check (category in ('Sports','Outdoors','Food & drink','Culture','Gaming','Social')),
  description text not null default '' check (char_length(description) <= 2000),
  event_date date not null,
  start_time time not null,
  city text not null check (char_length(trim(city)) between 2 and 100),
  public_place text not null check (char_length(trim(public_place)) between 2 and 180),
  capacity smallint not null check (capacity between 2 and 50),
  skill_level smallint check (skill_level between 1 and 5),
  age_range text not null default 'Any age',
  budget text not null default 'Free' check (char_length(budget) <= 80),
  status text not null default 'published' check (status in ('published','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_attendees (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table if not exists public.saved_events (
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_no_self check (blocker_id <> blocked_id)
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid references public.profiles(id) on delete set null,
  event_id uuid references public.events(id) on delete set null,
  reason text not null check (char_length(trim(reason)) between 3 and 80),
  details text not null default '' check (char_length(details) <= 2000),
  status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists events_discovery_idx on public.events(status, event_date, city);
create index if not exists events_host_idx on public.events(host_id, event_date);
create index if not exists attendee_user_idx on public.event_attendees(user_id, created_at desc);
create index if not exists reports_status_idx on public.reports(status, created_at desc);

create or replace function public.is_linkup_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = (select auth.uid()) and r.role = 'admin'
  );
$$;

create or replace function public.has_complete_linkup_profile()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.profile_complete
  );
$$;

create or replace function public.has_linkup_demographics()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.private_demographics d
    where d.user_id = (select auth.uid())
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at before update on public.events
for each row execute function public.set_updated_at();

create or replace function public.add_event_host_as_attendee()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.event_attendees(event_id, user_id) values (new.id, new.host_id)
  on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists events_add_host_attendee on public.events;
create trigger events_add_host_attendee after insert on public.events
for each row execute function public.add_event_host_as_attendee();

create or replace function public.join_linkup_event(p_event_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_capacity smallint;
  v_count integer;
begin
  if auth.uid() is null or not public.has_complete_linkup_profile() then
    raise exception 'Complete your profile before joining events.' using errcode = '42501';
  end if;
  select e.capacity into v_capacity from public.events e
  where e.id = p_event_id and e.status = 'published' for update;
  if not found then raise exception 'This event is no longer available.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.event_attendees a where a.event_id = p_event_id and a.user_id = auth.uid()) then
    return;
  end if;
  select count(*) into v_count from public.event_attendees a where a.event_id = p_event_id;
  if v_count >= v_capacity then raise exception 'This event is full.' using errcode = '23514'; end if;
  insert into public.event_attendees(event_id, user_id) values (p_event_id, auth.uid());
end;
$$;

create or replace function public.leave_linkup_event(p_event_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to leave an event.' using errcode = '42501'; end if;
  delete from public.event_attendees a
  where a.event_id = p_event_id and a.user_id = auth.uid()
    and not exists (select 1 from public.events e where e.id = p_event_id and e.host_id = auth.uid());
end;
$$;

-- This view intentionally omits gender, email, and precise coordinates.
create or replace view public.public_profiles as
select id, display_name, age, city, bio, interests, activity_skills, availability
from public.profiles where profile_complete;

alter table public.profiles enable row level security;
alter table public.private_demographics enable row level security;
alter table public.profile_locations enable row level security;
alter table public.user_roles enable row level security;
alter table public.events enable row level security;
alter table public.event_attendees enable row level security;
alter table public.saved_events enable row level security;
alter table public.user_blocks enable row level security;
alter table public.reports enable row level security;

drop policy if exists "profiles_read_self_or_admin" on public.profiles;
create policy "profiles_read_self_or_admin" on public.profiles for select to authenticated
using (id = (select auth.uid()) or ((select public.has_complete_linkup_profile()) and (select public.is_linkup_admin())));
drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles for insert to authenticated
with check (id = (select auth.uid()) and (not profile_complete or (select public.has_linkup_demographics())));
drop policy if exists "profiles_update_self_or_admin" on public.profiles;
create policy "profiles_update_self_or_admin" on public.profiles for update to authenticated
using (id = (select auth.uid()) or ((select public.has_complete_linkup_profile()) and (select public.is_linkup_admin())))
with check ((id = (select auth.uid()) and (not profile_complete or (select public.has_linkup_demographics())))
  or ((select public.has_complete_linkup_profile()) and (select public.is_linkup_admin())));

drop policy if exists "demographics_read_self" on public.private_demographics;
create policy "demographics_read_self" on public.private_demographics for select to authenticated
using (user_id = (select auth.uid()));
drop policy if exists "demographics_insert_self" on public.private_demographics;
create policy "demographics_insert_self" on public.private_demographics for insert to authenticated
with check (user_id = (select auth.uid()));
drop policy if exists "demographics_update_self" on public.private_demographics;
create policy "demographics_update_self" on public.private_demographics for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "locations_manage_self" on public.profile_locations;
create policy "locations_manage_self" on public.profile_locations for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "roles_read_self_or_admin" on public.user_roles;
create policy "roles_read_self_or_admin" on public.user_roles for select to authenticated
using (user_id = (select auth.uid()) or (select public.is_linkup_admin()));

drop policy if exists "events_read_members" on public.events;
create policy "events_read_members" on public.events for select to authenticated
using ((select public.has_complete_linkup_profile()));
drop policy if exists "events_create_self" on public.events;
create policy "events_create_self" on public.events for insert to authenticated
with check (host_id = (select auth.uid()) and (select public.has_complete_linkup_profile()));
drop policy if exists "events_update_host_or_admin" on public.events;
create policy "events_update_host_or_admin" on public.events for update to authenticated
using ((select public.has_complete_linkup_profile()) and (host_id = (select auth.uid()) or (select public.is_linkup_admin())))
with check ((select public.has_complete_linkup_profile()) and (host_id = (select auth.uid()) or (select public.is_linkup_admin())));
drop policy if exists "events_delete_host_or_admin" on public.events;
create policy "events_delete_host_or_admin" on public.events for delete to authenticated
using ((select public.has_complete_linkup_profile()) and (host_id = (select auth.uid()) or (select public.is_linkup_admin())));

drop policy if exists "public_profiles_read_members" on public.profiles;
create policy "public_profiles_read_members" on public.profiles for select to authenticated
using (profile_complete and (select public.has_complete_linkup_profile()));
-- Public profile cards omit gender, email, and location coordinates; those fields live
-- in separate private tables with own-user-only policies.
revoke all on public.public_profiles from anon;
grant select on public.public_profiles to authenticated;

drop policy if exists "attendees_read_members" on public.event_attendees;
create policy "attendees_read_members" on public.event_attendees for select to authenticated
using ((select public.has_complete_linkup_profile()));
drop policy if exists "attendees_insert_self" on public.event_attendees;
drop policy if exists "attendees_delete_self_or_admin" on public.event_attendees;

drop policy if exists "saved_events_manage_self" on public.saved_events;
create policy "saved_events_manage_self" on public.saved_events for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "blocks_manage_self" on public.user_blocks;
create policy "blocks_manage_self" on public.user_blocks for all to authenticated
using (blocker_id = (select auth.uid())) with check (blocker_id = (select auth.uid()));

drop policy if exists "reports_insert_self" on public.reports;
create policy "reports_insert_self" on public.reports for insert to authenticated
with check (reporter_id = (select auth.uid()) and reporter_id <> reported_user_id
  and (select public.has_complete_linkup_profile()));
drop policy if exists "reports_read_admin" on public.reports;
create policy "reports_read_admin" on public.reports for select to authenticated
using ((select public.has_complete_linkup_profile()) and (select public.is_linkup_admin()));
drop policy if exists "reports_update_admin" on public.reports;
create policy "reports_update_admin" on public.reports for update to authenticated
using ((select public.has_complete_linkup_profile()) and (select public.is_linkup_admin()))
with check ((select public.has_complete_linkup_profile()) and (select public.is_linkup_admin()));

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update on public.private_demographics to authenticated;
grant select, insert, update, delete on public.profile_locations to authenticated;
grant select on public.user_roles to authenticated;
grant select, insert, update, delete on public.events to authenticated;
grant select on public.event_attendees to authenticated;
grant select, insert, delete on public.saved_events to authenticated;
grant select, insert, delete on public.user_blocks to authenticated;
grant select, insert, update on public.reports to authenticated;
revoke all on function public.is_linkup_admin() from public, anon;
revoke all on function public.has_complete_linkup_profile() from public, anon;
revoke all on function public.has_linkup_demographics() from public, anon;
revoke all on function public.join_linkup_event(uuid) from public, anon;
revoke all on function public.leave_linkup_event(uuid) from public, anon;
grant execute on function public.is_linkup_admin() to authenticated;
grant execute on function public.has_complete_linkup_profile() to authenticated;
grant execute on function public.has_linkup_demographics() to authenticated;
grant execute on function public.join_linkup_event(uuid) to authenticated;
grant execute on function public.leave_linkup_event(uuid) to authenticated;

-- After your first verified sign-up, replace the email and run this in SQL Editor
-- to grant the dashboard to that one owner. Never grant admin from the browser.
-- insert into public.user_roles (user_id, role)
-- select id, 'admin' from auth.users where lower(email) = lower('you@example.com')
-- on conflict (user_id) do update set role = excluded.role;
