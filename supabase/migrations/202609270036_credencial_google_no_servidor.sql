-- 036: CREDENCIAL DO GOOGLE NO SERVIDOR — para a sincronização rodar de tempo em tempo
--
-- Pedido do dono, ditado em áudio (27/09/2026): "o cliente cancelou no dia, ou um dia antes, dois
-- dias antes… altera lá. Aí você vai ver no calendário vermelho". Hoje a importação só roda no
-- aparelho e o refresh token fica SÓ no Keychain — com o app fechado, nada entra no dia.
--
-- Decisão AUTORIZADA pelo dono em 27/09/2026 (com a ressalva de que o calendário é do cliente):
-- a credencial passa a existir no servidor, CIFRADA, para uma função agendada rodar a importação.
--
-- Decisões registradas aqui:
--  * o token é gravado CIFRADO pelo Edge Function (AES-GCM, chave em segredo do projeto): o conteúdo
--    desta tabela não serve para nada sem a chave, e a chave NÃO vive no banco;
--  * RLS ligada e **sem nenhuma policy**: nem o gestor lê a credencial pela API. Quem lê/escreve é a
--    função, com service role. O app manda o token para a função no momento de conectar (TLS) e
--    nunca o lê de volta;
--  * uma linha por organização (`organization_id` é a PK) — a agenda conectada é uma só;
--  * `last_sync_at` / `last_sync_result`: o histórico do que a função agendada fez, para o dono
--    conseguir ver que está rodando sem abrir o app;
--  * desconectar o Google na tela APAGA a linha (não sobra acesso de calendário que o cliente não
--    usa mais).

begin;

create table if not exists public.google_calendar_credentials (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  refresh_token_encrypted text not null,
  connected_email text,
  calendar_id text,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  last_sync_at timestamptz,
  last_sync_result text
);

comment on table public.google_calendar_credentials is
  'Refresh token do Google do escritorio, CIFRADO pelo Edge Function (AES-GCM). RLS ligada SEM policy: apenas service role toca.';

alter table public.google_calendar_credentials enable row level security;

-- O Supabase dá GRANT ALL por padrão em tabela nova de `public` para anon/authenticated; com RLS e
-- sem policy já estaria negado, mas o REVOKE é o cinto de segurança explícito.
revoke all on public.google_calendar_credentials from anon, authenticated;

create index if not exists google_calendar_credentials_sync_idx
  on public.google_calendar_credentials (last_sync_at);

commit;
