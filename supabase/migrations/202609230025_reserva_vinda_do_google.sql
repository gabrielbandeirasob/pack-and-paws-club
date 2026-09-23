-- 025: RESERVA QUE NASCE NO GOOGLE CALENDAR (importacao Google -> app)
--
-- Pedido do dono (23/09/2026): "eu gostaria que ao sincronizar as datas que estao marcadas no
-- calendario do cliente fossem para o aplicativo".
--
-- Contexto: ate aqui o espelho era de UMA VIA (app -> Google). Evento criado direto no Google era
-- IGNORADO (nao tem a marca do app), e evento nosso editado no Google era SOBRESCRITO na proxima
-- sincronizacao. Estas duas colunas sao o que faltava para o caminho de volta:
--
--   google_event_id -> liga a reserva ao evento que a originou. E o que impede o ping-pong:
--                      a reserva importada NAO volta para o Google como evento novo (o espelho
--                      passa a ATUALIZAR esse mesmo evento), e a importacao reconhece o que ja veio.
--   source          -> 'google' = nasceu no Google (la manda: se mudarem a data, a reserva muda; se
--                      apagarem o evento, a reserva e cancelada); 'app' = nasceu no app (app manda).
--                      Sem essa separacao, cada sincronizacao desfaz a outra.
--
-- Idempotencia: indice unico parcial por (organizacao, evento) — reexecutar a importacao nao cria
-- reserva duplicada para o mesmo evento.

alter table public.reservations
  add column if not exists google_event_id text;

alter table public.reservations
  add column if not exists source text not null default 'app';

-- A coluna `source` tem de aceitar somente os dois mundos (evita valor inventado por engano).
alter table public.reservations
  drop constraint if exists reservations_source_ok;
alter table public.reservations
  add constraint reservations_source_ok check (source in ('app', 'google'));

-- Um evento do Google gera no maximo UMA reserva por organizacao.
create unique index if not exists reservations_google_event_unico
  on public.reservations (organization_id, google_event_id)
  where google_event_id is not null;

-- Busca por evento (a importacao procura a reserva ligada ao evento).
create index if not exists reservations_google_event_idx
  on public.reservations (google_event_id)
  where google_event_id is not null;

comment on column public.reservations.google_event_id is
  'Id do evento do Google Calendar que originou a reserva (importacao). NULL = reserva so do app.';
comment on column public.reservations.source is
  'app = criada no aplicativo (app manda no espelho); google = criada no Google Calendar (Google manda).';

-- A SERIE (dias da semana) tambem pode nascer no Google Calendar ("toda segunda e quarta"), e sem
-- estas duas colunas o espelho criaria um evento NOVO para ela (o vínculo nao existiria do lado da
-- serie). Mesma regra da reserva avulsa.
alter table public.recurring_schedules
  add column if not exists google_event_id text;

alter table public.recurring_schedules
  add column if not exists source text not null default 'app';

alter table public.recurring_schedules
  drop constraint if exists recurring_schedules_source_ok;
alter table public.recurring_schedules
  add constraint recurring_schedules_source_ok check (source in ('app', 'google'));

create unique index if not exists recurring_schedules_google_event_unico
  on public.recurring_schedules (organization_id, google_event_id)
  where google_event_id is not null;

create index if not exists recurring_schedules_google_event_idx
  on public.recurring_schedules (google_event_id)
  where google_event_id is not null;

comment on column public.recurring_schedules.google_event_id is
  'Id do evento do Google Calendar que originou a serie (importacao). NULL = serie so do app.';
comment on column public.recurring_schedules.source is
  'app = criada no aplicativo; google = criada no Google Calendar (Google manda).';

select column_name, data_type, column_default, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'reservations'
   and column_name in ('google_event_id', 'source')
 order by column_name;
