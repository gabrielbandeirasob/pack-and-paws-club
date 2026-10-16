-- O FATURAMENTO DO DIA É LEITURA DO GESTOR — o motorista não lê `daily_plans`.
--
-- Achado da varredura de 16/10/2026: a policy `daily_plans_member_read` liberava SELECT para qualquer
-- membro da organização (`is_org_member`), então o MOTORISTA podia ler `revenue_cents` — o faturamento
-- do dia — direto pela API. Provado com a conta de teste do motorista:
--   GET /rest/v1/daily_plans?select=day,revenue_cents
--   -> [{"day":"2026-09-27","revenue_cents":125075,"walk_location":"Yard - Goiania"}]
-- O caminho também aparecia na TELA: `/day-summary` pintava "Revenue" para o motorista (a trava de
-- papel dessa tela entrou no mesmo dia, no app).
--
-- A policy de membro não é necessária para nada do produto: nenhuma tela do motorista lê
-- `daily_plans` (os únicos leitores são o painel do gestor em `app/(tabs)/index.tsx` e
-- `features/dashboard/dayService.ts`), e `daily_plans_manager_all` (for all to authenticated,
-- `is_org_manager`) já cobre o SELECT de quem opera o dia.
--
-- `walk_location` e `photo_idea` são do mesmo registro: como o faturamento mora na MESMA linha, restringir
-- a linha inteira é o único jeito de proteger o número sem separar a coluna em outra tabela.

begin;

drop policy if exists daily_plans_member_read on public.daily_plans;

commit;
