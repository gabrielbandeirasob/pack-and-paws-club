-- 052: TRANSFERENCIA DE CAO ENTRE MOTORISTAS no meio do dia
-- (item 5 do documento do cliente de 25/09/2026; audio: "o cachorro A, que foi pego pelo driver X,
--  pode, no final da caminhada, ir pra van do driver Y ... por escolha do chefe".)
--
-- O gestor JA conseguia mover o cao de rota (`assign_stop_to_route`, migration 018, remove da rota
-- anterior e insere na nova). Faltavam duas coisas que este migracao resolve:
--
--   1. NAO FICAVA REGISTRO da troca — nem quem autorizou nem a hora.
--   2. OS MARCOS DO CAO ERAM PERDIDOS. A linha nova nascia limpa: um cao que ja tinha sido pego pelo
--      driver X aparecia na rota do driver Y como "para buscar" — o motorista ia buscar um cao que ja
--      estava na van. (A linha antiga era apagada e a nova nao herdava `picked_up_at`/`status`.)
--
-- Agora a transferencia fica registrada (`route_stop_transfers`), a linha de destino HERDA o historico
-- do cao (marcos e comprovantes) e o motorista Y ve DE QUEM recebeu e a hora (`handed_from_name`/
-- `handed_at`), que o app mostra no cartao da parada.
--
-- A RLS nao afrouxa: quem transfere continua sendo o GESTOR (`is_org_manager`), dentro de uma RPC
-- `security definer` — nao houve politica nova de update em `route_stops`.

alter table public.route_stops
  add column if not exists handed_from_driver_id uuid references auth.users (id) on delete set null,
  add column if not exists handed_from_name text,
  add column if not exists handed_at timestamptz;

comment on column public.route_stops.handed_from_name is
  'Nome do motorista que tinha o cao antes da transferencia (item 5, 25/09/2026). Nulo = o cao nunca trocou de motorista.';
comment on column public.route_stops.handed_at is
  'Quando o gestor transferiu o cao para esta rota. O motorista le "de quem / a que hora" no cartao.';

create table if not exists public.route_stop_transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  dog_id uuid not null references public.dogs (id) on delete cascade,
  from_route_id uuid references public.routes (id) on delete set null,
  from_driver_id uuid references auth.users (id) on delete set null,
  from_driver_name text,
  to_route_id uuid not null references public.routes (id) on delete cascade,
  to_driver_id uuid references auth.users (id) on delete set null,
  authorized_by uuid references auth.users (id) on delete set null,
  reason text,
  transferred_at timestamptz not null default now()
);

comment on table public.route_stop_transfers is
  'Auditoria das transferencias de cao entre motoristas no meio do dia (item 5). Só o gestor escreve (pela RPC) e só o gestor le.';

create index if not exists route_stop_transfers_org_idx
  on public.route_stop_transfers (organization_id, transferred_at desc);

alter table public.route_stop_transfers enable row level security;

drop policy if exists route_stop_transfers_manager_read on public.route_stop_transfers;
create policy route_stop_transfers_manager_read on public.route_stop_transfers
  for select using (public.is_org_manager (organization_id));

-- Recria a atribuicao com registro da transferencia + heranca do historico.
-- MESMA assinatura de 018 (nao cria sobrecarga no catalogo do PostgREST).
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
  select organization_id, route_date, lock_version, driver_id
    into v_org, v_date, v_lock, v_to_driver
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
  limit 1;

  -- So e transferencia se veio de OUTRO motorista (mover entre duas rotas do mesmo driver nao e troca).
  v_transfere := v_from_driver is not null and v_from_driver is distinct from v_to_driver;

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
