# Análise de lacunas do app (10/09/2026)

## Como esta análise foi feita (evidências, não achismo)
1. **Ações disponíveis por tela**: varredura de todos os `accessibilityLabel`/`onPress` de `app/` e `features/`.
2. **Schema real do banco**: introspecção do Supabase `bhuexxjcrjdhkmsvagdw` (14 tabelas) via API de management.
3. **Permissões (RLS)**: consulta a `pg_policies` — para separar "não dá porque falta tela" de "não dá porque falta permissão".

Resultado da checagem de permissão: `clients`, `dogs`, `reservations`, `routes`, `route_stops`, `recurring_schedules`, `recurring_exceptions`, `client_instructions`, `route_versions` têm política **ALL** (escrita liberada). Ou seja: **as lacunas abaixo são de INTERFACE, não de banco** — corrigir é trabalho de app, não de infraestrutura.

## P0 — Trava a operação (corrigido nesta sessão)
| # | Lacuna | Evidência | Status |
|---|---|---|---|
| 1 | **Não dá para editar cliente** (nome, telefone, endereço, notas, instruções de acesso) — a lista é só leitura | `features/clients/ClientsList.tsx:37` (card sem ação); único caminho era "Add from Contacts" (`app/(tabs)/clients.tsx:22`) | ✅ CORRIGIDO |
| 2 | **Não dá para editar cachorro** (nome, raça, comportamento, saúde) | só criado no fluxo de contatos (`clients.tsx:106`) | ✅ CORRIGIDO |
| 3 | **Endereço corrigido → coordenada velha continuava no mapa** (pino no lugar errado, pior que pino nenhum) | nenhum tratamento de `latitude/longitude` na edição | ✅ CORRIGIDO (zera lat/lng quando o endereço muda) |
| 4 | **Cliente desativado desaparecia para sempre** (sem como reativar) | filtro `.eq('active', true)` na lista | ✅ CORRIGIDO (mostra `INACTIVE` e permite reativar) |
| 5 | **Não dá para editar reserva** (data, daycare/boarding, transporte, observação) | só `insert` (`calendar.tsx:120`) e delete/exceções | ✅ CORRIGIDO |
| 6 | **Não dá para editar/desativar motorista** | só convidar (`features/drivers/DriverInviteForm.tsx`) | ✅ CORRIGIDO |
| 7 | **Não dá para cancelar/despublicar rota já publicada** | `routes` tem ALL no banco; nenhum `update` no app | ✅ CORRIGIDO |
| 8 | **Nenhum endereço digitado ganha coordenada (geocoding)** | as 3 bases atuais vieram do contato do iPhone | ⏳ PENDENTE (chave Google/Edge Function) |

### Bug de banco encontrado e corrigido (crítico)
O app oferecia o botão **"Mark arrived"** ao motorista e gravava `route_stops.status = 'arrived'`, mas o `CHECK` do banco só aceitava `pending, picked_up, completed, skipped` → **a ação falhava** (`ERROR 23514 violates check constraint`). Provado por execução e corrigido com `ALTER TABLE ... ADD CONSTRAINT route_stops_status_check CHECK (status = ANY (ARRAY['pending','arrived','picked_up','completed','skipped']))`, verificado numa transação revertida (não sujou dados).

## P1 — Importante, não trava
- ✅ **Motorista agora vê comportamento/saúde do cão** (`behavior_notes`, `medical_notes`): bloco `⚠ MEDICAL` (vermelho) e `BEHAVIOR` na parada — antes só via as instruções de acesso.
- ✅ **Busca na lista de clientes**: por nome, telefone, endereço, cidade ou nome do cão; ignora acento e maiúscula (`joao` acha `João`).
- ✅ **Ciclo de vida da rota completo**: o status `completed` **nunca era atingido** (nenhum código o definia); agora o manager fecha a rota com **✓ Done**, e há **Unpublish** e **✕ cancelar**.
- ✅ **Histórico de rotas** (More → Route history): data, motorista, status e resumo das paradas (`3/4 stops · 1 skipped · 1 pending`), últimas 60 rotas.
- ⏳ **Sem push notifications** (cliente avisando / motorista recebendo rota) — `expo-notifications` aguardando credenciais APNs.
- ⏳ **Sem tela de organização** (nome, endereço, fuso, horários de operação).
- ⏳ **Reserva não gera parada automaticamente**: o manager monta a rota na mão no dispatch (decidir se é intencional).

## P2 — Desejável
- Foto do cão (`dogs.photo_url` existe, sem upload).
- Histórico de alterações (`audit_logs` existe e não é alimentado).
- Exportar CSV (clientes/reservas) para contabilidade.
- `route_versions` existe (versões publicadas) e não é usado na interface.

## Entregue nesta correção
- `app/client-edit.tsx` — tela de edição do cliente (abre ao tocar no card).
- `features/clients/EditClientForm.tsx` — formulário: nome, telefone, endereço completo, notas internas, notas de agendamento, instruções de acesso, cães (nome/raça/comportamento/saúde), "Add dogs", toggle Active.
- `features/clients/clientsService.ts` — regras puras: normalização (vazio → null), detecção de mudança de endereço, payload do update, payload do cão, nomes novos sem repetir.
- `_features/clients/ClientsList.tsx` — card clicável ("Edit ›"), chip `INACTIVE`.
- Testes: `__tests__/clientEdit.test.ts` (7) e `__tests__/ClientsList.test.tsx` (4, incluindo "abre a edição ao tocar").

Gates: `npm run typecheck` limpo · **141/141 testes**.
