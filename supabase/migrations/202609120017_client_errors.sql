-- 017: registro de erros do app (para saber do problema antes do cliente reclamar)
--
-- Por que no banco e nao num servico externo: o plano preve Sentry, mas isso exige conta/DSN
-- de terceiro. Esta tabela entrega o essencial hoje (mensagem, pilha, versao do app, aparelho
-- e organizacao) sem dependencia externa e sem custo; quando houver conta Sentry, o envio
-- aponta para la mantendo esta tabela como historico.
--
-- Privacidade: o app NUNCA manda dado de cliente nem codigo de portao. Só o texto do erro,
-- a pilha, a versao e o identificador do usuario/organizacao.
--   * qualquer usuario logado grava erro EM NOME PROPRIO (nao da para forjar outro usuario);
--   * somente gestor da organizacao LE os erros;
--   * ninguem apaga nem edita pelo app (sem policy de update/delete).
--   * se o erro acontecer antes do perfil carregar, organization_id pode vir nulo.

create table if not exists public.client_errors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  app_version text,
  platform text,
  message text not null,
  stack text,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists client_errors_created_idx on public.client_errors (created_at desc);
create index if not exists client_errors_org_idx on public.client_errors (organization_id, created_at desc);

alter table public.client_errors enable row level security;

drop policy if exists client_errors_insert_own on public.client_errors;
create policy client_errors_insert_own on public.client_errors
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and (organization_id is null or public.user_in_org(organization_id))
  );

drop policy if exists client_errors_manager_read on public.client_errors;
create policy client_errors_manager_read on public.client_errors
  for select
  to authenticated
  using (organization_id is not null and public.is_org_manager(organization_id));
