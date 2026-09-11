export function todayLocalISO(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDaysISO(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
  const nextDay = String(date.getUTCDate()).padStart(2, '0');
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

export function weekdayOfISO(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function shortWeekday(isoDate: string): string {
  return SHORT_WEEKDAYS[weekdayOfISO(isoDate)];
}

export function formatDayLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  // en-US: o app inteiro esta em ingles ("Daycare", "Boarding", "Transport"). Estava
  // saindo "Fri, 11 De Set" — dia da semana em ingles com mes em portugues.
  const label = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  return `${SHORT_WEEKDAYS[weekdayOfISO(isoDate)]}, ${label.replace('.', '')}`;
}
