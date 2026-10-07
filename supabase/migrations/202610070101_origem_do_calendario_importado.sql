-- 07/10/2026, 12:50 UTC: a troca de agenda cancelou Enso, Oreo e Rani por ausência.
-- Guardar a origem permite cancelar só quando o evento some DAQUELA agenda.
-- Sem backfill: a agenda escolhida hoje não comprova a origem das reservas antigas.
alter table public.reservations add column if not exists google_calendar_id text;
alter table public.recurring_schedules add column if not exists google_calendar_id text;

comment on column public.reservations.google_calendar_id is
  'Agenda de origem do vínculo Google. NULL = origem desconhecida, não cancelar por ausência.';
comment on column public.recurring_schedules.google_calendar_id is
  'Agenda de origem do vínculo Google. NULL = origem desconhecida, não cancelar por ausência.';
