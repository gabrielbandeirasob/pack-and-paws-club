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
      { dogId: 'dog-luna', clientName: 'John', dogName: 'Luna', sequence: 1, status: 'pending', latitude: 37.79, longitude: -122.4, windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' },
      { dogId: 'dog-max', clientName: 'Sarah', dogName: 'Max', sequence: 2, status: 'pending', latitude: 37.8, longitude: -122.41, windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' },
    ],
  },
];

const noops = {
  onAssign: jest.fn().mockResolvedValue(undefined),
  onSaveStop: jest.fn().mockResolvedValue(undefined),
  onRemoveStop: jest.fn().mockResolvedValue(undefined),
  onMoveStop: jest.fn().mockResolvedValue(undefined),
  onOptimize: jest.fn().mockResolvedValue(undefined),
  onPublish: jest.fn().mockResolvedValue(undefined),
  onUnpublish: jest.fn().mockResolvedValue(undefined),
  onCancelRoute: jest.fn().mockResolvedValue(undefined),
  onCompleteRoute: jest.fn().mockResolvedValue(undefined),
  onDateChange: jest.fn(),
};

const ITEM = 42;

async function pickTime(screen: Awaited<ReturnType<typeof render>>, fieldLabel: string, testID: string, hour: number, minute: number) {
  await fireEvent.press(screen.getByRole('button', { name: fieldLabel }));
  await fireEvent(screen.getByTestId(`${testID}-hours`), 'momentumScrollEnd', { nativeEvent: { contentOffset: { y: hour * ITEM } } });
  await fireEvent(screen.getByTestId(`${testID}-minutes`), 'momentumScrollEnd', { nativeEvent: { contentOffset: { y: (minute / 5) * ITEM } } });
}

