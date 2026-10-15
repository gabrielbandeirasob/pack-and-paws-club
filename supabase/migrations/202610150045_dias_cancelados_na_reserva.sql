-- Dias cancelados DENTRO de uma reserva (vermelho do escritório em um dia da barra).
--
-- Pedido do dono (14/10/2026, item 2 do relatório da sincronização): o vermelho num dia de uma barra de
-- daycare cancelava a reserva INTEIRA — o cão sumia também dos dias que ninguém cancelou, inclusive
-- passados. Agora a linha continua `confirmed` e guarda os dias que o escritório cancelou; o dia não
-- aparece na agenda, no Total Pack nem na fila do Dispatch (features/calendar/dayMath.ts), e o resumo
-- semanal marca o dia como cancelado (features/dashboard/cancelledDays.ts).
--
-- Aditiva e com default vazio: toda reserva que já existe se comporta exatamente como antes.
alter table public.reservations
  add column if not exists cancelled_days date[] not null default '{}'::date[];

comment on column public.reservations.cancelled_days is
  'Dias desta reserva cancelados pelo VERMELHO no dia (barra continua ativa nos demais dias).';
