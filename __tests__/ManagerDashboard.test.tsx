import { fireEvent, render } from '@testing-library/react-native';
import { ManagerDashboard, type DashboardDaySection, type DashboardRoute } from '@/features/dashboard/ManagerDashboard';

const routes: DashboardRoute[] = [
  { id: 'route-1', driverName: 'Rafael', stops: 2, miles: 12, statusLabel: 'Ready', late: false, nextLabel: 'Luna · by 08:15' },
  { id: 'route-2', driverName: 'Jordan', stops: 1, miles: 4, statusLabel: 'Late', late: true, nextLabel: 'Bolt · ~9 min' },
];

/** O bloco do dia (operação, 26/09/2026): 5 indicadores + pack + to-do + fechamento. */
function dia(over: Partial<DashboardDaySection> = {}): DashboardDaySection {
  return {
    totalDogs: 23,
    pack: 12,
    revenueCents: 123456,
    packRows: [
      { dogId: 'thor', dogName: 'Thor', clientName: 'Ana', serviceType: 'daycare', inPack: true, walkerId: null },
      { dogId: 'nina', dogName: 'Nina', clientName: 'Juliana', serviceType: 'daycare', inPack: false, walkerId: null },
    ],
    members: [{ id: 'driver-b', name: 'Sam Costa' }],
    onTogglePack: jest.fn(),
    onSetWalker: jest.fn(),
    onSaveRevenue: jest.fn(),
    todos: [
      { id: 't1', text: 'Pagar Wisiwash', done: false, position: 0 },
      { id: 't2', text: 'Protocolar prong', done: true, position: 1 },
    ],
    onAddTodo: jest.fn(),
    onToggleTodo: jest.fn(),
    onEditTodo: jest.fn(),
    onRemoveTodo: jest.fn(),
    plan: { walkLocation: 'Yard — Goiânia', photoIdea: 'Turma do dia' },
    onSavePlan: jest.fn(),
    onOpenDaySummary: jest.fn(),
    ...over,
  };
}

async function setup(overrides: Partial<React.ComponentProps<typeof ManagerDashboard>> = {}) {
  const onOpenDispatch = jest.fn();
  const onOpenClients = jest.fn();
  const onNewReservation = jest.fn();
  const onOpenProgress = jest.fn();
  const onOpenDriverHours = jest.fn();
  const day = dia();
  const screen = await render(
    <ManagerDashboard
      dateLabel="MONDAY · SEPTEMBER 8"
      greeting="Good morning, Alexandra"
      initials="AM"
      daycare={18}
      boarding={5}
      progress={{ done: 7, total: 12 }}
      routes={routes}
      day={day}
      onOpenProgress={onOpenProgress}
      onOpenDispatch={onOpenDispatch}
      onOpenClients={onOpenClients}
      onNewReservation={onNewReservation}
      onOpenDriverHours={onOpenDriverHours}
      {...overrides}
    />,
  );
  return { screen, day, onOpenDispatch, onOpenClients, onNewReservation, onOpenProgress, onOpenDriverHours };
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
  // DELES (pack walk), então o nome fica e a legenda explica o número. Em 26/09 ele definiu o
  // número: é o pack da CAMINHADA (quem vai para o yard), e o quadrado abre a lista.
  it('explica embaixo do número o que o Total Pack conta (e o quadrado é clicável)', async () => {
    const { screen } = await setup();

    expect(screen.getByText('going to the walk · tap to see the dogs')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Total Pack — open the pack of the day' })).toBeTruthy();
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
    const { screen } = await setup({ routes: [], daycare: 0, boarding: 0, progress: { done: 0, total: 0 }, day: dia({ pack: 0, totalDogs: 0 }) });

    expect(screen.getByText('No routes yet today')).toBeTruthy();
    expect(screen.getByText(/Assign the dogs that need transport in Dispatch/)).toBeTruthy();
    expect(screen.getByText('Nothing scheduled for today')).toBeTruthy();
    // daycare, boarding, total dogs e total pack — o quadrado "Routes" saiu em 23/09.
    expect(screen.getAllByText('0')).toHaveLength(4);
  });

  it('summarises a single stop route without pluralising', async () => {
    const { screen } = await setup({ routes: [routes[1]] });

    expect(screen.getByText('1 stop · 4 mi')).toBeTruthy();
  });

  /* --------------------- operação, 26/09/2026 (5 indicadores e o dia) --------------------- */

  it('mostra os 5 indicadores do dia', async () => {
    const { screen } = await setup();

    expect(screen.getByText('Daycare')).toBeTruthy();
    expect(screen.getByText('Boarding')).toBeTruthy();
    expect(screen.getByText('Total dogs')).toBeTruthy();
    expect(screen.getByText('23')).toBeTruthy();
    expect(screen.getByText('Total Pack')).toBeTruthy();
    expect(screen.getByText('Revenue · tap to type')).toBeTruthy();
    expect(screen.getByLabelText('Revenue of the day').props.value).toBe('1,234.56');
  });

  it('o Total Pack abre a folha com os cães do dia, o X e quem caminha', async () => {
    const { screen, day } = await setup();

    await fireEvent.press(screen.getByRole('button', { name: 'Total Pack — open the pack of the day' }));

    expect(screen.getByText(/1 of 2 going to the walk/)).toBeTruthy();
    expect(screen.getByText('Thor')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Thor from the pack' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Put Nina back in the pack' })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Remove Thor from the pack' }));
    expect(day.onTogglePack).toHaveBeenCalledWith('thor', false);

    await fireEvent.press(screen.getByRole('button', { name: 'Walker for Thor: Sam Costa' }));
    expect(day.onSetWalker).toHaveBeenCalledWith('thor', 'driver-b');
  });

  it('faturamento digitado sobe em centavos ao sair do campo', async () => {
    const { screen, day } = await setup();

    const campo = screen.getByLabelText('Revenue of the day');
    await fireEvent.changeText(campo, '$2,500.75');
    await fireEvent(campo, 'blur');

    expect(day.onSaveRevenue).toHaveBeenCalledWith(250075);
  });

  it('a to-do list do dia fica no cartão do progresso e conta os abertos', async () => {
    const { screen } = await setup();

    expect(screen.getByText("Today's to-do")).toBeTruthy();
    expect(screen.getByText('1 open')).toBeTruthy();
    expect(screen.getByText('Pagar Wisiwash')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark Pagar Wisiwash as done' })).toBeTruthy();
  });

  it('o fim do dia mostra os dois campos já salvos', async () => {
    const { screen } = await setup();

    expect(screen.getByText('End of the day')).toBeTruthy();
    expect(screen.getByLabelText('Walk location of the day').props.value).toBe('Yard — Goiânia');
    expect(screen.getByLabelText('Photo of the day idea').props.value).toBe('Turma do dia');
  });

  it('leva para o histórico do dia', async () => {
    const { screen, day } = await setup();

    await fireEvent.press(screen.getByRole('button', { name: 'See another day' }));

    expect(day.onOpenDaySummary).toHaveBeenCalledTimes(1);
  });

  it('abre a tela de horas dos motoristas pelo atalho (pedido do cliente)', async () => {
    const { screen, onOpenDriverHours } = await setup();

    await fireEvent.press(screen.getByRole('button', { name: 'Driver hours' }));

    expect(onOpenDriverHours).toHaveBeenCalledTimes(1);
  });
});
