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
  const onOpenProgress = jest.fn();
  const onOpenDriverHours = jest.fn();
  const screen = await render(
    <ManagerDashboard
      dateLabel="MONDAY · SEPTEMBER 8"
      greeting="Good morning, Alexandra"
      initials="AM"
      daycare={18}
      boarding={5}
      totalPack={12}
      progress={{ done: 7, total: 12 }}
      routes={routes}
      onOpenProgress={onOpenProgress}
      onOpenDispatch={onOpenDispatch}
      onOpenClients={onOpenClients}
      onNewReservation={onNewReservation}
      onOpenDriverHours={onOpenDriverHours}
      {...overrides}
    />,
  );
  return { screen, onOpenDispatch, onOpenClients, onNewReservation, onOpenProgress, onOpenDriverHours };
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

  it('mostra o Total Pack e o progresso do dia (pedido do cliente em 22/09)', async () => {
    const { screen } = await setup();

    expect(screen.getByText('Total Pack')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText("Today's progress")).toBeTruthy();
    expect(screen.getByText('7 of 12 dogs done')).toBeTruthy();
  });

  // O cliente perguntou "o que que é o Total Pack?" (áudio de 23/09/2026). O nome é o vocabulário
  // DELES (pack walk), então o nome fica e a legenda explica o número.
  it('explica embaixo do número o que o Total Pack conta', async () => {
    const { screen } = await setup();

    expect(screen.getByText('going to daycare today')).toBeTruthy();
  });

  /**
   * 23/09/2026: o cliente pediu para tirar o QUADRADO "Routes" (áudio: "tira o botão, esse aqui
   * mostrando as rotas que tem no dia") — no print, a seta verde encosta na borda de baixo do
   * quadrado, e o cabo dela atravessa o cartão de progresso (que FICA).
   */
  it('não tem mais o quadrado "Routes" — e o cartão de progresso continua', async () => {
    const { screen } = await setup({ routes: [] });

    expect(screen.queryByText('Routes')).toBeNull();
    expect(screen.getByText("Today's progress")).toBeTruthy();
    expect(screen.getByRole('button', { name: "See today's progress" })).toBeTruthy();
  });

  it('leva para a tela do progresso do dia', async () => {
    const { screen, onOpenProgress } = await setup();

    await fireEvent.press(screen.getByRole('button', { name: "See today's progress" }));

    expect(onOpenProgress).toHaveBeenCalledTimes(1);
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
    const { screen } = await setup({ routes: [], daycare: 0, boarding: 0, totalPack: 0, progress: { done: 0, total: 0 } });

    expect(screen.getByText('No routes yet today')).toBeTruthy();
    expect(screen.getByText(/Assign the dogs that need transport in Dispatch/)).toBeTruthy();
    expect(screen.getByText('Nothing scheduled for today')).toBeTruthy();
    expect(screen.getAllByText('0')).toHaveLength(3); // total pack, daycare, boarding (Routes saiu)
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
