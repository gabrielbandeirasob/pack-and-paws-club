# Auditoria — funcionalidade "fazer as rotas" (gestor + motorista)

**Data:** 25/10/2026 · **Build auditado:** 171 (`5166c8c`) · **Escopo:** montar, ordenar, publicar, executar, acompanhar e fechar a rota.
**Critério:** só conta **ATENDIDO** se o gestor ou o motorista consegue fazer **pela tela hoje**.

**Método:** leitura do código (dispatch.tsx 1808 linhas, DispatchBoard 1593, driver.tsx 1833, módulos puros), `tsc --noEmit` limpo, consultas de leitura no banco de produção (org `c0af17d6`, projeto `bhuexxjcrjcv…`) e harnesses rodando `eta.ts`/`shift.ts` reais. **Nada foi executado em aparelho.** Cada achado marcado abaixo diz se foi **conferido por mim** (código/consulta lida) ou apenas **relatado** pelo auditor setorial.

---

## Veredito em uma linha

O caminho **existe e é usável**: montar, ordenar (em rascunho), publicar, o motorista ver a próxima parada e concluir, e o gestor fechar com aviso de pendências. O que está errado é a **borda**: cancelamento destrutivo, perna de entrega fantasma em duas telas, escrita sem confirmação e o motorista culpado por decisão do escritório.

---

## P0 — corrigir antes de o cliente usar de novo

### 1. Cancelar rota apaga as paradas e as provas sem pedir confirmação — *conferido*
`app/(tabs)/dispatch.tsx:1361-1376` (`fecharComAviso` só confirma quando há parada **pendente**) · `:1396-1421` (`soltarOsCaes` faz `DELETE route_stops` **sem filtro de status**) · `features/dispatch/DispatchBoard.tsx` menu ⋯ oferece "Cancel route" em **qualquer** status, só desabilitado com escrita em curso.

Sintoma: rota já cumprida (todas as paradas concluídas) → um toque em "Cancel route" → some a execução **e** as fotos-prova, sem aviso. O dia passa a aparecer como `0/0 stops` no histórico.
Correção: confirmar cancelamento sempre que a rota tiver paradas; e `soltarOsCaes` não deve apagar `completed` (ou deve desvincular em vez de deletar).

### 2. Prova de coleta/entrega de qualquer motorista pode ser listada e apagada por outro — *conferido em produção*
Políticas `stop_proofs_read` / `stop_proofs_delete` / `stop_proofs_insert` do bucket `stop-proofs` usam `path_belongs_to_my_org(name)`, que só compara o **primeiro** segmento do caminho (o `organization_id`) com a membership ativa (`pg_get_functiondef` conferido). Não há dono por parada nem validação de que a linha de `route_stops` é dele.

Sintoma: qualquer membro ativo da organização — inclusive motorista — lista e apaga as provas de todos (fotos das casas dos clientes). Não é vazamento para fora da org, é destruição dentro dela.
Correção: policy por parada (`route_stops` do próprio motorista, ou gestor da org) e `route_stops.*_proof_path` com verificação de existência.

---

## P1 — o dia funciona, mas mente ou trava

### 3. A perna de entrega aparece "toda pendente" na tela de paradas do gestor — *conferido*
`features/dispatch/routeStops.ts:103-108` carrega **uma** rota por `id`, sem `phase`; a seção "Drop-offs" é montada com `dropoff_sequence`/`delivered_at` da **rota de pickup**. Desde a migration 053 a entrega é outra rota (`phase='dropoff'`) com paradas próprias, onde o `delivered_at` é gravado.

Sintoma: gestor abre "Route stops" à tarde, vê tudo pendente e o dia "não fechado"; aberta pelo modo Drop-offs, a lista de entrega aparece rotulada "Pick-ups".
Correção: carregar as duas pernas do dia e usar a rota `dropoff` para a seção de entregas; mostrar a fase no cabeçalho.

### 4. Na tela do motorista, a tarde pode sumir quando a jornada é deduzida — *conferido (código), condicionado*
`app/(tabs)/driver.tsx:970-971` calcula `journey` só com `stops` — que, na fase de entrega, são as paradas da rota de drop-off, todas sem marco. `features/driver/shift.ts:132-148` devolve `none` se não houver turno manual aberto; `deduceShift` (`:101-110`) não aceita `delivered_at` como fim.

Sintoma: se o motorista **não** estiver com clock-in manual aberto ao virar para a tarde, a tela volta para "Ready to start / Clock in" com a tarde inteira por fazer. Com clock-in manual aberto (o caminho que a tela força hoje) o defeito não aparece — por isso está em P1 e não em P0.
Correção: deduzir a jornada com as duas pernas e incluir `delivered_at`.

### 5. Toque duplo no botão grande grava dois passos — *conferido (código)*
`driver.tsx:794` (`act` = `escrever(...)`, sem trava por ação) · `NextStopCard` troca o rótulo do **mesmo** botão (`I've arrived` → `Next`). Duas batidas rápidas enfileiram "arrived" e depois "next".

