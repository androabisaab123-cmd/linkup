-- LINKUP production hardening and persistent in-app notifications.
-- Apply after 202610090001_linkup_core.sql.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_bio_length'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_bio_length check (char_length(bio) <= 500);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_interests_valid'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_interests_valid check (
        interests <@ array['Sports','Outdoors','Food & drink','Culture','Gaming','Social']::text[]
      );
  end if;
end
$$;

create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.is_linkup_blocked_from(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.user_blocks b
    where (b.blocker_id = (select auth.uid()) and b.blocked_id = p_user_id)
       or (b.blocker_id = p_user_id and b.blocked_id = (select auth.uid()))
  );
$$;
revoke all on function private.is_linkup_blocked_from(uuid) from public, anon;
grant execute on function private.is_linkup_blocked_from(uuid) to authenticated;

-- Keep the public profile card view subject to the querying member's RLS context.
create or replace view public.public_profiles with (security_invoker = true) as
select id, display_name, age, city, bio, interests, activity_skills, availability
from public.profiles
where profile_complete and not private.is_linkup_blocked_from(id);
revoke all on public.public_profiles from anon;
grant select on public.public_profiles to authenticated;

drop policy if exists "events_read_members" on public.events;
create policy "events_read_members" on public.events for select to authenticated
using (
  status = 'published'
  and (select public.has_complete_linkup_profile())
  and not private.is_linkup_blocked_from(host_id)
);

drop policy if exists "attendees_read_members" on public.event_attendees;
create policy "attendees_read_members" on public.event_attendees for select to authenticated
using (
  (select public.has_complete_linkup_profile())
  and exists (
    select 1 from public.events e
    where e.id = event_attendees.event_id
      and e.status = 'published'
      and not private.is_linkup_blocked_from(e.host_id)
  )
);

create index if not exists user_blocks_blocked_idx
  on public.user_blocks(blocked_id, blocker_id);

create or replace function public.join_linkup_event(p_event_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_host_id uuid;
  v_capacity smallint;
  v_count integer;
begin
  if auth.uid() is null or not public.has_complete_linkup_profile() then
    raise exception 'Complete your profile before joining events.' using errcode = '42501';
  end if;
  select e.host_id, e.capacity into v_host_id, v_capacity
  from public.events e
  where e.id = p_event_id and e.status = 'published'
  for update;
  if not found then
    raise exception 'This event is no longer available.' using errcode = 'P0002';
  end if;
  if private.is_linkup_blocked_from(v_host_id) then
    raise exception 'This event is unavailable.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.event_attendees a
    where a.event_id = p_event_id and a.user_id = auth.uid()
  ) then
    return;
  end if;
  select count(*) into v_count
  from public.event_attendees a
  where a.event_id = p_event_id;
  if v_count >= v_capacity then
    raise exception 'This event is full.' using errcode = '23514';
  end if;
  insert into public.event_attendees(event_id, user_id)
  values (p_event_id, auth.uid());
end;
$$;
revoke all on function public.join_linkup_event(uuid) from public, anon;
grant execute on function public.join_linkup_event(uuid) to authenticated;

create or replace function public.prevent_capacity_below_attendance()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_attendees integer;
begin
  if new.capacity < old.capacity then
    select count(*) into v_attendees
    from public.event_attendees a
    where a.event_id = old.id;
    if new.capacity < v_attendees then
      raise exception 'Maximum people cannot be lower than the current attendee count.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_capacity_below_attendance() from public, anon, authenticated;
drop trigger if exists events_capacity_not_below_attendance on public.events;
create trigger events_capacity_not_below_attendance
before update of capacity on public.events
for each row execute function public.prevent_capacity_below_attendance();

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_id uuid references public.events(id) on delete set null,
  kind text not null check (kind in ('event_joined','event_updated','event_cancelled')),
  title text not null check (char_length(title) between 1 and 100),
  body text not null default '' check (char_length(body) <= 500),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user_created_idx
  on public.notifications(user_id, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists "notifications_read_self" on public.notifications;
create policy "notifications_read_self" on public.notifications for select to authenticated
using (user_id = (select auth.uid()));
drop policy if exists "notifications_update_self" on public.notifications;
create policy "notifications_update_self" on public.notifications for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "notifications_delete_self" on public.notifications;
create policy "notifications_delete_self" on public.notifications for delete to authenticated
using (user_id = (select auth.uid()));
revoke all on public.notifications from public, anon, authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create or replace function public.notify_linkup_event_join()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_host_id uuid;
  v_title text;
begin
  select e.host_id, e.title into v_host_id, v_title
  from public.events e where e.id = new.event_id;
  if v_host_id is not null and v_host_id <> new.user_id then
    insert into public.notifications(user_id, actor_id, event_id, kind, title, body)
    values (v_host_id, new.user_id, new.event_id, 'event_joined', 'New attendee', 'Someone joined ' || v_title || '.');
  end if;
  return new;
end;
$$;
revoke all on function public.notify_linkup_event_join() from public, anon, authenticated;
drop trigger if exists attendees_notify_event_host on public.event_attendees;
create trigger attendees_notify_event_host
after insert on public.event_attendees
for each row execute function public.notify_linkup_event_join();

create or replace function public.notify_linkup_event_update()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status = 'published'
    and (new.title, new.event_date, new.start_time, new.city, new.public_place, new.capacity)
        is distinct from
        (old.title, old.event_date, old.start_time, old.city, old.public_place, old.capacity)
  then
    insert into public.notifications(user_id, actor_id, event_id, kind, title, body)
    select a.user_id, auth.uid(), new.id, 'event_updated', 'Event details changed', new.title || ' has new details.'
    from public.event_attendees a
    where a.event_id = new.id
      and a.user_id <> new.host_id
      and not exists (
        select 1 from public.user_blocks b
        where (b.blocker_id = new.host_id and b.blocked_id = a.user_id)
           or (b.blocker_id = a.user_id and b.blocked_id = new.host_id)
      );
  end if;
  return new;
end;
$$;
revoke all on function public.notify_linkup_event_update() from public, anon, authenticated;
drop trigger if exists events_notify_attendees_updated on public.events;
create trigger events_notify_attendees_updated
after update on public.events
for each row execute function public.notify_linkup_event_update();

create or replace function public.notify_linkup_event_delete()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if old.status = 'published' then
    insert into public.notifications(user_id, actor_id, event_id, kind, title, body)
    select a.user_id, auth.uid(), old.id, 'event_cancelled', 'Event cancelled', old.title || ' was cancelled.'
    from public.event_attendees a
    where a.event_id = old.id
      and a.user_id <> old.host_id
      and not exists (
        select 1 from public.user_blocks b
        where (b.blocker_id = old.host_id and b.blocked_id = a.user_id)
           or (b.blocker_id = a.user_id and b.blocked_id = old.host_id)
      );
  end if;
  return old;
end;
$$;
revoke all on function public.notify_linkup_event_delete() from public, anon, authenticated;
drop trigger if exists events_notify_attendees_deleted on public.events;
create trigger events_notify_attendees_deleted
before delete on public.events
for each row execute function public.notify_linkup_event_delete();

grant usage on schema public to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'notifications'
    )
  then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;
