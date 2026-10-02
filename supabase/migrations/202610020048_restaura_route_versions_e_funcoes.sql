-- REVERTE O ITEM 6 DA MIGRATION 202610020047 (esquema morto) — ELE ESTAVA VIVO.
--
-- A auditoria de 02/10/2026 viu `route_versions` e as funções `move_stop_to_route` e
-- `driver_reorder_route_stops` sem NENHUMA referência no app, no robô e nos scripts — e concluiu "morto".
-- Errado: o `npm run test:db` (teste de fluxos do banco) mostrou na hora que
--   · `publish_route` grava em `route_versions` (publicar rota quebrou: `relation does not exist`), e
--   · o teste do motorista usa `driver_reorder_route_stops` para provar que ele NÃO reordena a rota.
-- Recurso: as definições ORIGINAIS, copiadas sem reescrever das migrations 003/010/026.
--
-- ⚠️ O que se perdeu: as 28 linhas de histórico de versão que existiam na tabela (snapshots de rotas já
-- publicadas). O `lock_version` das rotas — que é o que o app usa para detectar escrita velha — está
-- intacto; o histórico de snapshots antigos não tem como ser recuperado.

begin;

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

commit;
