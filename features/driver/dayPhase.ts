/**
 * A FASE DO DIA: PICK-UP ou DROP-OFF — e quem vira a chave é o MOTORISTA.
 *
 * 🪤 CLIENTE (áudios de 02/10/2026, encaminhados pelo dono):
 *   *"agora eu cliquei que cheguei, peguei o cachorro, agora ele vai para a rota de drop off — olha
 *   como está a rota de drop off, está aparecendo como se eu já tivesse feito todos"*
 *   *"Tem que ter uma mudança clara de rota, de pickup e drop-off. Ele NÃO tem que fazer essa mudança
 *   automática. Eu tive que despublicar e republicar a rota para atualizar a de drop-off."*
 *
 * O que estava errado: o app NÃO tinha fase. Ele DEDUZIA a virada pelo `status` das paradas. Como o
 * pick-up grava `picked_up` + `completed` no mesmo toque, a lista inteira passava a parecer "feita" —
 * e um cão posto direto no drop-off (sem busca) nascia `pending`, o que fazia o app cobrar uma BUSCA
 * que nunca existiu e travar a entrega.
 *
 * Agora o dia tem uma fase EXPLÍCITA, guardada no aparelho por rota (e por usuário — a mesma regra de
 * dono das filas), e só o motorista a vira, com um botão. Decisão do dono (02/10/2026): *"deve ser um
 * botão do motorista"*.
 *
 * As regras de DECISÃO são puras (testáveis sem tela). A PERSISTÊNCIA da fase mora em
 * `dayPhaseStore.ts` — separada de propósito: a tela (DriverRouteView) importa só as regras puras e,
 * assim, não arrasta o AsyncStorage para dentro do teste de renderização.
 */
import { buscaTerminou, entregaTerminou } from '@/features/driver/routeClosing';

export type DayPhase = 'pickup' | 'dropoff';

/**
 * A ETAPA corrente do dia, na ordem do dono (03/10/2026, verbatim): *"driver vai pra van, dá clock in,
 * começa a etapa de pick up dos cachorros, depois de pegar todos os cachorros é pra ir pro yard, depois
 * do yard começa o drop off, e após deixar todos os cachorros o driver volta pra onde pegou a van e dá
 * clock off."* Ou seja: `pickups` → `to_yard` → `dropoffs` → `to_van`.
 */
export type EtapaDoDia = 'pickups' | 'to_yard' | 'dropoffs' | 'to_van';

/**
 * Qual fase o app deve REALMENTE usar, dada a fase GRAVADA no aparelho e a perna de BUSCA do dia.
 *
 * 🪤 BUG REAL (03/10/2026): a fase fica no aparelho por rota+usuário (`dayPhaseStore`) e era restaurada
 * SEM conferir o dia. Com 'dropoff' guardado de um teste anterior, o motorista abriu o app JÁ na ENTREGA
 * e os cães da BUSCA (todos `pending`) apareceram como entregáveis — ele marcou "Delivered" em 4 cães em
 * 30 segundos e o banco ficou com `status='pending'` E `delivered_at` carimbado (estado incoerente).
 *
 * Regra: NUNCA se entrega antes de buscar. Se a fase guardada é 'dropoff' mas a perna de BUSCA ainda tem
 * cão sem buscar (`buscaTerminou` falso), a fase efetiva volta para 'pickup'. A ÚNICA exceção é a perna
 * de busca VAZIA (aí não há busca a fazer e a entrega pode ser a etapa certa — cão posto direto na
 * entrega). 'pickup' nunca é promovido a 'dropoff' sozinho.
 */
export function faseEfetiva(
  faseGuardada: DayPhase,
  paradasDaBusca: { status: string }[],
): DayPhase {
  if (faseGuardada !== 'dropoff') return faseGuardada;
  if (paradasDaBusca.length === 0) return 'dropoff';
  return buscaTerminou(paradasDaBusca) ? 'dropoff' : 'pickup';
}

/**
 * A ETAPA do dia, pura (testável sem tela). É o que a tela usa para apresentar o momento certo e para
 * saber que, depois da última BUSCA, o dia VAI AO YARD antes de qualquer entrega:
 *  - fase 'pickup' e ainda há cão para buscar → 'pickups';
 *  - fase 'pickup' e as buscas terminaram → 'to_yard';
 *  - fase 'dropoff' e ainda há cão para entregar → 'dropoffs';
 *  - fase 'dropoff' e a entrega terminou → 'to_van' (volta para onde pegou a van; aí é o clock off).
 */
export function etapaDoDia(params: {
  fase: DayPhase;
  paradasDaBusca: { status: string }[];
  paradasDaEntrega: { status: string; deliveredAt?: string | null }[];
}): EtapaDoDia {
  const { fase, paradasDaBusca, paradasDaEntrega } = params;
  if (fase === 'dropoff') {
    return entregaTerminou(paradasDaEntrega) ? 'to_van' : 'dropoffs';
  }
  return buscaTerminou(paradasDaBusca) ? 'to_yard' : 'pickups';
}

/**
 * O botão "Start drop-offs" só aparece quando a BUSCA acabou e ainda há ENTREGA a fazer.
 * Enquanto houver cão para buscar (`pending`/`arrived`), a virada não é oferecida.
 */
export function podeIniciarDropoff(
  stops: { status: string; deliveredAt?: string | null }[],
): boolean {
  return buscaTerminou(stops) && !entregaTerminou(stops);
}

/**
 * A parada está FECHADA nesta fase?
 *  - busca: `completed` (o toque grava `picked_up` + `completed`) ou `skipped`;
 *  - entrega: só a ENTREGA (`delivered_at`) ou `skipped` fecha. É isto que impede a lista de drop-off
 *    de aparecer "toda feita" por causa do pick-up.
 */
export function paradaDaFaseConcluida(
  stop: { status: string; deliveredAt?: string | null },
  fase: DayPhase,
): boolean {
  if (stop.status === 'skipped') return true;
  return fase === 'dropoff' ? Boolean(stop.deliveredAt) : stop.status === 'completed';
}

/**
 * A parada pode ser ENTREGUE agora?
 *  - na busca: só depois de pega (`picked_up`/`completed`);
 *  - na entrega: qualquer parada viva — inclusive um cão posto DIRETO no drop-off, que chega `pending`
 *    e NÃO pode ser cobrado como busca (é o defeito do áudio: "está cobrando que eu peguei esse
 *    cachorro na rota de pickup").
 */
export function paradaEntregavel(
  stop: { status: string; deliveredAt?: string | null },
  fase: DayPhase,
): boolean {
  if (stop.status === 'skipped' || stop.deliveredAt) return false;
  return fase === 'dropoff' ? true : stop.status === 'picked_up' || stop.status === 'completed';
}

/** Ordena a lista pela PERNA da fase: busca (sequence) ou entrega (dropoff_sequence). */
export function ordenarPelaFase<
  T extends { sequence: number; dropoffSequence?: number | null },
>(stops: readonly T[], fase: DayPhase): T[] {
  const copia = [...stops];
  if (fase === 'pickup') return copia.sort((a, b) => a.sequence - b.sequence);
  return copia.sort((a, b) => {
    if (a.dropoffSequence == null) return b.dropoffSequence == null ? a.sequence - b.sequence : 1;
    if (b.dropoffSequence == null) return -1;
    return a.dropoffSequence - b.dropoffSequence || a.sequence - b.sequence;
  });
}
