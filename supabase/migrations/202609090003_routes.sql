-- Pack & Paws Club - Routes and route stops
-- Apply with a database owner/admin connection only.

begin;

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  route_date date not null,
  driver_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'published', 'completed', 'cancelled')),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, route_date, driver_id)
);

create table public.route_stops (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes(id) on delete cascade,
  dog_id uuid not null references public.dogs(id) on delete cascade,
  sequence integer not null default 0,
  status text not null default 'pending' check (status in ('pending', 'picked_up', 'completed', 'skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (route_id, dog_id)
);

create index routes_org_date_idx on public.routes(organization_id, route_date);
create index route_stops_route_idx on public.route_stops(route_id, sequence);

alter table public.routes enable row level security;
alter table public.route_stops enable row level security;

-- Managers manage routes for drivers inside their organization.
create policy routes_manager_all on public.routes
for all to authenticated
using (
  public.is_org_manager(organization_id)
  and exists (select 1 from public.organization_members m where m.organization_id = organization_id and m.user_id = driver_id and m.role = 'driver')
)
with check (
  public.is_org_manager(organization_id)
  and exists (select 1 from public.organization_members m where m.organization_id = organization_id and m.user_id = driver_id and m.role = 'driver')
);

-- Drivers can read their own published routes.
create policy routes_driver_read on public.routes
for select to authenticated
using (driver_id = auth.uid() and status = 'published' and public.is_org_member(organization_id));

create policy route_stops_manager_all on public.route_stops
for all to authenticated
using (exists (select 1 from public.routes r where r.id = route_id and public.is_org_manager(r.organization_id)))
with check (exists (select 1 from public.routes r where r.id = route_id and public.is_org_manager(r.organization_id)));

-- Drivers read stops only through their own published routes.
create policy route_stops_driver_read on public.route_stops
for select to authenticated
using (exists (
  select 1 from public.routes r
  where r.id = route_id and r.driver_id = auth.uid() and r.status = 'published'
));

-- Moves a dog to a route atomically: removes the dog from any other route
-- on the same date and appends it to the target route.
create or replace function public.move_stop_to_route(p_route_id uuid, p_dog_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_date date;
begin
  select organization_id, route_date into v_org, v_date
  from public.routes where id = p_route_id;
  if v_org is null then
    raise exception 'route not found';
  end if;
  if not public.is_org_manager(v_org) then
    raise exception 'forbidden';
  end if;

  delete from public.route_stops
  where dog_id = p_dog_id
    and route_id <> p_route_id
    and route_id in (
      select id from public.routes
      where organization_id = v_org and route_date = v_date
    );

  if not exists (
    select 1 from public.route_stops
    where route_id = p_route_id and dog_id = p_dog_id
  ) then
    insert into public.route_stops(route_id, dog_id, sequence)
    select p_route_id, p_dog_id, coalesce(max(sequence), 0) + 1
    from public.route_stops where route_id = p_route_id;
  end if;
end;
$$;

revoke all on function public.move_stop_to_route(uuid, uuid) from public, anon;
grant execute on function public.move_stop_to_route(uuid, uuid) to authenticated;

commit;
