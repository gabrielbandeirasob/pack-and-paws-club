// GERADO por scripts/gera-importacao-compartilhada.mjs — NÃO EDITE ESTE ARQUIVO.
// Edite o original no app (features/...) e rode o gerador: o teste importacao-compartilhada falha
// se esta cópia ficar desatualizada.
export type DogRef = { id: string; dogName: string; clientName: string };

export type ReservationRecord = {
  id: string;
  dog: DogRef;
  /** Omitido apenas por consumidores legados que já consultam confirmadas. */
  status?: 'confirmed' | 'cancelled';
  serviceType: 'daycare' | 'boarding';
  startDate: string;
  endDate: string;
  transportRequired: boolean;
  /**
   * O cão passa pelo DAYCARE neste dia (entra no Total Pack e na seção "já está na van"). Contrato do
   * cliente, escrito em 28/09/2026: *"por via de regra todo boarding vai pro daycare (ou seja eles no
   * início do dia já estarão dentro da van esperando o driver)"*. A única exceção é a **chegada fora do
   * horário** (Cocoa no pick-up): *"ele entra no total de cães mas não entra no total pack porque o cão
   * não estará no day care"*. Omitido = `true` (reserva antiga/criada no app, série de daycare).
   */
  goesToDaycare?: boolean;
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

export type RecurringExceptionAction = 'skip' | 'extra' | 'transport_on' | 'transport_off';

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
  /** O cão passa pelo daycare hoje (ver `ReservationRecord.goesToDaycare`). */
  goesToDaycare: boolean;
  // True when this recurring occurrence is currently overridden to skip (paused) on the built day.
  paused?: boolean;
};

export type DaySummary = { daycare: DayItem[]; boarding: DayItem[] };

/**
 * Cães que já começam o dia DENTRO da van (não precisam de pickup).
 *
 * Pedido do cliente em áudio (23/09/2026): "se o cachorro está boarding… ele já vai começar dentro da
 * van aquele dia. Então ele não tem necessidade de aparecer para fazer rota de pickup, porque ele está
 * boarding."
 *
 * CONTRATO ESCRITO (28/09/2026) — o que fecha a regra: *"por via de regra todo boarding vai pro daycare
 * (ou seja eles no início do dia já estarão dentro da van esperando o driver e na rota de drop off eles
 * voltam pro ponto de drop da van junto com o motorista — **não entra como parada na rota**, mas entram
 * na lista de total pack e contagem do dia)"*. Então quem está na van é o dia de HOTEL **sem movimento**
 * (`transport_required = false`: Basil e a saída fora do horário) que passa pelo daycare — não é mais
 * preciso o calendário ter DOIS eventos no mesmo dia.
 *
 * A chegada fora do horário (Cocoa no pick-up) fica de fora: `goesToDaycare = false` ("o cão não estará
 * no day care"). Dia de movimento (avocado, chegada ou saída com o driver) também fica de fora — ele
 * ENTRA como parada normal da rota.
 */
export function dogsJaNaVan(day: DaySummary): Set<string> {
  return new Set(
    day.boarding
      .filter((item) => !item.transportRequired && item.goesToDaycare)
      .map((item) => item.dogId),
  );
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
 * Cães que JÁ ESTÃO NA VAN, para a seção separada do Dispatch ("Boarding — already in the van").
 *
 * Por que existem mesmo sem precisar de pickup (áudio do cliente, 23/09/2026): "pode ser que algum que
 * vai pro daycare precise voltar para a casa… então é melhor que o administrador possa dizer quais
 * cachorros estão para aquele dia, ou pelo menos confirmar manualmente". Ou seja: saem da fila
 * principal, mas continuam à mão do gestor para incluir na rota quando precisarem voltar.
 *
 * Contrato escrito (28/09/2026): o dia de hotel sem movimento entra aqui sozinho (Basil e a saída fora
 * do horário) — `dogsJaNaVan` é quem decide.
 */
export function vanPool(day: DaySummary): DayItem[] {
  const jaNaVan = dogsJaNaVan(day);
  const vistos = new Set<string>();
  return day.boarding.filter((item) => {
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
    goesToDaycare: reservation?.goesToDaycare ?? true,
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

/**
 * True when this date is an EXTRA day of the schedule (evento ROXO no Google): o cliente de dia fixo
 * mudou o dia / veio fora da ordem, e o dia fica LIGADO à escala em vez de virar reserva avulsa —
 * é o "não ficar serviço solto" do pedido do dono (24/09/2026).
 */
export function isExtraDay(scheduleId: string, isoDate: string, exceptions: RecurringExceptionRecord[]): boolean {
  return exceptions.some(
    (exception) =>
      exception.scheduleId === scheduleId && exception.action === 'extra' && isWithin(isoDate, exception.startDate, exception.endDate),
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
    if (reservation.status === 'cancelled') continue;
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

  // Dia EXTRA (evento ROXO no Google): o dia não está nos `weekdays`, mas faz parte da escala daquele
  // cão. Entra na agenda ligado à escala (mesmo cartão "Repeats weekly"), não como reserva avulsa.
  for (const schedule of recurring) {
    if (!schedule.active) continue;
    if (isoDate < schedule.startDate) continue;
    if (schedule.endDate && isoDate > schedule.endDate) continue;
    if (schedule.weekdays.includes(weekday)) continue; // dia normal da escala: já entrou acima
    if (!isExtraDay(schedule.id, isoDate, exceptions)) continue;
    if (isSkipped(schedule.id, isoDate, exceptions)) continue;
    daycare.push({ ...itemize('recurring-daycare', null, schedule), transportRequired: transportForSchedule(schedule, isoDate, exceptions) });
  }

  daycare.sort(compareByName);
  boarding.sort(compareByName);
  // Agregação de tela: uma entrada por cão/serviço, sem alterar reservas no banco.
  // Transporte continua disponível se qualquer agendamento desse serviço o pedir.
  const uniqueDogs = (items: DayItem[]): DayItem[] => {
    const dogs = new Map<string, DayItem>();
    for (const item of items) {
      const existing = dogs.get(item.dogId);
      dogs.set(item.dogId, existing
        ? { ...existing, transportRequired: existing.transportRequired || item.transportRequired }
        : item);
    }
    return [...dogs.values()];
  };
  return { daycare: uniqueDogs(daycare), boarding: uniqueDogs(boarding) };
}
