-- A perna da ENTREGA também precisa do seu tempo (conferência do dono, 01/10/2026 — item 5).
--
-- O `travel_seconds` da migração 041 guarda a perna que CHEGA na parada na ordem da BUSCA. A tarde usa
-- outra ordem (a `dropoff_sequence`), então a perna da entrega precisa da coluna dela — senão o ETA da
-- entrega continuaria sendo linha reta, que é exatamente a queixa do cliente.
alter table public.route_stops add column if not exists dropoff_travel_seconds integer;
