-- 021: RASTREIO DO MOTORISTA AO VIVO
--
-- Por que existe: no mercado, rastreio ao vivo é o que o Onfleet faz e nenhum software de creche
-- faz. É também a base do aviso de ETA ao tutor ("a van está a ~10 minutos").
--
-- Decisões:
--  * Tabela própria (uma linha por posição) em vez de "última posição" na rota: dá histórico,
--    permite calcular atraso e não perde dado se dois aparelhos enviam junto.
--  * O motorista só escreve na PRÓPRIA rota e só enquanto ela está em operação (published/completed).
--  * O gestor da organização lê; qualquer membro também (o escritório acompanha).
--  * Sem pg_cron neste projeto (não é extensão disponível): a limpeza é uma função chamada pelo
--    app do gestor, e o aviso de ETA é disparado quando o app do motorista envia a posição.

begin;

create table if not exists public.route_positions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  route_id uuid not null references public.routes(id) on delete cascade,
  driver_id uuid not null references auth.users(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_m double precision,
  speed_mps double precision,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'route_positions_lat_ok') then
    alter table public.route_positions
      add constraint route_positions_lat_ok check (latitude between -90 and 90),
      add constraint route_positions_lng_ok check (longitude between -180 and 180);
  end if;
end $$;

-- A consulta do painel é sempre "as posições desta rota, mais novas primeiro"
create index if not exists route_positions_route_idx
  on public.route_positions (route_id, recorded_at desc);

alter table public.route_positions enable row level security;

-- Motorista: escreve só na própria rota, e só com a rota em operação
drop policy if exists route_positions_driver_insert on public.route_positions;
create policy route_positions_driver_insert on public.route_positions
  for insert to authenticated
  with check (
    driver_id = auth.uid()
    and exists (
      select 1 from public.routes r
      where r.id = route_id
        and r.driver_id = auth.uid()
        and r.organization_id = organization_id
        and r.status in ('published', 'completed')
    )
  );

-- Equipe da organização: lê (escritório acompanha a van)
drop policy if exists route_positions_org_read on public.route_positions;
create policy route_positions_org_read on public.route_positions
  for select to authenticated
  using (public.is_org_member(organization_id));

-- Gestor: apaga rastro antigo (senão a tabela só cresce)
drop policy if exists route_positions_manager_delete on public.route_positions;
create policy route_positions_manager_delete on public.route_positions
  for delete to authenticated
  using (public.is_org_manager(organization_id));

-- Tempo real: o painel do gestor vê a van andando sem ficar consultando
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'route_positions'
  ) then
    alter publication supabase_realtime add table public.route_positions;
  end if;
end $$;

-- Limpeza: cada gestor apaga o rastro antigo da PRÓPRIA organização (chamada pelo app)
create or replace function public.limpar_posicoes_antigas(p_dias integer default 30)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  removidas integer;
begin
  delete from public.route_positions p
   where p.recorded_at < now() - make_interval(days => greatest(coalesce(p_dias, 30), 1))
     and public.is_org_manager(p.organization_id);
  get diagnostics removidas = row_count;
  return removidas;
end;
$function$;

commit;
