-- Motorista recalcula a própria rota publicada a partir do GPS atual.
-- O cálculo acontece no app; esta RPC só grava a ordem, com autorização estrita e lock otimista.
-- Todos os RPCs que escrevem a rota usam a mesma trava de linha para serializar motorista e gestor.

create or replace function public.reorder_route_stops(
  p_route_id uuid,
  p_dog_ids uuid[],
  p_esperado integer default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid;
  v_lock integer;
  v_index integer;
begin
  select organization_id, lock_version into v_org, v_lock
  from public.routes
  where id = p_route_id
  for update;

  if v_org is null then
    raise exception 'route not found';
  end if;
  if not public.is_org_manager(v_org) then
    raise exception 'forbidden';
  end if;
  if p_esperado is not null and p_esperado <> v_lock then
    raise exception 'stale_route';
  end if;

  for v_index in 1 .. coalesce(array_length(p_dog_ids, 1), 0) loop
    update public.route_stops
    set sequence = v_index, updated_at = now()
    where route_id = p_route_id and dog_id = p_dog_ids[v_index];
  end loop;

  update public.routes set lock_version = lock_version + 1, updated_at = now() where id = p_route_id;
end;
$function$;

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
  v_lock integer;
  v_stop_id uuid;
begin
  select organization_id, route_date, lock_version into v_org, v_date, v_lock
  from public.routes
  where id = p_route_id
  for update;

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

  update public.routes set lock_version = lock_version + 1, updated_at = now() where id = p_route_id;
end;
$function$;

create or replace function public.publish_route(
  p_route_id uuid,
  p_esperado integer default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid;
  v_lock integer;
  v_next integer;
begin
  select organization_id, lock_version into v_org, v_lock
  from public.routes
  where id = p_route_id
  for update;

  if v_org is null then
    raise exception 'route not found';
  end if;
  if not public.is_org_manager(v_org) then
    raise exception 'forbidden';
  end if;
  if p_esperado is not null and p_esperado <> v_lock then
    raise exception 'stale_route';
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
  where r.id = p_route_id
  group by r.id, r.status;

  update public.routes
  set status = 'published', published_at = now(), updated_at = now(), lock_version = lock_version + 1
  where id = p_route_id;
end;
$function$;

drop function if exists public.driver_reorder_route_stops(uuid, uuid[], integer);

create or replace function public.driver_reorder_route_stops(
  p_route_id uuid,
  p_dog_ids uuid[],
  p_esperado integer
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_driver uuid;
  v_status text;
  v_lock integer;
  v_total integer;
  v_index integer;
begin
  if p_esperado is null then
    raise exception 'expected route version is required' using errcode = '22004';
  end if;

  select driver_id, status::text, lock_version
    into v_driver, v_status, v_lock
  from public.routes
  where id = p_route_id
  for update;

  if v_driver is null then
    raise exception 'route not found' using errcode = 'P0002';
  end if;
  if v_driver is distinct from auth.uid() or v_status <> 'published' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_esperado <> v_lock then
    raise exception 'stale_route' using errcode = '40001';
  end if;

  select count(*) into v_total from public.route_stops where route_id = p_route_id;
  if coalesce(array_length(p_dog_ids, 1), 0) <> v_total then
    raise exception 'invalid route order: all stops are required' using errcode = '22023';
  end if;
  if (select count(distinct dog_id) from unnest(p_dog_ids) as dog_id) <> v_total then
    raise exception 'invalid route order: duplicated dog' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_dog_ids) as ids(dog_id)
    where not exists (
      select 1 from public.route_stops rs
      where rs.route_id = p_route_id and rs.dog_id = ids.dog_id
    )
  ) then
    raise exception 'invalid route order: dog is not on this route' using errcode = '22023';
  end if;

  for v_index in 1 .. v_total loop
    update public.route_stops
       set sequence = v_index,
           updated_at = now()
     where route_id = p_route_id
       and dog_id = p_dog_ids[v_index];
  end loop;

  update public.routes
     set lock_version = lock_version + 1,
         updated_at = now()
   where id = p_route_id;
end;
$function$;

revoke all on function public.driver_reorder_route_stops(uuid, uuid[], integer) from public, anon;
grant execute on function public.driver_reorder_route_stops(uuid, uuid[], integer) to authenticated;

comment on function public.driver_reorder_route_stops(uuid, uuid[], integer) is
  'Motorista atribuído reordena todas as paradas da própria rota publicada; exige lock_version e serializa com escritores do gestor.';
