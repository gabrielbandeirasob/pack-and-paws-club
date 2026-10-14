/**
 * BARRA DE DAYCARE DE VÁRIOS DIAS + ORDEM DAS LINHAS NÃO PODE MUDAR O DIA
 *
 * Dois defeitos medidos no banco do cliente em 14/10/2026 (queixa do escritório no grupo do app:
 * *"tá faltando 1 cachorro lá ainda"*), com as funções REAIS deste módulo sobre as reservas reais:
 *
 * 1. **A barra de daycare de vários dias só entrava no dia de início.** O escritório pinta UMA barra
 *    por semana (medido: `Charlie` 12→17 e `Tiger` 13→16) e a lista de trabalho dele traz os dois com
 *    horário de busca em cada dia — o app mostrava o Charlie só em 12/10 e o Tiger só em 13/10.
 * 2. **A ordem das linhas do SELECT decidia quem era parada e quem ia para a van.** Uma chegada/saída
 *    de hospedagem (linha de UM dia com `movement_day = true`) e a barra da estadia (`false`) cobrem o
 *    mesmo dia; a agregação deixava valer a primeira que viesse. Medido em 15/10 (Elvis, Levi S) e
 *    16/10 (Jasper, Ruby, Skippy): a fila ia de 17 para 19 e de 12 para 13 só trocando a ordem.
 *
 * Os dois vetores abaixo usam o MESMO caminho de tela (`buildDay` → `transportPool` → `dogsJaNaVan`),
 * com nomes de cães e datas do caso real. A regra do dia de movimento é a palavra do cliente de
 * 06/10/2026: *"o dia de CHEGADA/SAÍDA da hospedagem é parada normal da rota"*.
 */
import {
  buildDay,
  dogsJaNaVan,
  transportPool,
  transportPoolForPhase,
  type RecurringExceptionRecord,
  type RecurringScheduleRecord,
  type ReservationRecord,
} from '@/features/calendar/dayMath';

const cao = (id: string, dogName: string, clientName: string) => ({ id, dogName, clientName });

const TIGER = cao('dog-tiger', 'Tiger', 'Norm');
const CHARLIE = cao('dog-charlie', 'Charlie', 'Emily');
const ELVIS = cao('dog-elvis', 'Elvis', 'Chris');
const DOG = {
  daycareMultiDia: (): ReservationRecord => ({
    id: 'r-charlie-barra',
    dog: CHARLIE,
    serviceType: 'daycare',
    startDate: '2026-10-12',
    endDate: '2026-10-17',
    status: 'confirmed',
    transportRequired: true,
  }),
  daycareTiger: (): ReservationRecord => ({
    id: 'r-tiger-barra',
    dog: TIGER,
    serviceType: 'daycare',
    startDate: '2026-10-13',
    endDate: '2026-10-16',
    status: 'confirmed',
    transportRequired: true,
  }),
};

const semEscalas: RecurringScheduleRecord[] = [];
const semExcecoes: RecurringExceptionRecord[] = [];

const nomesDaFila = (dia: string, reservas: ReservationRecord[]): string[] =>
  transportPool(buildDay(dia, reservas, semEscalas, semExcecoes)).map((i) => i.dogName).sort();

const nomesNaVan = (dia: string, reservas: ReservationRecord[]): string[] => {
  const resumo = buildDay(dia, reservas, semEscalas, semExcecoes);
  const naVan = dogsJaNaVan(resumo);
  return resumo.boarding.filter((i) => naVan.has(i.dogId)).map((i) => i.dogName).sort();
};

describe('barra de daycare de vários dias = o cão vem TODO dia dela', () => {
  const reservas = [DOG.daycareMultiDia(), DOG.daycareTiger()];

  it('Charlie (12→17) aparece em cada dia da barra, e não nos dias de fora', () => {
    for (const dia of ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']) {
      expect(nomesDaFila(dia, reservas)).toContain('Charlie');
    }
    expect(nomesDaFila('2026-10-11', reservas)).not.toContain('Charlie');
    expect(nomesDaFila('2026-10-18', reservas)).not.toContain('Charlie');
  });

  it('Tiger (13→16) idem — é o caso do dia 14/10, quando o escritório esperava os dois na rota', () => {
    for (const dia of ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']) {
      expect(nomesDaFila(dia, reservas)).toContain('Tiger');
    }
    expect(nomesDaFila('2026-10-12', reservas)).not.toContain('Tiger');
    expect(nomesDaFila('2026-10-17', reservas)).not.toContain('Tiger');
  });

  it('em 14/10 a fila tem os dois cães da barra (o dia deixa de "perder" cachorro)', () => {
    expect(nomesDaFila('2026-10-14', reservas)).toEqual(['Charlie', 'Tiger']);
  });

  it('cão da barra não duplica quando existe também a reserva avulsa do dia (17/10 do Charlie)', () => {
    const avulsa: ReservationRecord = {
      id: 'r-charlie-dia17',
      dog: CHARLIE,
      serviceType: 'daycare',
      startDate: '2026-10-17',
      endDate: '2026-10-17',
      status: 'confirmed',
      transportRequired: true,
    };
    expect(nomesDaFila('2026-10-17', [...reservas, avulsa])).toEqual(['Charlie']);
  });

  it('cancelada continua fora de TODOS os dias da barra', () => {
    const cancelada: ReservationRecord = { ...DOG.daycareMultiDia(), status: 'cancelled' };
    for (const dia of ['2026-10-12', '2026-10-14', '2026-10-17']) {
      expect(nomesDaFila(dia, [cancelada])).not.toContain('Charlie');
    }
  });

  it('barra SEM transporte conta no dia (daycare) mas não entra na fila de pickup', () => {
    const semTransporte: ReservationRecord = { ...DOG.daycareMultiDia(), transportRequired: false, pickupRequired: false, dropoffRequired: false };
    const resumo = buildDay('2026-10-14', [semTransporte], semEscalas, semExcecoes);
    expect(resumo.daycare.map((i) => i.dogName)).toEqual(['Charlie']);
    expect(transportPool(resumo)).toHaveLength(0);
  });

  it('barra de daycare gera busca E entrega em cada dia (as duas pernas)', () => {
    for (const dia of ['2026-10-12', '2026-10-14', '2026-10-17']) {
      expect(transportPoolForPhase(buildDay(dia, reservas, semEscalas, semExcecoes), 'dropoff').map((i) => i.dogName)).toContain('Charlie');
    }
  });
});

