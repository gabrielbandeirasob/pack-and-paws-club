-- Pack & Paws Club - Drivers read access instructions for dogs on their published route
-- Apply with a database owner/admin connection only.

begin;

create policy instructions_driver_route_read on public.client_instructions
for select to authenticated
using (
  exists (
    select 1
    from public.route_stops rs
    join public.routes r on r.id = rs.route_id
    join public.dogs d on d.id = rs.dog_id
    where d.client_id = client_instructions.client_id
      and r.driver_id = auth.uid()
      and r.status = 'published'
  )
);

commit;
