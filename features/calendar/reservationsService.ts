/**
 * Regras de edicao de reserva (puras, testaveis).
 * Espelha as constraints do banco (descobertas por introspeccao):
 *   service_type in (daycare, boarding) | status in (confirmed, cancelled) | end_date >= start_date
 */
export type ServiceType = 'daycare' | 'boarding';
export type ReservationStatus = 'confirmed' | 'cancelled';

export type ReservationFormValues = {
  service_type: string;
  start_date: string;
  end_date: string;
  transport_required: boolean;
  status: string;
  notes: string | null;
};

export type ReservationUpdatePayload = {
  service_type: ServiceType;
  start_date: string;
  end_date: string;
  transport_required: boolean;
  status: ReservationStatus;
  notes: string | null;
};

const SERVICES: ServiceType[] = ['daycare', 'boarding'];
const STATUSES: ReservationStatus[] = ['confirmed', 'cancelled'];

/** Data no formato AAAA-MM-DD e realmente valida (nao aceita 2026-02-31). */
export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function reservationUpdatePayload(values: ReservationFormValues): ReservationUpdatePayload {
  if (!SERVICES.includes(values.service_type as ServiceType)) throw new Error('Pick daycare or boarding.');
  if (!STATUSES.includes(values.status as ReservationStatus)) throw new Error('Invalid reservation status.');
  if (!isValidISODate(values.start_date)) throw new Error('Start date is not a valid date.');
  const end = values.service_type === 'daycare' ? values.start_date : values.end_date;
  if (!isValidISODate(end)) throw new Error('End date is not a valid date.');
  if (end < values.start_date) throw new Error('End date cannot be before the start date.');
  const notes = values.notes && values.notes.trim().length > 0 ? values.notes.trim() : null;
  return {
    service_type: values.service_type as ServiceType,
    start_date: values.start_date,
    end_date: end,
    transport_required: Boolean(values.transport_required),
    status: values.status as ReservationStatus,
    notes,
  };
}

/** Ao voltar para "daycare" o periodo vira um dia so (evita reserva de 5 dias por engano). */
export function endDateForService(serviceType: string, startDate: string, currentEnd: string): string {
  if (serviceType === 'daycare') return startDate;
  return currentEnd < startDate ? startDate : currentEnd;
}