Sintoma: na rua, o motorista toca duas vezes; o cão aparece embarcado no escritório sem ter sido pego, e não há desfazer.
Correção: trava por `stopId+ação` em voo e `busy` desabilitando o botão.

### 6. Erro ao cancelar/fechar é engolido — *conferido*
`dispatch.tsx:1372` `onPress: () => { void aplicar(); }` — promise sem `catch`; só `stale_route` abre modal. Pior: em `cancelRoute` o `DELETE` das paradas vem **antes** do `UPDATE` de status.

Sintoma: gestor confirma, o alerta fecha, nada muda — ou a rota fica publicada **vazia** na mão do motorista.
Correção: `catch` com mensagem; inverter a ordem (status primeiro) ou fazer as duas escritas numa RPC só.

### 7. Otimizar a ordem dispara um push por parada — *relatado (SQL lido pelo auditor)*
`202610020051_aviso_de_parada_em_rota_publicada.sql:110-112` (`for each row`) + `apply_route_order` em laço.

Sintoma: uma rajada de "Route updated" no celular do motorista depois de um toque em Optimize.
Correção: gatilho por `statement` com agregação, ou debounce por transação.

### 8. ETA da tarde é calculado com a perna da manhã — *relatado (harness)*
`features/driver/eta.ts:194-208` deduz a fase pelo **status** (todas `pending`), não pela perna declarada; a rota de entrega só tem `dropoff_travel_seconds`.

Sintoma: o número que vai no SMS ao tutor está na ordem da manhã — a 1ª entrega pode dizer 5 min e a 3ª dizer 0.
Correção: passar a fase explicitamente para `minutosAteParada`/`acumularAteAlvo`.

### 9. Sem sinal, o motivo do "não feito" se perde — *relatado*
`driver.tsx:896-937` grava `proof_note` só no caminho online; a fila (`offlineStore.ts:13-43`) não tem campo para a nota e o replay envia só `status`.

Sintoma: justamente no dia de sinal ruim o escritório recebe "Problem" sem motivo.
Correção: `note?: string` no `DriverEvent` e `proof_note` no replay.

### 10. Uma recusa não definitiva trava a fila para sempre — *relatado*
`features/driver/pendingWrites.ts:116-163`: só alguns erros são tratados como definitivos; `parada não encontrada` e `route cancelled` não estão na lista.

Sintoma: banner "1 change waiting to sync" eterno e o clock out atrás dele nunca sobe.
Correção: classificar esses erros como definitivos (pular a entrada e seguir a fila).

### 11. Rota cancelada ou trocada para outro motorista: a tela mente — *relatado*
`driver.tsx:535-536, 610, 1680-1699` mostram "No published route today" (igual a dia sem rota) e a mensagem de escrita pendente diz "check your signal" — culpa o motorista por decisão do escritório.
Correção: detectar a perda da rota comparando com o snapshot e mostrar cartão próprio ("This route was cancelled/reassigned").

### 12. Ordem não pode ser corrigida à mão depois de publicada — *conferido*
`DispatchBoard.tsx:1250` `enabled={status === 'draft' && …}` → a alça `≡` não é renderizada. As RPCs de reordenação não exigem rascunho; só a tela impede.

Sintoma: publicou, errou a ordem, a alça sumiu sem explicação; só resta Optimize ou despublicar (o que dispara push de novo).
Correção: permitir reordenar em `published` (a RPC já aceita; a trava é `lock_version`).

### 13. Cão que já está na van é arrastado para o pickup junto com o irmão de casa — *relatado com linha exata*
`dispatch.tsx:884` chama `vaoJunto(itensDoDia.current, …)`, e `itensDoDia` mistura fila e `naVan`; `houseMates.ts:59` calcula os irmãos só entre os que **não** estão na van, então o aviso também não sai.

Sintoma: motorista recebe parada na casa de um cão que já está dentro da van.

### 14. "Add any dog" não existe mais — *conferido: removido a pedido do dono em 07/10/2026*
`DispatchBoard.tsx:524-526`. Hoje a fila é só o que o calendário do dia oferece. **Não é bug — é divergência entre a regra que eu tinha e o que está no ar.** Precisa da sua decisão: volta ou o calendário é a única porta?

### 15. Foto-prova removida do fluxo do motorista — *conferido: pedido do dono em 26/09/2026*
Commit `497c40e`; `features/driver/proofCapture.ts` existe mas **não é importado em lugar nenhum**; as colunas e as fotos antigas continuam no banco e na visão do escritório.

---

