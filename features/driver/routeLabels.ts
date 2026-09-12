/**
 * Rotulos e agrupamento das telas do motorista — funcoes puras (testadas sem renderizar nada).
 *
 * As telas "Schedule" e "Assigned" mostravam o texto cru do banco ("2026-09-11", "published",
 * "pending") e a lista vinha na ordem do banco, nao na ordem da rota. Aqui ficam a traducao
 * para o que o motorista entende e a ordenacao certa.
 */

export type RouteLike = { route_date: string };

/** Status da rota em ingles, como o resto do app. */
export function routeStatusLabel(status: string): string {
  switch (status) {
    case 'published':
      return 'Published';
    case 'draft':
      return 'Draft';
    case 'cancelled':
      return 'Cancelled';
    case 'completed':
      return 'Completed';
    default:
      return status;
  }
}

/** Status da parada, do ponto de vista de quem esta dirigindo. */
export function stopStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'arrived':
      return 'Arrived';
    case 'picked_up':
      return 'Picked up';
    case 'completed':
      return 'Done';
    case 'skipped':
      return 'Skipped';
    default:
      return status;
  }
}

export type GroupedRoutes<T extends RouteLike> = {
  today: T[];
  upcoming: T[];
  past: T[];
};

/**
 * Separa as rotas em hoje / proximas / anteriores.
 * "upcoming" em ordem crescente (a proxima primeiro) e "past" em ordem decrescente (a mais
 * recente primeiro) — e' assim que o motorista procura.
 */
export function groupRoutesByPeriod<T extends RouteLike>(rotas: T[], hoje: string): GroupedRoutes<T> {
  const ordenadas = [...rotas].sort((a, b) => a.route_date.localeCompare(b.route_date));
  return {
    today: ordenadas.filter((rota) => rota.route_date === hoje),
    upcoming: ordenadas.filter((rota) => rota.route_date > hoje),
    past: ordenadas.filter((rota) => rota.route_date < hoje).reverse(),
  };
}

/** Paradas na ordem da rota (o banco nao garante a ordem; a sequencia e' quem manda). */
export function sortStopsBySequence<T extends { sequence: number | null | undefined }>(paradas: T[]): T[] {
  return [...paradas].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
}

/** Texto curto da parada: "Maria · Mowgli" (com fallback quando falta nome). */
export function stopLabel(cliente: string | null | undefined, cao: string | null | undefined): string {
  const nomeCliente = (cliente ?? '').trim() || 'Client';
  const nomeCao = (cao ?? '').trim() || 'Dog';
  return `${nomeCliente} · ${nomeCao}`;
}
