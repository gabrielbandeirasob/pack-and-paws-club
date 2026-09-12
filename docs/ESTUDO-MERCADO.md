# Estudo de mercado — Pack & Paws Club

**Pedido:** Rafael apontou os dois softwares que "as grandes empresas usam": **Time To Pet** e **Onfleet**.
**Objetivo:** entender as funções dos dois e avaliar o que faz sentido juntar no nosso app.
**Data:** 12/09/2026 · pesquisa com fonte citada (URL em cada afirmação) · relatórios brutos em `estudo/*.json`

---

## 1. O que o Rafael apontou (e por que ele está certíssimo)

Os dois nomes não são concorrentes entre si — são os **dois mundos** que o Pack & Paws juntou:

| Referência | Mundo | O que resolve |
|---|---|---|
| **Time To Pet** | CRM de cuidado de pets | Agendamento, tutor, cão, reservas, faturas, app do cliente, equipe |
| **Onfleet** | Despacho e logística | Rota otimizada, app do motorista, rastreio ao vivo, comprovante de entrega |

**Nossa tese é exatamente a interseção:** cuidado de pet **com van de transporte**. E a pesquisa
confirmou o principal: **nenhum dos dois lados cobre o outro lado** (§6).

---

## 2. Quanto custa o mercado (referência para calibrar nossa mensalidade)

| Produto | Preço por mês | Observação |
|---|---|---|
| **Time To Pet** | US$ 25 (Lite) · 50 (Solo) · **40 + 16 por funcionário ativo** (Team) · **79 (Facility)** | Add-ons: SMS 10, site 15, folha 40+6/pessoa |
| **Gingr** | **~105 a 155** por localização | Planos por serviço (Spa/Play/Stay); Enterprise sob consulta |
| **MoeGo** | 49 (Basic) · 99 (Growth) · 159 (Ultimate) | SMS cobrado à parte (~100/mês) |
| **DaySmart Pet** | 29 · 69 · 149 · 199 | 1 a 6 usuários conforme plano |
| **PetExec** | a partir de 105 | Foco multi-serviço |
| **ProPet** | 49,99 + módulos (boarding +20, daycare +15, tosa +15) | Preço "de entrada" engana: soma rápido |
| **Pawfinity** | 55 a 60 | Pequenos salões |
| **PetPocketbook** | 23,75 (anual) / 25 (mensal) | Preço único, entrada |
| **Onfleet** | **619 · 1.349 · 3.099** | Cobra por **volume de tarefas** (2.500 / 5.000 / 10.000+); **não tem plano barato**; cartão +3,5%; SMS por minuto |

**Taxa de pagamento (padrão do setor):** cartão ~3% + US$ 0,30 · ACH ~1,3% + US$ 0,30 (Time To Pet Payments, via Stripe).

### O achado que muda a conversa

Uma creche com transporte que quisesse fazer o que **nós já fazemos** teria de assinar **dois** softwares:

- **Gingr Stay (155)** + **Onfleet (619)** = **US$ 774/mês** — e nenhum dos dois faz a van da creche
- **Time To Pet Facility (79)** + **Onfleet (619)** = **US$ 698/mês**

**Nossa proposta (US$ 449/mês) é mais barata que o Onfleet sozinho** (US$ 619) — e inclui o CRM inteiro.
Isso não é textinho de venda: é comparação de preço publicado. §9 detalha.

---

## 3. Matriz: o que eles têm × o que nós temos

Legenda: **temos** · **parcial** · **falta** · `—` não se aplica ao nosso modelo

| Capacidade | Time To Pet | Gingr | MoeGo | Onfleet | **Nós** |
|---|---|---|---|---|---|
| Agenda e reservas | sim | sim | sim | — | **temos** |
| Clientes, cães, instruções | sim | sim | sim | — | **temos** |
| App/site do CLIENTE (tutor) | sim | sim | sim | — | **falta** |
| Solicitação de reserva pelo tutor | sim | sim | sim | — | **falta** |
| Faturas e pagamento online | sim | sim | sim | — | **falta** |
| Cartão salvo (card on file) | sim | sim | sim | — | **falta** |
| Pacotes, mensalidades, assinaturas | sim | sim | sim | — | **falta** |
| Carteira de vacinas com bloqueio | sim | sim | parcial | — | **falta** |
| Relatório do dia com fotos | sim | sim (50M+) | sim | — | **falta** |
| Check-in digital / PreCheck / kiosk | parcial | sim | parcial | — | **falta** |
| Capacidade de vaga / kennel board | parcial | sim | parcial | — | **parcial** (dia, não vaga) |
| Contrato/waiver com assinatura | sim | sim | sim | — | **falta** |
| Mensagens no app (2 vias) | sim | sim | sim | — | **falta** |
| Lembretes automáticos e SMS | sim (+10) | sim | sim (add-on) | — | **falta** |
| Relatórios financeiros + QuickBooks | sim | sim | parcial | — | **falta** |
| **Gestão de motorista e rota** | GPS de visita | — | rota de tosa | **sim** | **temos** |
| **Rotas com trânsito real** | — | — | parcial | sim | **temos** (Google Routes) |
| **Rastreio do motorista ao vivo** | parcial (visita) | — | parcial | **sim** | **falta** |
| **Comprovante de entrega (foto/assinatura)** | parcial | — | — | **sim** | **falta** |
| **Aviso automático ao tutor com ETA da van** | parcial | — | — | **sim** | **falta** |
| **App do motorista com modo offline** | — | — | — | parcial | **temos** |
| Multi-organização isolada (RLS) | — | multi-local | — | multi-hub | **temos** |

