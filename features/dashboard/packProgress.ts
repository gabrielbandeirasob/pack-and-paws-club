/**
 * "Total Pack" e progresso do dia — regras puras, testáveis.
 *
 * Pedido do cliente (22/09/2026):
 *  - "Total Pack" = quantos cães saem de fato hoje (o gestor escolhe quem vai na caminhada no Dispatch);
 *  - o gestor quer ver quais cães já foram pegos/concluídos no dia, nas duas rotas.
 *
 * Aqui só entra cálculo: nada de banco nem de tela.
 */

export type PackStop = {
  status: string;
  dogName: string;
  /** Última mudança de estado (ISO) — é o horário que mostramos como "marcado às". */
  at?: string | null;
};

export type PackRoute = {
  driverName: string;
  status: 'draft' | 'published' | string;
  stops: PackStop[];
};

const ROTULOS: Record<string, string> = {
  pending: 'Waiting',
  arrived: 'Arrived',
  picked_up: 'Picked up',
  completed: 'Completed',
  skipped: 'Problem',
};

export function stopStatusLabel(status: string | null | undefined): string {
  return ROTULOS[status ?? ''] ?? 'Waiting';
}

/** Estado final: cão concluído ou marcado com problema (não conta mais como pendente). */
export function stopIsDone(status: string | null | undefined): boolean {
  return status === 'completed' || status === 'skipped';
}

/** Total Pack do dia: um ponto = um cão, somando todas as rotas (rascunho e publicada). */
export function totalPack(routes: PackRoute[]): number {
  return routes.reduce((soma, rota) => soma + rota.stops.length, 0);
}

export type PackProgress = {
  total: number;
  done: number;
  left: number;
  routes: number;
};

export function packProgress(routes: PackRoute[]): PackProgress {
  let total = 0;
  let done = 0;
  for (const rota of routes) {
    total += rota.stops.length;
    done += rota.stops.filter((ponto) => stopIsDone(ponto.status)).length;
  }
  return { total, done, left: total - done, routes: routes.length };
}

/** Texto curto para o painel: "8 of 12 done" (ou "nothing scheduled" quando não há cão). */
export function progressSummary(routes: PackRoute[]): string {
  const { total, done } = packProgress(routes);
  if (total === 0) return 'Nothing scheduled for today';
  return `${done} of ${total} done`;
}

/** Horário local HH:MM a partir de um ISO; null quando não há data válida. */
export function clockOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return null;
  const hh = String(data.getHours()).padStart(2, '0');
  const mm = String(data.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export type ProgressRow = {
  routeId?: string;
  driverName: string;
  routeStatus: 'draft' | 'published' | string;
  stops: { dogName: string; status: string; statusLabel: string; at: string | null }[];
};

/** Linhas da tela "Today's progress": uma seção por rota, na ordem que veio do painel. */
export function progressRows(routes: PackRoute[]): ProgressRow[] {
  return routes.map((rota) => ({
    driverName: rota.driverName,
    routeStatus: rota.status,
    stops: rota.stops.map((ponto) => ({
      dogName: ponto.dogName,
      status: ponto.status,
      statusLabel: stopStatusLabel(ponto.status),
      at: clockOf(ponto.at),
    })),
  }));
}
