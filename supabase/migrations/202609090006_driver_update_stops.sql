-- Pack & Paws Club - Drivers update their own published route stops
-- Apply with a database owner/admin connection only.

begin;

create policy route_stops_driver_update on public.route_stops
for update to authenticated
using (
  exists (
    select 1 from public.routes r
    where r.id = route_id
      and r.driver_id = auth.uid()
      and r.status in ('published', 'completed')
  )
)
with check (
  exists (
    select 1 from public.routes r
    where r.id = route_id
      and r.driver_id = auth.uid()
      and r.status in ('published', 'completed')
  )
);

commit;
