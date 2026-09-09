export type DogRef = { id: string; dogName: string; clientName: string };

export type ReservationRecord = {
  id: string;
  dog: DogRef;
  serviceType: 'daycare' | 'boarding';
  startDate: string;
  endDate: string;
};

export type RecurringScheduleRecord = {
  id: string;
  dog: DogRef;
  weekdays: number[]; // 0 = Sunday .. 6 = Saturday
  startDate: string;
  endDate: string | null;
  active: boolean;
};

export type DayItem = {
  kind: 'daycare' | 'boarding' | 'recurring-daycare';
  dog: DogRef;
  reservationId: string | null;
  recurringScheduleId: string | null;
  dogId: string;
  dogName: string;
  clientName: string;
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
  };
}

function compareByName(a: DayItem, b: DayItem): number {
  return a.clientName.localeCompare(b.clientName) || a.dogName.localeCompare(b.dogName);
}

export function buildDay(isoDate: string, reservations: ReservationRecord[], recurring: RecurringScheduleRecord[]): DaySummary {
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
    daycare.push(itemize('recurring-daycare', null, schedule));
  }

  daycare.sort(compareByName);
  boarding.sort(compareByName);
  return { daycare, boarding };
}
