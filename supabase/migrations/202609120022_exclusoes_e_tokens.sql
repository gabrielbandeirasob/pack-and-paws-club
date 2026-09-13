-- Pack & Paws Club - Exclusoes: o gestor pode limpar os tokens de push do motorista removido
--
-- Contexto: "excluir motorista" no app remove o vinculo em organization_members (a conta do
-- usuario em si exige a chave de administrador do Supabase e nao vive no app). Sem remover o
-- token de push, o aparelho do motorista removido continuaria recebendo notificacao de rota.
--
-- A politica antiga (device_tokens_own_all) so deixa cada um mexer nos PROPRIOS tokens, o que
-- impede o gestor de limpar o token de quem saiu. Esta politica abre exatamente esse caso:
-- apagar token de alguem da MESMA organizacao, e somente se quem pede e gestor.
--
-- Nao cria acesso de leitura: o gestor continua sem ver token de ninguem (select segue so o dono).

begin;

drop policy if exists device_tokens_manager_delete on public.device_tokens;
create policy device_tokens_manager_delete on public.device_tokens
for delete to authenticated
using (
  public.is_org_manager(organization_id)
  and user_id <> auth.uid()
);

commit;
