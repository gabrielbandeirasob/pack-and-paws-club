-- 038: GESTOR TAMBÉM DIRIGE (o Dispatch precisa poder atribuir a rota ao próprio gestor)
--
-- Áudio do dono (27/09/2026): "todo administrador consegue ser, se ele quiser ou tiver necessidade de
-- ser um driver… porque o administrador também faz os pick-ups e drop-off, então para o administrador
-- não tem que ficar deslogando e logando".
--
-- A política `routes_manager_all` (ALL, a única que usa esta função) exige
-- `is_org_manager(organization_id) AND driver_in_org(driver_id, organization_id)`, e `driver_in_org`
-- só aceitava vínculo de **motorista** — ou seja: o gestor aparecia na tela, mas na hora de salvar a
-- rota com ele mesmo como motorista o banco recusava. Aqui a função passa a aceitar o **gestor ativo
-- da MESMA organização**.
--
-- O que NÃO muda: continua exigindo vínculo ATIVO naquela organização (nada de outro tenant), e a
-- leitura/escrita do lado motorista continua sendo por `driver_id = auth.uid()`
-- (`routes_driver_read` / `route_stops_driver_*`), que já valia para qualquer membro — por isso o
-- gestor consegue ver e operar a rota dele como motorista sem política nova.
--
-- Medido antes de aplicar: rotas com gestor como motorista = 0 (nada quebrava e nada passa a
-- comportar-se diferente para quem já existia).

create or replace function public.driver_in_org(p_user_id uuid, p_org_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (select 1 from public.organization_members m
                 where m.organization_id = p_org_id and m.user_id = p_user_id
                   and m.role in ('driver', 'manager') and m.status = 'active');
$function$;

comment on function public.driver_in_org(uuid, uuid) is
  'Vinculo ATIVO na organizacao que pode ser motorista de rota: driver ou manager (gestor tambem dirige, audio 27/09/2026).';
