-- AUDITORIA 02/10/2026 — PENDENCIA #1: dois gestores se sobrescrevendo no DIA DA OPERACAO
--
-- ACHADO (frente de DADOS): `daily_plans` (walk location, foto do dia, faturamento) e `pack_entries`
-- (X do pack e quem caminha) nao tinham versao. Dois aparelhos salvando o mesmo dia se sobrescreviam
-- EM SILENCIO: quem salvasse por ultimo vencia e ninguem era avisado.
--
-- CORRECAO: o banco passa a contar versao sozinho (`lock_version`) e recusa gravacao feita em cima de
-- versao velha. O app que entende de versao manda `lock_version_base` = a versao que ele LEU ao abrir a
-- tela; se outro aparelho ja gravou, o gatilho recusa com 'stale_day' e a tela pede para recarregar.
--
-- COMPATIVEL COM A BUILD 107 (que ja esta no celular do cliente): quem NAO manda `lock_version_base`
-- (todas as gravacoes antigas) continua funcionando como antes — o banco so cuida da versao. Nada quebra.

alter table public.daily_plans  add column if not exists lock_version integer not null default 1;
alter table public.daily_plans  add column if not exists lock_version_base integer;
alter table public.pack_entries add column if not exists lock_version integer not null default 1;
alter table public.pack_entries add column if not exists lock_version_base integer;

create or replace function public.dia_sem_sobrescrita() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.lock_version := greatest(coalesce(new.lock_version, 1), 1);
    new.lock_version_base := null;
    return new;
  end if;
  -- Gravacao inteligente de versao: so quem manda `lock_version_base` entra na conferencia.
  if new.lock_version_base is not null and new.lock_version_base <> old.lock_version then
    raise exception 'Another device changed this day while you were editing (day version %, your copy was %). Reload the screen and save again.', old.lock_version, new.lock_version_base
      using errcode = 'P0001', hint = 'stale_day';
  end if;
  new.lock_version := old.lock_version + 1;
  new.lock_version_base := null;
  return new;
end $$;

drop trigger if exists daily_plans_sem_sobrescrita on public.daily_plans;
create trigger daily_plans_sem_sobrescrita before insert or update on public.daily_plans
for each row execute function public.dia_sem_sobrescrita();

drop trigger if exists pack_entries_sem_sobrescrita on public.pack_entries;
create trigger pack_entries_sem_sobrescrita before insert or update on public.pack_entries
for each row execute function public.dia_sem_sobrescrita();
