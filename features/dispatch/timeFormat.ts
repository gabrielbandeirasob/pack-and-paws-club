const pad = (value: number) => String(value).padStart(2, '0');

export type TimePickerProps = {
  label?: string;
  accessibilityLabel?: string;
  testID?: string;
  value: string | null;
  onChange: (hhmm: string) => void;
  onDone?: () => void;
};

/** Formats a Date as local 'HH:MM'. */
export function toHHMM(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Parses an 'HH:MM' string into a Date at the given local time. Empty/invalid values fall back to 08:00 — never midnight. */
export function parseTime(value: string | null, fallbackHour = 8): Date {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value ?? '');
  const hour = match ? Number(match[1]) : fallbackHour;
  const minute = match ? Number(match[2]) : 0;
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date;
}
