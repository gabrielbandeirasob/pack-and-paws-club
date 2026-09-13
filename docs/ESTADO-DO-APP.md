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

## Exclusões e qualidade de vida — 13/09/2026

Pedido do dono: *"não tem como excluir clientes e nem motorista — faça essa correção e vasculhe no app por mais melhorias"*.

| O que entrou | Detalhe |
|---|---|
| **Excluir cliente** | botão no fim da tela de edição. Antes de apagar, mostra o que vai junto (cães, reservas, passagem pelas rotas) e oferece **"Keep history (inactive)"**; com histórico, exige **duas confirmações** (o banco apaga reservas e paradas de rota em cascata) |
| **Excluir cachorro** | cada cão do cadastro pode ser tirado (marcado como "will be removed" e efetivado no salvar, com desfazer antes de salvar). Só apaga id que é daquele cliente |
| **Excluir motorista** | botão "Remove driver" no modal: apaga o vínculo (`organization_members`) + os tokens de push. Avisa quantas rotas de **hoje em diante** ficam sem motorista e oferece **"Disable instead"**. Não apaga a conta do usuário (exige chave de admin) nem o histórico de rotas |
| **Nova política de banco** | `device_tokens_manager_delete` (migration 022, **aplicada e conferida** em `pg_policies`): gestor consegue limpar o token de quem saiu, e o push para na hora |
| **Ligar / mandar mensagem** | botão **Call** e **Text** no card do cliente e na edição (número limpo do formato do iPhone; número curto demais **não** vira botão) |
| **Rota para o endereço** | botão "Directions to this address" na edição do cliente, abrindo o mapa preferido do gestor |
| **Puxar para atualizar** | lista de clientes e de motoristas |
| **Buscar motorista** | campo de busca (aparece quando há mais de um) |
| **Nome sujo do contato** | botão que move o cachorro que veio colado no nome (`Leigh Ann(Mowgli)`) para a lista de cães — resolve o caso `Elisha Ma (Mocha)` sem apagar nada |
| **Trocar a senha** | a tela só existia no primeiro acesso; agora há **Change password** no More (gestor) e no Profile (motorista) |
| **Ajuda & suporte** | linha no More que abre o e-mail de suporte com **versão, build, aparelho e conta** já preenchidos, mais a versão do app no rodapé |

### Segunda leva — 13/09/2026 (as 4 pendências do relatório anterior)

| O que entrou | Detalhe |
|---|---|
| **Filtrar inativos** | botão "Hide N inactive / Show N inactive" na lista de clientes (inativo **não** some sozinho: arquivado continua sendo dado do negócio) e **ativos primeiro** na ordem |
| **Aviso de duplicado** | ao revisar o cadastro vindo dos contatos, avisa quando já existe cliente com o **mesmo nome** ou o **mesmo cachorro** — o banco só bloqueia duplicata do *mesmo contato*, então a família podia ficar partida em dois cadastros |
| **Desfazer a exclusão** | cliente **sem** reserva nem histórico de rota: depois de excluir, oferece **Undo**, que reinsere cliente, cães e instruções **com os mesmos ids**. Com histórico, nada é oferecido (não haveria como devolver as reservas) |
| **Convidar gestor** | o convite agora tem papel **Driver / Manager** (função de borda `add-driver` aceita `role`, publicada). A tela virou **Team**: lista motoristas **e** gestores, com o papel ao lado do status |

**Evidência (2ª leva):** `tsc --noEmit` limpo · **365 testes em 61 suítes** passando · função `add-driver` republicada no Supabase (`Deployed Functions`) · política da migration 022 conferida em `pg_policies`.

**Evidência:** `tsc --noEmit` limpo · **348 testes em 59 suítes** passando (eram 300/53; +5 arquivos de teste: exclusão de cliente, exclusão na tela, remoção de motorista, ações de contato, suporte) · `expo export --platform ios` empacotou o bundle sem erro.

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
