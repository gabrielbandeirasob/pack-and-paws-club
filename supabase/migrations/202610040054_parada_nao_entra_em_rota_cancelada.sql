-- PARADA NÃO ENTRA EM ROTA CANCELADA (defesa no banco).
--
-- Dono (04/10/2026, prints do Dispatch): *"Agora tentei fazer o dispatch e não iam para o driver"*.
--
-- Medido em produção: o X cancela a rota do dia, ela sai do quadro (`carregarRotas` filtra `cancelled`) e,
-- ao atribuir de novo, o banco recusa CRIAR outra rota (UNIQUE `routes_organization_date_driver_phase_key`,
-- erro 23505). O app relia a rota do dia SEM olhar o status, pegava a CANCELADA e a RPC
-- `assign_stop_to_route` gravava as paradas ali dentro (a rota `d2347318…` de 04/10 ficou `cancelled` com
-- 2 paradas criadas DEPOIS do cancelamento: Ellie 11:25:16Z e Duke 11:26:42Z). O motorista nunca recebe
-- (o app dele lê só `published`) e o cão continua aparecendo como não atribuído no quadro.
--
-- O app agora REATIVA a rota cancelada antes de escrever (`reativarRotaCancelada`). Esta trava fecha o
-- caminho pelo BANCO: nenhuma parada — de nenhum caminho do app, presente ou futuro — pode nascer/entrar
-- numa rota cancelada. A mensagem 'route cancelled' é a que o app traduz para o gestor.

create or replace function public.route_stops_exige_rota_viva()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if exists (
    select 1 from public.routes r
    where r.id = new.route_id and r.status = 'cancelled'
  ) then
    raise exception 'route cancelled';
  end if;
  return new;
end;
$function$;

drop trigger if exists route_stops_rota_viva on public.route_stops;
create trigger route_stops_rota_viva
  before insert or update on public.route_stops
  for each row execute function public.route_stops_exige_rota_viva();
