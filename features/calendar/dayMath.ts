export type DogRef = { id: string; dogName: string; clientName: string };

export type ReservationRecord = {
  id: string;
  dog: DogRef;
  serviceType: 'daycare' | 'boarding';
  startDate: string;
  endDate: string;
  transportRequired: boolean;
  /** Evento do Google que originou a reserva (reserva importada) — ver migration 025. */
  googleEventId?: string | null;
  /** 'google' = nasceu no Google Calendar (lá manda); 'app' = nasceu no aplicativo. */
  source?: 'app' | 'google' | null;
};

export type RecurringScheduleRecord = {
  id: string;
  dog: DogRef;
  weekdays: number[]; // 0 = Sunday .. 6 = Saturday
  startDate: string;
  endDate: string | null;
  active: boolean;
  transportRequired: boolean;
  /** Evento do Google que originou a série (importada) — ver migration 025. */
  googleEventId?: string | null;
  /** 'google' = nasceu no Google Calendar (lá manda); 'app' = nasceu no aplicativo. */
  source?: 'app' | 'google' | null;
};

export type RecurringExceptionAction = 'skip' | 'transport_on' | 'transport_off';

export type RecurringExceptionRecord = {
  id: string;
  scheduleId: string;
  action: RecurringExceptionAction;
  startDate: string;
  endDate: string;
  reason?: string | null;
};

export type DayItem = {
  kind: 'daycare' | 'boarding' | 'recurring-daycare';
  dog: DogRef;
  reservationId: string | null;
  recurringScheduleId: string | null;
  dogId: string;
  dogName: string;
  clientName: string;
  transportRequired: boolean;
  // True when this recurring occurrence is currently overridden to skip (paused) on the built day.
  paused?: boolean;
};

export type DaySummary = { daycare: DayItem[]; boarding: DayItem[] };

function dateToWeekday(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

function isWithin(isoDate: string, start: string, end: string): boolean {
  return isoDate >= start && isoDate <= end;
}

function itemize(kind: DayItem['kind'], reservation: ReservationRecord | null, schedule: RecurringScheduleRecord | null): DayItem {
  const source = reservation ?? schedule;
  if (!source) throw new Error('itemize requires a reservation or a schedule');
  const dog = source.dog;
  return {
    kind,
    dog,
    dogId: dog.id,
    dogName: dog.dogName,
    clientName: dog.clientName,
    reservationId: reservation?.id ?? null,
    recurringScheduleId: schedule?.id ?? null,
    transportRequired: source.transportRequired,
  };
}

function compareByName(a: DayItem, b: DayItem): number {
  return a.clientName.localeCompare(b.clientName) || a.dogName.localeCompare(b.dogName);
}

/** Effective transport for a recurring schedule on a date, after per-occurrence overrides. */
function transportForSchedule(schedule: RecurringScheduleRecord, isoDate: string, exceptions: RecurringExceptionRecord[]): boolean {
  let transport = schedule.transportRequired;
  for (const exception of exceptions) {
    if (exception.scheduleId !== schedule.id) continue;
    if (!isWithin(isoDate, exception.startDate, exception.endDate)) continue;
    if (exception.action === 'transport_on') transport = true;
    if (exception.action === 'transport_off') transport = false;
  }
  return transport;
}

/** True when a skip exception (pause/absence) covers this date for the schedule. */
export function isSkipped(scheduleId: string, isoDate: string, exceptions: RecurringExceptionRecord[]): boolean {
  return exceptions.some(
    (exception) =>
      exception.scheduleId === scheduleId && exception.action === 'skip' && isWithin(isoDate, exception.startDate, exception.endDate),
  );
}

export function buildDay(
  isoDate: string,
  reservations: ReservationRecord[],
  recurring: RecurringScheduleRecord[],
  exceptions: RecurringExceptionRecord[] = [],
): DaySummary {
  const daycare: DayItem[] = [];
  const boarding: DayItem[] = [];

  for (const reservation of reservations) {
    if (!isWithin(isoDate, reservation.startDate, reservation.endDate)) continue;
    if (reservation.serviceType === 'boarding') {
      boarding.push(itemize('boarding', reservation, null));
    } else if (isoDate === reservation.startDate) {
      daycare.push(itemize('daycare', reservation, null));
    }
  }

  const weekday = dateToWeekday(isoDate);
  for (const schedule of recurring) {
    if (!schedule.active) continue;
    if (isoDate < schedule.startDate) continue;
    if (schedule.endDate && isoDate > schedule.endDate) continue;
    if (!schedule.weekdays.includes(weekday)) continue;
    if (isSkipped(schedule.id, isoDate, exceptions)) continue;
    daycare.push({ ...itemize('recurring-daycare', null, schedule), transportRequired: transportForSchedule(schedule, isoDate, exceptions) });
  }

  daycare.sort(compareByName);
  boarding.sort(compareByName);
  return { daycare, boarding };
}
