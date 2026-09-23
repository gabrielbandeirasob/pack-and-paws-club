import { fireEvent, render } from '@testing-library/react-native';
import { ManagerDashboard, type DashboardRoute } from '@/features/dashboard/ManagerDashboard';

const routes: DashboardRoute[] = [
  { id: 'route-1', driverName: 'Rafael', stops: 2, miles: 12, statusLabel: 'Ready', late: false, nextLabel: 'Luna · by 08:15' },
  { id: 'route-2', driverName: 'Jordan', stops: 1, miles: 4, statusLabel: 'Late', late: true, nextLabel: 'Bolt · ~9 min' },
];

async function setup(overrides: Partial<React.ComponentProps<typeof ManagerDashboard>> = {}) {
  const onOpenDispatch = jest.fn();
  const onOpenClients = jest.fn();
  const onNewReservation = jest.fn();

  const onOpenDriverHours = jest.fn();
  const screen = await render(
    <ManagerDashboard
      dateLabel="MONDAY · SEPTEMBER 8"
      greeting="Good morning, Alexandra"
      initials="AM"
      daycare={18}
      boarding={5}
      totalPack={12}

      routes={routes}

      onOpenDispatch={onOpenDispatch}
      onOpenClients={onOpenClients}
      onNewReservation={onNewReservation}
      onOpenDriverHours={onOpenDriverHours}
      {...overrides}
    />,
  );
  return { screen, onOpenDispatch, onOpenClients, onNewReservation, onOpenDriverHours };
}

describe('ManagerDashboard', () => {
  it('shows the real daily overview (greeting, counts and routes)', async () => {
    const { screen } = await setup();

    expect(screen.getByText('Good morning, Alexandra')).toBeTruthy();
    expect(screen.getByText('AM')).toBeTruthy();
    expect(screen.getByText('MONDAY · SEPTEMBER 8')).toBeTruthy();
    expect(screen.getByText('18')).toBeTruthy();
    expect(screen.getByText('Daycare')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('Boarding')).toBeTruthy();
    expect(screen.getByText('Rafael')).toBeTruthy();
    expect(screen.getByText('2 stops · 12 mi')).toBeTruthy();
    expect(screen.getByText('Luna · by 08:15')).toBeTruthy();
    expect(screen.getByText('Late')).toBeTruthy();
    expect(screen.getByText('Bolt · ~9 min')).toBeTruthy();
  });

  it('mostra o Total Pack na fileira de indicadores', async () => {
    const { screen } = await setup();

    expect(screen.getByText('Total Pack')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
  });

  // O cliente pediu para TIRAR o cartão "Today's progress" (áudio + print com as setas verdes,
  // 23/09/2026). Este teste trava a remoção: se o cartão voltar, ele quebra.
  it('não tem mais o cartão "Today\'s progress" (pedido do cliente)', async () => {
    const { screen } = await setup();

    expect(screen.queryByText("Today's progress")).toBeNull();
    expect(screen.queryByText('See all ›')).toBeNull();
    expect(screen.queryByRole('button', { name: "See today's progress" })).toBeNull();
  });

  it('opens dispatch, clients and the calendar from the shortcuts', async () => {
    const { screen, onOpenDispatch, onOpenClients, onNewReservation } = await setup();

    await fireEvent.press(screen.getByRole('button', { name: 'View all routes' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Add from contacts' }));
    await fireEvent.press(screen.getByRole('button', { name: 'New reservation' }));

    expect(onOpenDispatch).toHaveBeenCalledTimes(1);
    expect(onOpenClients).toHaveBeenCalledTimes(1);
    expect(onNewReservation).toHaveBeenCalledTimes(1);
  });

  it('explains how to get started when there are no routes yet', async () => {
    const { screen } = await setup({ routes: [], daycare: 0, boarding: 0, totalPack: 0 });

    expect(screen.getByText('No routes yet today')).toBeTruthy();
    expect(screen.getByText(/Assign the dogs that need transport in Dispatch/)).toBeTruthy();
    expect(screen.getAllByText('0')).toHaveLength(4); // total pack, daycare, boarding, routes
  });

  it('summarises a single stop route without pluralising', async () => {
    const { screen } = await setup({ routes: [routes[1]] });

    expect(screen.getByText('1 stop · 4 mi')).toBeTruthy();
  });

  it('abre a tela de horas dos motoristas pelo atalho (pedido do cliente)', async () => {
    const { screen, onOpenDriverHours } = await setup();

    await fireEvent.press(screen.getByLabelText('Driver hours'));
    expect(onOpenDriverHours).toHaveBeenCalledTimes(1);
  });
});
