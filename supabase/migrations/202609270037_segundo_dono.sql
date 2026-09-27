-- 037: SEGUNDO DONO (segundo tutor do mesmo cão)
--
-- Pedido do dono, ditado em áudio (27/09/2026): "cada cachorro tem um dono só, mas existe cachorro
-- que tem pai e mãe... os pais têm a exigência de receber mensagem nos dois números, ou seja, a
-- forma que a gente trabalha hoje é... a gente cria um grupo no iMessage e manda para os dois donos".
--
-- Decisões registradas aqui:
--  * o segundo dono é do CLIENTE (o cadastro), não do cão: pai e mãe moram no mesmo endereço e o
--    endereço é o mesmo para todos os cães daquela casa. Dois campos, nada de tabela nova — o
--    cadastro hoje tem UM telefone e ganha um segundo, com nome;
--  * nada de mudar o telefone principal: os relatórios, a lista e a busca continuam no primeiro;
--    a segunda linha é só para quem recebe o aviso de ETA;
--  * o aviso vai para os DOIS números em UMA conversa (SMS em grupo no iOS), a pedido dele:
--    "não de forma separada, mas num grupo";
--  * RLS não muda: o gestor já escreve `clients` (policy ALL) e o motorista já lê (policy SELECT),
--    então as colunas novas seguem a mesma regra do telefone atual.

begin;

alter table public.clients add column if not exists second_owner_name text;
alter table public.clients add column if not exists second_owner_phone text;

comment on column public.clients.second_owner_name is
  'Nome do segundo tutor (pai/mae do mesmo cao) — entra na saudacao da mensagem de ETA.';
comment on column public.clients.second_owner_phone is
  'Telefone do segundo tutor — o aviso de ETA sai em UMA conversa com os dois numeros.';

commit;
