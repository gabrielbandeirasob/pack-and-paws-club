/**
 * Regra do cliente (áudio de 23/09/2026): cão em BOARDING que também faz DAYCARE no mesmo dia
 * já começa o dia dentro da van — "ele não tem necessidade de aparecer para fazer rota de pickup".
 *
 * Estes testes travam o pool de transporte que o Dispatch usa para montar a rota.
 */
import { buildDay, dogsJaNaVan, transportPool, type RecurringScheduleRecord, type ReservationRecord } from '@/features/calendar/dayMath';

const DIA = '2026-09-23'; // quarta-feira (weekday 3)

function cao(id: string, nome: string, cliente: string) {
  return { id, dogName: nome, clientName: cliente };
}

function reserva(parcial: Partial<ReservationRecord> & { id: string; dog: ReturnType<typeof cao> }): ReservationRecord {
  return {
    serviceType: 'daycare',
    startDate: DIA,
    endDate: DIA,
    transportRequired: true,
    ...parcial,
  } as ReservationRecord;
}

describe('dogsJaNaVan', () => {
  it('cão em boarding que faz daycare no dia já está na van', () => {
    const day = buildDay(DIA, [
      reserva({ id: 'r1', dog: cao('d1', 'Filó', 'Amor'), serviceType: 'boarding', startDate: '2026-09-21', endDate: '2026-09-27' }),
      reserva({ id: 'r2', dog: cao('d1', 'Filó', 'Amor'), serviceType: 'daycare' }),
    ], []);
    expect([...dogsJaNaVan(day)]).toEqual(['d1']);
  });

  it('cão só em boarding (sem daycare no dia) NÃO está na van', () => {
    const day = buildDay(DIA, [
      reserva({ id: 'r1', dog: cao('d2', 'Thor', 'Maria'), serviceType: 'boarding', startDate: '2026-09-21', endDate: '2026-09-27' }),
    ], []);
    expect([...dogsJaNaVan(day)]).toEqual([]);
  });

  it('cão só em daycare no dia NÃO está na van', () => {
    const day = buildDay(DIA, [reserva({ id: 'r1', dog: cao('d3', 'Kona', 'Leigh Ann') })], []);
    expect([...dogsJaNaVan(day)]).toEqual([]);
  });
});

describe('transportPool (fila que o Dispatch oferece)', () => {
  it('tira da rota o cão que está boarding e faz daycare no mesmo dia', () => {
    const day = buildDay(DIA, [
      reserva({ id: 'r1', dog: cao('d1', 'Filó', 'Amor'), serviceType: 'boarding', startDate: '2026-09-21', endDate: '2026-09-27' }),
      reserva({ id: 'r2', dog: cao('d1', 'Filó', 'Amor'), serviceType: 'daycare' }),
      reserva({ id: 'r3', dog: cao('d2', 'Kona', 'Leigh Ann') }),
    ], []);
    expect(transportPool(day).map((item) => item.dogId)).toEqual(['d2']);
  });

  it('mantém quem precisa de transporte e não está na van', () => {
    const day = buildDay(DIA, [
      reserva({ id: 'r1', dog: cao('d1', 'Kona', 'Leigh Ann') }),
      reserva({ id: 'r2', dog: cao('d2', 'Soko', 'Leigh Ann'), transportRequired: false }),
    ], []);
    expect(transportPool(day).map((item) => item.dogId)).toEqual(['d1']);
  });

  it('série de daycare (dias da semana) entra na fila', () => {
    const serie: RecurringScheduleRecord = {
      id: 's1',
      dog: cao('d9', 'Mowgli', 'Maria Silva'),
      weekdays: [3],
      startDate: '2026-09-01',
      endDate: null,
      active: true,
      transportRequired: true,
    };
    const day = buildDay(DIA, [], [serie], []);
    expect(transportPool(day).map((item) => item.dogId)).toEqual(['d9']);
  });

  it('não repete o mesmo cão duas vezes na fila', () => {
    const day = buildDay(DIA, [
      reserva({ id: 'r1', dog: cao('d1', 'Filó', 'Amor') }),
      reserva({ id: 'r2', dog: cao('d1', 'Filó', 'Amor') }),
    ], []);
    expect(transportPool(day).map((item) => item.dogId)).toEqual(['d1']);
  });
});
