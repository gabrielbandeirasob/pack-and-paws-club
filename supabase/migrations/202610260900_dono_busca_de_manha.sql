-- DONO BUSCA DE MANHÃ (☀️) — pedido do cliente em áudio (26/10/2026), encaminhado pelo dono:
-- *"a última lá da casinha, ela foi embora de manhã cedo. E os outros dois, o Lucky, o Levi Miller, vão
-- embora à tarde. Como que a gente consegue fazer pra ele ter essa leitura?"*
--
-- O calendário é a cabeça (exigência do cliente): a informação tem de vir de lá. O horário do bloco não
-- serve — o escritório confirmou em 26/10/2026 que a hora do evento 🏠 é "só um marcador do dia". Então o
-- canal é o TÍTULO, no mesmo lugar onde ele já escreve o 🏠:
--
--   Lucky 🏠        → vai para casa à tarde  → entra na entrega (a van leva)
--   Indie 🏠 ☀️     → o tutor busca de manhã  → conta no dia, mas fora das duas pernas da rota
--
-- A coluna guarda a marca no DIA da reserva (a linha de um dia que representa o movimento), porque quem
-- decide a rota é o dia, não a estadia.
alter table public.reservations
  add column if not exists owner_pickup boolean not null default false;

comment on column public.reservations.owner_pickup is
  'Tutor busca de manhã (☀️ no título do evento de saída): o cão conta no dia, mas não pede van — fora do pickup e da entrega. Ver features/calendar/dayMath.ts (ownerPickupToday).';

-- Conferência sugerida depois de aplicar:
--   select column_name, data_type, column_default, is_nullable
--     from information_schema.columns
--    where table_name = 'reservations' and column_name = 'owner_pickup';
--   esperado: owner_pickup | boolean | false | NO
