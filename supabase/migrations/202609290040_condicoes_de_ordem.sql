-- 040: CONDICOES DE ORDEM por parada — busca e entrega (pedido do dono, 29/09/2026)
--
-- Pedido literal: "quero que na parte de dispatch tenha a opcão de colocar condicões, por exemplo tem o
-- cachorro lucki que sempre vai ser o primeiro a ser entregue então quando for fazer a rota de drop off
-- a primeira entrega vai ser esse lucki".
--
-- Decisoes dele, na mesma data (pergunta de multipla escolha):
--   * a condicao vive na PARADA da rota do dia (como a janela de horario que ja existe), marcada pelo
--     gestor na montagem — nao e propriedade do cadastro do cao;
--   * vale para as DUAS pernas, SEPARADAS: ordem de BUSCA (pickup, a `sequence` de hoje) e ordem de
--     ENTREGA (dropoff, coluna nova `dropoff_sequence`);
--   * ele escolhe na montagem o que travar: primeiro, ultimo ou posicao fixa;
--   * a ordem da ENTREGA e AUTOMATICA: o gestor toca Optimize e o app calcula a melhor ordem da tarde
--     respeitando as travas — as travas sao a EXCECAO, o resto e calculado.
--
-- Compatibilidade (nada muda para quem nao usar):
--   * parada sem `dropoff_sequence` e entregue na ordem da busca (o app cai no `sequence`);
--   * parada sem trava se comporta exatamente como hoje;
--   * `reorder_route_stops` e `publish_route` continuam com a MESMA assinatura — so ganham o novo
--     comportamento de ordem/entrega por coluna nova, sem sobrecarga (a armadilha da 018).

begin;

alter table public.route_stops
  add column if not exists pickup_pin text check (pickup_pin in ('first', 'last', 'fixed')),
  add column if not exists pickup_pin_position integer check (pickup_pin_position >= 1),
  add column if not exists dropoff_pin text check (dropoff_pin in ('first', 'last', 'fixed')),
  add column if not exists dropoff_pin_position integer check (dropoff_pin_position >= 1),
  add column if not exists dropoff_sequence integer;

comment on column public.route_stops.pickup_pin is
  'Trava da ORDEM DA BUSCA (manha): first = primeiro, last = ultimo, fixed = posicao pickup_pin_position. NULL = livre.';
comment on column public.route_stops.dropoff_pin is
  'Trava da ORDEM DA ENTREGA (tarde): first/last/fixed em dropoff_pin_position. NULL = livre (o app calcula).';
comment on column public.route_stops.dropoff_sequence is
  'Ordem da ENTREGA (tarde). NULL = ainda nao calculada: a entrega segue a ordem da busca (`sequence`).';

create index if not exists route_stops_dropoff_sequence_idx
  on public.route_stops(route_id, dropoff_sequence);

-- ---------------------------------------------------------------------------------------------
-- Trava de ordem de UMA parada, numa perna (busca ou entrega). O gestor escolhe: primeiro, ultimo,
-- posicao fixa, ou nenhuma (volta ao calculo automatico).
-- ---------------------------------------------------------------------------------------------
create or replace function public.set_stop_order_pin(
  p_route_id uuid,
  p_dog_id uuid,
  p_leg text,
  p_pin text default null,
  p_pin_position integer default null,
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
begin
  if p_leg not in ('pickup', 'dropoff') then
    raise exception 'invalid leg: %', p_leg;
  end if;
  if p_pin is not null and p_pin not in ('first', 'last', 'fixed') then
    raise exception 'invalid pin: %', p_pin;
  end if;
  if p_pin = 'fixed' and (p_pin_position is null or p_pin_position < 1) then
    raise exception 'fixed pin needs a position >= 1';
  end if;

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

  if p_leg = 'pickup' then
    update public.route_stops
    set pickup_pin = p_pin,
        pickup_pin_position = case when p_pin = 'fixed' then p_pin_position else null end,
        updated_at = now()
    where route_id = p_route_id and dog_id = p_dog_id;
  else
    update public.route_stops
    set dropoff_pin = p_pin,
        dropoff_pin_position = case when p_pin = 'fixed' then p_pin_position else null end,
        updated_at = now()
    where route_id = p_route_id and dog_id = p_dog_id;
  end if;

  update public.routes set lock_version = lock_version + 1, updated_at = now() where id = p_route_id;
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- Aplica a ordem CALCULADA das DUAS pernas numa escrita so (o "Apply" do Optimize do gestor).
-- A ordem da entrega vem do otimizador da tarde, ja com as travas respeitadas pelo app.
-- ---------------------------------------------------------------------------------------------
create or replace function public.apply_route_order(
  p_route_id uuid,
  p_pickup_ids uuid[] default null,
  p_dropoff_ids uuid[] default null,
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

  if p_pickup_ids is not null then
    for v_index in 1 .. coalesce(array_length(p_pickup_ids, 1), 0) loop
      update public.route_stops
      set sequence = v_index, updated_at = now()
      where route_id = p_route_id and dog_id = p_pickup_ids[v_index];
    end loop;
  end if;

  if p_dropoff_ids is not null then
    for v_index in 1 .. coalesce(array_length(p_dropoff_ids, 1), 0) loop
      update public.route_stops
      set dropoff_sequence = v_index, updated_at = now()
      where route_id = p_route_id and dog_id = p_dropoff_ids[v_index];
    end loop;
  end if;

  update public.routes set lock_version = lock_version + 1, updated_at = now() where id = p_route_id;
end;
$function$;

commit;
