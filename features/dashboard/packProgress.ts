import { formatClock } from '@/lib/clock';

/**
 * "Total Pack" e progresso do dia — regras puras, testáveis.
 *
 * Pedido do cliente (22/09/2026):
 *  - "Total Pack" = quantos cães saem de fato hoje (o gestor escolhe quem vai na caminhada no Dispatch);
 *  - o gestor quer ver quais cães já foram pegos/concluídos no dia, nas duas rotas.
 *
 * Aqui só entra cálculo: nada de banco nem de tela.
 *
 * DESEMPENHO POR MOTORISTA (pedido do dono, 30/09/2026: "a parada do administrador acompanhar o
 * desempenho de cada driver"): `driverPerformance` resume, por rota/motorista, o que a tela
 * "Today's progress" já carrega — concluídas × total, quantas com problema (skipped), quantas
 * pendentes FORA do prazo e a última atualização. O atraso usa a MESMA `isPastDeadline` do resto do
 * app, ou seja, já com a tolerância de 3 minutos (GRACE_MINUTES) — não existe uma segunda definição
 * de "atrasado" aqui.
 */

import { isPastDeadline } from '@/features/driver/eta';

export type PackStop = {
  status: string;
  dogName: string;
  /** Última mudança de estado (ISO) — é o horário que mostramos como "marcado às". */
  at?: string | null;
  /** Prazo da parada (janela/exato, 'HH:MM'). Só o atraso do desempenho usa estes campos. */
  windowEnd?: string | null;
  exactTime?: string | null;
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

/** Horário local em 12 h a partir de um ISO; null quando não há data válida. */
export function clockOf(iso: string | null | undefined): string | null {
  return formatClock(iso);
}

export type ProgressRow = {
  routeId?: string;
  driverName: string;
  routeStatus: 'draft' | 'published' | string;
  stops: { dogName: string; status: string; statusLabel: string; at: string | null }[];
  /** Desempenho do motorista nesta rota (contagens + atraso com a tolerância de 3 min). */
  performance: DriverPerformance;
};

/** Desempenho de UMA rota/motorista, montado só com o que a tela já carrega. */
export type DriverPerformance = {
  driverName: string;
  /** Paradas da rota (um ponto = um cão). */
  total: number;
  /** Concluídas ou marcadas com problema (mesma definição de `stopIsDone`). */
  done: number;
  /** Marcadas com problema (`skipped` = o que o botão Problem grava). */
  problems: number;
  /** Pendentes FORA do prazo, já com a tolerância de 3 minutos do app. */
  late: number;
  /** Última atualização do dia nesta rota (hora em 12 h do carimbo do servidor). */
  lastUpdate: string | null;
};

/**
 * Desempenho do motorista da rota. Nada de consulta nova: status, carimbo e (para o atraso) o prazo
 * já vêm da consulta que a tela faz hoje; o `now` entra por parâmetro para o cálculo ser
 * determinístico no teste.
 */
export function driverPerformance(route: PackRoute, now: Date = new Date()): DriverPerformance {
  const problems = route.stops.filter((ponto) => ponto.status === 'skipped').length;
  const late = route.stops.filter(
    (ponto) => ponto.status === 'pending' && isPastDeadline(ponto.windowEnd, ponto.exactTime, now),
  ).length;
  const ultimo = route.stops.reduce<string | null>((maior, ponto) => {
    if (!ponto.at || Number.isNaN(new Date(ponto.at).getTime())) return maior;
    if (maior == null) return ponto.at;
    return new Date(ponto.at).getTime() > new Date(maior).getTime() ? ponto.at : maior;
  }, null);
  return {
    driverName: route.driverName,
    total: route.stops.length,
    done: route.stops.filter((ponto) => stopIsDone(ponto.status)).length,
    problems,
    late,
    lastUpdate: clockOf(ultimo),
  };
}

/** Texto curto do cartão: "3 of 5 done · 1 problem · 2 late · last update 2:20 PM". */
export function performanceSummary(performance: DriverPerformance): string {
  const partes = [`${performance.done} of ${performance.total} done`];
  if (performance.problems > 0) partes.push(`${performance.problems} problem${performance.problems === 1 ? '' : 's'}`);
  if (performance.late > 0) partes.push(`${performance.late} late`);
  if (performance.lastUpdate) partes.push(`last update ${performance.lastUpdate}`);
  return partes.join(' · ');
}

/** Linhas da tela "Today's progress": uma seção por rota, na ordem que veio do painel. */
export function progressRows(routes: PackRoute[], now: Date = new Date()): ProgressRow[] {
  return routes.map((rota) => ({
    driverName: rota.driverName,
    routeStatus: rota.status,
    stops: rota.stops.map((ponto) => ({
      dogName: ponto.dogName,
      status: ponto.status,
      statusLabel: stopStatusLabel(ponto.status),
      at: clockOf(ponto.at),
    })),
    performance: driverPerformance(rota, now),
  }));
}
