// GERADO por scripts/gera-importacao-compartilhada.mjs — NÃO EDITE ESTE ARQUIVO.
// Edite o original no app (features/...) e rode o gerador: o teste importacao-compartilhada falha
// se esta cópia ficar desatualizada.
/** Fuso do NEGÓCIO: a operação é em São Francisco/CA. O robô do servidor roda em UTC e precisa saber
 *  qual é o "hoje" do cliente — entre 17h e 24h em Los Angeles o UTC já é o dia seguinte. */
export const FUSO_DO_NEGOCIO = 'America/Los_Angeles';

/**
 * "Hoje" como data ISO (YYYY-MM-DD).
 *
 * Sem `timeZone`, usa o relógio do RUNTIME (o aparelho do gestor/motorista já está no fuso certo) —
 * é o comportamento de sempre e nada muda para o app. Com `timeZone`, calcula o dia NAQUELE fuso: é o
 * que o robô agendado passa (`FUSO_DO_NEGOCIO`), senão entre 17h e 24h em Los Angeles ele usa a data
 * de UTC (= amanhã) e deixa de importar/cancelar o dia.
 */
export function todayLocalISO(timeZone?: string): string {
  const agora = new Date();
  if (!timeZone) {
    const year = agora.getFullYear();
    const month = String(agora.getMonth() + 1).padStart(2, '0');
    const day = String(agora.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  try {
    const partes = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(agora);
    const valor = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? '';
    const year = valor('year');
    const month = valor('month');
    const day = valor('day');
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    // Fuso inválido / runtime sem ICU: cai no relógio do runtime (comportamento antigo), nunca lança.
  }
  const year = agora.getFullYear();
  const month = String(agora.getMonth() + 1).padStart(2, '0');
  const day = String(agora.getDate()).padStart(2, '0');
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
