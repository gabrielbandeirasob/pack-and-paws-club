const pad = (value: number) => String(value).padStart(2, '0');

export type TimeFieldProps = {
  label: string;
  accessibilityLabel: string;
  value: string | null;
  onChange: (hhmm: string) => void;
  testID?: string;
};

/** Formats a Date as local 'HH:MM'. */
export function toHHMM(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Parses an 'HH:MM' string into a Date at the given local time (defaults to 08:00). */
export function parseTime(value: string | null, fallbackHour = 8): Date {
  const [hour = fallbackHour, minute = 0] = (value ?? '').split(':').map(Number);
  const date = new Date();
  date.setHours(Number.isFinite(hour) ? hour : fallbackHour, Number.isFinite(minute) ? minute : 0, 0, 0);
  return date;
}
