-- Run only in a disposable database AFTER migration 053. No production data is touched.
-- Not executed as part of slice 1 (migration application is explicitly out of scope).
begin;
create temporary table phase_route_vector (like public.routes including defaults including constraints including indexes);
do $$
declare
  org uuid := gen_random_uuid();
  driver uuid := gen_random_uuid();
begin
  insert into phase_route_vector (organization_id, route_date, driver_id, created_by)
    values (org, '2026-10-02', driver, driver);
  insert into phase_route_vector (organization_id, route_date, driver_id, created_by, phase)
    values (org, '2026-10-02', driver, driver, 'dropoff');
  assert (select count(*) from phase_route_vector) = 2, 'both phases must coexist';
  assert (select count(*) from phase_route_vector where phase = 'pickup') = 1, 'legacy default';
  begin
    insert into phase_route_vector (organization_id, route_date, driver_id, created_by, phase)
      values (org, '2026-10-02', driver, driver, 'dropoff');
    raise exception 'duplicate phase accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into phase_route_vector (organization_id, route_date, driver_id, created_by, phase)
      values (org, '2026-10-02', driver, driver, 'invalid');
    raise exception 'invalid phase accepted';
  exception when check_violation then null;
  end;
end;
$$;
rollback;
