import { addDaysISO } from '@/features/calendar/dates';

export type GoogleEventInput = {
  summary: string;
  description?: string;
  start: { date: string };
  end: { date: string };
  recurrence?: string[];
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
};

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function recurrenceRule(weekdays: number[], untilDate?: string): string {
  const days = weekdays.map((weekday) => BYDAY[weekday]).join(',');
  const until = untilDate ? `;UNTIL=${untilDate.replaceAll('-', '')}` : '';
  return `RRULE:FREQ=WEEKLY;BYDAY=${days}${until}`;
}

export function buildGoogleEvent(reservation: ReservationForSync): GoogleEventInput {
  const summary = `${reservation.serviceType === 'daycare' ? 'Daycare' : 'Boarding'} · ${reservation.dogName} (${reservation.clientName})`;
  // Google Calendar all-day events use an exclusive end date.
  const effectiveEnd = reservation.endDate ?? reservation.startDate;
  const endDate = addDaysISO(effectiveEnd, 1);
  const event: GoogleEventInput = { summary, start: { date: reservation.startDate }, end: { date: endDate } };
  if (reservation.weekdays?.length) {
    const openEnded = !reservation.endDate || reservation.endDate === reservation.startDate;
    event.recurrence = [recurrenceRule(reservation.weekdays, openEnded ? undefined : reservation.endDate)];
  }
  return event;
}
