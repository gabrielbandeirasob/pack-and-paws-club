import { addMonthsISO, monthLabel, monthMatrixISO, weekDatesISO, weekStartISO } from '@/features/calendar/gridMath';

describe('gridMath week helpers', () => {
  it('finds the Sunday that starts a week', () => {
    // 2026-09-09 is a Wednesday; the week starts Sunday 2026-09-06.
    expect(weekStartISO('2026-09-09')).toBe('2026-09-06');
  });

  it('returns 7 dates starting on Sunday', () => {
    expect(weekDatesISO('2026-09-09')).toEqual([
      '2026-09-06',
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
    ]);
  });

  it('treats Sunday itself as the week start', () => {
    expect(weekStartISO('2026-09-06')).toBe('2026-09-06');
  });
});

describe('gridMath month helpers', () => {
  it('formats the month label in English (the app language)', () => {
    expect(monthLabel('2026-09-09')).toBe('September 2026');
  });

  it('adds months without overflowing short months', () => {
    expect(addMonthsISO('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsISO('2026-08-31', 1)).toBe('2026-09-30');
    expect(addMonthsISO('2026-09-09', -1)).toBe('2026-08-09');
  });

  it('builds a grid that starts on Sunday and covers the month cells', () => {
    const grid = monthMatrixISO('2026-09-09');
    expect(grid.label).toBe('September 2026');
    // September 2026 starts on a Tuesday (weekday 2) → 2 leading nulls.
    expect(grid.weeks[0].slice(0, 2)).toEqual([null, null]);
    expect(grid.weeks[0][2]).toBe('2026-09-01');
    expect(grid.weeks[0][6]).toBe('2026-09-05');
    // All rows have 7 cells and every non-null cell is inside September.
    for (const week of grid.weeks) {
      expect(week).toHaveLength(7);
      for (const cell of week) {
        if (cell) expect(cell.startsWith('2026-09-')).toBe(true);
      }
    }
    // The last day of the month is present exactly once.
    const cells = grid.weeks.flat().filter((cell): cell is string => cell !== null);
    expect(cells.filter((cell) => cell === '2026-09-30')).toHaveLength(1);
    expect(cells).toHaveLength(30);
  });
});
