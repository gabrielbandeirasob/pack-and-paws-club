import { fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { DispatchBoard, type DispatchDriver, type DispatchRoute, type DispatchStopItem } from '@/features/dispatch/DispatchBoard';

const drivers: DispatchDriver[] = [
  { id: 'driver-rafael', name: 'Rafael' },
  { id: 'driver-jordan', name: 'Jordan' },
];

const dayItems: DispatchStopItem[] = [
  { dogId: 'dog-bob', clientName: 'Maria', dogName: 'Bob', reservationKind: 'daycare' },
  { dogId: 'dog-luna', clientName: 'John', dogName: 'Luna', reservationKind: 'boarding' },
  { dogId: 'dog-max', clientName: 'Sarah', dogName: 'Max', reservationKind: 'recurring-daycare' },
];

const routes: DispatchRoute[] = [
  {
    routeId: 'route-1',
    driverId: 'driver-rafael',
    status: 'draft',
    stops: [
      { dogId: 'dog-luna', clientName: 'John', dogName: 'Luna', sequence: 1, windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' },
      { dogId: 'dog-max', clientName: 'Sarah', dogName: 'Max', sequence: 2, windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' },
    ],
  },
];

const noops = {
  onAssign: jest.fn().mockResolvedValue(undefined),
  onSaveStop: jest.fn().mockResolvedValue(undefined),
  onRemoveStop: jest.fn().mockResolvedValue(undefined),
  onMoveStop: jest.fn().mockResolvedValue(undefined),
  onPublish: jest.fn().mockResolvedValue(undefined),
  onDateChange: jest.fn(),
};

describe('DispatchBoard', () => {
  it('shows the selected date with unassigned transport dogs', async () => {
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={[]} {...noops} />);
    expect(screen.getByText('Wed, 09 de set')).toBeTruthy();
    expect(screen.getByText('Maria · Bob')).toBeTruthy();
    expect(screen.getByText('3 unassigned')).toBeTruthy();
  });

  it('assigns a dog to a driver through the sheet', async () => {
    const onAssign = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={[]} {...noops} onAssign={onAssign} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Assign Maria · Bob' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Driver Rafael' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save stop' }));
    expect(onAssign).toHaveBeenCalledWith('dog-bob', 'driver-rafael', { windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' });
  });

  it('requires a driver before assigning', async () => {
    const onAssign = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={[]} {...noops} onAssign={onAssign} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Assign Maria · Bob' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save stop' }));
    expect(screen.getByText('Choose a driver first.')).toBeTruthy();
    expect(onAssign).not.toHaveBeenCalled();
  });

  it('sends a time window and high priority when chosen', async () => {
    const onAssign = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={[]} {...noops} onAssign={onAssign} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Assign Maria · Bob' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Driver Rafael' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Schedule window' }));
    await fireEvent.changeText(screen.getByLabelText('Window start'), '07:30');
    await fireEvent.changeText(screen.getByLabelText('Window end'), '08:15');
    await fireEvent.press(screen.getByRole('button', { name: 'Priority priority' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save stop' }));
    expect(onAssign).toHaveBeenCalledWith('dog-bob', 'driver-rafael', { windowStart: '07:30', windowEnd: '08:15', exactTime: null, priority: 'priority' });
  });

  it('rejects an inverted time window', async () => {
    const onAssign = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={[]} {...noops} onAssign={onAssign} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Assign Maria · Bob' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Driver Rafael' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Schedule window' }));
    await fireEvent.changeText(screen.getByLabelText('Window start'), '09:00');
    await fireEvent.changeText(screen.getByLabelText('Window end'), '08:00');
    await fireEvent.press(screen.getByRole('button', { name: 'Save stop' }));
    expect(screen.getByText('The window end must be after its start.')).toBeTruthy();
    expect(onAssign).not.toHaveBeenCalled();
  });

  it('lists assigned stops under each driver and publishes a route', async () => {
    const onPublish = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={routes} {...noops} onPublish={onPublish} />);
    expect(screen.getByText('John · Luna')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Publish Rafael route' }));
    expect(onPublish).toHaveBeenCalledWith('route-1');
  });

  it('moves a stop up and reorders through the route callback', async () => {
    const onMoveStop = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={routes} {...noops} onMoveStop={onMoveStop} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Move Max up' }));
    expect(onMoveStop).toHaveBeenCalledWith('route-1', 'dog-max', -1);
  });

  it('edits an assigned stop constraint and saves it on the same route', async () => {
    const onSaveStop = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={routes} {...noops} onSaveStop={onSaveStop} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Options for Luna' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Schedule exact' }));
    await fireEvent.changeText(screen.getByLabelText('Exact time'), '07:45');
    await fireEvent.press(screen.getByRole('button', { name: 'Save stop' }));
    expect(onSaveStop).toHaveBeenCalledWith('route-1', 'dog-luna', { windowStart: null, windowEnd: null, exactTime: '07:45', priority: 'normal' });
  });

  it('removes a stop from the route after confirmation', async () => {
    const onRemoveStop = jest.fn().mockResolvedValue(undefined);
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const destructive = buttons?.find((button) => button.style === 'destructive');
      destructive?.onPress?.();
    });
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={routes} {...noops} onRemoveStop={onRemoveStop} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Options for Luna' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Remove from route' }));
    expect(alertSpy).toHaveBeenCalledWith('Remove stop', expect.stringContaining('John · Luna'), expect.any(Array));
    expect(onRemoveStop).toHaveBeenCalledWith('route-1', 'dog-luna');
    alertSpy.mockRestore();
  });
});
