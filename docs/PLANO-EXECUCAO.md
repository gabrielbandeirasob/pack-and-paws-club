# Plano de execução — fechar as pendências e implantar o que falta

**Pack & Paws Club** · criado em 12/09/2026 · autorizado pelo dono: executar tudo e testar cada item

> **Como usar:** cada fase é independente e termina com **testes executados + evidência real** antes de
> seguir. Nada entra em fase seguinte sem a anterior verde. Os commits são locais, um por fase.

---

## Situação de partida (medida, não estimada)

| Item | Estado |
|---|---|
| App Store | versão 1.0 com **build 15 em revisão** |
| TestFlight | build 15 liberado (Raphael e Maria Eduarda instalados) |
| Fases 0–7 do plano mestre | concluídas |
| Testes | 211 testes · cobertura 91,6% statements · suite de banco (31 casos) · typecheck limpo |
| Uso real | 6 clientes · 6 cães · 6 reservas · 3 rotas · 4 membros ativos |

---

## Fase 1 — Higiene e limpeza (rápida, sem risco)

**Objetivo:** tirar ruído do repositório e do ambiente antes de mexer em funcionalidade.

1. **`app.json`**: remover `ios.buildNumber` (o EAS avisa que é ignorado — a fonte da verdade é o remoto).
   - Teste: `npx expo config --type introspect` continua válido + `npm test` + `typecheck`.
2. ~~**Rotas de teste antigas**~~ — **VERIFICADO EM 12/09/2026: NÃO SÃO DADOS DE TESTE.** O cão "Filó"
   pertence à cliente **Amor**, "Rogério Guedes" ao **Dygão** e "Marcejamba" ao **Raphael Stefan** — as três
   rotas (09 e 10/09) são operacionais. **Nada foi apagado.** Lição aplicada: medir o estado atual do banco
   antes de "limpar" qualquer coisa (o nome do cão parecia teste nosso, era cliente real).
   - Achado real no lugar: os clientes criados **antes** da correção do nome ainda têm o cão colado no nome
     (`Elisha Ma (Mocha)`, `Leigh Ann(Mowgli)`, `Tori (Haru)`). Renomear é decisão do dono (1 comando).
3. **Documentação de estado**: `docs/ESTADO-DO-APP.md` (o que está entregue, o que falta, evidência).

**Evidência:** diff do `app.json`, arquivo de backup, contagens antes/depois, suíte verde.

---

## Fase 2 — Push notifications (maior lacuna funcional)

**Objetivo:** o motorista saber em segundos que a rota foi publicada, sem abrir o app.

1. **Banco** — migração `202609120016_push_device_tokens.sql`:
   - tabela `device_tokens (id, organization_id, user_id, token, platform, updated_at)`, único por token;
   - RLS: cada usuário lê/grava **o próprio** token na própria organização (padrão `SECURITY DEFINER` já usado);
   - testes de banco (positivo + negativos: outro usuário não vê, outra org não vê).
2. **App** — `expo-notifications` + plugin em `app.json` (ícone/descrição de permissão) via `npx expo install`.
3. **Registro do token** — `features/notifications/pushService.ts`:
   - pede permissão, obtém `ExpoPushToken`, grava em `device_tokens` no login (upsert por token);
   - módulo puro `buildRoutePublishedMessage(route, stops)` (título/corpo/contagem de paradas) **testado**;
   - sem permissão ou sem `projectId` → não quebra o app (retorna `null` e registra no log).
4. **Envio na publicação** — trigger no banco (`pg_net` → Expo Push API):
   - `after update on routes when new.status='published' and old.status<>'published'` →
     `net.http_post` para `https://exp.host/--/api/v2/push/send` com os tokens do motorista;
   - mensagem **sem código de porta/lockbox** (política do projeto: nada sensível em notificação).
5. **Teste do pipeline** — publicar uma rota no ambiente de teste com um token falso e conferir em
   `net._http_response` que a requisição saiu (evidência real de que o disparo funciona), além dos testes
   puros da mensagem e do RLS.

**Evidência:** linha em `net._http_response`, testes puros passando, suíte de banco verde.

---

## Fase 3 — Monitoramento de erros

**Objetivo:** saber dos erros **antes** do cliente reclamar (hoje só descobrimos por print).

1. **Banco** — migração `202609120017_client_errors.sql`:
   - `client_errors (id, organization_id, user_id, message, stack, screen, app_version, device, created_at)`;
   - RLS: app pode **inserir**; só gestor lê; sem update/delete pelo app.
2. **App**:
   - `ErrorBoundary` global (tela amigável "Something went wrong" + **Try again** em vez do erro cru do
     expo-router) — testado com componente que estoura de propósito;
   - `features/diagnostics/reportError.ts` (módulo puro que monta o payload + envio best-effort, nunca
     lança) — testado;
   - hook opcional de Sentry: se `EXPO_PUBLIC_SENTRY_DSN` existir, encaminha; sem DSN, só banco.
