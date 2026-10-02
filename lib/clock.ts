import { horaRelogio, sufixoDe } from '@/features/driver/etaMessage';

/** Same clock and suffix as ETA windows; timestamps retain the device's local timezone. */
export function formatClock(iso?: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const minutes = date.getHours() * 60 + date.getMinutes();
  return `${horaRelogio(minutes)} ${sufixoDe(minutes)}`;
}

/** Display a database HH:MM[:SS] value without changing its stored representation. */
export function formatTimeOfDay(value: string): string {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return value;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return `${horaRelogio(minutes)} ${sufixoDe(minutes)}`;
}
