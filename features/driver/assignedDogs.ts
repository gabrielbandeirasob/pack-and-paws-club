/**
 * "Assigned today" — UMA linha por CÃO, mesmo com as DUAS pernas publicadas.
 *
 * Desde o modelo de duas pernas (01/10/2026) o dia do motorista são DUAS linhas em `routes`:
 * a perna de BUSCA (`phase='pickup'`) e a de ENTREGA (`phase='dropoff'`), e o MESMO cão tem parada
 * nas duas. A tela listava as paradas de todas as rotas publicadas do dia, então o cão aparecia
 * duas vezes — inclusive com status contraditório (a parada da busca `completed` e a da entrega
 * `pending`) — e o cabeçalho contava o dobro.
 *
 * Medido no dia 16/10/2026 (org e2e, 2 cães, busca + entrega publicadas): a tela dizia
 * **"4 dogs · 2 done"** e mostrava `AUDIT 1 Pending` e `AUDIT 1 Done` na mesma lista.
 *
 * Regra daqui: a linha do cão fica na posição da PRIMEIRA parada dele na ordem do dia (a ordem que
 * o motorista vê na rota) e mostra o estado que ainda falta cumprir:
 * alguma parada pendente ⇒ pendente; senão alguma pulada ⇒ pulada; senão ⇒ concluída.
 */

/** Pesos do estado do cão: o maior manda. Pendente (trabalho por fazer) > pulada > concluída. */
const PESO_DO_STATUS: Record<string, number> = {
  pending: 3,
  arrived: 3,
  picked_up: 3,
  skipped: 2,
  completed: 1,
};

export function statusDoCao(statuses: string[]): string {
  let escolhido = statuses[0] ?? 'pending';
  for (const status of statuses) {
    if ((PESO_DO_STATUS[status] ?? 0) > (PESO_DO_STATUS[escolhido] ?? 0)) escolhido = status;
  }
  return escolhido;
}

export type ParadaComCao = { id: string; status: string; dogId?: string | null };

/**
 * Junta as paradas das duas pernas numa linha por cão.
 * Sem `dogId` (a RLS pode esconder o embed de `dogs`) a parada vale por si — nunca some da lista.
 */
export function umCaoPorLinha<T extends ParadaComCao>(paradas: T[]): T[] {
  const porCao = new Map<string, T>();
  for (const parada of paradas) {
    const chave = parada.dogId ?? `parada:${parada.id}`;
    const atual = porCao.get(chave);
    if (!atual) {
      porCao.set(chave, parada);
      continue;
    }
    if ((PESO_DO_STATUS[parada.status] ?? 0) > (PESO_DO_STATUS[atual.status] ?? 0)) {
      porCao.set(chave, { ...atual, status: parada.status });
    }
  }
  return [...porCao.values()];
}
