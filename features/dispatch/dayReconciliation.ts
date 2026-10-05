/**
 * Reconciliação do Dispatch com as reservas CONFIRMADAS do dia (dono, 03/10/2026).
 *
 * As duas telas leem fontes DIFERENTES: o Calendar lê as reservas `confirmed` do dia; a lista do
 * Dispatch desenha as linhas a partir das PARADAS da rota publicada (`route_stops`), que congelam o que
 * existia no momento em que o gestor publicou. Sem reconciliação, um cão cuja reserva foi CANCELADA
 * depois da publicação continua aparecendo na rota, e o cão NOVO (cuja reserva entrou no lugar) fica só
 * na fila de não-atribuídos.
 *
 * Este módulo é PURO: recebe as paradas da rota e o conjunto de cães que o dia confirmado oferece, e diz
 * quais paradas NÃO estão mais no dia. A tela só SINALIZA — nunca remove a parada sozinha; a saída
 * continua sendo o "Remove from route" que já existe.
 */
export type ParadaComCao = { dogId: string; clientName: string; dogName: string };

/**
 * Selo em inglês na linha da parada que não está mais no dia (o gestor lê em inglês).
 *
 * Redesenho (05/10/2026, item 9): a frase longa `Booking cancelled — no longer in today's day`
 * repetia no TOPO e na parada. O topo virou um contador compacto (`⚠ 1 booking changed`) e a frase
 * inteira ficou só AQUI, na linha da parada — mais curta e dizendo o que aconteceu.
 */
export const SELO_PARADA_FORA_DO_DIA = "Cancelled — removed from today's route";

/** Paradas da rota que NÃO estão no pool do dia confirmado (reserva cancelada/substituída). */
export function paradasForaDoDia<T extends ParadaComCao>(stops: readonly T[], diaDogIds: ReadonlySet<string>): T[] {
  return stops.filter((stop) => !diaDogIds.has(stop.dogId));
}

/**
 * Frase do topo do cartão: UM aviso por assunto (item 9). O detalhe (quais cães) vive na própria
 * linha da parada; aqui fica só o contador, compacto — `⚠ 1 booking changed` / `⚠ 2 bookings changed`.
 * Sem parada fora do dia devolve `null` (nada é desenhado).
 */
export function avisoDeParadasForaDoDia(fora: readonly ParadaComCao[]): string | null {
  if (fora.length === 0) return null;
  return `⚠ ${fora.length} booking${fora.length === 1 ? '' : 's'} changed`;
}
