import { buildDay, type DayItem, type ReservationRecord, type RecurringScheduleRecord } from '@/features/calendar/dayMath';

const dog = { id: 'dog-bob', dogName: 'Bob', clientName: 'Maria' };

const reservations: ReservationRecord[] = [
  { id: 'r-daycare', dog, serviceType: 'daycare', startDate: '2026-09-08', endDate: '2026-09-08' },
  { id: 'r-boarding', dog, serviceType: 'boarding', startDate: '2026-09-05', endDate: '2026-09-10' },
];

const recurring: RecurringScheduleRecord[] = [
  { id: 's-mon-wed-fri', dog, weekdays: [1, 3, 5], startDate: '2026-09-01', endDate: null, active: true },
];

describe('buildDay calendar math', () => {
  it('lists a daycare only on its own date', () => {
    const day = buildDay('2026-09-08', reservations, recurring);
    expect(day.daycare.map((item) => item.kind)).toEqual(['daycare']);
    expect(day.boarding.map((item) => item.kind)).toEqual(['boarding']);
    expect(day.daycare[0]).toMatchObject({ dogName: 'Bob', clientName: 'Maria', reservationId: 'r-daycare' });
  });

  it('spreads a boarding reservation across every date of its range', () => {
    expect(buildDay('2026-09-05', reservations, recurring).boarding).toHaveLength(1);
    expect(buildDay('2026-09-07', reservations, recurring).boarding).toHaveLength(1);
    expect(buildDay('2026-09-10', reservations, recurring).boarding).toHaveLength(1);
    expect(buildDay('2026-09-11', reservations, recurring).boarding).toHaveLength(0);
  });

  it('applies weekly recurrence only on matching weekdays inside its period', () => {
    // 2026-09-08 is a Tuesday (weekday 2): not in Mon/Wed/Fri
    expect(buildDay('2026-09-08', reservations, recurring).daycare).toHaveLength(1);
    // 2026-09-09 is Wednesday (weekday 3): recurrence applies
    const wednesday = buildDay('2026-09-09', reservations, recurring);
    expect(wednesday.daycare.map((item) => item.kind)).toContain('recurring-daycare');
  });

  it('combines daycare, boarding and recurrence without duplication', () => {
    // Wednesday 2026-09-09 has recurring daycare + boarding (Sep 5-10)
    const day = buildDay('2026-09-09', reservations, recurring);
    const kinds = day.daycare.map((item) => item.kind);
    expect(kinds).toContain('recurring-daycare');
    expect(day.boarding).toHaveLength(1);
    expect(allIds(day)).toHaveLength(2);
  });

  it('stops recurrence when it is inactive or outside the period', () => {
    const stopped: RecurringScheduleRecord[] = [
      { ...recurring[0], id: 's-stopped', active: false },
      { ...recurring[0], id: 's-future', startDate: '2026-10-01' },
    ];
    const day = buildDay('2026-09-09', reservations, stopped);
    expect(day.daycare.filter((item) => item.kind === 'recurring-daycare')).toHaveLength(0);
  });
});

function allIds(day: { daycare: DayItem[]; boarding: DayItem[] }): string[] {
  return [...day.daycare, ...day.boarding].map((item) => `${item.kind}-${item.dogId}-${item.recurringScheduleId ?? item.reservationId}`);
}
