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
