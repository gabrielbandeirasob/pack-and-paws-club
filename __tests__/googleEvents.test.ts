import { buildGoogleEvent } from '@/features/calendar/googleEvents';

describe('buildGoogleEvent', () => {
  it('builds a one-day daycare all-day event with exclusive end date', () => {
    const event = buildGoogleEvent({ dogName: 'Bob', clientName: 'Maria', serviceType: 'daycare', startDate: '2026-09-08', endDate: '2026-09-08' });
    expect(event).toMatchObject({
      summary: 'Daycare · Bob (Maria)',
      start: { date: '2026-09-08' },
      end: { date: '2026-09-09' },
    });
  });

  it('builds a boarding range event ending the day after checkout', () => {
    const event = buildGoogleEvent({ dogName: 'Bob', clientName: 'Maria', serviceType: 'boarding', startDate: '2026-09-05', endDate: '2026-09-10' });
    expect(event.start).toEqual({ date: '2026-09-05' });
    expect(event.end).toEqual({ date: '2026-09-11' });
  });

  it('adds a weekly recurrence rule for recurring daycare', () => {
    const event = buildGoogleEvent({ dogName: 'Luna', clientName: 'John', serviceType: 'daycare', startDate: '2026-09-09', weekdays: [1, 3, 5] });
    expect(event.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR']);
  });

  it('caps a recurrence when the schedule has an end date', () => {
    const event = buildGoogleEvent({ dogName: 'Luna', clientName: 'John', serviceType: 'daycare', startDate: '2026-09-09', weekdays: [1, 3, 5], endDate: '2026-12-18' });
    expect(event.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261218']);
  });

  it('turns paused dates into EXDATE lines so Google skips them', () => {
    const event = buildGoogleEvent({
      dogName: 'Luna',
      clientName: 'John',
      serviceType: 'daycare',
      startDate: '2026-09-09',
      weekdays: [1, 3, 5],
      skipDates: ['2026-09-18', '2026-09-21'],
    });
    expect(event.recurrence).toEqual([
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
      'EXDATE;VALUE=DATE:20260918',
      'EXDATE;VALUE=DATE:20260921',
    ]);
  });

  it('ignores skipDates on a one-off reservation (nothing to exclude)', () => {
    const event = buildGoogleEvent({ dogName: 'Bob', clientName: 'Maria', serviceType: 'daycare', startDate: '2026-09-08', endDate: '2026-09-08', skipDates: ['2026-09-08'] });
    expect(event.recurrence).toBeUndefined();
  });
});
