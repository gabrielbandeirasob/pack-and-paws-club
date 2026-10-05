/**
 * PAUSAS DE UMA ESCALA (`diasPausados`) — a única parte do módulo `localReservations` que sobrou.
 *
 * O que saiu em 05/10/2026 foi o preparo do ESPELHO (`toLocalReservations`: reserva do app virava
 * evento no calendário do cliente). A pausa continua sendo regra dos DOIS lados da importação: o app
 * não mostra o dia pausado e o robô do servidor não importa a série nesse dia.
 */
import type { RecurringExceptionRecord, RecurringScheduleRecord } from '@/features/calendar/dayMath';
import { diasPausados } from '@/features/integrations/google/localReservations';

// Semana de referência (16/09/2026 é uma quarta): 14 seg, 15 ter, 16 qua, 17 qui, 18 sex, 19 sáb, 20 dom, 21 seg.
const serie: RecurringScheduleRecord = {
  id: 's1',
  dog: { id: 'd2', dogName: 'Luna', clientName: 'John' },
  weekdays: [3, 1],
  startDate: '2026-09-14',
  endDate: null,
  active: true,
  transportRequired: false,
};

describe('diasPausados', () => {
  it('resolve a pausa apenas nos dias da semana da série', () => {
    // Pausa de 15 a 21/09: cai só em 16 (qua) e 21 (seg) — ter/qui/sex/sáb/dom não geram pausa.
    const pausa: RecurringExceptionRecord = { id: 'e1', scheduleId: 's1', action: 'skip', startDate: '2026-09-15', endDate: '2026-09-21' };
    expect(diasPausados(serie, [pausa], null)).toEqual(['2026-09-16', '2026-09-21']);
  });

  it('ignora exceção de outra série e exceção que não é pausa', () => {
    const deOutraSerie: RecurringExceptionRecord = { id: 'e2', scheduleId: 's9', action: 'skip', startDate: '2026-09-15', endDate: '2026-09-21' };
    const trocaDeTransporte: RecurringExceptionRecord = { id: 'e3', scheduleId: 's1', action: 'transport_off', startDate: '2026-09-15', endDate: '2026-09-21' };
    expect(diasPausados(serie, [deOutraSerie, trocaDeTransporte], null)).toEqual([]);
  });

  it('limita a expansão de uma pausa aberta pelo horizonte informado', () => {
    // Série sem fim + pausa até 31/12, mas o horizonte só vai até 05/10: seg/qua nesse intervalo.
    const pausaLonga: RecurringExceptionRecord = { id: 'e4', scheduleId: 's1', action: 'skip', startDate: '2026-09-15', endDate: '2026-12-31' };
    expect(diasPausados(serie, [pausaLonga], '2026-10-05')).toEqual([
      '2026-09-16',
      '2026-09-21',
      '2026-09-23',
      '2026-09-28',
      '2026-09-30',
      '2026-10-05',
    ]);
  });

  it('sem pausa nenhuma não inventa dia', () => {
    expect(diasPausados(serie, [], null)).toEqual([]);
  });
});
