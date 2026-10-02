-- FECHANDO A VISTORIA (02/10/2026), item de dados 10 — dois problemas de banco:
--
-- 1) `cleanup_driver_locations` era `security definer` GLOBAL, executável por qualquer `authenticated`:
--    o DELETE não filtrava organização (`where updated_at < now() - interval '24 hours'`), então um
--    usuário de UMA organização podia apagar as posições de TODAS. Agora a limpeza só alcança as
--    posições de uma organização de que quem chama é membro ativo — o motorista continua podendo
--    disparar a limpeza oportunista do app dele (a chamada é feita na carga da tela do motorista).
--    A assinatura segue `returns integer` (a função original devolve quantas linhas saíram).
--
-- 2) Esquema MORTO: `route_positions` (+ `limpar_posicoes_antigas`) não tem nenhum leitor nem escritor
--    no app (grep em `mobile/`: só aparece na própria migração de 12/09) e está com 0 linhas. Tabela e
--    função mortas confundem quem lê o banco depois — saem.

create or replace function public.cleanup_driver_locations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.driver_locations d
  where d.updated_at < now() - interval '24 hours'
    and exists (
      select 1 from public.organization_members m
      where m.user_id = auth.uid()
        and m.organization_id = d.organization_id
        and m.status = 'active'
    );
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.cleanup_driver_locations() from public, anon;
grant execute on function public.cleanup_driver_locations() to authenticated;

drop table if exists public.route_positions;
-- A função morta tem argumento (`p_dias integer`): o DROP precisa da assinatura exata.
drop function if exists public.limpar_posicoes_antigas(integer);
drop function if exists public.limpar_posicoes_antigas();
