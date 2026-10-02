/**
 * PROPRIEDADE/BEI­RADA — datas com FUSO (America/Los_Angeles) e recorrência.
 *
 * Por que existe (auditoria de 02/10/2026): o robô do servidor roda em UTC e o cliente vive no
 * Pacífico. As duas viradas do horário de verão americano de 2026 são as datas em que "o dia do
 * negócio" e "o dia do servidor" mais se confundem — e onde um defeito de data passa despercebido
 * num teste rodado em UTC. Este arquivo NÃO depende do TZ do processo: sempre pede o fuso do negócio
 * para `todayLocalISO`, de modo que roda igual em UTC e em Los_Angeles.
 *
 * Nada aqui re-litiga o contrato do cliente: são invariantes que nunca podem quebrar.
 */
import {
  FUSO_DO_NEGOCIO,
  addDaysISO,
  todayLocalISO,
  weekdayOfISO,
} from '@/features/calendar/dates';
import {
  buildDay,
  dogsJaNaVan,
  isExtraDay,
  isSkipped,
  transportPool,
  vanPool,
  type DayItem,
  type RecurringExceptionRecord,
  type RecurringScheduleRecord,
  type ReservationRecord,
} from '@/features/calendar/dayMath';

/** Cálculo INDEPENDENTE do dia em Los Angeles (outra API: `en-CA` já sai `YYYY-MM-DD`). */
function diaEmLosAngeles(instante: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_DO_NEGOCIO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante);
}

