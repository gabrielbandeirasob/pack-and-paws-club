import {
  buildDay,
  type DayItem,
  type RecurringExceptionRecord,
  type ReservationRecord,
  type RecurringScheduleRecord,
} from '@/features/calendar/dayMath';

const dog = { id: 'dog-bob', dogName: 'Bob', clientName: 'Maria' };

const reservations: ReservationRecord[] = [
  { id: 'r-daycare', dog, serviceType: 'daycare', startDate: '2026-09-08', endDate: '2026-09-08', transportRequired: false },
  { id: 'r-boarding', dog, serviceType: 'boarding', startDate: '2026-09-05', endDate: '2026-09-10', transportRequired: true },
];

const recurring: RecurringScheduleRecord[] = [
  { id: 's-mon-wed-fri', dog, weekdays: [1, 3, 5], startDate: '2026-09-01', endDate: null, active: true, transportRequired: false },
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

describe('recurrence exceptions', () => {
  const exceptions: RecurringExceptionRecord[] = [
    { id: 'x-holiday', scheduleId: 's-mon-wed-fri', action: 'skip', startDate: '2026-09-09', endDate: '2026-09-09', reason: 'holiday' },
    { id: 'x-vacation', scheduleId: 's-mon-wed-fri', action: 'skip', startDate: '2026-10-05', endDate: '2026-10-16', reason: 'owner away' },
  ];

  it('hides a recurring daycare on a single skipped date', () => {
    const wednesday = buildDay('2026-09-09', [], recurring, exceptions);
    expect(wednesday.daycare.filter((item) => item.kind === 'recurring-daycare')).toHaveLength(0);
  });

  it('still shows recurrence on surrounding weekdays', () => {
    // Friday 2026-09-11 is not skipped.
    const friday = buildDay('2026-09-11', [], recurring, exceptions);
    expect(friday.daycare.map((item) => item.kind)).toContain('recurring-daycare');
  });

  it('hides every weekday inside a multi-day pause interval', () => {
    // Mon 2026-10-05 and Wed 2026-10-07 are inside the pause; Fri 2026-10-09 too.
    expect(buildDay('2026-10-05', [], recurring, exceptions).daycare.filter((item) => item.kind === 'recurring-daycare')).toHaveLength(0);
    expect(buildDay('2026-10-07', [], recurring, exceptions).daycare.filter((item) => item.kind === 'recurring-daycare')).toHaveLength(0);
    // Friday 2026-10-09 inside pause as well (Oct 5-16 covers Mon/Wed/Fri of that week).
    expect(buildDay('2026-10-09', [], recurring, exceptions).daycare.filter((item) => item.kind === 'recurring-daycare')).toHaveLength(0);
    // Following Monday 2026-10-12 is still inside; the first weekday after the pause is Mon 2026-10-19.
    expect(buildDay('2026-10-19', [], recurring, exceptions).daycare.map((item) => item.kind)).toContain('recurring-daycare');
  });

  it('ignores exceptions belonging to other schedules', () => {
    const foreign: RecurringExceptionRecord[] = [
      { id: 'x-other', scheduleId: 's-other', action: 'skip', startDate: '2026-09-09', endDate: '2026-09-09' },
    ];
    const day = buildDay('2026-09-09', [], recurring, foreign);
    expect(day.daycare.filter((item) => item.kind === 'recurring-daycare')).toHaveLength(1);
  });
});

describe('transport flags', () => {
  it('carries transportRequired from a reservation', () => {
    expect(buildDay('2026-09-10', reservations, recurring).boarding[0].transportRequired).toBe(true);
    expect(buildDay('2026-09-08', reservations, recurring).daycare[0].transportRequired).toBe(false);
  });

  it('uses the schedule default transport', () => {
    const withTransport: RecurringScheduleRecord[] = [{ ...recurring[0], transportRequired: true }];
    const day = buildDay('2026-09-11', [], withTransport);
    expect(day.daycare.find((item) => item.kind === 'recurring-daycare')?.transportRequired).toBe(true);
  });

  it('applies a transport_on override for one date', () => {
    const overrides: RecurringExceptionRecord[] = [
      { id: 'x-on', scheduleId: 's-mon-wed-fri', action: 'transport_on', startDate: '2026-09-11', endDate: '2026-09-11' },
    ];
    const day = buildDay('2026-09-11', [], recurring, overrides);
    expect(day.daycare.find((item) => item.kind === 'recurring-daycare')?.transportRequired).toBe(true);
  });

  it('applies a transport_off override and does not leak to other dates', () => {
    const withTransport: RecurringScheduleRecord[] = [{ ...recurring[0], transportRequired: true }];
    const overrides: RecurringExceptionRecord[] = [
      { id: 'x-off', scheduleId: 's-mon-wed-fri', action: 'transport_off', startDate: '2026-09-11', endDate: '2026-09-11' },
    ];
    const friday = buildDay('2026-09-11', [], withTransport, overrides);
    expect(friday.daycare.find((item) => item.kind === 'recurring-daycare')?.transportRequired).toBe(false);
    const nextFriday = buildDay('2026-09-18', [], withTransport, overrides);
    expect(nextFriday.daycare.find((item) => item.kind === 'recurring-daycare')?.transportRequired).toBe(true);
  });
});

function allIds(day: { daycare: DayItem[]; boarding: DayItem[] }): string[] {
  return [...day.daycare, ...day.boarding].map((item) => `${item.kind}-${item.dogId}-${item.recurringScheduleId ?? item.reservationId}`);
}
