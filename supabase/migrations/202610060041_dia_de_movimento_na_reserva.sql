-- 06/10/2026 — DIA DE MOVIMENTO da hospedagem gravado na reserva.
--
-- Pedido do dono (06/10/2026), a partir da simulação do print do calendário do CLIENTE daquele dia:
-- *"a Scarlet vai poder entrar no pickup do day care normalmente e ela não vai poder entrar no drop off,
-- pois vai virar boarding"*.
--
-- Contexto: no calendário do escritório, o dia de CHEGADA/SAÍDA da hospedagem é pintado em
-- verde-claro/avocado e o dia do MEIO (o cão está no hotel) em verde. O app já lê essa diferença na
-- importação (`movimentaOCao`, em `features/calendar/googleColors.ts`), mas o `transport_required`
-- resultante era o MESMO nos dois casos — no dia de hotel o app restaura a van quando o calendário não
-- marca chegada/saída — e o Dispatch tratava os dois como "já está na van". Resultado medido no print de
-- 06/10/2026: a Scarlet (barra azul de day care + barra avocado com chegada) ficava FORA da fila de
-- pickup, quando ela está na casa e quem busca é o motorista.
--
-- `movement_day = true` = aquele dia da hospedagem é o dia de CHEGADA/SAÍDA (o cão anda de van, é parada
-- normal da rota e NÃO tem entrega). `false` (default) = dia de hotel/estadia — o cão já está lá dentro,
-- continua "já está na van" como hoje. O default `false` é de propósito: nada muda para as reservas que
-- já existem nem para calendário que não usa a convenção.
alter table public.reservations
  add column if not exists movement_day boolean not null default false;

comment on column public.reservations.movement_day is
  'Dia de CHEGADA/SAIDA da hospedagem (avocado no calendario do escritorio): o cao anda de van e e parada normal da rota (nao entra em "ja esta na van"). false = dia de hotel/estadia ou reserva que nao vem do calendario.';

-- Conferência desta migração (rodar depois de aplicar):
--   select column_name, data_type, column_default, is_nullable
--     from information_schema.columns
--    where table_name = 'reservations' and column_name = 'movement_day';
--   esperado: movement_day | boolean | false | NO
