# Integração Google (Calendar + Maps) — estado e desenho

## Atualização 12/09/2026 — os dois caminhos do Google estão no ar (falta só a chave)

O que mudou nesta data, com verificação:

| Peça | Estado | Prova |
|---|---|---|
| `travel-times` (Routes API, trânsito) | **publicada** no Supabase, `ACTIVE` versão 1 | `POST /functions/v1/travel-times` -> `HTTP 501 {"error":"sem-chave-do-google"}` |
| `geocode` (Geocoding, endereço -> pino) | **criada e publicada** | mesma resposta de contrato sem chave |
| App: `features/maps/geocodeService.ts` | novo serviço (timeout curto, sem pino chutado) | 17 testes em `__tests__/geocodeService.test.ts` |
| App: pino automático ao salvar | cliente novo e endereço alterado pedem o pino em segundo plano | `app/(tabs)/clients.tsx`, `app/client-edit.tsx` |
| Scripts | `scripts/geocode-clients.mjs` (backfill) e `scripts/google-smoke.mjs` (prova real) | rodam sem chave local |
| Como ligar | `docs/GOOGLE-CHAVES-PASSO-A-PASSO.md` | passo a passo com rótulos do console |

**Dado que motivou o geocoding (medido em 12/09/2026):** dos 9 clientes, **3 tinham coordenada**,
**4 tinham endereço e nenhum pino** e 2 não tinham endereço nenhum. Sem pino, esses 4 ficavam
fora do mapa e fora do cálculo de trânsito — a lista exata está no `scripts/geocode-clients.mjs`
(que é a fonte desse número, não uma estimativa).

Decisão de produto (confirmada pelo cliente em 10/09/2026):

| Tema | Decisão |
|---|---|
| Navegação | O app **não faz turn-by-turn**. Ele calcula a **ordem das paradas** e **redireciona** para o mapa do motorista (Google Maps ou Apple Maps), já apontando para a parada. Sem Navigation SDK (caro), sem GPS contínuo. |
| Mapa dentro do app | Apenas **visão geral** das paradas (desenho da rota), no topo da tela do motorista. Usa **Google Maps** quando a chave do Maps SDK estiver no build; senão cai no **mapa nativo do iOS** (nunca mapa quebrado). |
| Google Calendar | **Uma via**: o Pack & Paws é a fonte; as reservas são espelhadas. **Só o manager** conecta (conta do negócio, do Raphael). |
| Ordem das paradas | Hoje por geometria + janelas de horário (`routeOptimizer`). Com a **Routes API** (chave no servidor) passa a considerar **trânsito real** — o algoritmo já aceita a matriz. |
| Chaves | `Maps SDK for iOS` (pública, restrita ao bundle ID) vai no app; `Geocoding`/`Routes` ficam **no servidor** (Edge Function) — plano §5.4. |

## Implementado (com testes)

| Módulo | Papel |
|---|---|
| `features/maps/links.ts` | URLs de navegação Google/Apple (por coordenada ou endereço) |
| `features/maps/navigation.ts` | Qual app abrir + normalização da preferência |
| `features/maps/region.ts` | Região do mapa que enquadra as paradas |
| `features/maps/RouteMap.tsx` | Mapa de visão geral (Google quando há chave; Apple como fallback) |
| `features/maps/NavigationSheet.tsx` | Escolha Google/Apple com "lembrar minha escolha" |
| `features/maps/preferences.ts` | Preferência do motorista no aparelho (AsyncStorage) |
| `features/integrations/google/calendarSync.ts` | Planejador do espelhamento (criar/atualizar/apagar, idempotente por `appKey`) |
| `features/integrations/google/calendarApi.ts` | Cliente REST do Google Calendar v3 |
| `features/integrations/google/sync.ts` | Executa o plano, não aborta em falha, devolve resumo |
| `features/integrations/google/useCalendarConnection.ts` | OAuth PKCE + refresh automático |
| `features/integrations/google/tokenStore.ts` | Tokens no Keychain (refresh token nunca sai do aparelho) |
| `features/integrations/google/config.ts` | Estado da configuração + escopo `calendar.events` (lê `extra.googleIosClientId` e `ios.config.googleMapsApiKey`) |
| `/opt/data/pack-and-paws/build/set_google_config.py` | Grava as duas credenciais públicas no `app.json` (idempotente, com backup) |

## Falta (depende das credenciais do Google Cloud)
1. **Client ID OAuth iOS** (`GOOGLE_IOS_CLIENT_ID`) — habilita o "Conectar Google Calendar".
2. **Chave do Maps SDK iOS** (`GOOGLE_MAPS_IOS_KEY`) — troca o mapa para o Google.

Definir com `/opt/data/pack-and-paws/build/set_google_config.py --client-id <ID> --maps-key <AIza...>` (grava no `app.json`, com backup; as duas são credenciais públicas restritas ao bundle ID) e rodar um build novo — o mapa passa a usar o Google e aparece o "Conectar Google Calendar".

> ⚠️ **Não** tentar injetar isso com `app.config.js`: a presença da config dinâmica quebrou a cadeia de plugins do prebuild (`withIosInfoPlistBaseMod: Cannot use 'in' operator ... in undefined`) e derrubou o build 8 em 10/09/2026, mesmo com a config resolvendo certa localmente. Config estática resolve.

Depois disso ainda entra:
- Card **"Google Calendar"** no menu *More* (só manager): status, conectar/desconectar, "Sincronizar agora".
- Tabela `calendar_connections` (organização, conta conectada, conectado por) + RLS.
- **Edge Function** para Geocoding/Routes (chave no servidor) → ordem das paradas com trânsito real.

## Como testar depois de configurado

1. Manager → *More* → **Conectar Google Calendar** → escolhe a conta → autoriza.
2. Cria uma reserva no app → ela aparece no Google Calendar em segundos.
3. Altera a reserva (data/serviço) → o evento **atualiza** (não duplica).
4. Cancela a reserva → o evento é removido.
5. Motorista → rota do dia → **mapa de visão geral** no topo + botão **Navigate** → escolhe Google ou Apple → "lembrar escolha" → nas próximas vezes abre direto.