describe('fuso do NEGÓCIO — as duas viradas do horário de verão de 2026', () => {
  it('spring forward (08/03/2026): a hora inexistente não pula o DIA', () => {
    jest.useFakeTimers();
    try {
      // 01:59 PST (UTC-8) — ainda o dia 08 no Pacífico.
      jest.setSystemTime(new Date('2026-03-08T09:59:00Z'));
      expect(todayLocalISO(FUSO_DO_NEGOCIO)).toBe('2026-03-08');
      // 10:00Z já é 03:00 PDT (UTC-7); a hora 02:00-02:59 não existiu, mas o DIA continua 08.
      jest.setSystemTime(new Date('2026-03-08T10:00:00Z'));
      expect(todayLocalISO(FUSO_DO_NEGOCIO)).toBe('2026-03-08');
    } finally {
      jest.useRealTimers();
    }
  });

  it('fall back (01/11/2026): a hora REPETIDA fica no mesmo dia', () => {
    jest.useFakeTimers();
    try {
      // 01:59 PDT (UTC-7)
      jest.setSystemTime(new Date('2026-11-01T08:59:00Z'));
      expect(todayLocalISO(FUSO_DO_NEGOCIO)).toBe('2026-11-01');
      // 01:00 PST (UTC-8) — o mesmo 01:00 acontece de novo, e continua sendo 01/11.
      jest.setSystemTime(new Date('2026-11-01T09:00:00Z'));
      expect(todayLocalISO(FUSO_DO_NEGOCIO)).toBe('2026-11-01');
    } finally {
      jest.useRealTimers();
    }
  });

  it('às 23:30 do Pacífico o servidor em UTC já virou o dia — o negócio NÃO', () => {
    jest.useFakeTimers();
    try {
      const instante = new Date('2026-11-02T07:30:00Z'); // 23:30 PST de 01/11
      jest.setSystemTime(instante);
      expect(diaEmLosAngeles(instante)).toBe('2026-11-01');
      expect(todayLocalISO(FUSO_DO_NEGOCIO)).toBe('2026-11-01');
      expect(instante.toISOString().slice(0, 10)).toBe('2026-11-02'); // o UTC discorda — é o defeito que se evita
    } finally {
      jest.useRealTimers();
    }
  });

  it('3 anos de instantes (de 6 em 6h): a data do negócio bate com cálculo independente e fica a <=1 dia do UTC', () => {
    const inicio = Date.UTC(2026, 0, 1, 0, 0, 0);
    const fim = Date.UTC(2028, 11, 31, 23, 59, 0);
    jest.useFakeTimers();
    try {
      for (let t = inicio; t <= fim; t += 6 * 3600 * 1000) {
        const instante = new Date(t);
        jest.setSystemTime(instante);
        const doApp = todayLocalISO(FUSO_DO_NEGOCIO);
        expect(doApp).toBe(diaEmLosAngeles(instante));
        expect(doApp).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        // A distância para a data UTC nunca passa de 1 dia (Los Angeles é UTC-7/8).
        const utc = instante.toISOString().slice(0, 10);
        const deltaDias = Math.abs((Date.parse(`${doApp}T00:00:00Z`) - Date.parse(`${utc}T00:00:00Z`)) / 86400000);
        expect(deltaDias).toBeLessThanOrEqual(1);
      }
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('addDaysISO — propriedade em 10 anos de datas', () => {
  it('somar 1 dia é sempre crescente, correto e reversível (inclusive sobre o horário de verão)', () => {
    let iso = '2026-01-01';
    for (let i = 0; i < 3653; i += 1) {
      const proximo = addDaysISO(iso, 1);
      expect(proximo > iso).toBe(true);
      expect(addDaysISO(proximo, -1)).toBe(iso); // reversível
      expect(weekdayOfISO(proximo)).toBe((weekdayOfISO(iso) + 1) % 7);
      iso = proximo;
    }
    // As viradas de horário de verão NÃO afetam a conta (que é em UTC, de propósito).
    expect(addDaysISO('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDaysISO('2026-11-01', 1)).toBe('2026-11-02');
    // Virada de ano bissexto e de século (2100 NÃO é bissexto).
    expect(addDaysISO('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysISO('2028-02-29', 1)).toBe('2028-03-01');
    expect(addDaysISO('2100-02-28', 1)).toBe('2100-03-01');
  });
});

/* ------------------------------------------------------------------- recorrência */

const cao = (id: string) => ({ id, dogName: `Dog ${id}`, clientName: `Client ${id}`, clientId: `c-${id}` });

const serie = (over: Partial<RecurringScheduleRecord> = {}): RecurringScheduleRecord => ({
  id: 's1',
  dog: cao('d1'),
  weekdays: [1, 3, 5], // Mon/Wed/Fri
  startDate: '2026-09-01',
  endDate: null,
  active: true,
  transportRequired: false,
  ...over,
});

const excecao = (over: Partial<RecurringExceptionRecord> = {}): RecurringExceptionRecord => ({
  id: 'x1',
  scheduleId: 's1',
  action: 'skip',
  startDate: '2026-09-09',
  endDate: '2026-09-09',
  ...over,
});

const recorrentes = (dia: ReturnType<typeof buildDay>): DayItem[] =>
  dia.daycare.filter((item) => item.kind === 'recurring-daycare');

describe('recorrência — série que TERMINA e exceções que ligam/desligam', () => {
  it('a série para no dia do endDate e não ressuscita depois', () => {
    const s = serie({ endDate: '2026-09-11' });
    expect(recorrentes(buildDay('2026-09-11', [], [s])).length).toBe(1); // 11/09 é sexta e é o último dia
    expect(recorrentes(buildDay('2026-09-18', [], [s])).length).toBe(0); // sexta seguinte: fora do período
    // A série nem existe antes de começar.
    expect(recorrentes(buildDay('2026-08-31', [], [s])).length).toBe(0);
  });

  it('exceção de skip de VÁRIOS dias esconde todos, inclusive o dia do meio de uma hospedagem', () => {
    const s = serie({ transportRequired: true });
    const pausa: RecurringExceptionRecord[] = [excecao({ startDate: '2026-10-05', endDate: '2026-10-16' })];
    // Mon 05/10, Wed 07/10, Fri 09/10, Mon 12/10 (todas dentro) — todas escondidas.
    for (const dia of ['2026-10-05', '2026-10-07', '2026-10-09', '2026-10-12']) {
      expect(isSkipped('s1', dia, pausa)).toBe(true);
      expect(recorrentes(buildDay(dia, [], [s], pausa)).length).toBe(0);
    }
    // Segunda 19/10 (primeira fora) volta.
    expect(isSkipped('s1', '2026-10-19', pausa)).toBe(false);
    expect(recorrentes(buildDay('2026-10-19', [], [s], pausa)).length).toBe(1);
  });

  it('transport_on e transport_off no MESMO dia: vale a ÚLTIMA exceção escrita (ordem do banco)', () => {
    const s = serie({ transportRequired: false });
    const onDepoisDeOff: RecurringExceptionRecord[] = [
      excecao({ id: 'x-off', action: 'transport_off', startDate: '2026-09-09', endDate: '2026-09-09' }),
      excecao({ id: 'x-on', action: 'transport_on', startDate: '2026-09-09', endDate: '2026-09-09' }),
    ];
    expect(recorrentes(buildDay('2026-09-09', [], [s], onDepoisDeOff))[0].transportRequired).toBe(true);

    const offDepoisDeOn: RecurringExceptionRecord[] = [
      excecao({ id: 'x-on2', action: 'transport_on', startDate: '2026-09-09', endDate: '2026-09-09' }),
      excecao({ id: 'x-off2', action: 'transport_off', startDate: '2026-09-09', endDate: '2026-09-09' }),
    ];
    expect(recorrentes(buildDay('2026-09-09', [], [s], offDepoisDeOn))[0].transportRequired).toBe(false);
  });

  it('exceção fora da data não vaza e éExtraDay/isSkipped são específicos da escala', () => {
    const fora: RecurringExceptionRecord[] = [excecao({ startDate: '2026-09-16', endDate: '2026-09-16' })];
    expect(isSkipped('s1', '2026-09-09', fora)).toBe(false);
    expect(isSkipped('outra-escala', '2026-09-16', fora)).toBe(false);
    const extra: RecurringExceptionRecord[] = [excecao({ action: 'extra', startDate: '2026-09-08', endDate: '2026-09-08' })];
    expect(isExtraDay('s1', '2026-09-08', extra)).toBe(true); // terça que não está nos weekdays
    expect(recorrentes(buildDay('2026-09-08', [], [serie()], extra)).length).toBe(1);
    // Sem a exceção, o mesmo dia de terça NÃO aparece.
    expect(recorrentes(buildDay('2026-09-08', [], [serie()], [])).length).toBe(0);
  });
});

describe('hospedagem — o dia do MEIO (sem chegada/saída) fica na van, não na fila de pickup', () => {
  const meio: ReservationRecord = {
    id: 'r-mid',
    dog: cao('d-mid'),
    serviceType: 'boarding',
    startDate: '2026-09-05',
    endDate: '2026-09-10',
    transportRequired: true,
    goesToDaycare: true,
  };
  const chegadaForaDoHorario: ReservationRecord = {
    ...meio,
    id: 'r-late',
    dog: cao('d-late'),
    goesToDaycare: false, // Cocoa no pick-up: não passa pelo daycare
  };

  it('todo boarding que passa pelo daycare nasce DENTRO da van (mesmo pedindo transporte)', () => {
    const dia = buildDay('2026-09-07', [meio], []);
    expect(dogsJaNaVan(dia).has('d-mid')).toBe(true);
    expect(vanPool(dia).map((i) => i.dogId)).toEqual(['d-mid']);
    expect(transportPool(dia).map((i) => i.dogId)).toEqual([]);
  });

  it('quem NÃO passa pelo daycare (chegada fora do horário) continua na fila de transporte', () => {
    const dia = buildDay('2026-09-07', [chegadaForaDoHorario], []);
    expect(dogsJaNaVan(dia).has('d-late')).toBe(false);
    expect(vanPool(dia).map((i) => i.dogId)).toEqual([]);
    expect(transportPool(dia).map((i) => i.dogId)).toEqual(['d-late']);
  });

  it('propriedade (400 dias aleatórios determinísticos): van e fila são DISJUNTAS e nenhum cão some', () => {
    let semente = 20261101;
    const rnd = () => {
      semente = (semente * 1103515245 + 12345) & 0x7fffffff;
      return semente / 0x7fffffff;
    };
    for (let caso = 0; caso < 400; caso += 1) {
      const quantos = 1 + Math.floor(rnd() * 8);
      const reservas: ReservationRecord[] = Array.from({ length: quantos }, (_, i) => ({
        id: `r${i}`,
        dog: cao(`d${i}`),
        serviceType: rnd() < 0.5 ? 'boarding' : 'daycare',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        transportRequired: rnd() < 0.5,
        goesToDaycare: rnd() < 0.7,
      }));
      const dia = buildDay('2026-09-15', reservas, []);
      const naVan = new Set(vanPool(dia).map((i) => i.dogId));
      const naFila = new Set(transportPool(dia).map((i) => i.dogId));
      for (const id of naVan) expect(naFila.has(id)).toBe(false);
      for (const item of transportPool(dia)) expect(item.transportRequired).toBe(true);
      // Todo cão que pede transporte está na van OU na fila (nunca some).
      for (const item of [...dia.daycare, ...dia.boarding]) {
        if (!item.transportRequired) continue;
        expect(naVan.has(item.dogId) || naFila.has(item.dogId)).toBe(true);
      }
    }
  });
});
