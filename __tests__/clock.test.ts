import { formatClock, formatTimeOfDay } from '@/lib/clock';
import { clockOf } from '@/features/dashboard/packProgress';
import { horaCurta } from '@/features/dashboard/stopProgress';
import { clockText } from '@/features/driver/shift';

it.each([
  [0, 0, '12:00 AM'], [8, 28, '8:28 AM'], [12, 0, '12:00 PM'],
  [14, 46, '2:46 PM'], [23, 59, '11:59 PM'],
])('formats local hour %i:%i consistently as %s', (hour, minute, expected) => {
  const iso = new Date(2026, 9, 2, hour, minute).toISOString();
  for (const format of [formatClock, clockOf, horaCurta, clockText]) expect(format(iso)).toBe(expected);
  const stored = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  expect(formatTimeOfDay(stored)).toBe(expected);
  expect(formatTimeOfDay(`${stored}:00`)).toBe(expected);
});

it('does not invent times for missing or invalid timestamps', () => {
  for (const format of [formatClock, clockOf, horaCurta, clockText]) {
    expect(format(null)).toBeNull();
    expect(format(undefined)).toBeNull();
    expect(format('invalid')).toBeNull();
  }
});
