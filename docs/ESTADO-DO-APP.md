# Estado do app — Pack & Paws Club

**Atualizado em 12/09/2026 (tarde)** · evidência medida no repositório, no banco e na App Store Connect API

## Onde o app está

| Camada | Estado | Evidência |
|---|---|---|
| App Store | versão **1.0** com **build 15 em revisão** (`WAITING_FOR_REVIEW`), release **manual** | ASC API 12/09 |
| TestFlight | **build 29** publicado e válido; **build 30** em geração (traz o ícone nítido) | ASC API + CI GitHub |
| Ícone da loja | ainda o azul do Expo ✗ — a versão em revisão é a 15, anterior à troca | sobe corrigido na **1.1** |
| Ícone do app | ✅ marca do cliente (escudo + 3 cães), fonte **1320×1710** do site dele | extraído de dentro do IPA do build 29 |
| Push | ✅ **ligado e entregando** (recibo da Apple `status: ok`) | chave APNs `4JP95YZWZ6`, `Sandbox & Production` |
| Trânsito real (Google Routes) | ✅ ligado no servidor | smoke test: `fonte: google`, 1435s entre pontos reais |
| Pinos dos clientes | ✅ 7 de 9 geocodificados (2 sem endereço cadastrado) | conferido no banco |
| Preço | Free (US$ 0) | `appPriceSchedules` |
| Link público do TestFlight | desligado | `publicLinkEnabled: false` |

## Fases do plano mestre — **9 de 9 concluídas**

0 · Fundação visual ✅ · 1 · Auth/orgs/RLS ✅ · 2 · Contatos/clientes/cães ✅ · 3 · Calendário/reservas ✅
4 · Despacho manual ✅ · 5 · App do motorista (offline + sync) ✅ · 6 · Otimização de rotas ✅
7 · Tempo real, localização e ETA ✅ · 8 · Development build e TestFlight ✅ · 9 · Preparação para App Store ✅

## Qualidade (medida em 12/09)

- **300 testes** do app em **53 suítes** ✅ · `typecheck` limpo ✅ · colisão de nomes (macOS) ✅
- **Suíte de banco: 54 casos** em transação com `rollback` (RLS por papel, isolamento entre organizações, fluxos completos, mensagem de push)
- **Build iOS de graça** pelo CI do GitHub (`macos-26`), sem cota do EAS — artefato IPA validado antes de publicar

## Recursos que já existem (base para comparação com o mercado)

**Gestor/escritório:** agenda e calendário · reservas (incluindo recorrentes) · clientes e cães ·
instruções de acesso · contatos do telefone importados · despacho de motorista · otimização de rota
com **trânsito real** · painel de despacho · histórico de rotas · relatórios de estado · multiusuário
com papéis (gestor/motorista) e isolamento por organização (RLS) · login/cadastro · troca de senha ·
monitoramento de erros no próprio banco

**Motorista:** rota do dia · paradas numeradas · navegação para o app de mapas preferido ·
sequência de status (a caminho → chegou → cão embarcado → concluído) · observações ·
**modo offline** com sincronização · notificações push de rota publicada/cancelada

**Integrações:** Google Routes (trânsito) · Google Geocoding (endereço → pino) · Expo Push + APNs ·
Supabase (banco, RLS, funções de borda)

**O que NÃO existe (lacunas frente ao mercado):** portal/app do cliente (tutor) · pagamentos e
cobrança · faturamento/relatórios financeiros · carteira de vacinas · check-in/check-out de balcão ·
relatório do dia com fotos · pacotes/mensalidades · assinaturas digitais · marketing automatizado ·
contabilidade (QuickBooks)

## Correções entregues hoje (12/09)

| Build | O que corrigiu |
|---|---|
| 24 | lista de cães atualiza na hora · seletor de cão com busca · teclado não cobre mais o formulário · ✕ com teclado aberto · ícone da marca |
| 27 | **push ligado** (credencial APNs `Sandbox & Production`) |
| 28 | toque na parada abre a navegação · botão "Navigate" não some em parada concluída · mensagem de push com a **data certa** e em **inglês** |
| 29 | **Dispatch**: nome do motorista não quebra letra por letra · botões de ação descem de linha quando não cabem |

## O que falta (com dono)

| Item | Dono | Situação |
|---|---|---|
| Aprovação da Apple + liberar a versão 1.0 | Apple | em revisão; release é manual |
| Build 1.1 (push + correções + ícone) | nós | depois da aprovação |
| **Portal do cliente + pagamentos** | nós | **estudo de concorrentes em andamento** (Time To Pet, Gingr, MoeGo) |
| Cota diária do Google (trava de fatura) | dono | pendente de confirmação |
| Logo vetorial (opcional) | cliente | só para uso impresso (banner/van) |
| Contrato/proposta | dono + cliente | sem contrato (dev on-spec) |
| Limpeza de nomes com o cão colado (`Elisha Ma (Mocha)`) | dono decide | 1 comando |
