-- A tabela de vans/sedes entra no tempo real (defeito relatado pelo dono, 01/10/2026: *"criei uma segunda
-- van de teste e mesmo assim não apareceu"*).
--
-- O Dispatch escutava mudanças de rota, de paradas e de posições — mas NÃO de `organization_locations`.
-- Quem cadastrava uma van não recebia nenhum aviso: se a tela do Dispatch já estava montada, a lista só
-- era relida junto com o "dia" (que tem trava de dois minutos), então a van nova simplesmente não
-- aparecia. A tela também relê no foco; esta migração cobre o outro aparelho (e o gestor que cadastra
-- enquanto o Dispatch está aberto em outra aba).
--
-- `replica identity full` para o evento de DELETE carregar as colunas: sem isso o Supabase só manda a
-- chave, o filtro `organization_id=eq.<org>` não casa e a van apagada continuaria na lista.
alter publication supabase_realtime add table public.organization_locations;
alter table public.organization_locations replica identity full;
