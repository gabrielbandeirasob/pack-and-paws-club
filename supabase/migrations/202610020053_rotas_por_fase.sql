-- 053: Independent pickup and dropoff routes; existing routes remain pickup.
begin;

alter table public.routes
  add column phase text not null default 'pickup'
    constraint routes_phase_check check (phase in ('pickup', 'dropoff'));
alter table public.routes
  drop constraint routes_organization_id_route_date_driver_id_key,
  add constraint routes_organization_date_driver_phase_key
    unique (organization_id, route_date, driver_id, phase);

-- publish_route, reorder_route_stops, apply_route_order and set_stop_order_pin
-- already scope every read/write by route_id. Their guards, grants and RLS are unchanged.
-- Assignment must only transfer stops within the destination phase.
create or replace function public.assign_stop_to_route(
  p_route_id uuid,
  p_dog_id uuid,
  p_window_start time without time zone default null,
  p_window_end time without time zone default null,
  p_exact_time time without time zone default null,
  p_priority text default 'normal',
  p_esperado integer default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid;
  v_date date;
  v_phase text;
  v_lock integer;
  v_to_driver uuid;
  v_stop_id uuid;
  -- origem da transferencia (a parada do mesmo cao em OUTRA rota do mesmo dia)
  v_from_stop uuid;
  v_from_route uuid;
  v_from_driver uuid;
  v_from_name text;
  v_status text;
  v_arrived timestamptz;
  v_picked timestamptz;
  v_completed timestamptz;
  v_skipped timestamptz;
  v_delivered timestamptz;
  v_proof_up text;
  v_proof_down text;
  v_transfere boolean;
begin
  select organization_id, route_date, lock_version, driver_id, phase
    into v_org, v_date, v_lock, v_to_driver, v_phase
  from public.routes where id = p_route_id for update;
  if v_org is null then
    raise exception 'route not found';
  end if;
  if not public.is_org_manager(v_org) then
    raise exception 'forbidden';
  end if;
  if p_priority not in ('normal', 'priority') then
    raise exception 'invalid priority';
  end if;
  if p_esperado is not null and p_esperado <> v_lock then
    raise exception 'stale_route';
  end if;

  -- A parada do mesmo cao em outra rota do MESMO dia/organizacao = a origem da transferencia.
  select rs.id, rs.route_id, r.driver_id,
         coalesce(nullif(btrim(pr.full_name), ''), 'Driver'),
         rs.status, rs.arrived_at, rs.picked_up_at, rs.completed_at, rs.skipped_at, rs.delivered_at,
         rs.pickup_proof_path, rs.dropoff_proof_path
    into v_from_stop, v_from_route, v_from_driver, v_from_name,
         v_status, v_arrived, v_picked, v_completed, v_skipped, v_delivered,
         v_proof_up, v_proof_down
  from public.route_stops rs
  join public.routes r on r.id = rs.route_id
  left join public.profiles pr on pr.id = r.driver_id
  where rs.dog_id = p_dog_id
    and rs.route_id <> p_route_id
    and r.organization_id = v_org
    and r.route_date = v_date
    and r.phase = v_phase
  limit 1;

  -- So e transferencia se veio de OUTRO motorista (mover entre duas rotas do mesmo driver nao e troca).
  v_transfere := v_from_driver is not null and v_from_driver is distinct from v_to_driver;

  -- Invalidate the source route's optimistic version as well as the destination's.
  update public.routes r set lock_version = r.lock_version + 1, updated_at = now()
  where r.organization_id = v_org and r.route_date = v_date and r.phase = v_phase
    and r.id <> p_route_id
    and exists (select 1 from public.route_stops s where s.route_id = r.id and s.dog_id = p_dog_id);

  delete from public.route_stops
  where dog_id = p_dog_id
    and route_id <> p_route_id
    and route_id in (
      select id from public.routes
      where organization_id = v_org and route_date = v_date and phase = v_phase
    );

  select id into v_stop_id
  from public.route_stops
  where route_id = p_route_id and dog_id = p_dog_id;

  if v_stop_id is null then
    insert into public.route_stops(
      route_id, dog_id, sequence, dropoff_sequence, status,
      window_start, window_end, exact_time, priority,
      arrived_at, picked_up_at, completed_at, skipped_at, delivered_at,
      pickup_proof_path, dropoff_proof_path,
      handed_from_driver_id, handed_from_name, handed_at)
    select
      p_route_id, p_dog_id,
      coalesce(max(sequence), 0) + 1,
      coalesce(max(dropoff_sequence), 0) + 1,
      coalesce(v_status, 'pending'),
      p_window_start, p_window_end, p_exact_time, p_priority,
      v_arrived, v_picked, v_completed, v_skipped, v_delivered,
      v_proof_up, v_proof_down,
      case when v_transfere then v_from_driver end,
      case when v_transfere then v_from_name end,
      case when v_transfere then now() end
    from public.route_stops where route_id = p_route_id;
  else
    update public.route_stops
    set window_start = p_window_start,
        window_end = p_window_end,
        exact_time = p_exact_time,
        priority = p_priority,
        -- herda o historico do cao que chegou transferido (nao rebaixa marco ja gravado)
        status = coalesce(v_status, status),
        arrived_at = coalesce(v_arrived, arrived_at),
        picked_up_at = coalesce(v_picked, picked_up_at),
        completed_at = coalesce(v_completed, completed_at),
        skipped_at = coalesce(v_skipped, skipped_at),
        delivered_at = coalesce(v_delivered, delivered_at),
        pickup_proof_path = coalesce(v_proof_up, pickup_proof_path),
        dropoff_proof_path = coalesce(v_proof_down, dropoff_proof_path),
        handed_from_driver_id = case when v_transfere then v_from_driver else handed_from_driver_id end,
        handed_from_name = case when v_transfere then v_from_name else handed_from_name end,
        handed_at = case when v_transfere then now() else handed_at end,
        updated_at = now()
    where id = v_stop_id;
  end if;

  if v_transfere then
    insert into public.route_stop_transfers(
      organization_id, dog_id, from_route_id, from_driver_id, from_driver_name,
      to_route_id, to_driver_id, authorized_by, transferred_at)
    values (
      v_org, p_dog_id, v_from_route, v_from_driver, v_from_name,
      p_route_id, v_to_driver, auth.uid(), now());
  end if;

  update public.routes set lock_version = lock_version + 1, updated_at = now() where id = p_route_id;
end;
$function$;

-- Keep the legacy entry point phase-safe, with the same authorization and audit as assignment.
create or replace function public.move_stop_to_route(p_route_id uuid, p_dog_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assign_stop_to_route(p_route_id, p_dog_id);
end;
$$;

commit;
