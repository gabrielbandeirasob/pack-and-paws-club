-- ENTREGA confirmada, tempo de viagem por perna e nome que o gestor consegue corrigir
-- (conferência do dono, 01/10/2026 — itens 2, 4 e 5 da lista de cinco pontos).
--
-- Por que cada coluna existe:
--  1. `delivered_at` — o app só carimbava marcos de BUSCA (`arrived_at`, `picked_up_at`, `completed_at`).
--     Como o fluxo do motorista passou a ser de 2 toques (dono, 30/09/2026: "I arrived" + "Next"), a
--     parada ficava `completed` na hora do pick-up e a ENTREGA não deixava registro nenhum: medido em
--     01/10/2026 na rota do Rafael, as 6 paradas fecharam em 15:18–16:25 e a tarde inteira ficou sem
--     dado. Sem este marco, nem o gestor vê em qual entrega o motorista está, nem o app sabe que a
--     rota continua à tarde (ele dava o dia por terminado às 09:25 da manhã).
--  2. `travel_seconds` — o ETA do motorista era distância em LINHA RETA da posição atual ÷ 25 km/h.
--     O Optimize do gestor já paga a matriz de tempos do Google e a usa só para ORDENAR; gravando a
--     perna aqui, o ETA passa a usar o tempo de ROTA (o que o cliente pediu) sem nenhuma chamada nova
--     à API paga.
--  3. A policy do nome — `profiles` só permitia UPDATE da própria linha, então o gestor corrigindo o
--     nome de um motorista alterava 0 linhas SEM erro (o app achava que salvou e o nome voltava —
--     relato do cliente: "tentou corrigir e voltava").

-- 1) Marco de ENTREGA ---------------------------------------------------------
alter table public.route_stops add column if not exists delivered_at timestamptz;

-- 2) Tempo de VIAGEM da perna que CHEGA nesta parada (segundos), gravado pelo Optimize.
alter table public.route_stops add column if not exists travel_seconds integer;

-- 3) O carimbo do servidor passa a valer para o marco novo.
--    (Mesma função de antes + as duas linhas do `delivered_at` no fim — nada do que já existia mudou.)
create or replace function public.route_stops_stamp_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.status is distinct from old.status then
    -- Carimbo oficial: sempre a hora do SERVIDOR.
    new.status_updated_at := now();

    if new.status = 'arrived'   then new.arrived_at   := public.hora_plausivel(new.arrived_at); end if;
    if new.status = 'picked_up' then new.picked_up_at := public.hora_plausivel(new.picked_up_at); end if;
    if new.status = 'completed' then new.completed_at := public.hora_plausivel(new.completed_at); end if;
    if new.status = 'skipped'   then new.skipped_at   := public.hora_plausivel(new.skipped_at); end if;
  end if;

  -- Furo fechado (achado no teste de 23/09): o app NÃO precisa trocar o status para mandar hora de
  -- evento. Sem esta parte, um aparelho com relógio adiantado gravava "chegou às 12h" às 7h — e a
  -- jornada deduzida sairia errada. Toda hora de evento que MUDA passa pela validação; hora antiga
  -- que já estava gravada (e não foi tocada) fica como está, para não reescrever histórico.
  if new.arrived_at   is distinct from old.arrived_at   then new.arrived_at   := public.hora_plausivel(new.arrived_at);   end if;
  if new.picked_up_at is distinct from old.picked_up_at then new.picked_up_at := public.hora_plausivel(new.picked_up_at); end if;
  if new.completed_at is distinct from old.completed_at then new.completed_at := public.hora_plausivel(new.completed_at); end if;
  if new.skipped_at   is distinct from old.skipped_at   then new.skipped_at   := public.hora_plausivel(new.skipped_at);   end if;

  -- Entrega (01/10/2026): mesmo tratamento das outras horas de evento — quem carimba é o servidor.
  if new.delivered_at is distinct from old.delivered_at then new.delivered_at := public.hora_plausivel(new.delivered_at); end if;

  return new;
end
$function$;

-- 4) O GESTOR pode corrigir o nome (e o telefone) de quem é da organização dele.
--    Escopo: só linhas de perfil de alguém com vínculo em alguma organização onde o autor é gestor
--    ATIVO. O motorista continua podendo editar a PRÓPRIA linha (policy antiga, mantida).
drop policy if exists profiles_manager_update on public.profiles;
create policy profiles_manager_update on public.profiles
  for update to authenticated
  using (
    exists (
      select 1 from public.organization_members alvo
      where alvo.user_id = profiles.id
        and public.is_org_manager(alvo.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.organization_members alvo
      where alvo.user_id = profiles.id
        and public.is_org_manager(alvo.organization_id)
    )
  );

-- 5) O motorista precisa poder LER `delivered_at`/`travel_seconds` na própria rota: já herdado pelas
--    policies de SELECT da tabela (as colunas novas não mudam policy).
