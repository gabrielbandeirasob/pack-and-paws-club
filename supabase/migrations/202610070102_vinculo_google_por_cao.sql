-- 07/10/2026: Teddy/Billy gerava duas reservas, mas apenas Teddy tinha vínculo.
-- Medido pelo dono: excluir cancelava 1; mover atualizava Teddy e duplicava Billy.
-- APLICAR ANTES de subir o app e a função: os dois passam a gravar o mesmo evento.
-- A identidade continua única por cão, inclusive nas séries; não altera route_stops.
-- O legado é recuperado pelo plano apenas com tutor por ID, período e agenda conhecida.
begin;
drop index if exists public.reservations_google_event_unico;
create unique index reservations_google_event_unico
  on public.reservations (organization_id, google_event_id, dog_id)
  where google_event_id is not null;
drop index if exists public.recurring_schedules_google_event_unico;
create unique index recurring_schedules_google_event_unico
  on public.recurring_schedules (organization_id, google_event_id, dog_id)
  where google_event_id is not null;
commit;
