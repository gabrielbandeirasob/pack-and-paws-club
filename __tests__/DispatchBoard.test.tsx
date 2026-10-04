// Pedido do cliente (04/10/2026): calendário e Dispatch identificam apenas o cão; as asserções permanecem.
import { fireEvent, render, within } from '@testing-library/react-native';
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
    expect(screen.getByText('Bob')).toBeTruthy();
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
    await fireEvent.press(screen.getByRole('button', { name: 'Assign Bob' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Driver Rafael' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save stop' }));
    expect(onAssign).toHaveBeenCalledWith('dog-bob', 'driver-rafael', { windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' });
  });

  /**
   * Cão em boarding que também faz daycare no dia: já acorda dentro da van, então NÃO pode aparecer
   * na fila de pickup (pedido do cliente, áudio de 23/09/2026). Decisão do dono (02/10/2026):
   * boarding NUNCA entra no drop-off — a seção separada é só INFORMATIVA, sem botão de incluir.
   */
  it('cão em boarding sai da fila e aparece só INFORMATIVO na seção separada — não dá para pôr na rota', async () => {
    const onAssign = jest.fn().mockResolvedValue(undefined);
    const comVan: DispatchStopItem[] = [
      ...dayItems,
      { dogId: 'dog-filo', clientName: 'Amor', dogName: 'Filó', reservationKind: 'boarding', inVan: true },
    ];
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={comVan} routes={[]} {...noops} onAssign={onAssign} />);

    // Fila principal: 3 (o da van não está ali) + a seção dele existe.
    expect(screen.getByText('3 unassigned')).toBeTruthy();
    expect(screen.getByTestId('dispatch-ja-na-van')).toBeTruthy();
    expect(screen.getByText('Boarding — already in the van (1) ▸')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Assign Filó' })).toBeNull();

    // 🪤 CLIENTE (02/10/2026): o boarding é só informação — abre no toque, mostra o chip, e NÃO existe
    // nenhum botão para jogá-lo na rota (era por aí que ele aparecia na rota de volta/drop-off).
    await fireEvent.press(screen.getByRole('button', { name: 'Show boarding dogs already in the van' }));
    expect(screen.getByText('Boarding — already in the van (1) ▾')).toBeTruthy();
    expect(screen.getByTestId('boarding-na-van-dog-filo')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add boarding Filó' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Assign Filó' })).toBeNull();
    expect(onAssign).not.toHaveBeenCalled();
  });

  it('requires a driver before assigning', async () => {
    const onAssign = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={[]} {...noops} onAssign={onAssign} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Assign Bob' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save stop' }));
    expect(screen.getByText('Choose a driver first.')).toBeTruthy();
    expect(onAssign).not.toHaveBeenCalled();
  });

  it('nao deixa o nome do motorista ser espremido pelos botoes (relato no iPhone, 12/09/2026)', async () => {
    // O print do dono mostrou "R / af / a / el" numa coluna de ~48pt: a coluna de texto nao tinha
    // `flex`, entao os quatro botoes de acao (Republish/Unpublish/Done/x) comiam a linha inteira.
    // Este teste trava a correcao: o texto tem de poder crescer.
    // AJUSTE (dono, 04/10/2026): a faixa de acoes deixou de ter rolagem horizontal — o "Publish" e o
    // "✓ Done" ficavam FORA da tela num iPhone estreito e o gestor tinha de descobrir um gesto para
    // achar a acao. Agora as acoes QUEBRAM em duas linhas quando nao couberem (nada escondido) e o
    // ultimo botao continua alcancavel. O nome do motorista continua sem ser espremido: `flex: 1`.
    const publicada: DispatchRoute[] = [{
      routeId: 'route-pub',
      driverId: 'driver-rafael',
      status: 'published',
      stops: [{ dogId: 'dog-luna', clientName: 'John', dogName: 'Luna', sequence: 1, status: 'completed', latitude: 37.79, longitude: -122.4, windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' }],
    }];
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={publicada} {...noops} />);
    // dois motoristas na tela (Rafael com rota, Jordan sem): o cartao do Rafael e' o primeiro
    expect(screen.getAllByTestId('driver-info')[0]).toHaveStyle({ flex: 1 });
    expect(screen.getByTestId('dispatch-actions-scroll')).toHaveStyle({ flexWrap: 'wrap' });
    expect(screen.getByRole('button', { name: 'Complete Rafael route' })).toBeTruthy();
  });

  it('sends a time window and high priority when chosen', async () => {
    const onAssign = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={[]} {...noops} onAssign={onAssign} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Assign Bob' }));
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
    await fireEvent.press(screen.getByRole('button', { name: 'Assign Bob' }));
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
    // Pedido de 04/10: o cão aparece na perna selecionada do cartão.
    expect(screen.getAllByText('Luna').length).toBeGreaterThan(0);
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
    // Pedido de 04/10: a ação acessível da linha substitui a seta da busca.
    const busca = within(screen.getByTestId('dispatch-leg-pickup-driver-rafael'));
    await fireEvent(busca.getByTestId('reorder-pickup-dog-max'), 'accessibilityAction', { nativeEvent: { actionName: 'moveUp' } });
    expect(onMoveStop).toHaveBeenCalledWith('route-1', 'dog-max', -1);
  });

  it('edits an assigned stop constraint and saves it on the same route', async () => {
    const onSaveStop = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={routes} {...noops} onSaveStop={onSaveStop} />);
    const busca = within(screen.getByTestId('dispatch-leg-pickup-driver-rafael'));
    await fireEvent.press(busca.getByRole('button', { name: 'Options for Luna' }));
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
    const busca = within(screen.getByTestId('dispatch-leg-pickup-driver-rafael'));
    await fireEvent.press(busca.getByRole('button', { name: 'Options for Luna' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Remove from route' }));
    expect(alertSpy).toHaveBeenCalledWith('Remove stop', expect.stringContaining('Luna'), expect.any(Array));
    expect(onRemoveStop).toHaveBeenCalledWith('route-1', 'dog-luna');
    alertSpy.mockRestore();
  });

  it('keeps From and Until pickers separate but only one open at a time', async () => {
    const onAssign = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={[]} {...noops} onAssign={onAssign} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Assign Bob' }));
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
    await fireEvent.press(screen.getByRole('button', { name: 'Assign Bob' }));
    // Panel content stays after pressing the backdrop area (no dismiss-on-tap-outside).
    expect(screen.getByText('Assign Bob')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Driver Rafael' })).toBeTruthy();
    // The explicit close button closes it.
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('button', { name: 'Driver Rafael' })).toBeNull();
    // Cancel closes too.
    await fireEvent.press(screen.getByRole('button', { name: 'Assign Bob' }));
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


it('mantém ações de VoiceOver e alça de pelo menos 44 pontos para mover Luna', async () => {
  const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={routes} {...noops} />);
  // Pedido do dono: só arrastar; VoiceOver mantém as duas ações na linha.
  expect(screen.getByTestId('drag-pickup-dog-luna')).toHaveStyle({ minWidth: 44, minHeight: 44 });
  expect(screen.getByTestId('reorder-pickup-dog-luna').props.accessibilityActions).toEqual([
    { name: 'moveUp', label: 'Move up' }, { name: 'moveDown', label: 'Move down' },
  ]);
});

it('mostra selos por perna e rótulos acessíveis dos controles novos', async () => {
  const comTravas: DispatchRoute[] = [{
    ...routes[0], stops: routes[0].stops.map((stop) => ({
      ...stop, pickupPin: 'first', dropoffPin: 'fixed', dropoffPinPosition: 3,
    })),
  }];
  const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={comTravas} {...noops} />);
  // Pedido de 04/10: alternar a perna preserva os selos próprios de cada lista.
  const busca = within(screen.getByTestId('dispatch-leg-pickup-driver-rafael'));
  expect(busca.getAllByText('🔒 1st')).toHaveLength(2);
  await fireEvent.press(screen.getByLabelText('Drop-offs'));
  const entrega = within(screen.getByTestId('dispatch-leg-dropoff-driver-rafael'));
  expect(entrega.getAllByText('🔒 #3')).toHaveLength(2);
  // O seletor é do quadro; não há seletor duplicado dentro do cartão.
  expect(screen.queryByRole('button', { name: /(Pick-up|Drop-off) Rafael route/ })).toBeNull();
  await fireEvent.press(screen.getByLabelText('Pick-ups'));
  await fireEvent.press(screen.getByRole('button', { name: 'Options for Luna' }));
  for (const perna of ['Pick-up', 'Drop-off']) {
    for (const regra of ['Free', '1st', 'Last', 'Position #']) {
      expect(screen.getByRole('button', { name: `${perna} rule ${regra}` })).toBeTruthy();
    }
  }
  expect(screen.getByLabelText('Drop-off position')).toBeTruthy();
});

it('mantém filas independentes mesmo quando o cão já tem rota na outra fase', async () => {
  const max = dayItems[2];
  const pickup = { ...routes[0], phase: 'pickup' as const, stops: [routes[0].stops[1]] };
  const onAssign = jest.fn().mockResolvedValue(undefined);
  const screen = await render(<DispatchBoard date="2026-10-03" drivers={drivers} dayItems={[max]}
    dropoffItems={[max]} routes={[pickup]} {...noops} onAssign={onAssign} />);
  expect(screen.queryByLabelText('Assign Max')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Drop-offs'));
  await fireEvent.press(screen.getByLabelText('Assign Max'));
  await fireEvent.press(screen.getByLabelText('Driver Jordan'));
  await fireEvent.press(screen.getByLabelText('Save stop'));
  expect(onAssign).toHaveBeenCalledWith('dog-max', 'driver-jordan',
    { windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' }, 'dropoff');
});

it('trocar o motorista de um drop-off preserva sua fase', async () => {
  const dropoff = { ...routes[0], phase: 'dropoff' as const, stops: [routes[0].stops[1]] };
  const onAssign = jest.fn().mockResolvedValue(undefined);
  const screen = await render(<DispatchBoard date="2026-10-03" drivers={drivers} dayItems={[]}
    routes={[dropoff]} {...noops} onAssign={onAssign} />);
  await fireEvent.press(screen.getByLabelText('Drop-offs'));
  await fireEvent.press(screen.getByLabelText('Options for Max'));
  await fireEvent.press(screen.getByLabelText('Driver Jordan'));
  await fireEvent.press(screen.getByLabelText('Save stop'));
  expect(onAssign).toHaveBeenCalledWith('dog-max', 'driver-jordan',
    { windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' }, 'dropoff');
});


// Pedido do dono (04/10): despublicar também deve usar a perna visível.
it('Unpublish recebe a rota da perna escolhida', async () => {
  const onUnpublish = jest.fn().mockResolvedValue(undefined);
  const pickup = { ...routes[0], phase: 'pickup' as const, status: 'published' as const };
  const dropoff = { ...routes[0], routeId: 'delivery-route', phase: 'dropoff' as const, status: 'published' as const };
  const screen = await render(<DispatchBoard date="2026-10-04" drivers={drivers} dayItems={dayItems}
    routes={[pickup, dropoff]} {...noops} onUnpublish={onUnpublish} />);
  await fireEvent.press(screen.getByLabelText('Unpublish Rafael route'));
  expect(onUnpublish).toHaveBeenLastCalledWith('route-1');
  await fireEvent.press(screen.getByLabelText('Drop-offs'));
  await fireEvent.press(screen.getByLabelText('Unpublish Rafael route'));
  expect(onUnpublish).toHaveBeenLastCalledWith('delivery-route');
});
