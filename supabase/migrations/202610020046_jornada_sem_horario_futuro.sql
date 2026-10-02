-- A JORNADA MANUAL NÃO PODE TER HORÁRIO NO FUTURO.
--
-- 🪤 ACHADO DA VISTORIA (02/10/2026): o horário da jornada manual (clock in/out que o motorista digita
-- quando o registro automático falha) é o número que PAGA o motorista — e ele vinha do relógio do
-- APARELHO (`new Date().toISOString()` no app). Quem quisesse podia adiantar o relógio e inflar a
-- jornada; e um aparelho com relógio errado gravava horas que nunca existiram.
--
-- Regra do negócio (mantida): o horário manual é a PALAVRA do motorista e pode ser no PASSADO (foi
-- quando ele realmente começou/fechou). O que o aparelho não pode é gravar no FUTURO — o servidor corta
-- para o "agora" dele. `created_at` continua sendo o carimbo do servidor (default `now()`), que já
-- existia e serve de trilha de auditoria: se `started_at` for igual a `created_at`, o servidor cortou.

create or replace function public.driver_shifts_clamp_tempo()
returns trigger
language plpgsql
as $$
begin
  if new.started_at is not null and new.started_at > now() then
    new.started_at := now();
  end if;
  if new.ended_at is not null and new.ended_at > now() then
    new.ended_at := now();
  end if;
  -- Fim antes do início não existe: encosta no início.
  if new.ended_at is not null and new.started_at is not null and new.ended_at < new.started_at then
    new.ended_at := new.started_at;
  end if;
  return new;
end;
$$;

drop trigger if exists driver_shifts_clamp on public.driver_shifts;
create trigger driver_shifts_clamp
before insert or update on public.driver_shifts
for each row execute function public.driver_shifts_clamp_tempo();
