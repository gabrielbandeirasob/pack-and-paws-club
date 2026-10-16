-- BUILD MÍNIMA DO APP — o app só funciona na versão mais recente publicada (pedido do dono, 16/10/2026).
--
-- Por que existe: o escritório testou build velha e reportou como se o recurso novo não existisse, e o app
-- é distribuído por TestFlight (não existe auto-update nosso: `EXUpdatesEnabled = False` no IPA). Esta
-- tabela guarda a build mínima por plataforma; o app lê ao abrir, antes das abas, e quem estiver atrás não
-- entra — tela de "atualize para continuar" com o passo do TestFlight.
--
-- Quem ESCREVE: o `build/publish_local_ipa.py` grava o número da build nova SÓ depois de ela estar
-- liberada para os testadores externos (`IN_BETA_TESTING`) — nunca antes, senão o escritório fica
-- bloqueado sem poder atualizar. Liberar uma build antiga de volta (build nova com defeito) é um UPDATE
-- nesta tabela; o app não escreve nada aqui.
create table if not exists public.app_releases (
  platform text primary key check (platform in ('ios', 'android')),
  min_build integer not null default 0 check (min_build >= 0),
  updated_at timestamptz not null default now(),
  note text
);

insert into public.app_releases (platform, min_build, note)
values ('ios', 0, 'liberado para todos: a publicacao sobe este numero')
on conflict (platform) do nothing;

alter table public.app_releases enable row level security;

-- Leitura por QUALQUER um (inclusive `anon`): o portão roda antes do login — quem está deslogado com
-- build velha também precisa ser barrado, e o dado não é sensível (um número de build).
drop policy if exists app_releases_leitura on public.app_releases;
create policy app_releases_leitura on public.app_releases for select to anon, authenticated using (true);

grant select on public.app_releases to anon, authenticated;