---

## 4. O que é OBRIGATÓRIO hoje (sem isso não se vende)

Segundo comparativos e avaliações do setor (fontes nos `estudo/*.json`):

1. **Agendamento online 24/7** com disponibilidade real (sem overbooking)
2. **Portal/app do tutor** — já é o "balcão moderno" do setor
3. **Check-in digital com assinatura de contrato/waiver antes de chegar** — descrito como "non-negotiable" em 2026
4. **Vacinação com bloqueio automático**: upload do comprovante, alerta 30 dias antes e **reserva bloqueada quando vence**
5. **Comunicação automatizada + relatório do dia com fotos**
6. **Pagamentos integrados** (com a taxa de processamento separada)
7. **Lembretes automáticos** (redução de no-show)
8. **Gestão de capacidade** (vaga/ocupação)
9. **Relatórios financeiros + integração com contabilidade (QuickBooks)**
10. **SMS de duas vias** — "essencial" para a maioria

---

## 5. Nossos diferenciais — e já estão prontos

A própria pesquisa de concorrentes lista o que **ninguém** faz bem. Destes, três são nossos de nascença:

| Diferencial | Situação no mercado | Nosso estado |
|---|---|---|
| **Transporte/van como fluxo nativo** | "nenhum concorrente aborda o transporte de van da creche como fluxo nativo" | **pronto** (rota + paradas por cão + despacho) |
| **App offline-first para a operação** | "não encontramos menção de modo offline robusto em nenhuma das ferramentas" | **pronto** (motorista trabalha sem sinal) |
| **UI simples / curva de aprendizado** | MoeGo e Gingr criticados por "pesados, muitos cliques, onboarding longo" | vantagem nossa (app enxuto) |
| **Suporte humano** | "praticamente todos sofrem com suporte ruim" | oportunidade nossa (suporte dedicado) |
| **Preço previsível** | relatos de aumento de **4×** (MoeGo) e SMS como add-on caro | nossa mensalidade é fixa |
| **API/Zapier abertos** | API só no plano Enterprise (MoeGo); Zapier ausente | oportunidade nossa |
| **Rotas com trânsito real** | Onfleet sim, CRM de pet não | **pronto** (Google Route Matrix) |

---

## 6. O que juntar dos dois — roadmap priorizado

### P0 — sem isto não competimos (o lado Time To Pet)

| # | Item | Por que | Esforço |
|---|---|---|---|
| 1 | **Portal do tutor** (login, cão, agenda, histórico) | porta de entrada de tudo; item obrigatório nº1 | grande |
| 2 | **Solicitação de reserva** (request-to-book com aprovação) | padrão do setor: o tutor **solicita**, a creche aprova | médio |
| 3 | **Pagamentos** (Stripe: cartão salvo, fatura, pagamento online) | sem isso não há garantia de reserva nem receita recorrente | grande |
| 4 | **Carteira de vacinas com bloqueio automático** | exigência sanitária e de licenciamento local | médio |
| 5 | **Relatório do dia com fotos** | o item que o tutor mais valoriza | médio |
| 6 | **Cobrança automática + política aceita com registro** | viabiliza no-show, late fee e mensalidade | médio |

### P1 — o que o Onfleet ensina para o nosso transporte

| # | Item | Por que | Esforço |
|---|---|---|---|
| 7 | **Rastreio do motorista ao vivo** (mapa do gestor) | visibilidade da operação em tempo real | médio |
| 8 | **Aviso automático ao tutor com ETA da van** ("a van está a ~10 min") | o de maior valor percebido no transporte: mata a ligação "onde está a van?" | médio |
| 9 | **Comprovante de entrega** (foto/assinatura configurável) | encerra disputa e dá registro | pequeno |
| 10 | **Estados de exceção explícitos** (cão não estava, portão fechado, nova tentativa, alerta de atraso) | é o que acontece todo dia na vida real | pequeno |
| 11 | **Tempo real por parada + quilometragem** | base dos relatórios de produtividade | pequeno |
| 12 | **Exportação CSV** de rota/paradas/comprovantes | conferência do gestor e contabilidade | pequeno |

