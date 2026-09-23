-- 024: JORNADA DO MOTORISTA (clock in / clock out) + AVISO DE ETA AO TUTOR
--
-- Pedido do cliente em áudio (16/09/2026), guardado em sugestoes-ios/:
--   "do driver, mano, clock in e clock out... quando o driver chegar, ele tem que dar o clock in
--    e depois o clock out";
--   "você clica pra mandar mensagem pro cliente... sem ser pelo Twilio, sem ser um disparo...
--    abre seu messenger pra mandar o ETA".
--
-- Decisões (as mesmas da especificação 1.1, aprovada pelo Gabriel em 23/09):
--  * A jornada é DEDUZIDA dos eventos da rota (primeira chegada → última conclusão) — o motorista
--    não precisa apertar nada. Clock in/out manual existe como EXCEÇÃO (esqueceu, imprevisto),
--    sempre com motivo, e o desenho diz "manual" na cara.
--  * Horário carimbado NO SERVIDOR: o carimbo oficial é `status_updated_at` (now() do banco). O
--    horário do EVENTO aceita a hora do aparelho quando ela é plausível (registro feito sem
--    sinal e sincronizado depois) — assim a jornada não fica com buraco de horas, e o gestor
--    pode ver as duas marcas. Hora no futuro ou absurda (> 24 h atrás) é recusada.
--  * Nada de SMS automático: a mensagem sai do aparelho do motorista (SMS ou WhatsApp), com o
--    texto pronto. O que o app registra é o AVISO (hora + fase), para o gestor acompanhar.

begin;

-- 1) Marcos de cada parada, com carimbo do servidor -------------------------
alter table public.route_stops
  add column if not exists arrived_at timestamptz,
  add column if not exists picked_up_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists skipped_at timestamptz,
  add column if not exists status_updated_at timestamptz,
  add column if not exists eta_notice_at timestamptz,
  add column if not exists eta_notice_kind text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'route_stops_eta_kind_ok') then
    alter table public.route_stops
      add constraint route_stops_eta_kind_ok
      check (eta_notice_kind is null or eta_notice_kind in ('pickup', 'dropoff'));
  end if;
end $$;

-- Histórico que já existia: usa updated_at como melhor aproximação (não inventa hora).
update public.route_stops set arrived_at   = coalesce(arrived_at, updated_at)
 where arrived_at is null and status in ('arrived', 'picked_up', 'completed');
update public.route_stops set picked_up_at = coalesce(picked_up_at, updated_at)
 where picked_up_at is null and status in ('picked_up', 'completed');
update public.route_stops set completed_at = coalesce(completed_at, updated_at)
 where completed_at is null and status = 'completed';
update public.route_stops set skipped_at   = coalesce(skipped_at, updated_at)
 where skipped_at is null and status = 'skipped';
update public.route_stops set status_updated_at = coalesce(status_updated_at, updated_at)
 where status_updated_at is null and status <> 'pending';

-- Hora do evento: o app PODE mandar a hora do toque (parada registrada sem sinal e sincronizada
-- depois), mas ela só vale se for plausível — no futuro ou mais de 24 h velha não passa. O
-- carimbo oficial (`status_updated_at`) é sempre a hora do servidor, então a diferença entre os
-- dois denuncia um registro que chegou muito depois do fato.
create or replace function public.hora_plausivel(p_quando timestamptz)
returns timestamptz
language sql
stable
as $function$
  select case
    when p_quando is null then now()
    when p_quando > now() then now()
    when p_quando < now() - interval '24 hours' then now()
    else p_quando
  end;
$function$;

create or replace function public.route_stops_stamp_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.status is distinct from old.status then
    -- Carimbo oficial: sempre a hora do SERVIDOR.
    new.status_updated_at := now();

    if new.status = 'arrived'   then new.arrived_at   := public.hora_plausivel(new.arrived_at); end if;
    if new.status = 'picked_up' then new.picked_up_at := public.hora_plausivel(new.picked_up_at); end if;
    if new.status = 'completed' then new.completed_at := public.hora_plausivel(new.completed_at); end if;
    if new.status = 'skipped'   then new.skipped_at   := public.hora_plausivel(new.skipped_at); end if;
  end if;

  -- Furo fechado (achado no teste de 23/09): o app NÃO precisa trocar o status para mandar hora de
  -- evento. Sem esta parte, um aparelho com relógio adiantado gravava "chegou às 12h" às 7h — e a
  -- jornada deduzida sairia errada. Toda hora de evento que MUDA passa pela validação; hora antiga
  -- que já estava gravada (e não foi tocada) fica como está, para não reescrever histórico.
  if new.arrived_at   is distinct from old.arrived_at   then new.arrived_at   := public.hora_plausivel(new.arrived_at);   end if;
  if new.picked_up_at is distinct from old.picked_up_at then new.picked_up_at := public.hora_plausivel(new.picked_up_at); end if;
  if new.completed_at is distinct from old.completed_at then new.completed_at := public.hora_plausivel(new.completed_at); end if;
  if new.skipped_at   is distinct from old.skipped_at   then new.skipped_at   := public.hora_plausivel(new.skipped_at);   end if;

  return new;
