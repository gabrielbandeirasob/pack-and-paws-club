-- Pack & Paws Club - AUDITORIA DE VERDADE (quem fez o que)
--
-- Achado da revisão das contas (25/09/2026): a tabela `audit_logs` existia com policy de leitura só para o
-- gestor, mas estava VAZIA e nada escrevia nela (nenhum trigger, nenhuma função). Ou seja: se alguém
-- cancelasse uma reserva, apagasse um cliente ou marcasse um problema na rota, não sobrava rastro.
--
-- Aqui nasce o rastro. Um único trigger genérico, aplicado nas tabelas que o escritório precisa auditar:
--   * registra 'created' / 'updated' / 'deleted', com autor (auth.uid()), tabela, id da linha;
--   * no UPDATE guarda só os CAMPOS QUE MUDARAM (+ antes/depois desses campos) — sem carimbo de tempo
--     puro (updated_at só não conta como mudança, senão a lista vira ruído);
--   * roda como SECURITY DEFINER: o autor não precisa de permissão de escrita em audit_logs e continua
--     sem poder ler nada (a leitura é do gestor, pela policy que já existe);
--   * se a linha não tem organization_id (tabela sem dono), não registra — auditoria é por organização.
--
-- Volume: uma linha por mudança. Uma rota de 10 cães gera ~30 linhas/dia. Não há expurgo automático:
-- se o escritório quiser, um cron de retenção (ex.: manter 12 meses) entra numa próxima rodada.

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
begin
  if tg_op = 'DELETE' then
    v_antes := to_jsonb(old);
  else
    v_depois := to_jsonb(new);
    if tg_op = 'UPDATE' then v_antes := to_jsonb(old); end if;
  end if;

  v_org := coalesce(v_depois ->> 'organization_id', v_antes ->> 'organization_id')::uuid;
  v_id  := coalesce(v_depois ->> 'id', v_antes ->> 'id', v_depois ->> 'user_id', v_antes ->> 'user_id');
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

do $$
declare
  tabela text;
  auditadas text[] := array[
    'clients', 'dogs', 'reservations', 'routes', 'route_stops',
    'recurring_schedules', 'recurring_exceptions', 'driver_shifts', 'organization_members'
  ];
begin
  foreach tabela in array auditadas loop
    execute format('drop trigger if exists auditoria_%1$s on public.%1$I', tabela);
    execute format(
      'create trigger auditoria_%1$s after insert or update or delete on public.%1$I
         for each row execute function public.registra_auditoria()', tabela);
  end loop;
end $$;

commit;
