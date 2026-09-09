-- Pack & Paws Club - Dispatch constraints, route versions and atomic RPCs
-- Apply with a database owner/admin connection only.

begin;

-- Time-window / exact-time / priority constraints per stop (dispatch phase 4).
alter table public.route_stops
  add column window_start time,
  add column window_end time,
  add column exact_time time,
  add column priority text not null default 'normal' check (priority in ('normal', 'priority'));

-- Version history: one row per publish, with a stop snapshot for auditing.
create table public.route_versions (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes(id) on delete cascade,
  version integer not null,
  status text not null,
  stops_snapshot jsonb not null default '[]'::jsonb,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (route_id, version)
);

create index route_versions_route_idx on public.route_versions(route_id, version);

alter table public.route_versions enable row level security;

create policy route_versions_manager_all on public.route_versions
for all to authenticated
using (exists (select 1 from public.routes r where r.id = route_id and public.is_org_manager(r.organization_id)))
with check (exists (select 1 from public.routes r where r.id = route_id and public.is_org_manager(r.organization_id)));

-- Assigns a dog to a route atomically: removes it from any other route on the
-- same date, appends it with the given sequence, then applies constraints.
create or replace function public.assign_stop_to_route(
  p_route_id uuid,
  p_dog_id uuid,
  p_window_start time default null,
  p_window_end time default null,
  p_exact_time time default null,
  p_priority text default 'normal'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_date date;
  v_stop_id uuid;
begin
  select organization_id, route_date into v_org, v_date
  from public.routes where id = p_route_id;
  if v_org is null then
    raise exception 'route not found';
  end if;
  if not public.is_org_manager(v_org) then
    raise exception 'forbidden';
  end if;
  if p_priority not in ('normal', 'priority') then
    raise exception 'invalid priority';
  end if;

  delete from public.route_stops
  where dog_id = p_dog_id
    and route_id <> p_route_id
    and route_id in (
      select id from public.routes
      where organization_id = v_org and route_date = v_date
    );

  select id into v_stop_id
  from public.route_stops
  where route_id = p_route_id and dog_id = p_dog_id;

  if v_stop_id is null then
    insert into public.route_stops(route_id, dog_id, sequence, window_start, window_end, exact_time, priority)
    select p_route_id, p_dog_id, coalesce(max(sequence), 0) + 1, p_window_start, p_window_end, p_exact_time, p_priority
    from public.route_stops where route_id = p_route_id;
  else
    update public.route_stops
    set window_start = p_window_start,
        window_end = p_window_end,
        exact_time = p_exact_time,
        priority = p_priority,
        updated_at = now()
    where id = v_stop_id;
  end if;
end;
$$;

revoke all on function public.assign_stop_to_route(uuid, uuid, time, time, time, text) from public, anon;
grant execute on function public.assign_stop_to_route(uuid, uuid, time, time, time, text) to authenticated;

-- Reorders every stop of a route to match the given dog_id order (1..n).
create or replace function public.reorder_route_stops(p_route_id uuid, p_dog_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_index integer;
begin
  select organization_id into v_org from public.routes where id = p_route_id;
  if v_org is null then
    raise exception 'route not found';
  end if;
  if not public.is_org_manager(v_org) then
    raise exception 'forbidden';
  end if;

  v_index := 1;
  for v_index in 1 .. array_length(p_dog_ids, 1) loop
    update public.route_stops
    set sequence = v_index, updated_at = now()
    where route_id = p_route_id and dog_id = p_dog_ids[v_index];
  end loop;
end;
$$;

revoke all on function public.reorder_route_stops(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_route_stops(uuid, uuid[]) to authenticated;

-- Publishes a route: records a version snapshot and marks it published.
create or replace function public.publish_route(p_route_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_next integer;
begin
  select organization_id into v_org from public.routes where id = p_route_id;
  if v_org is null then
    raise exception 'route not found';
  end if;
  if not public.is_org_manager(v_org) then
    raise exception 'forbidden';
  end if;

  select coalesce(max(version), 0) + 1 into v_next
  from public.route_versions where route_id = p_route_id;

  insert into public.route_versions(route_id, version, status, stops_snapshot)
  select
    r.id,
    v_next,
    r.status,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'dog_id', rs.dog_id,
        'sequence', rs.sequence,
        'window_start', rs.window_start,
        'window_end', rs.window_end,
        'exact_time', rs.exact_time,
        'priority', rs.priority,
        'client_name', c.name,
        'dog_name', d.name
      ) order by rs.sequence
    ), '[]'::jsonb)
  from public.routes r
  join public.route_stops rs on rs.route_id = r.id
  join public.dogs d on d.id = rs.dog_id
  join public.clients c on c.id = d.client_id
  where r.id = p_route_id;

  update public.routes
  set status = 'published', published_at = now(), updated_at = now()
  where id = p_route_id;
end;
$$;

revoke all on function public.publish_route(uuid) from public, anon;
grant execute on function public.publish_route(uuid) to authenticated;

commit;
