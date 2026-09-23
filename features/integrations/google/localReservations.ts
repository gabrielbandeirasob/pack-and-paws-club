/**
 * Converte o que a tela do gestor já carrega (reservas + escalas recorrentes) no formato que o
 * espelhamento do Google Calendar consome.
 *
 * Módulo PURO (sem rede, sem Supabase) — coberto por testes. Reutiliza `isSkipped` e
 * `weekdayOfISO` do calendário do app: assim o Google nunca mostra um dia que o app considera
 * cancelado, porque cada pausa vira um EXDATE no evento recorrente.
 */
import { addDaysISO, weekdayOfISO } from '@/features/calendar/dates';
import { isSkipped, type RecurringExceptionRecord, type RecurringScheduleRecord, type ReservationRecord } from '@/features/calendar/dayMath';

import type { LocalReservation } from './calendarSync';

/**
 * Prefixos no appKey: dizem no Google de qual tabela o evento veio e evitam que o id de uma
 * reserva colida com o id de uma escala (as duas tabelas geram uuid próprio).
 */
export const PREFIXO_RESERVA = 'res:';
export const PREFIXO_RECORRENTE = 'rec:';

/** Teto de expansão das pausas: uma exceção aberta não pode gerar uma lista infinita. */
export const DIAS_MAXIMOS_DE_PAUSA = 730;

/** Datas de pausa de uma escala, em ordem — viram EXDATE (o Google pula esses dias). */
export function diasPausados(
  schedule: RecurringScheduleRecord,
  exceptions: RecurringExceptionRecord[],
  horizonteISO: string | null,
): string[] {
  const fimDaSerie = schedule.endDate ?? horizonteISO;
  const dias: string[] = [];

  for (const excecao of exceptions) {
    if (excecao.scheduleId !== schedule.id || excecao.action !== 'skip') continue;

    let dia = excecao.startDate < schedule.startDate ? schedule.startDate : excecao.startDate;
    const fimExcecao = excecao.endDate ?? fimDaSerie ?? excecao.startDate;
    const fim = fimDaSerie !== null && fimExcecao > fimDaSerie ? fimDaSerie : fimExcecao;

    let passos = 0;
    while (dia <= fim && passos < DIAS_MAXIMOS_DE_PAUSA) {
      // Preguiça de reimplementar a regra: a mesma função que decide o dia no app decide aqui.
      if (isSkipped(schedule.id, dia, exceptions) && schedule.weekdays.includes(weekdayOfISO(dia))) {
        dias.push(dia);
      }
      dia = addDaysISO(dia, 1);
      passos += 1;
    }
  }

  return [...new Set(dias)].sort();
}

/**
 * Lista para espelhar: uma reserva avulsa vira um evento com data de início/fim; uma escala
 * recorrente vira um evento com RRULE (e EXDATE nas pausas).
 *
 * `horizonteISO` limita a expansão das pausas de uma escala sem data de término.
 */
export function toLocalReservations(
  reservations: ReservationRecord[] = [],
  recurring: RecurringScheduleRecord[] = [],
  exceptions: RecurringExceptionRecord[] = [],
  opcoes?: { horizonteISO?: string | null },
): LocalReservation[] {
  const horizonte = opcoes?.horizonteISO ?? null;

  const avulsas: LocalReservation[] = reservations.map((reserva) => ({
    id: `${PREFIXO_RESERVA}${reserva.id}`,
    dogName: reserva.dog.dogName,
    clientName: reserva.dog.clientName,
    serviceType: reserva.serviceType,
    startDate: reserva.startDate,
    endDate: reserva.endDate,
    // Vínculo com o Google (reserva importada): sem isso o espelho criaria um evento NOVO para uma
    // reserva que já tem evento — evento duplicado no calendário do cliente.
    googleEventId: reserva.googleEventId ?? null,
    source: reserva.source ?? 'app',
  }));

  const series: LocalReservation[] = recurring
    .filter((schedule) => schedule.active && schedule.weekdays.length > 0)
    .map((schedule) => ({
      id: `${PREFIXO_RECORRENTE}${schedule.id}`,
      dogName: schedule.dog.dogName,
      clientName: schedule.dog.clientName,
      serviceType: 'daycare' as const,
      startDate: schedule.startDate,
      endDate: schedule.endDate ?? undefined,
      weekdays: [...schedule.weekdays].sort((a, b) => a - b),
      skipDates: diasPausados(schedule, exceptions, horizonte),
      googleEventId: schedule.googleEventId ?? null,
      source: schedule.source ?? 'app',
    }));

  return [...avulsas, ...series];
}
