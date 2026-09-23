import { haversineKm } from '@/features/dispatch/routeOptimizer';

export type EtaPosition = { latitude: number; longitude: number };

export type EtaStop = {
  id: string;
  sequence: number;
  clientName: string;
  dogName: string;
  latitude?: number | null;
  longitude?: number | null;
  windowEnd?: string | null;
  exactTime?: string | null;
  status: string;
};

export type EtaResult = {
  stopId: string;
  clientName: string;
  dogName: string;
  minutes: number;
  lateMinutes: number; // > 0 when the projected arrival is past the window/deadline
};

const DEFAULT_SPEED_KPH = 25;

function hhmmToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function minutesBetweenKm(km: number, speedKph = DEFAULT_SPEED_KPH): number {
  return (km / speedKph) * 60;
}

/** Local minutes since midnight for a Date (used to compare against windows). */
export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** True when the current local time is already past the stop's deadline (window end or exact time). */
export function isPastDeadline(windowEnd?: string | null, exactTime?: string | null, now: Date = new Date()): boolean {
  const deadline = hhmmToMinutes(exactTime ?? windowEnd);
  if (deadline == null) return false;
  return minutesOfDay(now) > deadline;
}

/** Minutes elapsed since an ISO timestamp (never negative). */
export function minutesAgo(isoTimestamp: string, now: Date = new Date()): number {
  const then = new Date(isoTimestamp).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.round((now.getTime() - then) / 60_000));
}

/**
 * Atraso projetado para UMA parada: quanto a chegada passaria da janela/horário exato.
 * Mesma conta do banner da próxima parada, usada no botão "avisar o tutor" (âmbar quando atrasa).
 */
export function lateMinutesForStop(
  stop: { exactTime?: string | null; windowEnd?: string | null },
  minutes: number,
  now: Date = new Date(),
): number {
  const deadline = hhmmToMinutes(stop.exactTime ?? stop.windowEnd);
  if (deadline == null) return 0;
  const projected = minutesOfDay(now) + Math.max(0, minutes);
  return projected > deadline ? Math.round(projected - deadline) : 0;
}

/**
 * Minutos até UMA parada (mesma conta do ETA da próxima parada). Usado no botão "avisar o tutor"
 * de qualquer parada, não só da próxima: o motorista avisa a entrega depois de embarcar.
 */
export function minutesToStop(
  position: EtaPosition | null,
  stop: { latitude?: number | null; longitude?: number | null },
  speedKph = DEFAULT_SPEED_KPH,
): number | null {
  if (!position || stop.latitude == null || stop.longitude == null) return null;
  return Math.round(minutesBetweenKm(haversineKm(position.latitude, position.longitude, stop.latitude, stop.longitude), speedKph));
}

/**
 * ETA for the next pending stop from the driver's current position.
 * Also reports how many minutes past its window/deadline the arrival would be.
 */
export function nextStopEta(stops: EtaStop[], position: EtaPosition | null, now: Date = new Date(), speedKph = DEFAULT_SPEED_KPH): EtaResult | null {
  const next = [...stops]
    .filter((stop) => stop.status !== 'completed' && stop.status !== 'skipped')
    .sort((a, b) => a.sequence - b.sequence)[0];
  if (!next) return null;

  const minutes =
    position && next.latitude != null && next.longitude != null
      ? minutesBetweenKm(haversineKm(position.latitude, position.longitude, next.latitude, next.longitude), speedKph)
      : 0;

  const deadline = hhmmToMinutes(next.exactTime ?? next.windowEnd);
  const projected = minutesOfDay(now) + minutes;
  const lateMinutes = deadline != null && projected > deadline ? Math.round(projected - deadline) : 0;

  return {
    stopId: next.id,
    clientName: next.clientName,
    dogName: next.dogName,
    minutes: Math.round(minutes),
    lateMinutes,
  };
}
