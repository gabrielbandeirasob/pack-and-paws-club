-- Pack & Paws Club - Dia EXTRA na escala (evento ROXO no Google Calendar)
--
-- Pedido do dono (24/09/2026): *"Roxo - Alteração de cliente dia fixo / cliente fora de ordem, para não
-- ficar serviço solto"*. Traduzindo: quando o cliente de DIA FIXO muda o dia (ou vem fora da ordem
-- habitual), o escritório pinta o evento daquele dia de ROXO. O app então registra aquele dia como
-- parte da ESCALA do cão (`recurring_exceptions.action = 'extra'`), em vez de criar uma reserva
-- avulsa — assim o serviço continua ligado ao agendamento fixo e não fica solto.
--
-- Regra da ação nova (espelha o `skip`, que também é por dia):
--   * `extra` vale UM dia (start_date = end_date) — exatamente a data que o escritório pintou;
--   * `skip` continua valendo intervalo (pausa/ausência);
--   * `transport_on`/`transport_off` continuam valendo UM dia.
--
-- Os nomes das constraints são descobertos em tempo de migração (as originais são anônimas/inline), e a
-- migração é idempotente: rodar de novo derruba e recria as duas com os nomes explícitos.
-- Apply with a database owner/admin connection only.

begin;

do $$
declare c record;
begin
  for c in
    select conname, pg_get_constraintdef(oid) as def
    from pg_constraint
    where conrelid = 'public.recurring_exceptions'::regclass
      and contype = 'c'
  loop
    -- Só as constraints que falam das ações ('skip'/'transport_*') são substituídas; a de janela
    -- (`end_date >= start_date`) fica intacta.
    if c.def like '%skip%' then
      execute format('alter table public.recurring_exceptions drop constraint %I', c.conname);
    end if;
  end loop;
end $$;

alter table public.recurring_exceptions
  add constraint recurring_exceptions_action_ok
    check (action in ('skip', 'extra', 'transport_on', 'transport_off')),
  add constraint recurring_exceptions_janela_ok
    check (
      (action = 'skip')
      or (action in ('extra', 'transport_on', 'transport_off') and start_date = end_date)
    );

comment on column public.recurring_exceptions.action is
  'skip = pausa/ausência (intervalo); extra = dia extra/alterado da escala (um dia, vindo de evento ROXO no Google); transport_on/off = liga/desliga transporte naquele dia.';

commit;