describe('DispatchBoard', () => {
  it('shows the selected date with unassigned transport dogs', async () => {
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={[]} {...noops} />);
    expect(screen.getByText('Wed, Sep 09')).toBeTruthy();
    expect(screen.getByText('Maria · Bob')).toBeTruthy();
    expect(screen.getByText('3 unassigned')).toBeTruthy();
  });

  it('nao comemora quando nao ha cao de transporte no dia (estado vazio coerente)', async () => {
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={[]} routes={[]} {...noops} />);
    expect(screen.queryByText('Every transport dog is assigned. 🎉')).toBeNull();
    expect(screen.getByText('No transport dogs need a ride today.')).toBeTruthy();
  });

  it('comemora quando todos os caes de transporte ja estao atribuidos', async () => {
    const todos: DispatchRoute[] = [
      {
        routeId: 'route-all',
        driverId: 'driver-rafael',
        status: 'draft',
        stops: dayItems.map((item, i) => ({
          ...item,
          sequence: i + 1,
          status: 'pending' as const,
          latitude: null,
          longitude: null,
          windowStart: null,
          windowEnd: null,
          exactTime: null,
          priority: 'normal' as const,
        })),
      },
    ];
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={todos} {...noops} />);
    expect(screen.getByText('Every transport dog is assigned. 🎉')).toBeTruthy();
    expect(screen.queryByText('No transport dogs need a ride today.')).toBeNull();
  });

  it('assigns a dog to a driver through the sheet', async () => {
    const onAssign = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={[]} {...noops} onAssign={onAssign} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Assign Maria · Bob' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Driver Rafael' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save stop' }));
    expect(onAssign).toHaveBeenCalledWith('dog-bob', 'driver-rafael', { windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' });
  });

  /**
   * Cão em boarding que também faz daycare no dia: já acorda dentro da van, então NÃO pode aparecer
   * na fila de pickup (pedido do cliente, áudio de 23/09/2026) — mas continua à mão do gestor numa
   * seção separada, para o caso de ele precisar voltar para casa.
   */
  it('cão que já está na van sai da fila e aparece na seção separada, podendo ser incluído à mão', async () => {
    const onAssign = jest.fn().mockResolvedValue(undefined);
    const comVan: DispatchStopItem[] = [
      ...dayItems,
      { dogId: 'dog-filo', clientName: 'Amor', dogName: 'Filó', reservationKind: 'boarding', inVan: true },
    ];
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={comVan} routes={[]} {...noops} onAssign={onAssign} />);

    // Fila principal: 3 (o da van não está ali) + a seção dele existe.
    expect(screen.getByText('3 unassigned')).toBeTruthy();
    expect(screen.getByTestId('dispatch-ja-na-van')).toBeTruthy();
    expect(screen.getByText('Boarding — already in the van')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Assign Amor · Filó' })).toBeNull();

    // E dá para incluir na rota à mão (a volta para casa).
    await fireEvent.press(screen.getByRole('button', { name: 'Add boarding Amor · Filó' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Driver Jordan' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save stop' }));
    expect(onAssign).toHaveBeenCalledWith('dog-filo', 'driver-jordan', { windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' });
  });

  it('requires a driver before assigning', async () => {
    const onAssign = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={[]} {...noops} onAssign={onAssign} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Assign Maria · Bob' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save stop' }));
    expect(screen.getByText('Choose a driver first.')).toBeTruthy();
    expect(onAssign).not.toHaveBeenCalled();
  });

  it('nao deixa o nome do motorista ser espremido pelos botoes (relato no iPhone, 12/09/2026)', async () => {
    // O print do dono mostrou "R / af / a / el" numa coluna de ~48pt: a coluna de texto nao tinha
    // `flex`, entao os quatro botoes de acao (Republish/Unpublish/Done/x) comiam a linha inteira.
    // Este teste trava a correcao: o texto tem de poder crescer e os botoes tem de poder descer.
    const publicada: DispatchRoute[] = [{
      routeId: 'route-pub',
      driverId: 'driver-rafael',
      status: 'published',
      stops: [{ dogId: 'dog-luna', clientName: 'John', dogName: 'Luna', sequence: 1, status: 'completed', latitude: 37.79, longitude: -122.4, windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' }],
    }];
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={publicada} {...noops} />);
    // dois motoristas na tela (Rafael com rota, Jordan sem): o cartao do Rafael e' o primeiro
    expect(screen.getAllByTestId('driver-info')[0]).toHaveStyle({ flex: 1 });
    expect(screen.getByTestId('driver-actions')).toHaveStyle({ flexWrap: 'wrap' });
    expect(screen.getByRole('button', { name: 'Complete Rafael route' })).toBeTruthy();
  });

  it('sends a time window and high priority when chosen', async () => {
    const onAssign = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={[]} {...noops} onAssign={onAssign} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Assign Maria · Bob' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Driver Rafael' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Time window' }));
    await pickTime(screen, 'Window start', 'time-picker-from', 7, 30);
    await pickTime(screen, 'Window end', 'time-picker-until', 8, 15);
    await fireEvent.press(screen.getByRole('button', { name: 'Priority priority' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save stop' }));
    expect(onAssign).toHaveBeenCalledWith('dog-bob', 'driver-rafael', { windowStart: '07:30', windowEnd: '08:15', exactTime: null, priority: 'priority' });
  });

  it('rejects an inverted time window', async () => {
    const onAssign = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={[]} {...noops} onAssign={onAssign} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Assign Maria · Bob' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Driver Rafael' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Time window' }));
    await pickTime(screen, 'Window start', 'time-picker-from', 9, 0);
    await pickTime(screen, 'Window end', 'time-picker-until', 8, 0);
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

  it('optimizes a route with two pending stops', async () => {
    const onOptimize = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={routes} {...noops} onOptimize={onOptimize} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Optimize Rafael route' }));
    expect(onOptimize).toHaveBeenCalledWith('route-1');
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
    await fireEvent.press(screen.getByRole('button', { name: 'Exact time' }));
    await pickTime(screen, 'Exact time input', 'time-picker-exact', 7, 45);
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

  it('keeps From and Until pickers separate but only one open at a time', async () => {
    const onAssign = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={[]} {...noops} onAssign={onAssign} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Assign Maria · Bob' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Driver Rafael' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Time window' }));
    expect(screen.queryAllByTestId('time-picker-from')).toHaveLength(0);
    expect(screen.queryAllByTestId('time-picker-until')).toHaveLength(0);
    // Open From: only the From wheel exists.
    await fireEvent.press(screen.getByRole('button', { name: 'Window start' }));
    expect(screen.queryAllByTestId('time-picker-from')).toHaveLength(1);
    expect(screen.queryAllByTestId('time-picker-until')).toHaveLength(0);
    await fireEvent(screen.getByTestId('time-picker-from-hours'), 'momentumScrollEnd', { nativeEvent: { contentOffset: { y: 7 * ITEM } } });
    await fireEvent(screen.getByTestId('time-picker-from-minutes'), 'momentumScrollEnd', { nativeEvent: { contentOffset: { y: 6 * ITEM } } });
    // Opening Until closes From automatically.
    await fireEvent.press(screen.getByRole('button', { name: 'Window end' }));
    expect(screen.queryAllByTestId('time-picker-from')).toHaveLength(0);
    expect(screen.queryAllByTestId('time-picker-until')).toHaveLength(1);
    await fireEvent(screen.getByTestId('time-picker-until-hours'), 'momentumScrollEnd', { nativeEvent: { contentOffset: { y: 8 * ITEM } } });
    await fireEvent(screen.getByTestId('time-picker-until-minutes'), 'momentumScrollEnd', { nativeEvent: { contentOffset: { y: 3 * ITEM } } });
    await fireEvent.press(screen.getByRole('button', { name: 'Save stop' }));
    expect(onAssign).toHaveBeenCalledWith('dog-bob', 'driver-rafael', { windowStart: '07:30', windowEnd: '08:15', exactTime: null, priority: 'normal' });
  });

  it('closes the panel only through the close or cancel buttons', async () => {
    const onAssign = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={[]} {...noops} onAssign={onAssign} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Assign Maria · Bob' }));
    // Panel content stays after pressing the backdrop area (no dismiss-on-tap-outside).
    expect(screen.getByText('Assign Maria · Bob')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Driver Rafael' })).toBeTruthy();
    // The explicit close button closes it.
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('button', { name: 'Driver Rafael' })).toBeNull();
    // Cancel closes too.
    await fireEvent.press(screen.getByRole('button', { name: 'Assign Maria · Bob' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Driver Rafael' })).toBeNull();
  });
});
// O painel agora mostra o comprovante de entrega, e esse componente pede link assinado ao
// Supabase. O mock evita que o módulo real valide a configuração (que não existe no teste).
jest.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://example.test/foto.jpg' }, error: null }),
      }),
    },
  },
}));

