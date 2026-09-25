-- Pack & Paws Club - Conta do motorista e do gestor: leitura de jornada e correção pelo escritório
--
-- Achados da revisão do agente2 (25/09/2026), os dois PROVADOS com conta real na org de teste:
--
-- 1) VAZAMENTO: a policy `driver_shifts_read` usava `is_org_member(organization_id)`, que é verdadeiro
--    para QUALQUER membro ativo — inclusive outro motorista. Logado como motorista, a leitura de
--    `driver_shifts` devolveu o turno do GESTOR ("turno de: gestor (não é o usuário logado)").
--    Jornada é dado pessoal: o motorista vê a dele, o gestor vê a da equipe, mais ninguém.
--
-- 2) SEM CORREÇÃO: não existia policy de DELETE em `driver_shifts`. O DELETE do gestor devolvia HTTP 200
--    e não apagava linha nenhuma (RLS filtra em silêncio) — ou seja, um turno batido por engano ficava
--    para sempre e o escritório não tinha como consertar. Aqui o gestor ganha o direito de apagar.
--
-- Rastro de auditoria: a tabela `audit_logs` existe (leitura só do gestor) mas HOJE ESTÁ VAZIA e nada
-- escreve nela (nenhum trigger, nenhuma função) — então este DELETE é silencioso. Registrar quem apagou
-- exige alimentar a auditoria (item separado na fila; não é escopo desta migration).

begin;

drop policy if exists driver_shifts_read on public.driver_shifts;
create policy driver_shifts_read on public.driver_shifts
  for select to authenticated
  using (driver_id = auth.uid() or is_org_manager(organization_id));

drop policy if exists driver_shifts_manager_delete on public.driver_shifts;
create policy driver_shifts_manager_delete on public.driver_shifts
  for delete to authenticated
  using (is_org_manager(organization_id));

commit;
