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

/** Selo em inglês na linha da parada que não está mais no dia (o gestor lê em inglês). */
export const SELO_PARADA_FORA_DO_DIA = "Booking cancelled — no longer in today's day";

/** Paradas da rota que NÃO estão no pool do dia confirmado (reserva cancelada/substituída). */
export function paradasForaDoDia<T extends ParadaComCao>(stops: readonly T[], diaDogIds: ReadonlySet<string>): T[] {
  return stops.filter((stop) => !diaDogIds.has(stop.dogId));
}

/**
 * Frase do topo do cartão: quantas e QUAIS paradas saíram do dia.
 * `1 stop is no longer in today's day: Akmal · Enso` / `2 stops are …: Akmal · Enso, Sam · Ollie`.
 * Sem parada fora do dia devolve `null` (nada é desenhado).
 */
export function avisoDeParadasForaDoDia(fora: readonly ParadaComCao[]): string | null {
  if (fora.length === 0) return null;
  const nomes = fora.map((p) => `${p.dogName}`).join(', ');
  const singular = fora.length === 1;
  return `${fora.length} stop${singular ? '' : 's'} ${singular ? 'is' : 'are'} no longer in today's day: ${nomes}`;
}
