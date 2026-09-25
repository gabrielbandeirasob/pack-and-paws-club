-- Pack & Paws Club - CONSERTA a auditoria de PARADAS (rota/parada sem organization_id)
--
-- Defeito encontrado pelos próprios testes do agente2 (25/09/2026), na primeira bateria de validação da
-- migration 032: o gestor aparecia no rastro (clientes, cães, reservas), mas **a ação do MOTORISTA na
-- parada não registrava nada**.
--
-- Causa: `route_stops` NÃO tem coluna `organization_id` (a organização vem de `routes`). A função de
-- auditoria resolvia a organização só pelo próprio registro e, sem ela, voltava em silêncio — ou seja, o
-- caso mais importante para o escritório ("quem marcou essa parada como problema/concluída?") era
-- exatamente o que ficava sem rastro.
--
-- Correção: quando o registro não traz `organization_id`, sobe para o pai (`routes`) pelo `route_id`.
-- Cobertura conferida depois: rota, parada, cliente, cão, reserva, escala, exceção, turno e equipe.

begin;

create or replace function public.registra_auditoria()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes  jsonb;
  v_depois jsonb;
  v_org    uuid;
  v_id     text;
  v_acao   text;
  v_mudou  text[];
  v_meta   jsonb;
  v_route  uuid;
begin
  if tg_op = 'DELETE' then
    v_antes := to_jsonb(old);
  else
    v_depois := to_jsonb(new);
    if tg_op = 'UPDATE' then v_antes := to_jsonb(old); end if;
  end if;

  v_org := coalesce(v_depois ->> 'organization_id', v_antes ->> 'organization_id')::uuid;

  -- Tabelas sem organization_id (route_stops): a organização vem da ROTA. Sem isto, o registro mais
  -- importante para o escritório (o que o motorista fez na parada) era descartado em silêncio.
  if v_org is null then
    v_route := coalesce(v_depois ->> 'route_id', v_antes ->> 'route_id')::uuid;
    if v_route is not null then
      select r.organization_id into v_org from public.routes r where r.id = v_route;
    end if;
  end if;

  v_id := coalesce(v_depois ->> 'id', v_antes ->> 'id', v_depois ->> 'user_id', v_antes ->> 'user_id');
  if v_org is null or v_id is null then
    return coalesce(new, old);
  end if;

  v_acao := case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end;

  if tg_op = 'UPDATE' then
    select array_agg(campo order by campo) into v_mudou
      from (
        select campo
          from jsonb_object_keys(v_depois) as campo
         where campo not in ('updated_at', 'created_at')
           and coalesce(v_depois -> campo, 'null'::jsonb) is distinct from coalesce(v_antes -> campo, 'null'::jsonb)
      ) mudados;
    if v_mudou is null then
      return new;  -- UPDATE que só mexeu em carimbo de tempo: não vira registro
    end if;
  end if;

  v_meta := case tg_op
    when 'INSERT' then jsonb_build_object('after', v_depois - 'updated_at' - 'created_at')
    when 'UPDATE' then jsonb_build_object(
      'changed', to_jsonb(v_mudou),
      'before', (v_antes - 'updated_at' - 'created_at') - 'id' - 'organization_id',
      'after',  (v_depois - 'updated_at' - 'created_at') - 'id' - 'organization_id')
    else jsonb_build_object('before', v_antes - 'updated_at' - 'created_at')
  end;

  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_org, auth.uid(), v_acao, tg_table_name, v_id, v_meta);

  return coalesce(new, old);
end;
$$;

revoke all on function public.registra_auditoria() from public;

commit;
