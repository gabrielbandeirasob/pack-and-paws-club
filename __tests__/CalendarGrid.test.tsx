import { fireEvent, render } from '@testing-library/react-native';

import { CalendarGrid } from '@/features/calendar/CalendarGrid';
import type { DayCounts } from '@/features/calendar/gridMath';

describe('CalendarGrid', () => {
  const counts: Record<string, DayCounts> = {
    '2026-09-05': { daycare: 0, boarding: 1 },
    '2026-09-06': { daycare: 0, boarding: 1 },
    '2026-09-09': { daycare: 2, boarding: 1 },
    '2026-09-10': { daycare: 0, boarding: 1 },
  };

  // One week row, Sunday Sep 6 to Saturday Sep 12 (2026).
  const rows: (string | null)[][] = [['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12']];

  it('renders a selectable cell for every non-null date', async () => {
    const screen = await render(<CalendarGrid rows={rows} counts={counts} selectedDate="2026-09-09" onSelectDate={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Select 2026-09-06 · 1 boarding' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Select 2026-09-09 · 2 daycare · 1 boarding' })).toBeTruthy();
  });

  it('reports tap with the tapped ISO date', async () => {
    const onSelectDate = jest.fn();
    const screen = await render(<CalendarGrid rows={rows} counts={counts} selectedDate={null} onSelectDate={onSelectDate} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Select 2026-09-10 · 1 boarding' }));
    expect(onSelectDate).toHaveBeenCalledWith('2026-09-10');
  });

  it('shows one boarding dot per day of a boarding interval without duplicating counts', async () => {
    // A boarding reservation Sep 5-10 appears on every day of the range (Sep 6, 9, 10 in this row).
    const screen = await render(<CalendarGrid rows={rows} counts={counts} selectedDate={null} onSelectDate={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Select 2026-09-06 · 1 boarding' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Select 2026-09-09 · 2 daycare · 1 boarding' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Select 2026-09-10 · 1 boarding' })).toBeTruthy();
  });

  it('renders null cells as empty space', async () => {
    const withNulls: (string | null)[][] = [[null, '2026-09-01']];
    const screen = await render(<CalendarGrid rows={withNulls} counts={{}} selectedDate={null} onSelectDate={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Select 2026-09-01 · no care' })).toBeTruthy();
  });
});
