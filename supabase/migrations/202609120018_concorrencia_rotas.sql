-- 018: escrita concorrente nas rotas (dois gestores ao mesmo tempo)
--
-- Problema real: dois gestores no mesmo dia mexendo na mesma rota. O ponto de colisao nao e
-- a rota em si, sao as PARADAS (reordenar, atribuir) e a publicacao. Sem trava, o segundo
-- sobrescreve o primeiro e ninguem percebe (ex.: ordem das paradas "volta" sozinha).
--
-- Solucao: cada rota carrega um `lock_version`. Quem escreve informa a versao que LEU; se a
-- rota ja mudou nesse meio tempo, a escrita e RECUSADA com o erro `stale_route` (o app avisa
-- "a rota mudou em outro aparelho, recarregue") em vez de sobrescrever em silencio.
--   * p_esperado NULL = escrita do sistema/legado -> nao trava (compatibilidade).
--   * toda escrita bem-sucedida incrementa lock_version.

alter table public.routes
  add column if not exists lock_version integer not null default 1;

-- ATENCAO: adicionar parametro com DEFAULT cria uma SOBRECARGA (nao substitui a antiga).
-- Com duas versoes no catalogo, o PostgREST fica ambiguo ("could not choose the best
-- candidate function") e todo publish/reorder do app quebraria. Por isso as antigas saem.
drop function if exists public.reorder_route_stops(uuid, uuid[]);
drop function if exists public.assign_stop_to_route(uuid, uuid, time without time zone, time without time zone, time without time zone, text);
drop function if exists public.publish_route(uuid);

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
  from public.routes where id = p_route_id;
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
  from public.routes where id = p_route_id;
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
