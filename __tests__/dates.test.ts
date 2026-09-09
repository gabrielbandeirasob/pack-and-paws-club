import { todayLocalISO, addDaysISO, weekdayOfISO } from '@/features/calendar/dates';

describe('local date helpers', () => {
  beforeAll(() => { jest.useFakeTimers(); });
  afterAll(() => { jest.useRealTimers(); });

  it('produces today in the local timezone', () => {
    jest.setSystemTime(new Date(2026, 8, 9, 23, 30)); // local Sep 9 2026
    expect(todayLocalISO()).toBe('2026-09-09');
  });

  it('adds days across month boundaries', () => {
    expect(addDaysISO('2026-09-30', 2)).toBe('2026-10-02');
    expect(addDaysISO('2026-09-09', -1)).toBe('2026-09-08');
  });

  it('reports the weekday number of an ISO date', () => {
    expect(weekdayOfISO('2026-09-09')).toBe(3); // Wednesday
  });
});
