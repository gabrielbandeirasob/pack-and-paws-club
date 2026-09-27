/**
 * RESUMO SEMANAL — pedido do dono (áudio de 27/09/2026, 50 s):
 *
 * "no aplicativo você inseriu a opção de resumo da semana... esse resumo da semana vai apresentar a
 * lista dos cachorros que vieram na semana. Em cada cachorro, em cada nome do cachorro, vai ter...
 * vamos supor, tem um Luck. Tem que ver o 2º, 4º e 6º, 2º dia 12, 4º dia 15, 6º dia 10, daycare...
 * Se você conseguir fazer essa checagem todo sábado, sempre que chegar no sábado, vai ter essa
 * checagem da semana, tipo assim, resumo semanal."
 *
 * Decisões dele no mesmo dia: o serviço mostrado em cada dia é o **daycare** (era o "take care" do
 * áudio) e a **semana vai de segunda a sábado**.
 *
 * Por que domingo fica de fora: ele definiu a semana como segunda→sábado. Um domingo então NÃO abre
 * semana nova — ele pertence à semana que acabou de fechar (sábado foi ontem), que é justamente a
 * que o gestor quer conferir nesse dia. Na segunda-feira a semana vira.
 *
 * Tudo puro aqui: a tela só carrega os dados e chama estas funções (mesma conta do calendário).
 */
import { addDaysISO, shortWeekday, weekdayOfISO } from '@/features/calendar/dates';
import type { DayDog } from './dayOperation';

export type WeekDogDay = { date: string; serviceType: 'daycare' | 'boarding' };

export type WeekDog = {
  dogId: string;
  dogName: string;
  clientName: string;
  /** Dias da semana em que o cão veio, em ordem de data. */
  days: WeekDogDay[];
};

export type WeeklySummary = {
  /** Segunda e sábado da semana (ISO). */
  from: string;
  to: string;
  /** Os seis dias, de segunda a sábado. */
  days: string[];
  dogs: WeekDog[];
  /** Quantos cães diferentes vieram na semana. */
  totalDogs: number;
  /** Soma dos dias de todos os cães (cão × dia). */
  totalDogDays: number;
  /** Quantos cães vieram em cada dia (mesma ordem de `days`). */
  perDay: number[];
};

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

/** A segunda-feira da semana de `iso` (semana = segunda→sábado; domingo fecha a semana anterior). */
export function weekStart(iso: string): string {
  const dow = weekdayOfISO(iso); // 0 = domingo
  const recuo = dow === 0 ? 6 : dow - 1;
  return addDaysISO(iso, -recuo);
}

/** Os seis dias da semana: segunda, terça, quarta, quinta, sexta e sábado. */
export function weekDays(iso: string): string[] {
  const inicio = weekStart(iso);
  return [0, 1, 2, 3, 4, 5].map((passo) => addDaysISO(inicio, passo));
}

/** "Mon 21" — o rótulo curto do dia (usado nos chips de cada dia). */
export function dayChipLabel(iso: string): string {
  return `${shortWeekday(iso)} ${emUTC(iso).getUTCDate()}`;
}

/** "SEPTEMBER 21 – 26" (mesmo mês) ou "AUGUST 31 – SEPTEMBER 5" (vira o mês). */
export function weekLabel(from: string, to: string): string {
  const a = emUTC(from);
  const b = emUTC(to);
  const mesA = LONG_MONTHS[a.getUTCMonth()].toUpperCase();
  const mesB = LONG_MONTHS[b.getUTCMonth()].toUpperCase();
  return mesA === mesB
    ? `${mesA} ${a.getUTCDate()} – ${b.getUTCDate()}`
    : `${mesA} ${a.getUTCDate()} – ${mesB} ${b.getUTCDate()}`;
}

/**
 * Monta o resumo a partir dos cães de cada dia (o que a tela carrega com o MESMO `buildDay` do
 * calendário). `dogsByDay` pode não ter todos os dias — dia sem entrada conta como vazio.
 *
 * Ordem: cães por nome (é uma lista de conferência, o gestor procura pelo nome) e, dentro do cão,
 * os dias por data. Serviço repetido no mesmo dia não duplica.
 */
export function buildWeeklySummary(days: string[], dogsByDay: Record<string, DayDog[]>): WeeklySummary {
  const porCao = new Map<string, WeekDog>();
  const perDay: number[] = [];

  for (const dia of days) {
    const caes = dogsByDay[dia] ?? [];
    perDay.push(caes.length);
    for (const cao of caes) {
      const atual = porCao.get(cao.dogId);
      if (atual) {
        if (!atual.days.some((item) => item.date === dia)) {
          atual.days.push({ date: dia, serviceType: cao.serviceType });
        }
      } else {
        porCao.set(cao.dogId, {
          dogId: cao.dogId,
          dogName: cao.dogName,
          clientName: cao.clientName,
          days: [{ date: dia, serviceType: cao.serviceType }],
        });
      }
    }
  }

  const dogs = [...porCao.values()]
    .map((cao) => ({ ...cao, days: [...cao.days].sort((a, b) => a.date.localeCompare(b.date)) }))
    .sort((a, b) => a.dogName.localeCompare(b.dogName));

  return {
    from: days[0] ?? '',
    to: days[days.length - 1] ?? '',
    days,
    dogs,
    totalDogs: dogs.length,
    totalDogDays: dogs.reduce((soma, cao) => soma + cao.days.length, 0),
    perDay,
  };
}
