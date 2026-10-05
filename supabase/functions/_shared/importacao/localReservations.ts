// GERADO por scripts/gera-importacao-compartilhada.mjs — NÃO EDITE ESTE ARQUIVO.
// Edite o original no app (features/...) e rode o gerador: o teste importacao-compartilhada falha
// se esta cópia ficar desatualizada.
/**
 * PAUSAS DE UMA ESCALA RECORRENTE — a única parte deste módulo que sobrou depois de 05/10/2026.
 *
 * O que existia aqui era o preparo da lista para o ESPELHO (`toLocalReservations`: reserva avulsa →
 * evento no calendário do cliente), removido junto com o espelho por decisão do dono (*"quero que o
 * aplicativo apenas importe do cliente"*). `diasPausados` ficou porque não é do espelho: é a regra de
 * PAUSA de uma escala (férias/ausência do cão) usada pelos DOIS lados da importação —
 *  * no app (`app/(tabs)/calendar.tsx`) para não mostrar o dia que o cão não vem;
 *  * no robô do servidor (`supabase/functions/google-calendar-sync`) para não importar a série nos
 *    dias pausados.
 *
 * Módulo PURO (sem rede, sem Supabase) — coberto por testes. Reutiliza `isSkipped` e `weekdayOfISO` do
 * calendário do app: a mesma função que decide o dia no app decide aqui.
 */
import { addDaysISO, weekdayOfISO } from './dates.ts';
import { isSkipped, type RecurringExceptionRecord, type RecurringScheduleRecord } from './dayMath.ts';

/** Teto de expansão das pausas: uma exceção aberta não pode gerar uma lista infinita. */
export const DIAS_MAXIMOS_DE_PAUSA = 730;

/** Datas de pausa de uma escala, em ordem. */
export function diasPausados(
  schedule: RecurringScheduleRecord,
  exceptions: RecurringExceptionRecord[],
  horizonteISO: string | null,
): string[] {
  const fimDaSerie = schedule.endDate ?? horizonteISO;
  const dias: string[] = [];

  for (const excecao of exceptions) {
    if (excecao.scheduleId !== schedule.id || excecao.action !== 'skip') continue;

    let dia = excecao.startDate < schedule.startDate ? schedule.startDate : excecao.startDate;
    const fimExcecao = excecao.endDate ?? fimDaSerie ?? excecao.startDate;
    const fim = fimDaSerie !== null && fimExcecao > fimDaSerie ? fimDaSerie : fimExcecao;

    let passos = 0;
    while (dia <= fim && passos < DIAS_MAXIMOS_DE_PAUSA) {
      // Preguiça de reimplementar a regra: a mesma função que decide o dia no app decide aqui.
      if (isSkipped(schedule.id, dia, exceptions) && schedule.weekdays.includes(weekdayOfISO(dia))) {
        dias.push(dia);
      }
      dia = addDaysISO(dia, 1);
      passos += 1;
    }
  }

  return [...new Set(dias)].sort();
}
