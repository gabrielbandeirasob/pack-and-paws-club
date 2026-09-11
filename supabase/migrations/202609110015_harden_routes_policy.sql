-- 202609110015_harden_routes_policy.sql
--
-- Fecha a pendencia anotada na migracao 014: `routes_manager_all` fazia
-- `m.organization_id = m.organization_id` (comparacao consigo mesma = sempre verdadeira),
-- ou seja, a checagem "o motorista pertence a esta organizacao" nao era aplicada de fato.
-- Qualquer membro com papel 'driver' em QUALQUER organizacao passava.
--
-- Nao causava erro, mas era uma brecha: um manager podia criar/atualizar rota apontando
-- driver_id para um motorista de outra organizacao (ou para qualquer usuario).
--
-- Antes de endurecer, conferi o impacto nos dados reais: 3 rotas existentes, 0 seriam
-- recusadas (todos os drivers sao membros 'driver' ativos da propria org). O app tambem so
-- atribui rota a membros `role='driver'` ativos (mobile/app/(tabs)/dispatch.tsx:53).
--
-- Testado em 11/09/2026 (tudo como o usuario manager, em transacao com ROLLBACK):
--   PASS  manager cria rota com driver ativo
--   PASS  manager troca o driver da rota para outro driver ativo
--   PASS  recusa rota com driver_id = um manager (papel diferente de 'driver')
--   PASS  recusa rota com driver_id inexistente
--   PASS  publish_route() continua funcionando (status draft -> published dentro da transacao)
--   PASS  manager continua enxergando as 3 rotas
--   PASS  nada gravado depois do rollback (rota de teste inexistente; rota real segue 'draft')

create or replace function public.driver_in_org(p_user_id uuid, p_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.organization_members m
                 where m.organization_id = p_org_id
                   and m.user_id = p_user_id
                   and m.role = 'driver'
                   and m.status = 'active');
$$;

drop policy if exists routes_manager_all on public.routes;
create policy routes_manager_all on public.routes for all to authenticated
  using (is_org_manager(organization_id) and driver_in_org(driver_id, organization_id))
  with check (is_org_manager(organization_id) and driver_in_org(driver_id, organization_id));
