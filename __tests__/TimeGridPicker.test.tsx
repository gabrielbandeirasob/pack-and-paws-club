import { fireEvent, render } from '@testing-library/react-native';

import { generateTimes, TimeGridPicker } from '@/features/dispatch/TimeGridPicker';

describe('generateTimes', () => {
  it('generates 15-minute options across the day', () => {
    const times = generateTimes();
    expect(times[0]).toBe('00:00');
    expect(times).toContain('07:30');
    expect(times).toContain('08:15');
    expect(times).toContain('23:45');
    expect(times).toHaveLength(96);
  });

  it('supports custom steps', () => {
    expect(generateTimes(30)).toHaveLength(48);
  });
});

describe('TimeGridPicker', () => {
  it('calls onChange with the tapped time and highlights the current value', async () => {
    const onChange = jest.fn();
    const onDone = jest.fn();
    const screen = await render(<TimeGridPicker testID="grid" value="07:30" onChange={onChange} onDone={onDone} />);
    await fireEvent.press(screen.getByRole('button', { name: '08:15' }));
    expect(onChange).toHaveBeenCalledWith('08:15');
    expect(onChange).not.toHaveBeenCalledWith('07:30');
  });

  it('closes through Done', async () => {
    const onDone = jest.fn();
    const screen = await render(<TimeGridPicker testID="grid" value={null} onChange={jest.fn()} onDone={onDone} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalled();
  });
});
