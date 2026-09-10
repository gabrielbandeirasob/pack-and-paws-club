-- Pack & Paws Club - Realtime + driver location (phase 7)
-- Apply with a database owner/admin connection only.

begin;

-- ---------------------------------------------------------------- realtime
-- Publish the tables the apps subscribe to (routes, stops, lifecycle).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'routes'
  ) then
    alter publication supabase_realtime add table public.routes;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'route_stops'
  ) then
    alter publication supabase_realtime add table public.route_stops;
  end if;
end $$;

-- ------------------------------------------------------- driver location
-- One live position row per route (upserted by the driver while the route is active).
create table if not exists public.driver_locations (
  route_id uuid primary key references public.routes(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  driver_id uuid not null references auth.users(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists driver_locations_org_idx on public.driver_locations(organization_id, updated_at desc);

alter table public.driver_locations enable row level security;

-- Managers read locations of their own organization.
drop policy if exists driver_locations_manager_read on public.driver_locations;
create policy driver_locations_manager_read on public.driver_locations
for select to authenticated
using (public.is_org_manager(organization_id));

-- Drivers manage only their own location row.
drop policy if exists driver_locations_driver_all on public.driver_locations;
create policy driver_locations_driver_all on public.driver_locations
for all to authenticated
using (driver_id = auth.uid())
with check (
  driver_id = auth.uid()
  and exists (
    select 1 from public.routes r
    where r.id = route_id and r.driver_id = auth.uid() and r.status = 'published'
  )
);

-- Retention: positions older than 24h are removed (called opportunistically by the apps).
create or replace function public.cleanup_driver_locations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.driver_locations where updated_at < now() - interval '24 hours';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.cleanup_driver_locations() from public, anon;
grant execute on function public.cleanup_driver_locations() to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'driver_locations'
  ) then
    alter publication supabase_realtime add table public.driver_locations;
  end if;
end $$;

commit;
