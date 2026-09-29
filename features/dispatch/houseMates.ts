/**
 * CÃES DA MESMA CASA — pedido do dono em áudio (29/09/2026):
 *
 *   * áudio 1: *"eu quero que arrume com urgência o bagulho do Dispatch… tem o Sam e o Oli hoje no
 *     calendário… eles são da mesma casa, então automaticamente se eu mandar o Sam para um driver, o
 *     Oli vai para o mesmo driver… o que está acontecendo agora é que ele separa os dois cachorros…
 *     como eles moram na mesma casa, eles têm que ir juntos… não faz sentido eu ter que clicar duas
 *     vezes para a mesma casa"*;
 *   * áudio 2: *"na hora de ver lá no calendário, no mesmo spot dois cachorros, ele tem que reconhecer
 *     que são dois cachorros, mas na hora de fazer o Dispatch, se os dois cachorros são da mesma casa,
 *     eles são um pick-up só"*.
 *
 * Leitura da regra (as duas coisas ao mesmo tempo, é o que o dono pediu):
 *  - **Contagem: continuam sendo DOIS cães.** Nada aqui funde cão: a fila do dia, o total de cães, o
 *    Total Pack e o calendário seguem mostrando dois. (Foi o pedido explícito do áudio 2.)
 *  - **Trabalho do gestor: UM só.** Atribuir um cão ao motorista leva junto os irmãos de casa que ainda
 *    estão sem motorista — e o banco já junta as paradas do mesmo cliente numa tarefa só
 *    (`route_stops.stop_group_id`, migração 029), então para o motorista é literalmente um pick-up.
 *
 * A "casa" é o **cliente** (`dogs.client_id`) — é a chave que o banco usa na migração 029 e é o que os
 * dois cães do Jose (Sam e Ollie, 56 Melrose Pl) confirmam no cadastro.
 *
 * Módulo puro: nada de banco, nada de tela.
 */

export type CaoDaFila = { dogId: string; clientId?: string | null };

/** Os outros cães da fila do dia que moram na mesma casa (mesmo cliente). */
export function irmaosDeCasa<T extends CaoDaFila>(fila: T[], dogId: string): T[] {
  const alvo = fila.find((item) => item.dogId === dogId);
  if (!alvo?.clientId) return [];
  return fila.filter((item) => item.dogId !== dogId && item.clientId === alvo.clientId);
}

/**
 * Quem vai JUNTO quando o gestor atribui `dogId`: irmãos de casa que ainda NÃO estão em rota nenhuma.
 *
 * Só entra quem está sem motorista de propósito: se um dos irmãos já foi posto em outro carro à mão,
 * essa escolha do gestor é respeitada (e o gestor decide — o dono pediu o automático para o caso
 * normal, não uma trava).
 */
export function vaoJunto<T extends CaoDaFila>(fila: T[], dogId: string, jaNaRota: Set<string>): T[] {
  return irmaosDeCasa(fila, dogId).filter((item) => !jaNaRota.has(item.dogId));
}

/** Nomes dos cães da mesma casa, para mostrar na folha de atribuição ("Sam goes too"). */
export function nomesDosIrmaos<T extends CaoDaFila & { dogName: string }>(fila: T[], dogId: string): string[] {
  return irmaosDeCasa(fila, dogId).map((item) => item.dogName);
}

/**
 * Marca em cada cão da fila os nomes dos irmãos de casa — é o que a folha de atribuição mostra ao
 * gestor ("Sam goes too") e o que explica por que dois cães se movem num clique só. Só a fila
 * PRINCIPAL conta: cão que já está na van não tem pickup para juntar.
 */
export function juntarIrmaosDeCasa<
  T extends CaoDaFila & { dogName: string; inVan?: boolean; houseMates?: string[] },
>(fila: T[]): T[] {
  const principal = fila.filter((item) => !item.inVan);
  return fila.map((item) => (item.inVan ? item : { ...item, houseMates: nomesDosIrmaos(principal, item.dogId) }));
}
