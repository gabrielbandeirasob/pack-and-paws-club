import { fireEvent, render } from '@testing-library/react-native';
import { ManagerDashboard } from '@/features/dashboard/ManagerDashboard';

describe('ManagerDashboard', () => {
  it('shows the calm daily overview and opens dispatch', async () => {
    const onOpenDispatch = jest.fn();
    const screen = await render(<ManagerDashboard onOpenDispatch={onOpenDispatch} />);

    expect(screen.getByText('Good morning, Alexandra')).toBeTruthy();
    expect(screen.getByText('18')).toBeTruthy();
    expect(screen.getByText('Daycare')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('Boarding')).toBeTruthy();
    expect(screen.getByText('Rafael')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'View all routes' }));
    expect(onOpenDispatch).toHaveBeenCalledTimes(1);
  });
});