3. **Teste:** erro simulado no app de teste → linha gravada em `client_errors` (evidência no banco).

---

## Fase 4 — Concorrência: escrita otimista em rotas

**Objetivo:** dois gestores mexendo na mesma rota não se sobrescreverem em silêncio.

1. **Banco** — migração `202609120018_route_optimistic_lock.sql`:
   - coluna `routes.lock_version int not null default 1` + trigger que incrementa a cada escrita;
   - RPC `update_route_guarded(p_route_id, p_expected_version, …)` → erro claro (`P0001 stale_route`)
     quando a versão não bate.
2. **App**: o Dispatch manda a versão que conhece; ao receber `stale_route`, mostra
   **"Someone else changed this route — reload"** e recarrega.
3. **Testes de banco:** dois gestores em transações separadas — o segundo com versão velha é **recusado**;
   depois de recarregar, a escrita passa.

---

## Fase 5 — Trânsito real (Google) com fallback

**Objetivo:** o algoritmo já aceita matriz real; falta o provedor e a degradação segura.

1. `features/dispatch/travelMatrix.ts`:
   - `haversineMatrix()` (atual) como **padrão**;
   - `googleMatrix(points, key)` com Distance Matrix (`departure_time=now`, `traffic_model=best_guess`),
     **com teste de parsing** contra uma resposta Google falsa em memória;
   - `resolveTravelMatrix()` escolhe Google só quando `EXPO_PUBLIC_GOOGLE_ROUTES_KEY` existe **e** a chamada
     responde; qualquer falha → volta para haversine (testado: 4 casos de falha).
2. Documentar que a chave fica restrita por bundle/referrer e **nunca** vai para o repositório.

**Observação honesta:** a chave/conta Google é dependência externa do cliente; o código fica pronto e
ligado por variável de ambiente.

---

## Fase 6 — Polimento das telas do motorista ("Schedule" e "Assigned")

**Objetivo:** as duas abas hoje são quase vazias (1–2 cartões).

1. **Schedule**: agrupar por dia (hoje/amanhã/próximos), mostrar contagem de paradas, status da rota e
   horário de publicação; estado vazio explicativo.
2. **Assigned**: lista dos cães atribuídos ao motorista com cliente, endereço, instruções e nota
   **médica/comportamental** (segurança, não enfeite).
3. **Testes de componente** para cada estado (vazio, com dados, muitos itens).

---

## Fase 7 — Logo em alta resolução (ícone/splash)

**Objetivo:** parar de usar a imagem do Instagram (baixa resolução) sem depender de designer.

1. `scripts/make-icons.py`: gera de um PNG/SVG de origem **todos** os tamanhos de ícone + splash
   (1024×1024 sem alpha, adaptativos do Android, splash 1284×2778) — testado contra o logo atual
   (gera em pasta temporária e valida dimensões/alpha).
2. `scripts/check-appstore-assets.py` da skill já valida 1024×1024 sem alpha — rodar antes do build.
3. Pendência declarada para o cliente: enviar o **arquivo original** (SVG/PNG grande). Enquanto não chega, o
   pipeline fica pronto e o ícone atual segue válido.

---

## Fase 8 — Suporte, releases e documentação

1. `docs/SUPORTE-E-RELEASES.md`: como reportar problema, o que fazer com erro no aparelho, cadência de
   releases, o que é versão maior (1.1) × correção (1.0.1), checklist de publicação.
2. `docs/ESTADO-DO-APP.md` atualizado com a evidência de cada fase.
3. Atualizar a skill de projeto com o que foi aprendido.

---

## Fase 9 — Build 16 e distribuição

1. Suíte completa + auditoria de idioma (`grep` de português) + `expo-doctor` + export web.
2. `eas build` (16) → publicar na App Store Connect → TestFlight (mesma esteira já scriptada).
3. Quando a versão 1.0 sair da revisão: liberar (1 clique) e planejar a 1.1 com push + monitoramento.

---

## Ordem de execução e critério de pronto

| Fase | Depende de | Pronto quando |
|---|---|---|
| 1 · Higiene | — | suíte verde + backup das rotas gravado |
| 2 · Push | 1 | trigger dispara de verdade (evidência em `net._http_response`) |
| 3 · Erros | 1 | erro simulado gravado em `client_errors` |
| 4 · Concorrência | 1 | teste dos 2 gestores recusando a escrita velha |
| 5 · Trânsito | 1 | fallback testado e chave documentada |
| 6 · Telas do motorista | 1 | testes de componente dos 3 estados |
| 7 · Ícone | 1 | gerador validado (1024 sem alpha) |
| 8 · Docs | 2–7 | runbook escrito |
| 9 · Build 16 | todas | build VALID + testadores com o build novo |

**Não fazer sem pedir:** nada — esta execução está autorizada pelo dono (12/09/2026).