describe('a ORDEM das reservas não pode decidir o dia (movement_day combinado)', () => {
  /**
   * Elvis em 13→18 (estadia, sem marca) + o dia 15 com `movement_day = true` (chegada/saída). As duas
   * linhas cobrem 15/10; ele TEM de ser parada nesse dia em qualquer ordem de SELECT. Nos outros dias
   * da estadia ele segue na van (contrato de 28/09: todo boarding vai pro daycare, não é parada).
   */
  const estadia: ReservationRecord = {
    id: 'r-elvis-estadia',
    dog: ELVIS,
    serviceType: 'boarding',
    startDate: '2026-10-13',
    endDate: '2026-10-18',
    status: 'confirmed',
    transportRequired: true,
    goesToDaycare: true,
    movementDay: false,
  };
  const diaDeMovimento: ReservationRecord = {
    id: 'r-elvis-movimento',
    dog: ELVIS,
    serviceType: 'boarding',
    startDate: '2026-10-15',
    endDate: '2026-10-15',
    status: 'confirmed',
    transportRequired: true,
    goesToDaycare: true,
    movementDay: true,
  };

  const ordens: [string, ReservationRecord[]][] = [
    ['estadia primeiro', [estadia, diaDeMovimento]],
    ['dia de movimento primeiro', [diaDeMovimento, estadia]],
  ];

  it.each(ordens)('Skippy/Elvis em 15/10 é parada da fila em qualquer ordem (%s)', (_nome, reservas) => {
    expect(nomesDaFila('2026-10-15', reservas)).toEqual(['Elvis']);
    expect(nomesNaVan('2026-10-15', reservas)).toEqual([]);
  });

  it.each(ordens)('nos outros dias da estadia ele continua na van (%s)', (_nome, reservas) => {
    for (const dia of ['2026-10-13', '2026-10-14', '2026-10-16', '2026-10-17', '2026-10-18']) {
      expect(nomesDaFila(dia, reservas)).toEqual([]);
      expect(nomesNaVan(dia, reservas)).toEqual(['Elvis']);
    }
  });

  it('as duas ordens devolvem o MESMO dia em todas as datas da estadia', () => {
    for (const dia of ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']) {
      const a = ordens[0][1];
      const b = ordens[1][1];
      expect(nomesDaFila(dia, a)).toEqual(nomesDaFila(dia, b));
      expect(nomesNaVan(dia, a)).toEqual(nomesNaVan(dia, b));
      expect(buildDay(dia, a, semEscalas, semExcecoes).daycare.length).toBe(buildDay(dia, b, semEscalas, semExcecoes).daycare.length);
    }
  });

  it('cancelar a linha do dia de movimento devolve o cão à van (o dia volta a ser estadia)', () => {
    const comCancelamento: ReservationRecord = { ...diaDeMovimento, status: 'cancelled' };
    expect(nomesDaFila('2026-10-15', [estadia, comCancelamento])).toEqual([]);
    expect(nomesNaVan('2026-10-15', [estadia, comCancelamento])).toEqual(['Elvis']);
  });

  it('chegada fora do horário (goesToDaycare=false) nunca vai para a van, em qualquer ordem', () => {
    const cocoa: ReservationRecord = { ...diaDeMovimento, goesToDaycare: false };
    const ordemCocoa: [string, ReservationRecord[]][] = [
      ['cocoa primeiro', [cocoa, estadia]],
      ['estadia primeiro', [estadia, cocoa]],
    ];
    for (const [nome, reservas] of ordemCocoa) {
      expect(nomesNaVan('2026-10-15', reservas)).toEqual([]);
      expect(nomesDaFila('2026-10-15', reservas)).toEqual(['Elvis']);
      expect(nome).toBeTruthy();
    }
  });
});
