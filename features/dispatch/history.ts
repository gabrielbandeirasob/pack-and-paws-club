/**
 * Resumo do histórico de rotas (puro, testável).
 * Serve para o manager conferir o que foi executado e o que ficou pendente.
 */
export type HistoryStop = { status: string };

export type StopSummary = {
  total: number;
  done: number;
  skipped: number;
  pending: number;
  inProgress: number;
};

export function summarizeStops(stops: HistoryStop[]): StopSummary {
  const summary: StopSummary = { total: stops.length, done: 0, skipped: 0, pending: 0, inProgress: 0 };
  for (const stop of stops) {
    if (stop.status === 'completed') summary.done += 1;
    else if (stop.status === 'skipped') summary.skipped += 1;
    else if (stop.status === 'arrived' || stop.status === 'picked_up') summary.inProgress += 1;
    else summary.pending += 1;
  }
  return summary;
}

/** "3/4 stops · 1 skipped · 1 pending" — só mostra o que existe. */
export function stopSummaryLabel(summary: StopSummary): string {
  const parts = [`${summary.done}/${summary.total} stops`];
  if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`);
  if (summary.pending > 0) parts.push(`${summary.pending} pending`);
  if (summary.inProgress > 0) parts.push(`${summary.inProgress} in progress`);
  return parts.join(' · ');
}

export type RouteStatusStyle = { label: string; tone: 'green' | 'gold' | 'red' | 'muted' };

export function routeStatusStyle(status: string): RouteStatusStyle {
  if (status === 'completed') return { label: 'Completed', tone: 'green' };
  if (status === 'published') return { label: 'Published', tone: 'gold' };
  if (status === 'cancelled') return { label: 'Cancelled', tone: 'red' };
  return { label: 'Draft', tone: 'muted' };
}

/** Uma rota é "fechada" quando o manager marcou completa ou cancelou. */
export function isClosedRoute(status: string): boolean {
  return status === 'completed' || status === 'cancelled';
}
