/**
 * Bolinha do menu: quantos itens do to-do do dia ainda estão abertos.
 *
 * Por que um store fora do React: quem sabe o número é a Home (que carrega os itens), mas quem
 * DESENHA a bolinha é a barra de abas (`app/(tabs)/_layout.tsx`) — são duas árvores diferentes. Um
 * store minúsculo com `useSyncExternalStore` resolve isso sem provider e sem prop drilling.
 *
 * Pedido da operação (26/09/2026): "vai gerar tipo aquela bolinha para você clicar no menu".
 */

type Estado = { day: string | null; pending: number };

let estado: Estado = { day: null, pending: 0 };
const ouvintes = new Set<() => void>();

/** Chamado pela Home depois de carregar/mexer na lista do dia. */
export function registrarTodosPendentes(day: string, pending: number): void {
  if (estado.day === day && estado.pending === pending) return;
  estado = { day, pending };
  for (const ouvinte of ouvintes) ouvinte();
}

export function assinarTodosPendentes(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

export function lerTodosPendentes(): number {
  return estado.pending;
}

/** Ao sair da tela (ou sem organização), a bolinha não pode ficar mentindo. */
export function limparTodosPendentes(): void {
  registrarTodosPendentes(estado.day ?? '', 0);
}
