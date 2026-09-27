-- 035: DIA DA OPERAÇÃO — fechamento do dia, to-do list e PACK (caminhada)
--
-- Pedido da OPERAÇÃO do cliente, ditado em áudio (26/09/2026):
--   * "os indicadores diários, na dashboard vão ter 5 quadradinhos (…) o Total Pack (…) vai ser um
--      botão clicável, você clica, ele vai puxar todos os cachorros que estão no calendário (…) e o
--      administrador vai ter como clicar num X para deletar aquele cachorro no dia — é aquele pack,
--      no caso, porque o pack na verdade é a quantidade de cães e quais cães vão para a caminhada,
--      que vão para o yard";
--   * "aquele faturamento vai ser editável pela pessoa, e sempre que acabar o dia ele vai ter salvo,
--      você vai ser capaz de clicar lá, dia tal, e ver todas essas informações do dia tal";
--   * "na dashboard principal, também o administrador tem que ter, no final do dia, dois locais que
--      ele consiga digitar: um vai ser ideia da foto do dia e o outro vai ser local da caminhada";
--   * "Today's Progress (…) a gente vai incluir uma to-do list que vai ser editável, o cara vai
--      clicar, vai escrever o que ele tem que fazer no dia e vai gerar tipo aquela bolinha";
--   * "o administrador, um dia antes, vai selecionar qual cachorro vai com qual driver na hora da
--      caminhada (…) você consegue remover o cachorro que não vai estar no pack do dia e você
--      consegue assinar lá esse cachorro para um dos drivers (…) para a caminhada, NÃO na rota,
--      porque às vezes o driver vai pegar o cachorro X, mas ele não vai caminhar o cachorro X".
--
-- Decisões registradas aqui:
--  * TUDO é por DIA LOCAL da organização (`date`), como o resto do app (reservas, rotas);
--  * FATURAMENTO em CENTAVOS inteiros (`revenue_cents`) — dinheiro não passa por ponto flutuante;
--    nulo = o gestor ainda não digitou (não é zero);
--  * PACK: `pack_entries` guarda só o que o escritório MEXEU. Sem linha, todo cão do dia entra no
--    pack (o padrão é "todos"); com `in_pack = false`, o cão foi tirado do pack DAQUELE dia;
--  * QUEM CAMINHA é um MEMBRO ativo da organização (`walker_id`) — pode ser diferente de quem pega
--    na rota, que é o pedido literal do áudio;
--  * nada aqui apaga reserva, evento do Google ou rota: o X do pack tira o cão da CAMINHADA do dia.

begin;

-- 1) FECHAMENTO DO DIA (faturamento + os dois campos escritos no fim do dia) ------
create table if not exists public.daily_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  day date not null,
  /** Faturamento do dia digitado pelo gestor, em CENTAVOS (US$). null = não digitado. */
  revenue_cents integer,
  /** Local da caminhada do dia (texto livre — o escritório escreve onde a caminhada foi). */
  walk_location text,
  /** Ideia/legenda da foto do dia (texto livre). */
  photo_idea text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_plans_faturamento_ok check (revenue_cents is null or revenue_cents >= 0),
  constraint daily_plans_um_por_dia unique (organization_id, day)
);

create index if not exists daily_plans_org_dia_idx on public.daily_plans (organization_id, day desc);

-- 2) TO-DO LIST DO DIA -----------------------------------------------------------
create table if not exists public.daily_todos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  day date not null,
  text text not null,
  done boolean not null default false,
  /** ordem na lista (o app grava 0, 1, 2… na ordem em que foram digitados) */
  position integer not null default 0,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'daily_todos_texto_ok') then
    alter table public.daily_todos
      add constraint daily_todos_texto_ok check (length(btrim(text)) between 1 and 200);
  end if;
end $$;

create index if not exists daily_todos_org_dia_idx
  on public.daily_todos (organization_id, day, position, created_at);

-- 3) PACK DO DIA (caminhada): quem sai do pack e quem caminha --------------------
create table if not exists public.pack_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  day date not null,
  dog_id uuid not null references public.dogs(id) on delete cascade,
  /** false = o escritório tirou este cão do pack (caminhada) deste dia. */
  in_pack boolean not null default true,
  /** Membro da organização que CAMINHA com o cão neste dia (≠ de quem pega na rota). */
  walker_id uuid references auth.users(id) on delete set null,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pack_entries_um_por_cao_dia unique (organization_id, day, dog_id)
);

create index if not exists pack_entries_org_dia_idx on public.pack_entries (organization_id, day);
create index if not exists pack_entries_walker_idx on public.pack_entries (organization_id, day, walker_id);

-- 4) updated_at no padrão do projeto --------------------------------------------
create or replace function public.touch_daily_plans()
returns trigger language plpgsql as $function$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end
$function$;

drop trigger if exists daily_plans_touch on public.daily_plans;
create trigger daily_plans_touch
  before update on public.daily_plans
  for each row execute function public.touch_daily_plans();

create or replace function public.touch_daily_todos()
returns trigger language plpgsql as $function$
begin
  new.updated_at := now();
  return new;
end
$function$;

drop trigger if exists daily_todos_touch on public.daily_todos;
create trigger daily_todos_touch
  before update on public.daily_todos
  for each row execute function public.touch_daily_todos();

create or replace function public.touch_pack_entries()
returns trigger language plpgsql as $function$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end
$function$;

drop trigger if exists pack_entries_touch on public.pack_entries;
create trigger pack_entries_touch
  before update on public.pack_entries
  for each row execute function public.touch_pack_entries();

-- 5) RLS: gestor escreve, membro ativo lê ---------------------------------------
alter table public.daily_plans enable row level security;
alter table public.daily_todos enable row level security;
alter table public.pack_entries enable row level security;

drop policy if exists daily_plans_manager_all on public.daily_plans;
create policy daily_plans_manager_all on public.daily_plans
  for all to authenticated
  using (public.is_org_manager(organization_id))
  with check (public.is_org_manager(organization_id));

drop policy if exists daily_plans_member_read on public.daily_plans;
create policy daily_plans_member_read on public.daily_plans
  for select to authenticated
  using (public.is_org_member(organization_id));

drop policy if exists daily_todos_manager_all on public.daily_todos;
create policy daily_todos_manager_all on public.daily_todos
  for all to authenticated
  using (public.is_org_manager(organization_id))
  with check (public.is_org_manager(organization_id));

drop policy if exists daily_todos_member_read on public.daily_todos;
create policy daily_todos_member_read on public.daily_todos
  for select to authenticated
  using (public.is_org_member(organization_id));

drop policy if exists pack_entries_manager_all on public.pack_entries;
create policy pack_entries_manager_all on public.pack_entries
  for all to authenticated
  using (public.is_org_manager(organization_id))
  with check (public.is_org_manager(organization_id));

-- O MOTORISTA lê o pack: é assim que ele vê a lista de caminhada do dia dele.
drop policy if exists pack_entries_member_read on public.pack_entries;
create policy pack_entries_member_read on public.pack_entries
  for select to authenticated
  using (public.is_org_member(organization_id));

revoke all on public.daily_plans from anon;
revoke all on public.daily_todos from anon;
revoke all on public.pack_entries from anon;
grant select, insert, update, delete on public.daily_plans to authenticated;
grant select, insert, update, delete on public.daily_todos to authenticated;
grant select, insert, update, delete on public.pack_entries to authenticated;

commit;
