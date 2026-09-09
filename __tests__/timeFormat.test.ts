import { parseTime, toHHMM } from '@/features/dispatch/timeFormat';

describe('timeFormat helpers', () => {
  it('parses an HH:MM string into a local Date', () => {
    const date = parseTime('07:30');
    expect(date.getHours()).toBe(7);
    expect(date.getMinutes()).toBe(30);
  });

  it('falls back to 08:00 — never midnight — for empty or invalid values', () => {
    expect(parseTime(null).getHours()).toBe(8);
    expect(parseTime('').getHours()).toBe(8);
    expect(parseTime('abc').getHours()).toBe(8);
    expect(parseTime('25:99').getHours()).toBe(8);
    expect(parseTime('').getMinutes()).toBe(0);
  });

  it('round-trips through toHHMM', () => {
    expect(toHHMM(parseTime('09:05'))).toBe('09:05');
    expect(toHHMM(parseTime('23:55'))).toBe('23:55');
  });
});
