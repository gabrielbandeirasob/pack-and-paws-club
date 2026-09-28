-- DIA DE DAYCARE POR REGRA (contrato do cliente, escrito em 28/09/2026).
--
-- O cliente escreveu o contrato de cores e disse, com todas as letras: "por via de regra todo boarding
-- vai pro daycare (ou seja eles no início do dia já estarão dentro da van esperando o driver…)" e "no
-- pick up cocoa, por via de regra, ele entra no total de cães mas NÃO entra no total pack, porque o cão
-- não estará no day care".
--
-- Ou seja: todo dia de BOARDING conta como dia de daycare (o cão está na van e vai para a caminhada) —
-- MENOS o dia em que ele CHEGA fora do horário (Cocoa no pick-up), em que ele não passa pelo daycare.
-- Como isso não dá para deduzir das colunas atuais (um dia de meio de hospedagem e uma chegada fora do
-- horário têm a MESMA cara: boarding + transport_required = false), o fato passa a ser guardado:
--
--   goes_to_daycare = true   → o cão passa pelo daycare nesse dia (entra no Total Pack e na van)
--   goes_to_daycare = false  → o cão NÃO passa pelo daycare nesse dia (chegada fora do horário)
--
-- Padrão TRUE para não mexer em nada que já existe (reserva criada no app, série de daycare, hospedagem
-- antiga): "todo boarding vai pro daycare". A importação marca FALSE apenas na chegada fora do horário.

alter table reservations
  add column if not exists goes_to_daycare boolean not null default true;

comment on column reservations.goes_to_daycare is
  'O cão passa pelo daycare nesse dia (entra no Total Pack e na van). FALSE só na CHEGADA da hospedagem fora do horário (Cocoa no pick-up), quando ele não vai ao daycare.';
