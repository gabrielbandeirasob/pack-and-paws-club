-- 027: CALENDÁRIO DO GOOGLE ESCOLHIDO PELA ORGANIZAÇÃO (seletor de calendário)
--
-- Por que existe: o app conectava na conta do escritório, o espelho escrevia no Google, mas a
-- IMPORTAÇÃO não trazia nada. O diagnóstico em produção (24/09/2026) mostrou a causa: os
-- agendamentos do cliente estão num calendário SECUNDÁRIO (o "bot venda") e o app lia apenas o
-- `primary` da conta conectada. Agora o gestor escolhe o calendário e o app usa o MESMO id nas duas
-- vias (espelho app → Google e importação Google → app).
--
-- A escolha é da ORGANIZAÇÃO, não do aparelho: o escritório inteiro precisa operar no mesmo
-- calendário, e a escolha sobrevive a troca de celular/reinstalação (o token OAuth, esse sim, mora
-- no Keychain do aparelho).
--
-- `google_calendar_id` nulo/vazio = ninguém escolheu = o app segue no `primary`, exatamente o
-- comportamento antigo (migração aditiva: nada muda para quem não escolher).

begin;

alter table public.organizations
  add column if not exists google_calendar_id text,
  add column if not exists google_calendar_summary text;

comment on column public.organizations.google_calendar_id is
  'Id do calendário do Google usado pelo app nas duas vias (espelho e importação). Nulo = primary.';
comment on column public.organizations.google_calendar_summary is
  'Nome (summary) do calendário escolhido — evita uma consulta ao Google só para a tela mostrar.';

-- Quem lê: a política `organizations_member_read` (select para membro ativo) já cobre o motorista,
-- que precisa das configurações da organização. Falta a escrita: só o GESTOR grava a escolha.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'organizations' and policyname = 'organizations_manager_update') then
    create policy organizations_manager_update on public.organizations
      for update to authenticated
      using (public.is_org_manager(id))
      with check (public.is_org_manager(id));
  end if;
end $$;

commit;
