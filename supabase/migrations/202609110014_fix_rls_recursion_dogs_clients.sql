-- 202609110014_fix_rls_recursion_dogs_clients.sql
--
-- Corrige: ERROR 42P17 "infinite recursion detected in policy for relation \"dogs\""
-- Reportado no app (build 12) ao adicionar um cachorro para um cliente vindo de Contatos:
-- o INSERT em `dogs` falhava com recursao infinita de politica.
--
-- CAUSA RAIZ (ciclo entre politicas, ambas permissivas):
--   dogs_manager_all (ALL)      WITH CHECK -> EXISTS (SELECT 1 FROM clients ...)
--   clients_driver_read (SELECT) USING    -> EXISTS (SELECT 1 FROM dogs ...)
-- Ou seja: ler `clients` dentro da politica de `dogs` obriga o Postgres a avaliar a
-- politica de `clients`, que por sua vez le `dogs` -> ciclo. O Postgres detecta e aborta.
--
-- Mesmo defeito latente existia em `reservations`, `recurring_schedules` e
-- `recurring_exceptions` (todas referenciavam `dogs` no CHECK) - seriam o proximo erro
-- ao criar reserva/agenda. Corrigidas aqui tambem.
--
-- CORRECAO: checar o vinculo por funcao SECURITY DEFINER (que NAO passa por RLS),
-- o mesmo padrao que `is_org_manager` ja usava neste projeto.
--
-- Verificado em 11/09/2026 rodando os fluxos como o usuario manager dentro de transacao
-- com ROLLBACK: cliente+cao+instrucoes+reserva+agenda = OK; cao com cliente inexistente
-- = recusado (42501); org sem permissao = recusado; driver continua sem ver clientes/caes.

create or replace function public.client_belongs_to_org(p_client_id uuid, p_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.clients c where c.id = p_client_id and c.organization_id = p_org_id);
$$;

create or replace function public.dog_belongs_to_org(p_dog_id uuid, p_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.dogs d where d.id = p_dog_id and d.organization_id = p_org_id);
$$;

create or replace function public.schedule_belongs_to_org(p_schedule_id uuid, p_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.recurring_schedules s where s.id = p_schedule_id and s.organization_id = p_org_id);
$$;

-- dogs: era `EXISTS (SELECT 1 FROM clients c WHERE c.id = dogs.client_id AND c.organization_id = c.organization_id)`
-- (alem do ciclo, o segundo termo era comparacao consigo mesmo = sempre verdadeira).
drop policy if exists dogs_manager_all on public.dogs;
create policy dogs_manager_all on public.dogs for all to authenticated
  using (is_org_manager(organization_id))
  with check (is_org_manager(organization_id) and client_belongs_to_org(client_id, organization_id));

-- client_instructions: havia DUAS politicas ALL; a antiga (`instructions_manager_all`)
-- carregava o mesmo ciclo. Removida, ficando apenas a com o check correto.
drop policy if exists instructions_manager_all on public.client_instructions;
drop policy if exists client_instructions_manager_all on public.client_instructions;
create policy client_instructions_manager_all on public.client_instructions for all to authenticated
  using (is_org_manager(organization_id))
  with check (is_org_manager(organization_id) and client_belongs_to_org(client_id, organization_id));

-- reservations: CHECK referenciava dogs (mesmo ciclo latente)
drop policy if exists reservations_manager_all on public.reservations;
create policy reservations_manager_all on public.reservations for all to authenticated
  using (is_org_manager(organization_id))
  with check (is_org_manager(organization_id) and dog_belongs_to_org(dog_id, organization_id));

-- recurring_schedules: idem
drop policy if exists recurring_manager_all on public.recurring_schedules;
create policy recurring_manager_all on public.recurring_schedules for all to authenticated
  using (is_org_manager(organization_id))
  with check (is_org_manager(organization_id) and dog_belongs_to_org(dog_id, organization_id));

-- recurring_exceptions: cadeia recurring_schedules -> dogs -> clients -> dogs
drop policy if exists recurring_exceptions_manager_all on public.recurring_exceptions;
create policy recurring_exceptions_manager_all on public.recurring_exceptions for all to authenticated
  using (is_org_manager(organization_id))
  with check (is_org_manager(organization_id) and schedule_belongs_to_org(recurring_schedule_id, organization_id));

-- PENDENCIA RESOLVIDA: `routes_manager_all` tinha o mesmo typo de comparacao consigo mesma
-- (a checagem "o motorista pertence a esta organizacao" nao era aplicada). Corrigida em
-- 202609110015_harden_routes_policy.sql, com dry-run nos dados reais (0 rotas afetadas) e testes.
