import { summarizeRange } from '@/features/calendar/gridMath';
import type {
  RecurringExceptionRecord,
  RecurringScheduleRecord,
  ReservationRecord,
} from '@/features/calendar/dayMath';

const dog = { id: 'dog-bob', dogName: 'Bob', clientName: 'Maria' };

const reservations: ReservationRecord[] = [
  { id: 'r-daycare', dog, serviceType: 'daycare', startDate: '2026-09-08', endDate: '2026-09-08', transportRequired: false },
  { id: 'r-boarding', dog, serviceType: 'boarding', startDate: '2026-09-05', endDate: '2026-09-07', transportRequired: true },
];

const recurring: RecurringScheduleRecord[] = [
  { id: 's-mon-wed-fri', dog, weekdays: [1, 3, 5], startDate: '2026-09-01', endDate: null, active: true, transportRequired: false },
];

describe('summarizeRange (contagem que alimenta o mes)', () => {
  it('conta daycare e boarding em cada dia do intervalo', () => {
    const counts = summarizeRange('2026-09-05', '2026-09-09', reservations, recurring, []);
    expect(Object.keys(counts)).toEqual([
      '2026-09-05',
      '2026-09-06',
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
    ]);
    // 05/09 (sabado): so o boarding (05 a 07) e a recorrencia e seg/qua/sex
    expect(counts['2026-09-05']).toEqual({ daycare: 0, boarding: 1 });
    // 06/09 (domingo): continua o boarding
    expect(counts['2026-09-06']).toEqual({ daycare: 0, boarding: 1 });
    // 07/09 (segunda): boarding + daycare recorrente de segunda
    expect(counts['2026-09-07']).toEqual({ daycare: 1, boarding: 1 });
    // 08/09 (terca): a reserva avulsa de daycare, sem recorrencia
    expect(counts['2026-09-08']).toEqual({ daycare: 1, boarding: 0 });
  });

  it('respeita a excecao de pausa no dia da recorrencia', () => {
    const exceptions: RecurringExceptionRecord[] = [
      { id: 'e-1', scheduleId: 's-mon-wed-fri', action: 'skip', startDate: '2026-09-09', endDate: '2026-09-09' },
    ];
    const counts = summarizeRange('2026-09-09', '2026-09-09', reservations, recurring, exceptions);
    // Quarta 09/09 cairia na recorrencia; com o skip o dia nao pode ficar igual a
    // uma quarta normal (conta 0 no daycare).
    expect(counts['2026-09-09'].daycare).toBe(0);
  });

  it('cobre um unico dia', () => {
    const counts = summarizeRange('2026-09-08', '2026-09-08', reservations, recurring, []);
    expect(Object.keys(counts)).toEqual(['2026-09-08']);
    expect(counts['2026-09-08']).toEqual({ daycare: 1, boarding: 0 });
  });

  it('nao inventa dias quando o intervalo esta invertido', () => {
    expect(summarizeRange('2026-09-09', '2026-09-05', reservations, recurring, [])).toEqual({});
  });
});
