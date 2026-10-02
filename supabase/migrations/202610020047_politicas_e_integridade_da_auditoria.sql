-- AUDITORIA DE 02/10/2026 — POLÍTICAS E INTEGRIDADE (achados da frente de DADOS)
--
-- Cada bloco nasceu de um achado PROVADO no banco, com a consulta no comentário. Nada aqui apaga dado do
-- cliente: as correções são de política, de gatilho e de esquema morto.

-- ---------------------------------------------------------------------------------------------------
-- 1) O GESTOR PRECISA VER (e poder fechar) A ROTA CUJO MOTORISTA SAIU DA ORGANIZAÇÃO.
--
-- Prova: a policy routes_manager_all exigia `driver_in_org(driver_id, organization_id)` no USING, então a
-- rota c0ce7d36… (26/09/2026, publicada, motorista "Jordan" com o vínculo desativado) ficava INVISÍVEL
-- para o gestor — ele não conseguia fechar nem cancelar, e o motorista continuava com ela no celular.
--
-- Conserto: a VISIBILIDADE (USING) passa a ser só "é gestor desta organização". A ESCRITA (WITH CHECK)
-- continua barrando atribuir rota a quem não é da casa — abre apenas para CANCELAR/FECHAR
-- (`status in ('cancelled','completed')`), que é o que o escritório precisa fazer com a rota presa.
-- ---------------------------------------------------------------------------------------------------
drop policy if exists routes_manager_all on public.routes;
create policy routes_manager_all on public.routes
  for all
  using (is_org_manager(organization_id))
  with check (
    is_org_manager(organization_id)
    and (driver_in_org(driver_id, organization_id) or status in ('cancelled', 'completed'))
  );

-- ---------------------------------------------------------------------------------------------------
-- 2) A JORNADA NÃO PODE APONTAR PARA ROTA DE OUTRA ORGANIZAÇÃO.
--
-- Prova: o WITH CHECK de `driver_shifts_driver_insert` tinha condição TAUTOLÓGICA
-- (`r.organization_id = r.organization_id`), ou seja, não comparava nada — o motorista podia gravar uma
-- jornada apontando para a rota de outra organização. O gatilho abaixo fecha o furo sem reescrever a
-- expressão longa da policy (aditivo e mais fácil de auditar).
-- ---------------------------------------------------------------------------------------------------
create or replace function public.driver_shifts_rota_da_mesma_organizacao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.route_id is not null then
    if not exists (
      select 1 from public.routes r
       where r.id = new.route_id and r.organization_id = new.organization_id
    ) then
      raise exception 'A jornada não pode apontar para uma rota de outra organização.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists driver_shifts_rota_da_mesma_organizacao on public.driver_shifts;
create trigger driver_shifts_rota_da_mesma_organizacao
  before insert or update on public.driver_shifts
  for each row execute function public.driver_shifts_rota_da_mesma_organizacao();

-- ---------------------------------------------------------------------------------------------------
-- 3) O MOTORISTA SÓ PODE MUDAR O PROGRESSO DA PARADA.
--
-- Prova: `route_stops_driver_update` permitia ao motorista alterar QUALQUER coluna da parada — dava para
-- trocar o cão, a ordem, a janela de horário e os pinos da parada de outro dia/rota publicada dele.
-- Agora um gatilho recusa mudanças fora das colunas de progresso quando quem escreve não é gestor.
-- (Escrita com service_role — robô e scripts — passa: `auth.uid()` é nulo.)
-- ---------------------------------------------------------------------------------------------------
create or replace function public.route_stops_somente_progresso_do_motorista()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sou_gestor boolean;
  -- O que o motorista PODE gravar (o resto é do escritório).
  permitidas text[] := array[
    'status', 'arrived_at', 'picked_up_at', 'completed_at', 'skipped_at', 'delivered_at',
    'status_updated_at', 'eta_notice_at', 'eta_notice_kind', 'proof_note',
    'pickup_proof_path', 'pickup_proof_at', 'dropoff_proof_path', 'dropoff_proof_at', 'updated_at'
  ];
  antes jsonb := to_jsonb(old) - permitidas;
  depois jsonb := to_jsonb(new) - permitidas;
begin
  if auth.uid() is null then
    return new; -- service_role / migração / robô
  end if;
  select is_org_manager(r.organization_id) into sou_gestor
    from public.routes r where r.id = old.route_id;
  if sou_gestor is true then
    return new; -- o escritório manda na ordem, no cão e na janela
  end if;
  if antes is distinct from depois then
    raise exception 'Only the office can change this stop''s dog, order, time window or pins.';
  end if;
  return new;
end;
$$;

drop trigger if exists route_stops_somente_progresso on public.route_stops;
create trigger route_stops_somente_progresso
  before update on public.route_stops
  for each row execute function public.route_stops_somente_progresso_do_motorista();

-- ---------------------------------------------------------------------------------------------------
-- 4) AS PROVAS DE ENTREGA PRECISAM PODER SER APAGADAS PELO ESCRITÓRIO.
--
-- Prova: o bucket `stop-proofs` tinha INSERT e SELECT, e nenhuma política de DELETE — 23 arquivos no
-- bucket contra 3 paradas com prova. Fotos de entregas antigas ficavam para sempre, sem ninguém poder
-- limpar. Mesma postura do `dog-photos` (que já tem delete pelo caminho da organização).
-- (A limpeza dos órfãos NÃO é feita aqui: são provas de entrega do cliente; o escritório decide.)
-- ---------------------------------------------------------------------------------------------------
drop policy if exists stop_proofs_delete on storage.objects;
create policy stop_proofs_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'stop-proofs' and path_belongs_to_my_org(name));

-- ---------------------------------------------------------------------------------------------------
-- 5) ÍNDICES QUE FALTAVAM para as consultas que o app faz (a auditoria mediu como ausentes).
-- ---------------------------------------------------------------------------------------------------
create index if not exists routes_driver_id_idx on public.routes (driver_id);
create index if not exists driver_shifts_driver_id_idx on public.driver_shifts (driver_id);
create index if not exists route_stops_dog_id_idx on public.route_stops (dog_id);

-- ---------------------------------------------------------------------------------------------------
-- 6) ESQUEMA "MORTO" — RETIRADO DESTA MIGRATION.
--
-- A auditoria marcou `route_versions` + `move_stop_to_route` + `driver_reorder_route_stops` como mortos
-- (0 referências no app/robô/scripts) e eles foram removidos aqui na primeira aplicação. O `npm run
-- test:db` provou que NÃO estavam mortos: `publish_route` grava em `route_versions` e o teste do
-- motorista usa `driver_reorder_route_stops`. A migration 202610020048 restaura os três (definições
-- originais, copiadas das migrations 003/010/026).
-- LIÇÃO: antes de dropar esquema, rodar `npm run test:db` — o grep do app não enxerga dentro de PL/pgSQL.
-- ---------------------------------------------------------------------------------------------------
