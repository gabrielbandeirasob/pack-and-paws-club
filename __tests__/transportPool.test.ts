/**
 * Regra do cliente (áudio de 23/09/2026): cão em BOARDING que também faz DAYCARE no mesmo dia já
 * começa o dia dentro da van — "ele não tem necessidade de aparecer para fazer rota de pickup".
 *
 * E a complementação do MESMO áudio: "pode ser que algum que vai pro daycare precise voltar para a
 * casa... então é melhor que o administrador possa dizer quais cachorros estão para aquele dia, ou
 * pelo menos confirmar manualmente". Por isso existem DUAS listas:
 *   transportPool -> fila principal do Dispatch (precisa de pickup);
 *   vanPool       -> seção separada ("já na van"), para o gestor incluir à mão quando precisar.
 */
import {
  buildDay,
  dogsJaNaVan,
  transportPool,
  vanPool,
  type DaySummary,
  type RecurringScheduleRecord,
  type ReservationRecord,
} from '@/features/calendar/dayMath';

const DIA = '2026-09-23'; // quarta-feira (weekday 3)

function cao(id: string, nome: string, cliente: string) {
  return { id, dogName: nome, clientName: cliente };
}

function dia(reservas: ReservationRecord[], series: RecurringScheduleRecord[] = []): DaySummary {
  return buildDay(DIA, reservas, series, []);
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

const boardingFiló = (id: string, extras: Partial<ReservationRecord> = {}) =>
  reserva({ id, dog: cao('d1', 'Filó', 'Amor'), serviceType: 'boarding', startDate: '2026-09-21', endDate: '2026-09-27', ...extras });

describe('dogsJaNaVan', () => {
  it('cão em boarding que faz daycare no dia já está na van', () => {
    const day = dia([boardingFiló('r1'), reserva({ id: 'r2', dog: cao('d1', 'Filó', 'Amor') })]);
    expect([...dogsJaNaVan(day)]).toEqual(['d1']);
  });

  it('cão só em boarding (sem daycare no dia) NÃO está na van', () => {
    const day = dia([reserva({ id: 'r1', dog: cao('d2', 'Thor', 'Maria'), serviceType: 'boarding', startDate: '2026-09-21', endDate: '2026-09-27' })]);
    expect([...dogsJaNaVan(day)]).toEqual([]);
  });

  it('cão só em daycare no dia NÃO está na van', () => {
    const day = dia([reserva({ id: 'r1', dog: cao('d3', 'Kona', 'Leigh Ann') })]);
    expect([...dogsJaNaVan(day)]).toEqual([]);
  });
});

describe('transportPool (fila principal que o Dispatch oferece)', () => {
  it('tira da rota o cão que está boarding e faz daycare no mesmo dia', () => {
    const day = dia([boardingFiló('r1'), reserva({ id: 'r2', dog: cao('d1', 'Filó', 'Amor') }), reserva({ id: 'r3', dog: cao('d2', 'Kona', 'Leigh Ann') })]);
    expect(transportPool(day).map((item) => item.dogId)).toEqual(['d2']);
  });

  it('mantém quem precisa de transporte e não está na van', () => {
    const day = dia([
      reserva({ id: 'r1', dog: cao('d1', 'Kona', 'Leigh Ann') }),
      reserva({ id: 'r2', dog: cao('d2', 'Soko', 'Leigh Ann'), transportRequired: false }),
    ]);
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
    expect(transportPool(dia([], [serie])).map((item) => item.dogId)).toEqual(['d9']);
  });

  it('não repete o mesmo cão duas vezes na fila', () => {
    const day = dia([reserva({ id: 'r1', dog: cao('d1', 'Filó', 'Amor') }), reserva({ id: 'r2', dog: cao('d1', 'Filó', 'Amor') })]);
    expect(transportPool(day).map((item) => item.dogId)).toEqual(['d1']);
  });
});

describe('vanPool (seção "já na van" do Dispatch)', () => {
  it('lista o cão em boarding que faz daycare no dia — e ele NÃO fica na fila principal', () => {
    const day = dia([boardingFiló('r1'), reserva({ id: 'r2', dog: cao('d1', 'Filó', 'Amor') }), reserva({ id: 'r3', dog: cao('d2', 'Kona', 'Leigh Ann') })]);
    expect(vanPool(day).map((item) => item.dogId)).toEqual(['d1']);
    expect(transportPool(day).map((item) => item.dogId)).toEqual(['d2']);
  });

  it('não repete o cão na seção', () => {
    const day = dia([boardingFiló('r1'), reserva({ id: 'r2', dog: cao('d1', 'Filó', 'Amor') })]);
    expect(vanPool(day)).toHaveLength(1);
  });

  it('cão em boarding sem daycare no dia NÃO entra na seção (ele precisa de pickup)', () => {
    const day = dia([reserva({ id: 'r1', dog: cao('d2', 'Thor', 'Maria'), serviceType: 'boarding', startDate: '2026-09-21', endDate: '2026-09-27' })]);
    expect(vanPool(day)).toEqual([]);
    expect(transportPool(day).map((item) => item.dogId)).toEqual(['d2']);
  });

  it('quem não pede transporte não entra em nenhuma das duas', () => {
    const day = dia([
      boardingFiló('r1', { transportRequired: false }),
      reserva({ id: 'r2', dog: cao('d1', 'Filó', 'Amor'), transportRequired: false }),
    ]);
    expect(vanPool(day)).toEqual([]);
    expect(transportPool(day)).toEqual([]);
  });
});
