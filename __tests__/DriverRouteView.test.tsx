import { fireEvent, render } from '@testing-library/react-native';
import { DriverRouteView, type DriverStop } from '@/features/driver/DriverRouteView';

const stops: DriverStop[] = [
  { id: 'stop-1', sequence: 1, status: 'pending', clientName: 'Maria', dogName: 'Bob', address: '123 Main St', city: 'Goiania', instructions: 'Call box 185. Key inside lockbox.' },
  { id: 'stop-2', sequence: 2, status: 'pending', clientName: 'John', dogName: 'Luna', address: 'Oak Avenue 45', city: 'Goiania', instructions: null },
];

describe('DriverRouteView', () => {
  it('lists ordered stops with client, dog, address and instructions', async () => {
    const screen = await render(<DriverRouteView stops={stops} onAction={jest.fn()} />);
    expect(screen.getByText('1. Maria · Bob')).toBeTruthy();
    expect(screen.getByText('123 Main St · Goiania')).toBeTruthy();
    expect(screen.getByText('Call box 185. Key inside lockbox.')).toBeTruthy();
    expect(screen.getByText('2. John · Luna')).toBeTruthy();
  });

  it('fires stop actions for the right stop', async () => {
    const onAction = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<DriverRouteView stops={stops} onAction={onAction} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Mark arrived stop-1' }));
    expect(onAction).toHaveBeenCalledWith('stop-1', 'arrived');
    await fireEvent.press(screen.getByRole('button', { name: 'Navigate to Bob' }));
    expect(onAction).toHaveBeenCalledWith('stop-1', 'navigate');
  });

  it('reveals the completed state after pickup', async () => {
    const progressed: DriverStop[] = [{ ...stops[0], status: 'picked_up' }];
    const screen = await render(<DriverRouteView stops={progressed} onAction={jest.fn()} />);
    expect(screen.getByText('Dog picked up')).toBeTruthy();
  });

  it('numera as paradas pela posicao, mesmo se o banco trouxer sequence 0', async () => {
    // Visto no teste na web: a tela mostrava "0. Maria Silva" porque o sequence vinha 0
    // (o painel do Dispatch numerava 1, 2 — a tela do motorista usava o campo cru).
    const zerados: DriverStop[] = [
      { ...stops[0], sequence: 0 },
      { ...stops[1], sequence: 0 },
    ];
    const screen = await render(<DriverRouteView stops={zerados} onAction={jest.fn()} />);
    expect(screen.getByText('1. Maria · Bob')).toBeTruthy();
    expect(screen.getByText('2. John · Luna')).toBeTruthy();
    expect(screen.queryByText('0. Maria · Bob')).toBeNull();
  });
});
