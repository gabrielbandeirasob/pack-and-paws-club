import { addDaysISO, weekdayOfISO } from '@/features/calendar/dates';
import { buildDay, type RecurringExceptionRecord, type RecurringScheduleRecord, type ReservationRecord } from '@/features/calendar/dayMath';

export type MonthCell = string | null; // ISO date of the day, or null for cells outside the month.

export type MonthMatrix = {
  weeks: MonthCell[][];
  label: string;
};

export type DayCounts = { daycare: number; boarding: number };

export type DayAggregate = DayCounts & { items: { kind: string; transport: boolean }[] };

/** ISO date of the Sunday that starts the week containing `isoDate`. */
export function weekStartISO(isoDate: string): string {
  return addDaysISO(isoDate, -weekdayOfISO(isoDate));
}

/** The 7 ISO dates of the week (Sunday first) containing `isoDate`. */
export function weekDatesISO(isoDate: string): string[] {
  const start = weekStartISO(isoDate);
  return Array.from({ length: 7 }, (_, index) => addDaysISO(start, index));
}

export function monthLabel(isoDate: string): string {
  const [year, month] = isoDate.split('-').map(Number);
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Moves by whole months, clamping the day to the target month length (Jan 31 + 1m → Feb 28). */
export function addMonthsISO(isoDate: string, delta: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const total = year * 12 + (month - 1) + delta;
  const targetYear = Math.floor(total / 12);
  const targetMonth = total - targetYear * 12; // 0-based
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const safeDay = Math.min(day, lastDay);
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
}

/** Builds the month grid (rows of 7 cells, Sunday first) containing `isoDate`. Cells outside the month are null. */
export function monthMatrixISO(isoDate: string): MonthMatrix {
  const [year, month] = isoDate.split('-').map(Number);
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const offset = weekdayOfISO(first);
  const days: MonthCell[] = Array.from({ length: offset }, () => null);
  for (let day = 1; day <= lastDay; day += 1) {
    days.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  while (days.length % 7 !== 0) days.push(null);
  const weeks: MonthCell[][] = [];
  for (let index = 0; index < days.length; index += 7) weeks.push(days.slice(index, index + 7));
  return { weeks, label: monthLabel(first) };
}

/** Daycare/boarding counts for every date from `startISO` to `endISO` inclusive (max ~43 days). */
export function summarizeRange(
  startISO: string,
  endISO: string,
  reservations: ReservationRecord[],
  recurring: RecurringScheduleRecord[],
  exceptions: RecurringExceptionRecord[],
): Record<string, DayCounts> {
  const counts: Record<string, DayCounts> = {};
  let cursor = startISO;
  while (cursor <= endISO) {
    const summary = buildDay(cursor, reservations, recurring, exceptions);
    counts[cursor] = { daycare: summary.daycare.length, boarding: summary.boarding.length };
    if (cursor === endISO) break;
    cursor = addDaysISO(cursor, 1);
  }
  return counts;
}
