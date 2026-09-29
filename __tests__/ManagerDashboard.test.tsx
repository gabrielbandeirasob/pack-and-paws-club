import { fireEvent, render, within } from '@testing-library/react-native';
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
  const onPreviousDay = jest.fn();
  const onNextDay = jest.fn();
  const onToday = jest.fn();
  const onOpenWeekSummary = jest.fn();
  const day = dia();
  const screen = await render(
    <ManagerDashboard
      dateLabel="MONDAY · SEPTEMBER 8"
      dayNav={{
        prefix: 'Today',
        isToday: true,
        canGoBack: true,
        canGoForward: true,
        onPreviousDay,
        onNextDay,
        onToday,
      }}
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
      onOpenWeekSummary={onOpenWeekSummary}
      weekSummaryHint="Monday to Saturday — who came day by day"
      {...overrides}
    />,
  );
  return { screen, day, onOpenDispatch, onOpenClients, onNewReservation, onOpenProgress, onOpenDriverHours, onPreviousDay, onNextDay, onToday, onOpenWeekSummary };
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
    // Rótulo em PORTUGUÊS por pedido do dono (28/09/2026): o indicador de total de cães e o de
    // faturamento ficam em português; day care, boarding e Total Pack continuam como o escritório fala.
    expect(screen.getByText('Número total de Cães')).toBeTruthy();
    expect(screen.getByText('23')).toBeTruthy();
    expect(screen.getByText('Total Pack')).toBeTruthy();
    expect(screen.getByText('Faturamento · tap to type')).toBeTruthy();
    expect(screen.getByLabelText('Revenue of the day').props.value).toBe('1,234.56');
  });

  it('o Total Pack abre a folha com os cães do dia, o X e quem caminha', async () => {
    const { screen, day } = await setup();

    await fireEvent.press(screen.getByRole('button', { name: 'Total Pack — open the pack of the day' }));

    expect(screen.getByText(/1 of 2 going to the walk/)).toBeTruthy();
    // Desde 29/09/2026 a Home TAMBÉM lista nome de cão, no cartão "Day plan" (distribuição do pack:
    // "motorista X ficou com tais cachorros"). Por isso o cão da folha é procurado DENTRO da folha —
    // a asserção continua provando o mesmo (a folha mostra o cão), só não confunde as duas listas.
    const folha = within(screen.getByTestId('total-pack-sheet'));
    expect(folha.getByText('Thor')).toBeTruthy();
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

  it('o plano do dia mostra os dois campos já salvos', async () => {
    const { screen } = await setup();

    // Nome corrigido em 27/09/2026 (áudio do dono): não é "fim do dia" — é o plano, escrito antes.
    expect(screen.getByText('Day plan')).toBeTruthy();
    expect(screen.getByText('Photo and walk location — decided the day before.')).toBeTruthy();
    expect(screen.queryByText('End of the day')).toBeNull();
    expect(screen.getByLabelText('Walk location of the day').props.value).toBe('Yard — Goiânia');
    expect(screen.getByLabelText('Photo of the day idea').props.value).toBe('Turma do dia');
  });

  /* ------------------ navegação por dia (áudio do dono, 27/09/2026) ------------------ */

  it('o cabeçalho verde leva as setas de dia e o swipe para o dia seguinte', async () => {
    const { screen, onNextDay, onPreviousDay } = await setup();

    await fireEvent.press(screen.getByRole('button', { name: 'Next day' }));
    expect(onNextDay).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByRole('button', { name: 'Previous day' }));
    expect(onPreviousDay).toHaveBeenCalledTimes(1);

    // Em hoje, o cabeçalho convida a arrastar em vez de oferecer "voltar para hoje".
    expect(screen.getByText('swipe sideways for the next day')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back to today' })).toBeNull();
  });

  it('olhando outro dia, os títulos dizem o dia e aparece o "back to today"', async () => {
    const onToday = jest.fn();
    const { screen } = await setup({
      dateLabel: 'TOMORROW · TUESDAY · SEPTEMBER 9',
      dayNav: {
        prefix: 'Tomorrow',
        isToday: false,
        canGoBack: true,
        canGoForward: true,
        onPreviousDay: jest.fn(),
        onNextDay: jest.fn(),
        onToday,
      },
    });

    expect(screen.getByText("Tomorrow's progress")).toBeTruthy();
    expect(screen.getByText("Tomorrow's to-do")).toBeTruthy();
    expect(screen.getByText("Tomorrow's routes")).toBeTruthy();
    expect(screen.queryByText("Today's progress")).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Back to today' }));
    expect(onToday).toHaveBeenCalledTimes(1);
  });

  it('no limite da janela, a seta do lado impossível fica desabilitada', async () => {
    const { screen } = await setup({
      dateLabel: 'FRIDAY · OCTOBER 30',
      dayNav: {
        prefix: 'Friday',
        isToday: false,
        canGoBack: true,
        canGoForward: false,
        onPreviousDay: jest.fn(),
        onNextDay: jest.fn(),
        onToday: jest.fn(),
      },
    });

    expect(screen.getByRole('button', { name: 'Next day' }).props.accessibilityState.disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Previous day' }).props.accessibilityState.disabled).toBe(false);
  });

  it('leva para o histórico do dia', async () => {
    const { screen, day } = await setup();

    await fireEvent.press(screen.getByRole('button', { name: 'See another day' }));

    expect(day.onOpenDaySummary).toHaveBeenCalledTimes(1);
  });

  it('o atalho do resumo da semana leva para a tela da semana (áudio do dono, 27/09/2026)', async () => {
    const { screen, onOpenWeekSummary } = await setup({ weekSummaryHint: 'The week is closed — check who came' });

    expect(screen.getByText('Weekly summary')).toBeTruthy();
    expect(screen.getByText('The week is closed — check who came')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Weekly summary — Monday to Saturday' }));
    expect(onOpenWeekSummary).toHaveBeenCalledTimes(1);
  });

  it('abre a tela de horas dos motoristas pelo atalho (pedido do cliente)', async () => {
    const { screen, onOpenDriverHours } = await setup();

    await fireEvent.press(screen.getByRole('button', { name: 'Driver hours' }));

    expect(onOpenDriverHours).toHaveBeenCalledTimes(1);
  });
});

/**
 * O INTERRUPTOR GESTOR ↔ MOTORISTA NA HOME (print do dono, 27/09/2026): ele procurava o botão no
 * painel e não achava — ele só existia escondido no "More"/Profile. Aqui se trava que o interruptor
 * que a Home recebe aparece junto do cabeçalho do painel.
 */
it('o interruptor de visão aparece no topo do painel do gestor', async () => {
  const { Text } = require('react-native');
  const { screen } = await setup({ viewSwitch: <Text>drive-switch-aqui</Text> });
  expect(screen.getByText('drive-switch-aqui')).toBeTruthy();
});

it('sem interruptor informado, o painel não renderiza nada no lugar dele', async () => {
  const { screen } = await setup();
  expect(screen.queryByText('drive-switch-aqui')).toBeNull();
});
