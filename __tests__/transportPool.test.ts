/**
 * VAN DO DIA — quem já está dentro dela, quem entra na fila principal e quem vai pro Total Pack.
 *
 * Pedido do cliente em áudio (23/09/2026): cão em BOARDING que também faz DAYCARE no mesmo dia já
 * começa o dia dentro da van — "ele não tem necessidade de aparecer para fazer rota de pickup". E a
 * complementação do mesmo áudio: "pode ser que algum que vai pro daycare precise voltar para a casa…
 * então é melhor que o administrador possa dizer quais cachorros estão para aquele dia, ou pelo menos
 * confirmar manualmente". Por isso existem DUAS listas:
 *   transportPool -> fila principal do Dispatch (é parada da rota);
 *   vanPool       -> seção separada ("já na van"), para o gestor incluir à mão quando precisar.
 *
 * CONTRATO ESCRITO (28/09/2026) — é ele que manda agora:
 *   * "por via de regra todo boarding vai pro daycare (ou seja eles no início do dia já estarão dentro
 *     da van esperando o driver e na rota de drop off eles voltam pro ponto de drop da van junto com o
 *     motorista — não entra como parada na rota, mas entram na lista de total pack e contagem do dia)";
 *   * "Avocado - pick up ou drop off do boarding (…) através dos drivers" e "Quem for avocado no dia de
 *     drop off ele entra como um ponto na rota normal";
 *   * "Cocoa - (…) o mesmo que o Avocado, a diferença está no horário (…) no pick up cocoa (…) ele entra
 *     no total de cães mas NÃO entra no total pack porque o cão não estará no day care".
 *
 * Traduzido para as colunas que o app tem:
 *   - dia de HOTEL sem movimento (`boarding` + `transport_required = false`) = já está na van, não é
 *     parada, entra no Total Pack;
 *   - dia de MOVIMENTO (`boarding` + `transport_required = true`, o Avocado) = parada normal da rota;
 *   - CHEGADA fora do horário (`goes_to_daycare = false`) = não está na van, não é parada e fica FORA do
 *     Total Pack.
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

/** Basil: dia de HOTEL do meio da hospedagem — sem movimento, o cão já está na van. */
const basil = (id: string, extras: Partial<ReservationRecord> = {}) =>
  reserva({ id, dog: cao('d1', 'Filó', 'Amor'), serviceType: 'boarding', startDate: '2026-09-21', endDate: '2026-09-27', transportRequired: false, ...extras });

/** Avocado: dia de chegada/saída da hospedagem — o driver busca ou entrega: parada da rota. */
const avocado = (id: string, extras: Partial<ReservationRecord> = {}) =>
  reserva({ id, dog: cao('d1', 'Filó', 'Amor'), serviceType: 'boarding', transportRequired: true, ...extras });

describe('dogsJaNaVan (quem já está dentro da van)', () => {
  it('dia de hotel (Basil) já está na van — mesmo sem evento de daycare no mesmo dia', () => {
    expect([...dogsJaNaVan(dia([basil('r1')]))]).toEqual(['d1']);
  });

  // 🪤 CLIENTE (02/10/2026): *"tô fazendo as rota e tá aparecendo os boarding na lista"* — o boarding
  // NÃO é parada de pickup por via de regra (contrato 28/09/2026: *"não entra como parada na rota, mas
  // entram na lista de total pack e contagem do dia"*). A distinção antiga ("dia de movimento entra como
  // parada") foi SUPERADA por este pedido: agora TODO boarding que passa pelo daycare nasce na van.
  it('boarding de UM DIA com transporte também nasce na van (Honey Bea e Archie, 02/10/2026)', () => {
    expect([...dogsJaNaVan(dia([avocado('r1')]))]).toEqual(['d1']);
  });

  it('chegada fora do horário (Cocoa no pick-up) NÃO está na van — o cão não vai pro daycare', () => {
    const day = dia([basil('r1', { goesToDaycare: false })]);
    expect([...dogsJaNaVan(day)]).toEqual([]);
  });

  it('cão só em daycare no dia NÃO está na van', () => {
    expect([...dogsJaNaVan(dia([reserva({ id: 'r1', dog: cao('d3', 'Kona', 'Leigh Ann') })]))]).toEqual([]);
  });
});

describe('transportPool (fila principal que o Dispatch oferece)', () => {
  it('não oferece o cão que já está na van (hotel) e mantém os outros', () => {
    const day = dia([basil('r1'), reserva({ id: 'r2', dog: cao('d1', 'Filó', 'Amor') }), reserva({ id: 'r3', dog: cao('d2', 'Kona', 'Leigh Ann') })]);
    expect(transportPool(day).map((item) => item.dogId)).toEqual(['d2']);
  });

  it('boarding NÃO entra na fila de pickup — o gestor o inclui à mão se precisar', () => {
    const day = dia([avocado('r1', { dog: cao('d1', 'Filó', 'Amor') })]);
    expect(transportPool(day).map((item) => item.dogId)).toEqual([]);
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
  it('lista o cão de hotel — e ele NÃO fica na fila principal', () => {
    const day = dia([basil('r1'), reserva({ id: 'r3', dog: cao('d2', 'Kona', 'Leigh Ann') })]);
    expect(vanPool(day).map((item) => item.dogId)).toEqual(['d1']);
    expect(transportPool(day).map((item) => item.dogId)).toEqual(['d2']);
  });

  it('não repete o cão na seção', () => {
    expect(vanPool(dia([basil('r1'), basil('r2')]))).toHaveLength(1);
  });

  it('o boarding entra na seção "já na van" (e sai da fila)', () => {
    const day = dia([avocado('r1', { dog: cao('d2', 'Thor', 'Maria') })]);
    expect(vanPool(day).map((item) => item.dogId)).toEqual(['d2']);
    expect(transportPool(day).map((item) => item.dogId)).toEqual([]);
  });

  it('a chegada fora do horário não entra em nenhuma das duas', () => {
    const day = dia([basil('r1', { dog: cao('d2', 'Thor', 'Maria'), goesToDaycare: false })]);
    expect(vanPool(day)).toEqual([]);
    expect(transportPool(day)).toEqual([]);
  });
});
