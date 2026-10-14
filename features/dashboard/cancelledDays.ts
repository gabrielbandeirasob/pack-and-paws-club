/**
 * DIA CANCELADO NA SEMANA — quem foi cancelado, dia por dia.
 *
 * Pedido do dono (13/10/2026): *"quero que quando esteja vermelho do Google calendário cancele como já
 * fazia antes mas agora apareça no weekly summary que foi cancelado"*. Até aqui o vermelho TIRAVA o cão
 * do dia (a reserva vira `cancelled`, ou a escala ganha uma pausa de UM dia) e o resumo semanal não
 * mostrava nada: o dia sumia como se o cão nunca tivesse sido agendado — e o gestor não tinha como
 * conferir depois o que o escritório cancelou naquela semana.
 *
 * AS DUAS FORMAS EM QUE O VERMELHO CHEGA NO BANCO (medido em 08/10/2026, PR #44):
 *  1. **Reserva avulsa** — `reservations.status = 'cancelled'`. É o mesmo UPDATE que a tela do
 *     calendário faz no "Day cancelled" (o gestor cancelando à mão), e também o que a varredura do
 *     vermelho aplica nas duplicatas de importações antigas que seguravam o cão no dia.
 *  2. **Escala fixa** — `recurring_exceptions.action = 'skip'` com o `reason` da marca
 *     `CANCELAMENTO_DO_GOOGLE`. A pausa que o GESTOR marcou no app ('Skipped on this date') NÃO entra
 *     aqui de propósito: o resumo mostra **cancelamento**, não folga/ausência — são coisas diferentes
 *     para quem confere a semana.
 *
 * A cobertura do dia é a MESMA conta do `buildDay` (o resumo não pode divergir do calendário):
 * reserva de BOARDING cobre todos os dias do período; reserva de DAYCARE cobre **todos** os dias da
 * barra (mudança de 14/10/2026 — antes só o dia de início, e o cão sumia do resto da semana); a escala
 * cobre os dias da semana dela mais o **dia extra** (roxo).
 */
import type { ReservationRecord, RecurringScheduleRecord, RecurringExceptionRecord } from '@/features/calendar/dayMath';
import { CANCELAMENTO_DO_GOOGLE } from '@/features/integrations/google/cancellationMark';

/** Um cão cancelado num dia da semana (o resumo semanal marca a visita com isto). */
export type CancelledVisit = {
  dogId: string;
  dogName: string;
  clientName: string;
  serviceType: 'daycare' | 'boarding';
  /** Present on the daily view; weekly callers retain their existing result shape. */
  reason?: 'Cancelled in Google Calendar' | 'Skipped on this date';
};

function diaDaSemana(isoDate: string): number {
  // 0 = domingo — mesma convenção de `recurring_schedules.weekdays`.
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

function dentro(isoDate: string, inicio: string, fim: string): boolean {
  return isoDate >= inicio && isoDate <= fim;
}

/**
 * includeSkipped inclui também folgas do app e o motivo para as telas diárias;
 * sem a opção, preserva o contrato do resumo semanal.
 * Os cães cancelados NESTE dia. Um cão aparece uma vez só: se houver mais de um motivo de cancelamento
 * (uma reserva cancelada E a pausa da escala, por exemplo), vale o primeiro que chegou — a reserva, que
 * é o serviço que de fato estava agendado. Sem nada cancelado, lista vazia (dia normal).
 */
export function cancelledVisitsOfDay(
  isoDate: string,
  reservations: ReservationRecord[],
  schedules: RecurringScheduleRecord[],
  exceptions: RecurringExceptionRecord[],
  includeSkipped = false,
): CancelledVisit[] {
  const porCao = new Map<string, CancelledVisit>();
  const anotar = (dog: { id: string; dogName: string; clientName: string }, serviceType: 'daycare' | 'boarding', reason: CancelledVisit['reason'] = 'Cancelled in Google Calendar'): void => {
    if (!porCao.has(dog.id)) {
      porCao.set(dog.id, { dogId: dog.id, dogName: dog.dogName, clientName: dog.clientName, serviceType, ...(includeSkipped ? { reason } : {}) });
    }
  };

  for (const reserva of reservations) {
    // Só o que está de fato cancelado: uma reserva confirmada é um cão que vem (ou veio).
    if (reserva.status !== 'cancelled') continue;
    if (!dentro(isoDate, reserva.startDate, reserva.endDate)) continue;
    if (reserva.serviceType === 'boarding') anotar(reserva.dog, 'boarding');
    // Daycare de VÁRIOS dias vale para TODO dia da barra (14/10/2026 — mesma cobertura do `buildDay`:
    // o escritório pinta uma barra por semana e o cão vem todo dia dela).
    else anotar(reserva.dog, 'daycare');
  }

  for (const excecao of exceptions) {
    if (excecao.action !== 'skip' || (!includeSkipped && excecao.reason !== CANCELAMENTO_DO_GOOGLE)) continue;
    if (!dentro(isoDate, excecao.startDate, excecao.endDate)) continue;
    const escala = schedules.find((item) => item.id === excecao.scheduleId);
    if (!escala || !escala.active) continue;
    if (isoDate < escala.startDate) continue;
    if (escala.endDate && isoDate > escala.endDate) continue;
    // O dia só existe para essa escala se for dia dela ou o dia EXTRA (roxo) que o cliente mudou.
    const diaExtra = exceptions.some(
      (outra) => outra.scheduleId === escala.id && outra.action === 'extra' && dentro(isoDate, outra.startDate, outra.endDate),
    );
    if (!escala.weekdays.includes(diaDaSemana(isoDate)) && !diaExtra) continue;
    anotar(escala.dog, 'daycare', excecao.reason === CANCELAMENTO_DO_GOOGLE ? 'Cancelled in Google Calendar' : 'Skipped on this date');
  }

  return [...porCao.values()];
}