end
$function$;

drop trigger if exists route_stops_stamp on public.route_stops;
create trigger route_stops_stamp
  before update on public.route_stops
  for each row execute function public.route_stops_stamp_status();

-- 2) Jornada manual (exceção) ----------------------------------------------
create table if not exists public.driver_shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  driver_id uuid not null references auth.users(id) on delete cascade,
  route_id uuid references public.routes(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  /** motivo do registro manual (obrigatório: é exceção, não rotina) */
  start_reason text not null,
  end_reason text,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'driver_shifts_ordem_ok') then
    alter table public.driver_shifts
      add constraint driver_shifts_ordem_ok check (ended_at is null or ended_at >= started_at);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'driver_shifts_motivo_ok') then
    alter table public.driver_shifts
      add constraint driver_shifts_motivo_ok check (length(btrim(start_reason)) between 3 and 200);
  end if;
end $$;

-- Uma jornada aberta por vez, por motorista (a segunda tentativa falha em vez de duplicar).
create unique index if not exists driver_shifts_uma_aberta
  on public.driver_shifts (driver_id) where ended_at is null;

create index if not exists driver_shifts_org_dia_idx
  on public.driver_shifts (organization_id, started_at desc);

alter table public.driver_shifts enable row level security;

-- Motorista: cria e fecha a PRÓPRIA jornada (e lê as próprias)
drop policy if exists driver_shifts_driver_insert on public.driver_shifts;
create policy driver_shifts_driver_insert on public.driver_shifts
  for insert to authenticated
  with check (
    driver_id = auth.uid()
    and public.user_in_org(organization_id)
    and (route_id is null or exists (
      select 1 from public.routes r
      where r.id = route_id and r.driver_id = auth.uid() and r.organization_id = organization_id
    ))
  );

drop policy if exists driver_shifts_driver_update on public.driver_shifts;
create policy driver_shifts_driver_update on public.driver_shifts
  for update to authenticated
  using (driver_id = auth.uid())
  with check (driver_id = auth.uid());

drop policy if exists driver_shifts_read on public.driver_shifts;
create policy driver_shifts_read on public.driver_shifts
  for select to authenticated
  using (driver_id = auth.uid() or public.is_org_member(organization_id));

-- updated_at no padrão do projeto
create or replace function public.touch_driver_shifts()
returns trigger language plpgsql as $function$
begin
  new.updated_at := now();
  return new;
end
$function$;

drop trigger if exists driver_shifts_touch on public.driver_shifts;
create trigger driver_shifts_touch
  before update on public.driver_shifts
  for each row execute function public.touch_driver_shifts();

-- 3) Aviso de ETA: registra hora (server) + fase ---------------------------
-- Roda como o usuário (SEM security definer): a política de UPDATE do motorista em route_stops
-- é quem autoriza. Motorista de outra rota recebe "parada não encontrada".
create or replace function public.mark_eta_notice(p_stop uuid, p_kind text)
returns timestamptz
language plpgsql
set search_path to 'public'
as $function$
declare
  quando timestamptz;
begin
  if p_kind not in ('pickup', 'dropoff') then
    raise exception 'fase inválida: %', p_kind using errcode = '22023';
  end if;

  update public.route_stops
     set eta_notice_at = now(), eta_notice_kind = p_kind
   where id = p_stop
  returning eta_notice_at into quando;

  if quando is null then
    raise exception 'parada não encontrada (ou não é sua)' using errcode = 'P0002';
  end if;
  return quando;
end
$function$;

revoke execute on function public.mark_eta_notice(uuid, text) from public, anon;
grant execute on function public.mark_eta_notice(uuid, text) to authenticated, service_role;

commit;
