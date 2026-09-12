-- 019: a mensagem do aviso estava errada em dois pontos (achados em 12/09/2026)
--
--  1) DIZIA "hoje" PARA ROTA DE QUALQUER DATA. O app mostra a rota do dia
--     (`app/(tabs)/driver.tsx` filtra `route_date = hoje`), entao um aviso de rota de 09/09 as 21h
--     mandava o motorista procurar uma rota que nao estava la.
--  2) ESTAVA EM PORTUGUES. O app e do cliente em San Francisco e toda a interface esta em ingles;
--     a notificacao chegava em portugues para um motorista americano.
--
-- A frase agora sai de uma funcao PURA (`push_route_body`), o que a torna testavel direto por SQL
-- em `scripts/db-flows-test.mjs` - antes estava embutida dentro do gatilho e ninguem conseguia verificar.

drop function if exists public.push_route_body(text, date, integer);

create or replace function public.push_route_body(
  p_tipo text,
  p_data date,
  p_paradas integer
)
returns text
language sql
stable
as $$
  select case
    when p_tipo = 'route_cancelled' then
      case
        when p_data = current_date then 'Your route for today was cancelled.'
        when p_data = current_date + 1 then 'Your route for tomorrow was cancelled.'
        else 'Your route for ' || to_char(p_data, 'Mon FMDD') || ' was cancelled.'
      end
    when coalesce(p_paradas, 0) <= 0 then
      case
        when p_data = current_date then 'Tap to open today''s route.'
        when p_data = current_date + 1 then 'Tap to open tomorrow''s route.'
        else 'Tap to open your route for ' || to_char(p_data, 'Mon FMDD') || '.'
      end
    else
      (case when p_paradas = 1 then '1 stop' else p_paradas::text || ' stops' end)
      ||
      case
        when p_data = current_date then ' today.'
        when p_data = current_date + 1 then ' tomorrow.'
        else ' on ' || to_char(p_data, 'Mon FMDD') || '.'
      end
      || ' Tap to open.'
  end;
$$;

create or replace function public.notify_route_status()
returns trigger
language plpgsql
security definer
set search_path = public, net, extensions
as $$
declare
  v_tokens text[];
  v_stops int;
  v_title text;
  v_body text;
  v_type text;
  v_msgs jsonb;
begin
  if new.status = 'published' and coalesce(old.status, '') <> 'published' then
    v_type := 'route_published';
    v_title := 'New route published';
  elsif new.status = 'cancelled' and old.status = 'published' then
    v_type := 'route_cancelled';
    v_title := 'Route cancelled';
  else
    return new;
  end if;

  select count(*) into v_stops from route_stops where route_id = new.id;

  select array_agg(distinct dt.token) into v_tokens
  from device_tokens dt
  where dt.user_id = new.driver_id;

  if v_tokens is null or coalesce(array_length(v_tokens, 1), 0) = 0 then
    return new; -- sem aparelho registrado: nada a fazer
  end if;

  v_body := public.push_route_body(v_type, new.route_date, v_stops);

  select jsonb_agg(jsonb_build_object(
    'to', t,
    'title', v_title,
    'body', v_body,
    'sound', 'default',
    'data', jsonb_build_object('type', v_type, 'routeId', new.id)
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
