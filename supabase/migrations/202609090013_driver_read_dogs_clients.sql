-- Pack & Paws Club - Driver read access to dogs and clients of their own route
-- The driver app embeds dog:dogs(...) and client:clients(...) inside route_stops.
-- Without SELECT policies on dogs/clients those embeds come back null and the
-- driver screen crashed with "Cannot read property 'client' of null".

begin;

-- A driver may read the dogs that are stops on routes assigned to them.
drop policy if exists dogs_driver_read on public.dogs;
create policy dogs_driver_read on public.dogs
for select to authenticated
using (
  exists (
    select 1
    from public.route_stops rs
    join public.routes r on r.id = rs.route_id
    where rs.dog_id = dogs.id
      and r.driver_id = auth.uid()
  )
  or public.is_org_manager(organization_id)
);

-- A driver may read the clients whose dogs are stops on their own routes.
drop policy if exists clients_driver_read on public.clients;
create policy clients_driver_read on public.clients
for select to authenticated
using (
  exists (
    select 1
    from public.dogs d
    join public.route_stops rs on rs.dog_id = d.id
    join public.routes r on r.id = rs.route_id
    where d.client_id = clients.id
      and r.driver_id = auth.uid()
  )
  or public.is_org_manager(organization_id)
);

commit;
