/**
 * Navegação por dia no Dashboard do gestor — pedido do dono (áudio de 27/09/2026):
 * "o administrador tem que ser capaz nessa parte verde... clicar, arrastar pro lado, pra ir pro
 * próximo dia ou para os próximos dias... se fosse um calendário de rolagem, rolagem lateral".
 *
 * Por que o dia é uma string ISO (`YYYY-MM-DD`) e não um `Date`: reservas, rotas, plano do dia e
 * to-do guardam o dia como texto, e texto ISO ordena igual a data. Guardar `Date` aqui dentro é o
 * caminho curto para a tela cair no dia errado às 21h (fuso do aparelho).
 *
 * Por que existe a janela de ±30 dias: o Dashboard consulta rotas, to-do e plano DO DIA escolhido.
 * Sem limite, cada dia arrastado viraria uma consulta nova (e um swipe em rajada, um caminhão delas)
 * para uma operação que não existe um ano à frente.
 */
import { addDaysISO, todayLocalISO, weekdayOfISO } from '@/features/calendar/dates';

/** Quantos dias para cada lado o swipe alcança. */
export const JANELA_DE_DIAS = 30;

const LONG_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const LONG_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function emUTC(iso: string): Date {
  const [ano, mes, dia] = iso.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia));
}

/** Quantos dias `ate` está depois de `de` (negativo = antes). */
export function diffEmDias(de: string, ate: string): number {
  return Math.round((emUTC(ate).getTime() - emUTC(de).getTime()) / 86400000);
}

/** Dia deslocado em `passo` dias (o swipe usa ±1). */
export function shiftDay(iso: string, passo: number): string {
  return addDaysISO(iso, passo);
}

/** O dia está dentro da janela que a tela consegue atender? (o swipe para no limite) */
export function dentroDaJanela(iso: string, hoje: string = todayLocalISO()): boolean {
  const distancia = diffEmDias(hoje, iso);
  return distancia >= -JANELA_DE_DIAS && distancia <= JANELA_DE_DIAS;
}

/**
 * "Today" / "Tomorrow" / "Yesterday" / "Monday" — é o que deixa os títulos dos cartões honestos
 * ("Tomorrow's routes" quando o gestor arrastou para amanhã, em vez de dizer "Today's").
 */
export function dayPrefix(iso: string, hoje: string = todayLocalISO()): string {
  const distancia = diffEmDias(hoje, iso);
  if (distancia === 0) return 'Today';
  if (distancia === 1) return 'Tomorrow';
  if (distancia === -1) return 'Yesterday';
  return LONG_WEEKDAYS[weekdayOfISO(iso)];
}

/** Rótulo do cabeçalho verde: `TOMORROW · MONDAY · SEPTEMBER 28`. */
export function dayHeadline(iso: string, hoje: string = todayLocalISO()): string {
  const prefixo = dayPrefix(iso, hoje).toUpperCase();
  const diaDaSemana = LONG_WEEKDAYS[weekdayOfISO(iso)].toUpperCase();
  const data = emUTC(iso);
  const mesEDia = `${LONG_MONTHS[data.getUTCMonth()].toUpperCase()} ${data.getUTCDate()}`;
  // Dia distante cai em "FRIDAY · SEPTEMBER 28"; perto do hoje o prefixo diz a relação ("TOMORROW").
  return (prefixo === diaDaSemana ? [diaDaSemana] : [prefixo, diaDaSemana]).concat(mesEDia).join(' · ');
}
