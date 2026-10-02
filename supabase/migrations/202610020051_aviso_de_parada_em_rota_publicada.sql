-- AUDITORIA 02/10/2026 — PENDENCIA #2: o motorista nao e avisado quando uma PARADA entra/muda
-- numa rota JA publicada.
--
-- ACHADO (frente de INTEGRACOES, item 8, MEDIO): o unico aviso de rota que o motorista recebe hoje vem do
-- gatilho de `routes` (migration 202609120019_push_mensagem_certa.sql): ele so dispara na TRANSICAO para
-- `status = 'published'`. Consequencia pratica: se o escritorio MONTA a rota, PUBLICA, e DEPOIS
-- adiciona uma parada (ou reordena as paradas), o motorista NAO recebe nada — so descobre abrindo o app e
-- reparando na ordem nova. Era exatamente o buraco que o escritorio reclamava.
--
-- CORRECAO: um gatilho novo em `route_stops` (AFTER INSERT OR UPDATE) que reusa o MESMO transporte do
-- aviso que ja existe — `net.http_post` direto para o endpoint de push do Expo, com os `device_tokens` do
-- MOTORISTA daquela rota (o mesmo `pg_net` da 019/032; nenhum transporte novo foi inventado). A frase sai
-- de uma funcao PURA (`push_route_stop_body`), como na 019, o que a torna testavel direto por SQL.
--
-- Regras para NAO virar spam e NAO avisar de rota que nao existe no app:
--   * so age se a ROTA daquela parada estiver `status = 'published'` (rascunho/cancelada/concluida: nada);
--   * so age se `route_date` for HOJE ou AMANHA (o app do motorista so mostra a rota do dia; avisar de
--     rota velha ou distante mandaria o motorista procurar uma rota que nao esta la);
--   * no UPDATE so dispara se a ORDEM mudou de verdade (`sequence`, `dog_id` ou `route_id` diferentes) —
--     marcar status, subir foto/prova, gravar ETA etc. nao gera aviso nenhum;
--   * so dispara se o MOTORISTA tiver aparelho registrado em `device_tokens` (sem aparelho, volta calado).
--
-- Limites honestos (os mesmos do canal da 019):
--   * o push de fato depende da credencial de APNs/FCM no projeto Expo (EAS) — o lado do banco fica pronto;
--   * o `net.http_post` e assincrono (enfileira e segue); o app do motorista nao espera resposta.

begin;

-- Frase do aviso como funcao PURA: testavel direto por SQL (mesmo padrao de `push_route_body`, da 019).
drop function if exists public.push_route_stop_body(text);

create or replace function public.push_route_stop_body(p_change text)
returns text
language sql
stable
as $$
  select 'Route updated: a stop was '
    || case when p_change = 'added' then 'added' else 'moved' end
    || '. Open the app to see the new order.';
$$;

create or replace function public.notify_route_stop_change()
returns trigger
language plpgsql
security definer
set search_path = public, net, extensions
as $$
declare
  v_route   record;
  v_tokens  text[];
  v_msgs    jsonb;
  v_change  text;
  v_type    text;
  v_body    text;
begin
  -- No UPDATE so interessa quando a ORDEM da parada muda de verdade. `is not distinct from` cobre
  -- NULL e evita disparar por status/prova/ETA/horario (os mesmos "ruidos" que a auditoria ignora).
  if tg_op = 'UPDATE'
     and new.sequence is not distinct from old.sequence
     and new.dog_id   is not distinct from old.dog_id
     and new.route_id is not distinct from old.route_id then
    return new;
  end if;

  select r.id, r.status, r.route_date, r.driver_id
    into v_route
    from public.routes r
   where r.id = new.route_id;

  if v_route.id is null then
    return new;                                   -- parada orfa: nada a avisar
  end if;

  if v_route.status <> 'published' then
    return new;                                   -- rascunho/cancelada/concluida: motorista ainda nao tem a rota
  end if;

  if v_route.route_date is distinct from current_date
     and v_route.route_date is distinct from current_date + 1 then
    return new;                                   -- rota velha (ou distante): nao avisar
  end if;

  select array_agg(distinct dt.token) into v_tokens
    from public.device_tokens dt
   where dt.user_id = v_route.driver_id;

  if v_tokens is null or coalesce(array_length(v_tokens, 1), 0) = 0 then
    return new;                                   -- motorista sem aparelho registrado: nada a fazer
  end if;

  v_change := case tg_op when 'INSERT' then 'added' else 'moved' end;
  v_type   := 'route_stop_' || v_change;
  v_body   := public.push_route_stop_body(v_change);

  select jsonb_agg(jsonb_build_object(
      'to', t,
      'title', 'Route updated',
      'body', v_body,
      'sound', 'default',
      'data', jsonb_build_object('type', v_type, 'routeId', new.route_id, 'stopId', new.id)
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

revoke all on function public.notify_route_stop_change() from public;

drop trigger if exists route_stops_notify_change on public.route_stops;
create trigger route_stops_notify_change
  after insert or update on public.route_stops
  for each row execute function public.notify_route_stop_change();

commit;
