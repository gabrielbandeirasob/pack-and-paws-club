import type { RecurringExceptionRecord, RecurringScheduleRecord, ReservationRecord } from '@/features/calendar/dayMath';
import { toLocalReservations } from '@/features/integrations/google/localReservations';

describe('toLocalReservations', () => {
  // Semana de referencia (16/09/2026 e uma quarta): 14 seg, 15 ter, 16 qua, 17 qui, 18 sex, 19 sab, 20 dom, 21 seg.
  const reserva: ReservationRecord = {
    id: 'r1',
    dog: { id: 'd1', dogName: 'Mocha', clientName: 'Elisha' },
    serviceType: 'boarding',
    startDate: '2026-09-20',
    endDate: '2026-09-24',
    transportRequired: true,
  };

  const serie: RecurringScheduleRecord = {
    id: 's1',
    dog: { id: 'd2', dogName: 'Luna', clientName: 'John' },
    weekdays: [3, 1],
    startDate: '2026-09-14',
    endDate: null,
    active: true,
    transportRequired: false,
  };

  it('prefixa o appKey por origem (reserva x serie) para os ids nao colidirem', () => {
    const [primeira] = toLocalReservations([reserva], [], []);
    expect(primeira.id).toBe('res:r1');
    expect(primeira).toMatchObject({
      dogName: 'Mocha',
      clientName: 'Elisha',
      serviceType: 'boarding',
      startDate: '2026-09-20',
      endDate: '2026-09-24',
    });
  });

  it('converte escala recorrente em serie com os dias da semana em ordem', () => {
    const [, segunda] = toLocalReservations([reserva], [serie], []);
    expect(segunda.id).toBe('rec:s1');
    expect(segunda.weekdays).toEqual([1, 3]);
    expect(segunda.serviceType).toBe('daycare');
    expect(segunda.endDate).toBeUndefined();
    expect(segunda.skipDates).toEqual([]);
  });

  it('resolve a pausa em EXDATE apenas nos dias da semana da serie', () => {
    // Pausa de 15 a 21/09: cai so em 16 (qua) e 21 (seg) — ter/qui/sex/sab/dom nao geram EXDATE.
    const pausa: RecurringExceptionRecord = { id: 'e1', scheduleId: 's1', action: 'skip', startDate: '2026-09-15', endDate: '2026-09-21' };
    const [, segunda] = toLocalReservations([reserva], [serie], [pausa]);
    expect(segunda.skipDates).toEqual(['2026-09-16', '2026-09-21']);
  });

  it('ignora excecao de outra serie e excecao que nao e pausa', () => {
    const deOutraSerie: RecurringExceptionRecord = { id: 'e2', scheduleId: 's9', action: 'skip', startDate: '2026-09-15', endDate: '2026-09-21' };
    const trocaDeTransporte: RecurringExceptionRecord = { id: 'e3', scheduleId: 's1', action: 'transport_off', startDate: '2026-09-15', endDate: '2026-09-21' };
    const [, segunda] = toLocalReservations([reserva], [serie], [deOutraSerie, trocaDeTransporte]);
    expect(segunda.skipDates).toEqual([]);
  });

  it('limita a expansao da pausa aberta pelo horizonte informado', () => {
    // Serie sem fim + pausa ate 31/12, mas o espelho so vai ate 05/10: seg/qua nesse intervalo.
    const pausaLonga: RecurringExceptionRecord = { id: 'e4', scheduleId: 's1', action: 'skip', startDate: '2026-09-15', endDate: '2026-12-31' };
    const [, segunda] = toLocalReservations([reserva], [serie], [pausaLonga], { horizonteISO: '2026-10-05' });
    expect(segunda.skipDates).toEqual(['2026-09-16', '2026-09-21', '2026-09-23', '2026-09-28', '2026-09-30', '2026-10-05']);
  });

  it('deixa de fora serie inativa e serie sem dia da semana', () => {
    const inativa = { ...serie, id: 's2', active: false };
    const semDias = { ...serie, id: 's3', weekdays: [] };
    const lista = toLocalReservations([], [inativa, semDias], []);
    expect(lista).toEqual([]);
  });
});
