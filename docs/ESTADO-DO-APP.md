# Estado do app — Pack & Paws Club

**Atualizado em 12/09/2026** · evidência medida no repositório e no banco (não é resumo de sessão)

## Onde o app está

| Camada | Estado | Evidência |
|---|---|---|
| App Store | versão **1.0** com **build 15 em revisão** (WAITING_FOR_REVIEW) | submissão criada em 11/09 23:34 UTC |
| TestFlight | build 15 liberado; Raphael **INSTALLED** | `betaTesters` via App Store Connect API |
| Screenshots da loja | **6/6 COMPLETE** (`APP_IPHONE_67`, 1290×2796) | conjunto `17c0c6ab` |
| Ficha de revisão | contato + telefone + **conta demo** + notas em inglês | `appStoreReviewDetails` preenchido |
| Preço | Free (US$ 0) | `appPriceSchedules` |
| Compliance de criptografia | respondido (`usesNonExemptEncryption: false`) | atributo do build 15 |
| Link público do TestFlight | **desligado** | `publicLinkEnabled: false` |

## Fases do plano mestre

| Fase | Estado |
|---|---|
| 0 · Fundação visual e técnica | concluída |
| 1 · Autenticação, organizações e RLS | concluída |
| 2 · Contatos, clientes e cachorros | concluída |
| 3 · Calendário e reservas | concluída |
| 4 · Despacho manual | concluída |
| 5 · App do motorista (offline + sync) | concluída |
| 6 · Otimização de rotas | concluída (geometria; trânsito real pendente de chave Google) |
| 7 · Tempo real, localização e ETA | concluída |
| 8 · Development build e TestFlight | concluída |
| 9 · Preparação para App Store | **submetida** (aguardando a Apple) |

## Qualidade (medida hoje)

- **211 testes** em 43 suítes · cobertura **91,6%** de statements · `typecheck` limpo
- **Suíte de integração de banco**: 31 casos com `rollback` (RLS por papel, isolamento entre organizações,
  fluxos completos) — `npm run test:db`
- **E2E dirigido por navegador** na versão web (login real, fluxos de gerente e motorista)
- Idioma do app: **100% inglês** (varredura de `pt-BR`/`Cancelar`/`Lembrar` aplicada em 11/09)

## Correções entregues nos builds 13–15

| Build | O que corrigiu |
|---|---|
| 13 | cliente reaproveitado do contato (sem erro de UNIQUE) · vários cães por cliente · nome do cão puxado do contato · cliente sem cão · app iPhone-only |
| 14 | aba "two" fantasma · motorista caindo no painel do gerente · datas em inglês · "1 driver" · mapa sem derrubar a tela · paradas numeradas |
| 15 | **instruções de acesso em branco na ficha do cliente** (embed vinha como objeto) + gravação idempotente (`upsert` por `client_id`) |

## Dados de produção (organização do cliente)

6 clientes · 6 cães · 6 reservas · 3 rotas · 4 membros ativos · 0 recorrências

- Todas as clientes vieram de **contatos do telefone** (`source_contact_identifier` preenchido) — o fluxo
  principal está em uso.
- As 3 rotas (09 e 10/09) são **operacionais** (cães de clientes reais), não dados de teste.

## O que falta (com dono)

| Item | Dono | Situação |
|---|---|---|
| Aprovação da Apple + liberar a versão | Apple / dono | em revisão (1–3 dias) |
| **Push notifications** | nós | plano, Fase 2 do `PLANO-EXECUCAO.md` |
| **Monitoramento de erros** | nós | plano, Fase 3 |
| Concorrência (trava otimista em rotas) | nós | plano, Fase 4 |
| Trânsito real (Google Directions) | nós + chave do cliente | plano, Fase 5 |
| Polimento das telas do motorista | nós | plano, Fase 6 |
| Logo do app | **resolvido em 12/09 sem o cliente** | logo do site do próprio cliente (1320×1710 = 13× mais pixels que o avatar de 100×100) → ícone reconstruído (marca só, fundo creme), nitidez **2,00 → 5,61**; falta só o vetor original para uso impresso (banner/van/cartão) |
| Runbook de suporte/releases | nós | plano, Fase 8 |
| Nomes de clientes com o cão colado (`Elisha Ma (Mocha)`) | dono decide | 1 comando para limpar |
