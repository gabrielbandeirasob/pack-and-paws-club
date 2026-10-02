-- A POSIÇÃO DO MOTORISTA CONTINUA ACEITA DEPOIS DO ✓ DONE (rota `completed`).
--
-- 🪤 ACHADO DA VISTORIA (02/10/2026): o `WITH CHECK` de `driver_locations_driver_all` exigia
-- `r.status = 'published'`. Quando o gestor fechava a rota, a van **parava de andar no mapa do
-- escritório** — e o app do motorista nem percebia, porque a escrita de posição era "fire and forget"
-- (o erro não era lido). Dois gestores relataram que o "acompanhamento ao vivo" simplesmente congelava.
--
-- O acompanhamento ao vivo existe para o DIA: depois do ✓ Done o motorista ainda está na rua
-- (entregando os últimos cães / voltando para a van). Aceitar também `completed` mantém o mapa honesto
-- e não afrouxa nada além disso: a policy segue exigindo que a linha seja do PRÓPRIO motorista
-- (`driver_id = auth.uid()`) e de uma rota DELE.

drop policy if exists driver_locations_driver_all on public.driver_locations;
create policy driver_locations_driver_all on public.driver_locations
for all to authenticated
using (driver_id = auth.uid())
with check (
  driver_id = auth.uid()
  and exists (
    select 1 from public.routes r
    where r.id = route_id and r.driver_id = auth.uid() and r.status in ('published', 'completed')
  )
);
