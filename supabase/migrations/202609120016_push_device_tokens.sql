-- 016: notificacoes push para o motorista
--
-- Objetivo: quando o gestor publica (ou cancela) uma rota, o motorista recebe um push
-- no celular em segundos, sem abrir o app.
--
-- Decisoes:
--  * O token do aparelho e dado sensivel: cada usuario so enxerga e grava O PROPRIO token
--    (RLS `user_id = auth.uid()`), na propria organizacao (helper SECURITY DEFINER, mesmo
--    padrao de is_org_manager, para nao recursar no RLS de organization_members).
--  * O envio NAO passa pelo app: trigger no banco usa pg_net -> Expo Push API. Assim o push
--    sai mesmo se o gestor fechar o app logo depois de publicar.
--  * Mensagem NAO carrega dado sensivel (nada de codigo de portao/lockbox — politica do
--    projeto). So a contagem de paradas e o id da rota; o conteudo abre dentro do app.

create extension if not exists pg_net with schema extensions;

-- Helper: o usuario tem vinculo ativo nesta organizacao? (SECURITY DEFINER quebra a recursao de RLS)
create or replace function public.user_in_org(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null,
  platform text not null default 'ios' check (platform in ('ios', 'android', 'web')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (token)
);

create index if not exists device_tokens_user_idx on public.device_tokens (user_id);
create index if not exists device_tokens_org_idx on public.device_tokens (organization_id);

alter table public.device_tokens enable row level security;

-- Cada usuario gerencia somente o proprio aparelho (inserir, atualizar token, remover ao sair).
drop policy if exists device_tokens_own_all on public.device_tokens;
create policy device_tokens_own_all on public.device_tokens
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.user_in_org(organization_id));

-- Envio do push na publicacao / cancelamento da rota.
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
    v_title := 'Nova rota publicada';
  elsif new.status = 'cancelled' and old.status = 'published' then
    v_type := 'route_cancelled';
    v_title := 'Rota cancelada';
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

  if v_type = 'route_published' then
    v_body := case
      when v_stops = 1 then '1 parada hoje. Toque para abrir.'
      when v_stops > 1 then v_stops::text || ' paradas hoje. Toque para abrir.'
      else 'Toque para abrir sua rota.'
    end;
  else
    v_body := 'A rota de hoje foi cancelada pelo escritorio.';
  end if;

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

drop trigger if exists routes_notify_driver on public.routes;
create trigger routes_notify_driver
  after update on public.routes
  for each row
  execute function public.notify_route_status();
