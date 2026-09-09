import { fireEvent, render } from '@testing-library/react-native';
import { DispatchBoard, type DispatchDriver, type DispatchStopItem } from '@/features/dispatch/DispatchBoard';

const drivers: DispatchDriver[] = [
  { id: 'driver-rafael', name: 'Rafael' },
  { id: 'driver-jordan', name: 'Jordan' },
];

const dayItems: DispatchStopItem[] = [
  { dogId: 'dog-bob', clientName: 'Maria', dogName: 'Bob', reservationKind: 'daycare' },
  { dogId: 'dog-luna', clientName: 'John', dogName: 'Luna', reservationKind: 'boarding' },
  { dogId: 'dog-max', clientName: 'Sarah', dogName: 'Max', reservationKind: 'recurring-daycare' },
];

describe('DispatchBoard', () => {
  it('shows the selected date with unassigned transport dogs', async () => {
    const screen = await render(
      <DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={[]} onAssign={jest.fn()} onPublish={jest.fn()} onDateChange={jest.fn()} />,
    );
    expect(screen.getByText('Wed, 09 de set')).toBeTruthy();
    expect(screen.getByText('Maria · Bob')).toBeTruthy();
    expect(screen.getByText('John · Luna')).toBeTruthy();
    expect(screen.getByText('3 unassigned')).toBeTruthy();
  });

  it('assigns a dog to a driver through the sheet', async () => {
    const onAssign = jest.fn().mockResolvedValue(undefined);
    const screen = await render(
      <DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={[]} onAssign={onAssign} onPublish={jest.fn()} onDateChange={jest.fn()} />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Assign Maria · Bob' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Assign to Rafael' }));
    expect(onAssign).toHaveBeenCalledWith('dog-bob', 'driver-rafael');
  });

  it('lists assigned stops under each driver and publishes a route', async () => {
    const onPublish = jest.fn().mockResolvedValue(undefined);
    const routes = [{ driverId: 'driver-rafael', status: 'draft' as const, stops: [{ dogId: 'dog-luna', clientName: 'John', dogName: 'Luna' }] }];
    const screen = await render(
      <DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={routes} onAssign={jest.fn()} onPublish={onPublish} onDateChange={jest.fn()} />,
    );
    expect(screen.getByText('John · Luna')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Publish Rafael route' }));
    expect(onPublish).toHaveBeenCalledWith('driver-rafael');
  });
});
