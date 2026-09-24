import { addDaysISO } from '@/features/calendar/dates';
import { colorOfService, labelForService, type EventLabel } from '@/features/calendar/googleColors';

export type GoogleEventInput = {
  summary: string;
  description?: string;
  start: { date: string };
  end: { date: string };
  recurrence?: string[];
  /**
   * Cor do evento na paleta fixa do Google (1..11). O app usa a cor como CONTRATO do serviço — verde
   * boarding, azul daycare (ver `googleColors`): é ela que o escritório vê e a que a importação lê de
   * volta, então o espelho PRECISA pintar o evento que cria/atualiza. Vai SEMPRE, mesmo quando o
   * evento também leva etiqueta: é o fallback de quem lê o calendário com um cliente antigo.
   */
  colorId?: string;
  /**
   * Etiqueta de cor do calendário (paleta NOVA do Google). Só vai quando o calendário TEM uma etiqueta
   * com o tom do serviço — a API recusa etiqueta que não existe no calendário. `null` significa
   * "limpe a etiqueta do evento" (`eventLabelId` vazio, o jeito documentado de remover); `undefined`
   * significa "não mexe".
   */
  eventLabelId?: string | null;
  /** Propriedades privadas do evento — usadas para idempotencia do sync (appKey = id da reserva). */
  extendedProperties?: { private: Record<string, string> };
};

export type ReservationForSync = {
  dogName: string;
  clientName: string;
  serviceType: 'daycare' | 'boarding';
  startDate: string;
  endDate?: string;
  weekdays?: number[];
  /** Datas (ISO) em que a serie NAO acontece (pausa/ausencia). Viram EXDATE no evento. */
  skipDates?: string[];
};

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function recurrenceRule(weekdays: number[], untilDate?: string): string {
  const days = weekdays.map((weekday) => BYDAY[weekday]).join(',');
  const until = untilDate ? `;UNTIL=${untilDate.replaceAll('-', '')}` : '';
  return `RRULE:FREQ=WEEKLY;BYDAY=${days}${until}`;
}

/**
 * Evento do espelho para a reserva.
 *
 * `options.labels` são as etiquetas do calendário escolhido (paleta NOVA). Quando existe uma etiqueta
 * com o tom do serviço, o evento leva `eventLabelId` **e** o `colorId` legado; quando não existe (ou
 * não deu para ler as etiquetas), o evento sai só com o `colorId` — o espelho nunca quebra por causa
 * de etiqueta.
 */
export function buildGoogleEvent(reservation: ReservationForSync, options: { labels?: EventLabel[] } = {}): GoogleEventInput {
  const summary = `${reservation.serviceType === 'daycare' ? 'Daycare' : 'Boarding'} · ${reservation.dogName} (${reservation.clientName})`;
  // Google Calendar all-day events use an exclusive end date.
  const effectiveEnd = reservation.endDate ?? reservation.startDate;
  const endDate = addDaysISO(effectiveEnd, 1);
  const event: GoogleEventInput = { summary, start: { date: reservation.startDate }, end: { date: endDate } };
  // O evento sai PINTADO com a cor do serviço: é assim que o escritório enxerga o tipo no calendário
  // e é o que a importação lê de volta quando o evento volta para o app.
  event.colorId = colorOfService(reservation.serviceType);
  const etiqueta = labelForService(options.labels, reservation.serviceType);
  if (etiqueta) event.eventLabelId = etiqueta.id;
  if (reservation.weekdays?.length) {
    const openEnded = !reservation.endDate || reservation.endDate === reservation.startDate;
    event.recurrence = [recurrenceRule(reservation.weekdays, openEnded ? undefined : reservation.endDate)];
    // Pausas (ferias/ausencia) viram EXDATE: o Google pula esses dias em vez de mostrar o dia
    // como se o cao fosse — a mesma regra que a tela do app usa (`isSkipped`).
    for (const dia of reservation.skipDates ?? []) {
      event.recurrence.push(`EXDATE;VALUE=DATE:${dia.replaceAll('-', '')}`);
    }
  }
  return event;
}