## P2 — incômodo, não bloqueia
### 0. Organização sem van/yard esconde passos do dia sem avisar — *descoberto no teste do dono (26/10)*
`features/driver/routeClosing.ts:47-56,74-86` devolve `null` quando não há destino — o cartão "Back to the yard" / "Back to the van" simplesmente **não existe**. O cartão da van (clock in) idem, depende de `organization_locations` com `kind='van'`.
Sintoma: organização nova (sem local cadastrado) abre a tela do motorista e não tem onde bater o ponto, nem para onde ir depois da última busca, nem como fechar o dia — e **nada na tela diz o motivo**. Foi exatamente o que aconteceu na organização de teste (0 locais, rotas com `start_location_id`/`end_location_id` nulos).
Correção: no Dispatch, avisar "No van/yard registered — the yard and end-of-day steps won't appear" com atalho para a tela de vans.

- Yard escolhido na rota é ignorado pelo Optimize (`dispatch.tsx:1523,1735` usam o yard **padrão**).
- Trava "1st/last" grava o pin mas não reordena até rodar Optimize (`dispatch.tsx:1252-1274`).
- "Edit times" no menu ⋯ abre a lista de paradas, que não edita horário (`DispatchBoard.tsx:883-885`).
- Cancelar/remover libera só a perna tocada; a outra mantém o cão (`dispatch.tsx:1396-1420`).
- `unpublish` não avisa o motorista (trigger `notify_route_status` só trata `published`/`cancelled`).
- "Route history" sem `phase`, sem filtro de status e sem drill-down (`route-history.tsx:49,87-95`).
- TimeWheel em passos de 5 min: janela 07:07 vira 07:05 sem avisar (`TimeWheel.tsx:20`).
- `route_versions` sem trigger: snapshot de publicação pode ser editado/apagado sem rastro; 3 rotas publicadas na P&P com `lock_version` e **zero** versões.
- `stale_route` com `p_esperado DEFAULT NULL` em `publish_route`/`apply_route_order`/`assign_stop`/`reorder_route_stops`, e sem `FOR UPDATE` → dois gestores podem perder a ordem um do outro.
- `routes` DELETE sem guarda de status → cascata apaga paradas, versões e localizações de rota em operação.
- `assigned.tsx` sem cache offline e sem `RefreshControl`; sessão perdida vira "No dogs assigned".

---

## Capacidades — gestor

| Capacidade | Veredito |
|---|---|
| Montar a rota (pick-up e drop-off) | ATENDIDO |
| Ordenar à mão | PARCIAL (só em rascunho; pin não reordena) |
| Ver tempo e distância | ATENDIDO |
| Ver quem está sem motorista | ATENDIDO |
| Trocar o motorista de um cão | ATENDIDO |
| Publicar (avisa o motorista) | ATENDIDO |
| Despublicar | ATENDIDO |
| Cancelar | PARCIAL (destrutivo + erro engolido) |
| Ver o que o motorista fez | PARCIAL (tarde fantasma; histórico sem drill-down) |
| Fechamento com aviso de pendentes | ATENDIDO |
| Cão já na van | ATENDIDO |
| "Add any dog" | AUSENTE (removido a pedido) |

## Capacidades — motorista

| Capacidade | Veredito |
|---|---|
| Vê só a rota publicada dele | ATENDIDO |
| Inicia a jornada | ATENDIDO (sempre manual, com motivo) |
| Próxima parada com endereço e ETA | PARCIAL (ETA da tarde errado) |
| Navega | ATENDIDO |
| Marca feito / não feito com motivo | PARCIAL (offline perde o motivo) |
| Alterna Pick-ups/Drop-offs | PARCIAL (tarde pode sumir) |
| Trabalha sem sinal e sobe depois | PARCIAL (não duplica; fila pode travar) |
| Fecha a rota | ATENDIDO |
| Toque duplo | QUEBRADO |
| Rota cancelada / trocada no meio do dia | PARCIAL (mensagem culpa o sinal) |
| App reaberto no meio da rota | QUEBRADO (volta para a busca) |
| Foto-prova | REMOVIDA a pedido do dono |

---

## O que não foi provado
- Nada em aparelho: GPS/geofence da van, `Accuracy.High`, `watchPositionAsync`, permissões, push APNs/FCM, e o link `sms:` com dois tutores no iOS.
- Escrita real como motorista (só leitura no banco): os achados de permissão vêm do texto das policies e do catálogo de funções/triggers.
- Se `phase` (053) e `movement_day` (060) estão aplicadas em produção — o código tem fallback.
- Semântica de **dia de saída** de hospedagem: `transportPoolForPhase` exclui todo boarding do drop-off; a 060 declara "dia de movimento não tem entrega", o que cobre a chegada, não a saída. Precisa de decisão do dono.

## Dados de produção (org `c0af17d6`, 90 dias)
`published 13 · draft 10 · cancelled 8 · completed 1`; última publicação **07/10/2026**; paradas `pending 49 · completed 25`, nenhuma em `arrived`/`picked_up`/`skipped` — **o app pula etapas**. Integridade ok: 0 parada órfã, 0 sequência duplicada, 0 cão cross-org, 0 duas rotas publicadas por motorista/perna, 0 prova pendurada.