### P2 — encanto e escala (depois de vender)

13. Pacotes de dias, mensalidades e assinaturas · 14. Check-in digital com waiver assinado ·
15. Lembretes automáticos e SMS de duas vias · 16. Integração QuickBooks · 17. Mensagens no app ·
18. Webcam/galeria de fotos · 19. Programa de fidelidade

---

## 7. O que NÃO copiar (evita inflar o app)

| Não fazer | Por que |
|---|---|
| Despacho automático por regras / multi-veículo | 1 van e 1 motorista: não há decisão de atribuição a automatizar |
| Motor de roteirização próprio | já usamos Google Route Matrix com trânsito real; duplicar não agrega |
| Rede de motoristas terceiros / courier suite | não temos frota terceirizada |
| Código de barras, leitura de documento/idade | não existe volume a escanear no transporte de cães |
| Multi-hub, multi-marca, SSO corporativo | operação única em San Francisco |
| Integrações de e-commerce (Shopify/WooCommerce) | não vendemos produto online |
| Dashboards customizáveis por papel | somos poucos usuários; um painel basta |
| Chat mascarado motorista↔tutor com telefonia | relação tutor↔creche já é pessoal; telefonia é caro e desnecessário |
| **Modelo de preço por tarefa** | é o ponto mais criticado da Onfleet (conta imprevisível) — nosso preço é fixo |

---

## 8. Cobrança: o que é preciso saber antes de escrever código

| Cuidado | Por quê |
|---|---|
| **Nunca guardar cartão/CVV no nosso banco** | guarda-se só o `payment_method_id` do Stripe; mantém o app no PCI mais simples (SAQ A) |
| Cartão salvo sem cobrar agora | *Setup Intent* (Checkout em modo setup) e cobrar depois **off-session** |
| Cobrar no-show/late fee | só é defensável com a **política aceita e registrada** (versão + data/hora) — é decisão de schema, não de tela |
| Débito em conta (ACH) | método americano; exige mandato de autorização do cliente |
| Quem é o merchant | a conta Stripe tem de ser de negócio **dos EUA** (entidade + conta bancária). A Pack & Paws já opera em San Francisco: a conta é **dela** (mesmo desenho da chave do Google). O **código** pode ser construído por nós daqui |
| Reserva instantânea | o padrão do setor é o tutor **solicitar** e a creche aprovar |
| Vacina vencida | a reserva tem de ser **bloqueada** (exigência sanitária e de licenciamento) |
| Cartão do tutor | o tutor precisa poder **atualizar o próprio cartão** — cartão expirado derruba a cobrança automática |
| Erros do setor a evitar | cobrança duplicada · mensagem automática errada · cobrar sem política registrada (risco de chargeback) |

---

## 9. O que isso diz sobre o nosso preço (US$ 3.000 + US$ 449/mês)

Comparando com o mercado **publicado**:

| Cenário do cliente sem o nosso app | Custo mensal |
|---|---|
| CRM de creche (Gingr Stay) + despacho (Onfleet Launch) | **US$ 774** |
| CRM (Time To Pet Facility) + despacho (Onfleet Launch) | **US$ 698** |
| **Só o Onfleet** (sem CRM de pet) | **US$ 619** |
| Gingr Stay sozinho (sem transporte) | **US$ 155** |
| **Pack & Paws** (CRM + transporte + suporte dedicado) | **US$ 449** |

**Leitura honesta:** sozinhos, somos caros (o mercado de CRM começa em US$ 25). **Comparados ao que o
cliente realmente teria de comprar para fazer o que já fazemos — CRM + despacho — somos mais baratos.**
Portanto a venda não é "software de creche": é **"um software em vez de dois, com o transporte que
nenhum deles faz, e suporte de gente"**.

E dois argumentos que a pesquisa entregou de graça: os concorrentes são criticados por **aumentar preço**
(relatos de 4×) e por **suporte ruim** — exatamente onde a proposta de valor está.

---

## 10. Anexos

- `estudo/time-to-pet.json` · `gingr.json` · `moego.json` · `portal-pag.json` · `onfleet.json`
  (relatórios brutos, cada afirmação com URL de origem)
- `estudo/resumo.py` — extrator usado para gerar as tabelas deste documento
- Fontes principais: timetopet.com/pricing · gingrapp.com · moego.pet/pricing · daysmart.com/pet/pricing ·
  onfleet.com/pricing · petmanager.com · franpos.com · guideflow.com · stripe.com/docs · g2/capterra/capterra reviews
