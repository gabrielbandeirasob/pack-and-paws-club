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

/**
 * Cães que já começam o dia DENTRO da van: estão em boarding e também fazem daycare no mesmo dia.
 *
 * Pedido do cliente em áudio (23/09/2026): "se o cachorro está boarding, o administrador é capaz de
 * escolher se ele vai ou não para o daycare; e normalmente se ele for para o daycare, ele já vai
 * começar dentro da van aquele dia. Então ele não tem necessidade de aparecer para fazer rota de
 * pickup, porque ele está boarding."
 */
export function dogsJaNaVan(day: DaySummary): Set<string> {
  const emDaycare = new Set(day.daycare.filter((item) => !item.paused).map((item) => item.dogId));
  return new Set(day.boarding.filter((item) => emDaycare.has(item.dogId)).map((item) => item.dogId));
}

/**
 * Fila de transporte do dia: precisa de transporte E não é cão que já está na van (boarding+daycare).
 *
 * É ESTA lista que o Dispatch oferece para montar rota. Antes dela o cão em boarding aparecia para
 * pickup mesmo já estando no daycare — era o que o cliente apontou.
 */
export function transportPool(day: DaySummary): DayItem[] {
  const jaNaVan = dogsJaNaVan(day);
  const vistos = new Set<string>();
  return [...day.daycare, ...day.boarding].filter((item) => {
    if (!item.transportRequired) return false;
    if (jaNaVan.has(item.dogId)) return false;
    if (vistos.has(item.dogId)) return false;
    vistos.add(item.dogId);
    return true;
  });
}

/**
 * Cães que JÁ ESTÃO NA VAN (boarding + daycare no mesmo dia), para a seção separada do Dispatch.
 *
 * Por que existem mesmo sem precisar de pickup (áudio do cliente, 23/09/2026): "pode ser que algum
 * que vai pro daycare precise voltar para a casa... então é melhor que o administrador possa dizer
 * quais cachorros estão para aquele dia, ou pelo menos confirmar manualmente". Ou seja: saem da fila
 * principal, mas continuam à mão do gestor para incluir na rota quando precisarem voltar.
 */
export function vanPool(day: DaySummary): DayItem[] {
  const jaNaVan = dogsJaNaVan(day);
  const vistos = new Set<string>();
  return [...day.boarding, ...day.daycare].filter((item) => {
    if (!item.transportRequired) return false;
    if (!jaNaVan.has(item.dogId)) return false;
    if (vistos.has(item.dogId)) return false;
    vistos.add(item.dogId);
    return true;
  });
}

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
