-- Pack & Paws Club - Parada AGRUPADA por cliente ("1 parada, 2 caes")
--
-- Pedido do dono (24/09/2026): cliente com dois caes nao pode virar duas tarefas soltas no dia — os dois
-- caes moram na MESMA casa, o motorista para uma vez. Decisao dele: **um status por CAO** dentro da mesma
-- parada (dois botoes de "picked up", dois comprovantes) e a **foto-comprovante continua por cao**; o
-- motorista PODE fechar o dia com um cao pendente (ele fica marcado dentro do grupo).
--
-- Como: cada parada continua sendo UMA LINHA de `route_stops` (com o status, os horarios e as provas do
-- cao dela — nada disso muda, e o que o cliente audita), e as linhas do MESMO cliente na MESMA rota
-- passam a compartilhar um `stop_group_id`. A tela agrupa por ele; o otimizador continua por coordenada
-- (mesmo endereco = paradas vizinhas).
--
-- O grupo e carimbado por TRIGGER (nao pelo app): assim vale para QUALQUER caminho de criacao — a RPC
-- `assign_stop_to_route`, o app, um script — e nunca fica parada sem grupo.
-- Apply with a database owner/admin connection only.

begin;

alter table public.route_stops
  add column if not exists stop_group_id uuid;

comment on column public.route_stops.stop_group_id is
  'Paradas do MESMO cliente na MESMA rota compartilham este id: a tela mostra "1 parada, N caes". Cada linha continua com o status/provas do seu cao.';

create index if not exists route_stops_group_idx on public.route_stops(stop_group_id, route_id);

-- 1. BACKFILL: agrupa o que JA esta em producao (por rota + cliente do cao), para as rotas antigas
--    aparecerem agrupadas sem perder historico (decisao do dono: "todos os dias, inclusive concluidas").
update public.route_stops rs
set stop_group_id = g.grupo
from (
  select rs2.route_id, d.client_id, gen_random_uuid() as grupo
  from public.route_stops rs2
  join public.dogs d on d.id = rs2.dog_id
  group by rs2.route_id, d.client_id
) g
where rs.route_id = g.route_id
  and rs.stop_group_id is null
  and g.client_id = (select d3.client_id from public.dogs d3 where d3.id = rs.dog_id);

-- 2. TRIGGER: toda parada nova entra no grupo do cliente dela naquela rota (cria o grupo quando e a
--    primeira). `security definer` porque a leitura precisa enxergar as paradas da rota mesmo quando
--    quem escreve nao tem policy de select (ex.: a RPC do gestor).
create or replace function public.route_stops_set_group()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_client uuid;
  v_group uuid;
begin
  if new.stop_group_id is not null then
    return new;
  end if;

  select client_id into v_client from public.dogs where id = new.dog_id;
  if v_client is null then
    new.stop_group_id := gen_random_uuid();
    return new;
  end if;

  select rs.stop_group_id into v_group
  from public.route_stops rs
  join public.dogs d on d.id = rs.dog_id
  where rs.route_id = new.route_id
    and d.client_id = v_client
    and rs.stop_group_id is not null
  limit 1;

  new.stop_group_id := coalesce(v_group, gen_random_uuid());
  return new;
end;
$function$;

drop trigger if exists route_stops_group_before_insert on public.route_stops;
create trigger route_stops_group_before_insert
  before insert on public.route_stops
  for each row
  execute function public.route_stops_set_group();

commit;
