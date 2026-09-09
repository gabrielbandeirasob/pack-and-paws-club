import { fireEvent, render } from '@testing-library/react-native';

import { TimeWheel } from '@/features/dispatch/TimeWheel';

const ITEM = 42;

function scrollTo(screen: Awaited<ReturnType<typeof render>>, testID: string, index: number) {
  return fireEvent(screen.getByTestId(testID), 'momentumScrollEnd', { nativeEvent: { contentOffset: { y: index * ITEM } } });
}

describe('TimeWheel', () => {
  it('emits the picked hour and minute as HH:MM', async () => {
    const onChange = jest.fn();
    const screen = await render(<TimeWheel testID="wheel" value={null} onChange={onChange} onDone={jest.fn()} />);
    await scrollTo(screen, 'wheel-hours', 7);
    await scrollTo(screen, 'wheel-minutes', 6);
    expect(onChange).toHaveBeenLastCalledWith('07:30');
  });

  it('respects an existing value as the starting point', async () => {
    const onChange = jest.fn();
    const screen = await render(<TimeWheel testID="wheel" value="09:15" onChange={onChange} onDone={jest.fn()} />);
    await scrollTo(screen, 'wheel-minutes', 0);
    expect(onChange).toHaveBeenLastCalledWith('09:00');
  });

  it('clamps overscroll to the last option', async () => {
    const onChange = jest.fn();
    const screen = await render(<TimeWheel testID="wheel" value={null} onChange={onChange} onDone={jest.fn()} />);
    await scrollTo(screen, 'wheel-hours', 999);
    expect(onChange).toHaveBeenLastCalledWith('23:00');
  });

  it('closes through Done', async () => {
    const onDone = jest.fn();
    const screen = await render(<TimeWheel testID="wheel" value={null} onChange={jest.fn()} onDone={onDone} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalled();
  });
});
