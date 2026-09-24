import { fireEvent, render } from '@testing-library/react-native';

import { DriverRouteOptimizerCard } from '@/features/driver/DriverRouteOptimizerCard';

describe('DriverRouteOptimizerCard', () => {
  it('oferece criar a rota a partir da localização atual', async () => {
    const onOptimize = jest.fn().mockResolvedValue(undefined);
    const screen = await render(
      <DriverRouteOptimizerCard pendingStops={4} busy={false} hasLocation onOptimize={onOptimize} />,
    );

    expect(screen.getByText('Start from where you are')).toBeTruthy();
    expect(screen.getByText(/live location/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Optimize route from my location' }));
    expect(onOptimize).toHaveBeenCalledTimes(1);
  });

  it('continua permitindo o toque quando o GPS ainda está carregando, pois busca uma posição nova', async () => {
    const onOptimize = jest.fn().mockResolvedValue(undefined);
    const screen = await render(
      <DriverRouteOptimizerCard pendingStops={3} busy={false} hasLocation={false} onOptimize={onOptimize} />,
    );

    expect(screen.getByText('GPS will be requested when you tap.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Optimize route from my location' }));
    expect(onOptimize).toHaveBeenCalledTimes(1);
  });

  it('desativa quando há menos de duas coletas pendentes ou durante o cálculo', async () => {
    const onOptimize = jest.fn().mockResolvedValue(undefined);
    const one = await render(
      <DriverRouteOptimizerCard pendingStops={1} busy={false} hasLocation onOptimize={onOptimize} />,
    );
    expect(one.getByRole('button', { name: 'Optimize route from my location' }).props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );

    const busy = await render(
      <DriverRouteOptimizerCard pendingStops={3} busy hasLocation onOptimize={onOptimize} />,
    );
    expect(busy.getByText('Optimizing…')).toBeTruthy();
  });
});
