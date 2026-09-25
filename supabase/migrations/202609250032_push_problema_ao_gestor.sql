-- Pack & Paws Club - PUSH ao GESTOR quando o motorista reporta problema numa parada
--
-- Melhoria 2 da revisão das contas (agente2, 25/09/2026). O canal já existia para o MOTORISTA
-- (`notify_route_status` avisa quando a rota é publicada/cancelada) e usa `pg_net` — extensão que já está
-- instalada no banco. O que faltava era o sentido contrário: o escritório saber NA HORA que o motorista
-- marcou problema numa parada, sem depender de alguém estar olhando a tela do Dispatch.
--
-- Como funciona: trigger AFTER UPDATE em `route_stops` quando o status VIRA 'skipped' (e não era antes).
-- ATENÇÃO ao modelo do app: o botão *Problem* do motorista grava `status = 'skipped'`
-- (`app/(tabs)/driver.tsx`, mapa `problem: 'skipped'`) — é o ÚNICO caminho que escreve 'skipped', e a tela
-- de progresso do dia já pinta esse estado como problema (`styles.bolinhaProblema`). O status 'problem'
-- NÃO existe: `route_stops_status_check` só aceita pending/arrived/picked_up/completed/skipped.
-- O texto é montado no BANCO (motorista + cão + cliente + observação, quando houver), e o disparo é
-- assíncrono (`net.http_post` devolve na hora; o app do motorista não espera resposta).
--
-- Limites honestos:
--   * só sai se o GESTOR tiver aparelho registrado em `device_tokens` (o app pede permissão de push e
--     grava o token no login; sem aparelho registrado, o trigger volta sem fazer nada);
--   * o push depende da credencial de APNs/FCM no projeto Expo (EAS) — o lado do banco está pronto;
--   * repetir 'problem' não gera novo aviso (só a TRANSIÇÃO para 'problem' conta).

begin;

create or replace function public.notify_stop_problem()
returns trigger
language plpgsql
security definer
set search_path = public, net, extensions
as $$
declare
  v_org       uuid;
  v_tokens    text[];
  v_msgs      jsonb;
  v_cao       text;
  v_cliente   text;
  v_motorista text;
  v_nota      text;
begin
  -- 'skipped' é o marcador de PROBLEMA do app (único caminho que o escreve é o botão Problem).
  if new.status <> 'skipped' or coalesce(old.status, '') = 'skipped' then
    return new;
  end if;

  select r.organization_id into v_org from public.routes r where r.id = new.route_id;
  if v_org is null then
    return new;
  end if;

  select array_agg(distinct dt.token) into v_tokens
    from public.device_tokens dt
    join public.organization_members m
      on m.user_id = dt.user_id and m.organization_id = dt.organization_id
   where dt.organization_id = v_org
     and m.role = 'manager'
     and m.status = 'active';

  if v_tokens is null or coalesce(array_length(v_tokens, 1), 0) = 0 then
    return new; -- nenhum gestor com aparelho registrado: nada a avisar
  end if;

  select d.name, c.name into v_cao, v_cliente
    from public.dogs d
    left join public.clients c on c.id = d.client_id
   where d.id = new.dog_id;

  select p.full_name into v_motorista
    from public.routes r
    left join public.profiles p on p.id = r.driver_id
   where r.id = new.route_id;

  v_nota := nullif(btrim(coalesce(new.proof_note, '')), '');

  select jsonb_agg(jsonb_build_object(
      'to', t,
      'title', 'Problem on the route',
      'body', concat_ws(' · ',
        coalesce(v_motorista, 'The driver') || ' reported a problem',
        coalesce(v_cao, 'a dog') || case when v_cliente is not null then ' (' || v_cliente || ')' else '' end,
        v_nota),
      'sound', 'default',
      'data', jsonb_build_object('type', 'stop_problem', 'routeId', new.route_id, 'stopId', new.id)
    ))
    into v_msgs
    from unnest(v_tokens) as t;

  perform net.http_post(
    url := 'https://exp.host/--/api/v2/push/send',
    body := v_msgs,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Accept', 'application/json')
  );

  return new;
end;
$$;

revoke all on function public.notify_stop_problem() from public;

drop trigger if exists route_stops_notify_problem on public.route_stops;
create trigger route_stops_notify_problem
  after update of status on public.route_stops
  for each row execute function public.notify_stop_problem();

commit;
