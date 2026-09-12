# Pack & Paws — roteiro de teste (o que falta provar no aparelho)

**Estado em 12/09/2026:** tudo que dava para provar daqui **já está provado** — 282 testes do app,
54 casos de banco, push com **recibo da Apple** (`status: ok`), trânsito real (`fonte: google`),
pinos gravados (7 de 9 clientes) e build 28 publicado no TestFlight.

O que sobra abaixo só existe **dentro do iPhone** (abrir outro aplicativo, tela de bloqueio, modo
avião). Cada item tem o resultado esperado — se algum não bater, me manda o print.

---

## Prioridade 1 — a jornada do motorista (~10 min)

| # | O que fazer | Resultado esperado |
|---|---|---|
| 1 | Com o app **fechado**, publique uma rota para você e **toque no aviso** que chegar | o app abre **na rota**, não na tela inicial |
| 2 | Na parada, toque em **Arrived** → depois **Dog picked up** → depois **Completed** | o selo muda em cada passo (Pending → Arrived → Dog picked up → Completed) |
| 3 | Em **qualquer** estado, toque no **cartão** da parada | abre o mapa / a folha de escolha de app de navegação *(já confirmado)* |
| 4 | Publique uma rota com data de **amanhã** | o aviso diz **"tomorrow"** (não "hoje") e a rota aparece em **Schedule**, não em *Today's Route* |

## Prioridade 2 — o lado do gestor (~10 min)

| # | O que fazer | Resultado esperado |
|---|---|---|
| 5 | Cadastre um cliente **com endereço** (rua e número) e salve | o **pino aparece sozinho** no mapa (é o geocode novo) |
| 6 | Abra o **Dispatch** e olhe a ordem/tempo sugerido da rota | deve bater com o **Google Maps** (agora é tempo de rua com trânsito, não linha reta) |
| 7 | *(opcional, 2 aparelhos)* Dois gestores editando a **mesma** rota | o segundo vê **"a rota mudou em outro aparelho, recarregue"** |

## Prioridade 3 — casos de borda (opcional)

| # | O que fazer | Resultado esperado |
|---|---|---|
| 8 | Ative o **modo avião** com uma rota aberta | a lista continua visível (motorista não fica cego sem sinal) |
| 9 | Negue a permissão de notificação em um aparelho | o app continua funcionando normal — só não recebe avisos |

## Fora do nosso alcance

- **Revisão da Apple** (versão 1.0): quando aprovar, eu libero a loja e monto a **1.1** com tudo o
  que entrou hoje. Aí revalidamos no build que veio da loja.
- **Testes com dados reais do cliente**: dependem da operação dele começar a usar (van saindo no
  horário, endereço de saída, destino padrão).
