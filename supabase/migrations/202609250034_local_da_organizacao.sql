-- 034: SEDE/VAN DA ORGANIZAÇÃO (onde a rota começa e termina) + raio do clock in
--
-- Pedido da OPERAÇÃO do cliente em áudio (25/09/2026):
--   "Chego na van, cheguei na van só quando eu chegar na van que eu sou apto a dar o clock in,
--    só quando eu chegar na van, e aí a posição de cada driver começar vai ser definida pela
--    administradora eu acho né";
--   "termina no yard sempre, aí o yard hoje em dia é uma localização x, mas futuramente meu chefe
--    pensa em mudar para uma outra localização, vou abrir outras localizações, então ele tem que
--    ser apto a botar (...) onde cada driver vai terminar por exemplo".
--
-- Decisões (a mais importante é a OPT-IN):
--  * O conceito novo é LOCAL DA ORGANIZAÇÃO (sede/van/yard): nome + lat/lng + raio de tolerância
--    em metros. MAIS DE UMA sede já é permitida ("futuramente vai ter uma van em cada pedaço da
--    área") e `is_default` diz qual vale quando a rota não escolhe uma. O caso de UMA sede é o
--    caminho normal (o índice parcial garante uma padrão por organização).
--  * ORGANIZAÇÃO SEM NENHUMA SEDE CONTINUA EXATAMENTE COMO HOJE: nada aqui bloqueia, filtra ou
--    muda o fluxo de quem já está em produção — não existe "sede vazia" bloqueando o motorista.
--  * `routes.start_location_id` / `routes.end_location_id` são NULÁVEIS: a rota PODE começar e
--    terminar numa sede específica; sem elas vale a sede padrão da organização; sem sede nenhuma
--    vale a posição do motorista, como sempre foi (comentário vivo em app/(tabs)/driver.tsx).
--  * Raio default 300 m: é a tolerância que o áudio pede ("na localização da van no raio lá").
--    O piso é 25 m (evita raio inútil por erro de digitação) e o teto 5 km.

begin;

-- 1) LOCAL DA ORGANIZAÇÃO (sede / van / yard) -------------------------------
create table if not exists public.organization_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  /** rótulo que o gestor escolhe — ex.: "Van — Palo Alto" */
  name text not null,
  /** van = onde a jornada começa/termina; yard = onde termina a rota de pick up */
  kind text not null default 'van' check (kind in ('van', 'yard', 'other')),
  address_line_1 text,
  city text,
  state text,
  postal_code text,
  latitude double precision not null,
  longitude double precision not null,
  /** raio de tolerância do clock in, em metros */
  radius_meters integer not null default 300,
  /** sede padrão da organização (usada quando a rota não aponta uma) */
  is_default boolean not null default false,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organization_locations_nome_ok') then
    alter table public.organization_locations
      add constraint organization_locations_nome_ok check (length(btrim(name)) between 2 and 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organization_locations_raio_ok') then
    alter table public.organization_locations
      add constraint organization_locations_raio_ok check (radius_meters between 25 and 5000);
  end if;
  -- Coordenada fora da faixa ou (0,0) ("Null Island", endereço não geocodificado) não entra:
  -- pino errado abriria a janela do clock in no lugar errado.
  if not exists (select 1 from pg_constraint where conname = 'organization_locations_coordenada_ok') then
    alter table public.organization_locations
      add constraint organization_locations_coordenada_ok check (
        latitude between -90 and 90
        and longitude between -180 and 180
        and not (latitude = 0 and longitude = 0)
      );
  end if;
end $$;

create index if not exists organization_locations_org_idx
  on public.organization_locations (organization_id, is_default desc, name);

-- UMA sede padrão por organização (só quando `is_default`); as demais convivem normalmente.
create unique index if not exists organization_locations_uma_padrao
  on public.organization_locations (organization_id) where is_default;

create unique index if not exists organization_locations_nome_unico
  on public.organization_locations (organization_id, lower(btrim(name)));

-- updated_at no padrão do projeto
create or replace function public.touch_organization_locations()
returns trigger language plpgsql as $function$
begin
  new.updated_at := now();
  return new;
end
$function$;

drop trigger if exists organization_locations_touch on public.organization_locations;
create trigger organization_locations_touch
  before update on public.organization_locations
  for each row execute function public.touch_organization_locations();

alter table public.organization_locations enable row level security;

-- Gestor: cadastra, edita e apaga as sedes DA PRÓPRIA organização.
drop policy if exists organization_locations_manager_all on public.organization_locations;
create policy organization_locations_manager_all on public.organization_locations
  for all to authenticated
  using (public.is_org_manager(organization_id))
  with check (public.is_org_manager(organization_id));

-- Motorista (e qualquer membro ativo): só LÊ. A leitura é o que permite ao app conferir se ele
-- está no raio da van antes de abrir o clock in — sem isso a trava não teria como funcionar.
drop policy if exists organization_locations_member_read on public.organization_locations;
create policy organization_locations_member_read on public.organization_locations
  for select to authenticated
  using (public.is_org_member(organization_id));

revoke all on public.organization_locations from anon;
grant select, insert, update, delete on public.organization_locations to authenticated;

-- 2) TROCA DA SEDE PADRÃO: uma transação só --------------------------------
-- Por que existe: o índice único parcial (`organization_locations_uma_padrao`) garante UMA padrão.
-- Fazer isso em duas requisições do app ("desmarca tudo, depois marca esta") deixaria a organização
-- sem sede padrão entre uma e outra (dois gestores clicando ao mesmo tempo, rede caindo no meio).
-- Aqui a troca é atômica e o motorista nunca fica com um alvo ambíguo.
create or replace function public.set_default_organization_location(p_location_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_org uuid;
begin
  select organization_id into v_org
  from public.organization_locations
  where id = p_location_id;

  if v_org is null then
    raise exception 'location not found' using errcode = 'P0002';
  end if;
  if not public.is_org_manager(v_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.organization_locations
     set is_default = false
   where organization_id = v_org and id <> p_location_id and is_default;

  update public.organization_locations
     set is_default = true
   where id = p_location_id;
end;
$function$;

revoke all on function public.set_default_organization_location(uuid) from public, anon;
grant execute on function public.set_default_organization_location(uuid) to authenticated;

-- 3) A ROTA pode começar/terminar numa sede específica ---------------------
-- Nulo = "vale o que sempre valeu" (sede padrão da organização, ou a posição do motorista quando
-- não há sede cadastrada). Nenhum caminho existente é alterado.
alter table public.routes
  add column if not exists start_location_id uuid references public.organization_locations(id) on delete set null,
  add column if not exists end_location_id uuid references public.organization_locations(id) on delete set null;

commit;
