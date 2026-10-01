import { act, fireEvent, waitFor, render, within } from '@testing-library/react-native';

import { DispatchBoard } from '@/features/dispatch/DispatchBoard';
import type { SugestaoDeRotas } from '@/features/dispatch/routeSuggestion';
jest.mock('@/lib/supabase', () => ({ supabase: { storage: { from: jest.fn() } } }));

/**
 * BOTÃO "SUGGEST ROUTES" no quadro do Dispatch — pedido do cliente em áudio (01/10/2026): *"leva um
 * tempinho aí de clicar e mandar pro driver certo"*. Provas que importam:
 *  - a proposta só PROPÕE (nada é aplicado antes do ok — decisão do dono);
 *  - o "Apply" entrega os blocos na ordem que veio, e é a tela que escreve;
 *  - sem as props o quadro continua exatamente como era (nada de botão órfão).
 */
const sugestao: SugestaoDeRotas = {
  kmTotal: 9.7,
  semLugar: [{ dogId: 'sem', clientName: 'Chuck', dogName: 'Sammy', latitude: null, longitude: null }],
  blocos: [
    {
      driverId: 'motorista-1',
      driverName: 'Rafael',
      km: 4.8,
      caes: [
        { dogId: 'lucky', clientName: 'Cristina', dogName: 'Lucky', latitude: 37.4, longitude: -122.14 },
        { dogId: 'fergie', clientName: 'Andrea', dogName: 'Fergie', latitude: 37.41, longitude: -122.14 },
      ],
    },
    {
      driverId: 'motorista-2',
      driverName: 'Jordan',
      km: 4.9,
      caes: [{ dogId: 'oreo', clientName: 'Andrea', dogName: 'Oreo', latitude: 37.3, longitude: -122.14 }],
    },
  ],
};

function props(over: Partial<React.ComponentProps<typeof DispatchBoard>> = {}) {
  return {
    date: '2026-10-01',
    drivers: [{ id: 'motorista-1', name: 'Rafael' }, { id: 'motorista-2', name: 'Jordan' }],
    dayItems: [
      { dogId: 'lucky', clientName: 'Cristina', dogName: 'Lucky' },
      { dogId: 'fergie', clientName: 'Andrea', dogName: 'Fergie' },
      { dogId: 'oreo', clientName: 'Andrea', dogName: 'Oreo' },
    ],
    routes: [],
    driverLocations: {},
    onAssign: jest.fn(),
    onSaveStop: jest.fn(),
    onRemoveStop: jest.fn(),
    onMoveStop: jest.fn(),
    onOptimize: jest.fn(),
    onPublish: jest.fn(),
    onUnpublish: jest.fn(),
    onCancelRoute: jest.fn(),
    onCompleteRoute: jest.fn(),
    onDateChange: jest.fn(),
    ...over,
  } as React.ComponentProps<typeof DispatchBoard>;
}

describe('sugestão de rota no Dispatch', () => {
  it('fica ao lado de Optimize nas ações do motorista, não na fila unassigned', async () => {
    const rota = { routeId: 'r', driverId: 'motorista-1', status: 'draft' as const,
      stops: ['x','y'].map((dogId, i) => ({ dogId, dogName: dogId, clientName: 'Tutor', sequence: i + 1, status: 'pending' as const, latitude: null, longitude: null, windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' as const })) };
    const tela = await render(<DispatchBoard {...props({ routes: [rota], onSuggestRoutes: jest.fn(), onApplySuggestion: jest.fn() })} />);
    const actions = within(tela.getByTestId('driver-actions'));
    expect(actions.getByLabelText('Optimize Rafael route')).toBeTruthy();
    expect(actions.getByLabelText('Suggest routes')).toBeTruthy();
  });

  it('resposta atrasada de outro dia não abre proposta antiga', async () => {
    let resolve!: (s: SugestaoDeRotas) => void;
    const onSuggestRoutes = () => new Promise<SugestaoDeRotas>(r => { resolve = r; });
    const base = props({ onSuggestRoutes, onApplySuggestion: jest.fn() });
    const tela = await render(<DispatchBoard {...base} />);
    await fireEvent.press(tela.getByLabelText('Suggest routes'));
    await tela.rerender(<DispatchBoard {...base} date="2026-10-02" />);
    await act(async () => resolve(sugestao));
    expect(tela.queryByText('Suggested routes')).toBeNull();
  });

  it('sem as props, o quadro não mostra o botão', async () => {
    const tela = await render(<DispatchBoard {...props()} />);
    expect(tela.queryByLabelText('Suggest routes')).toBeNull();
  });

  it('com um cão sem motorista e um motorista, o botão aparece', async () => {
    const tela = await render(<DispatchBoard {...props({ onSuggestRoutes: jest.fn(), onApplySuggestion: jest.fn() })} />);
    expect(tela.getByLabelText('Suggest routes')).toBeTruthy();
  });

  it('a proposta aparece na folha COM a ordem e NADA é aplicado antes do ok', async () => {
    const onApplySuggestion = jest.fn();
    const tela = await render(
      <DispatchBoard {...props({ onSuggestRoutes: async () => sugestao, onApplySuggestion })} />,
    );

    await fireEvent.press(tela.getByLabelText('Suggest routes'));
    await waitFor(() => expect(tela.getByText('Suggested routes')).toBeTruthy());

    // lista por motorista, na ordem que será gravada, e o aviso do cão sem endereço
    expect(tela.getByText('Rafael · 2 dogs · 3 mi')).toBeTruthy();
    expect(tela.getByText('1. Cristina · Lucky')).toBeTruthy();
    expect(tela.getByText('2. Andrea · Fergie')).toBeTruthy();
    expect(tela.getByText('Jordan · 1 dog · 3 mi')).toBeTruthy();
    expect(tela.getByText(/kept out of the suggestion/)).toBeTruthy();
    expect(onApplySuggestion).not.toHaveBeenCalled();

    // o gestor confirma
    await fireEvent.press(tela.getByLabelText('Apply suggestion'));
    await waitFor(() => expect(onApplySuggestion).toHaveBeenCalledTimes(1));
    expect(onApplySuggestion.mock.calls[0][0]).toEqual(sugestao.blocos);
  });

  it('cancelar fecha a folha sem aplicar nada', async () => {
    const onApplySuggestion = jest.fn();
    const tela = await render(
      <DispatchBoard {...props({ onSuggestRoutes: async () => sugestao, onApplySuggestion })} />,
    );
    await fireEvent.press(tela.getByLabelText('Suggest routes'));
    await waitFor(() => expect(tela.getByText('Suggested routes')).toBeTruthy());
    await fireEvent.press(tela.getByLabelText('Cancel suggestion'));
    await waitFor(() => expect(tela.queryByText('Suggested routes')).toBeNull());
    expect(onApplySuggestion).not.toHaveBeenCalled();
  });

  it('erro ao calcular aparece na tela em vez de sumir calado', async () => {
    const tela = await render(
      <DispatchBoard
        {...props({ onSuggestRoutes: async () => { throw new Error('permission denied'); }, onApplySuggestion: jest.fn() })}
      />,
    );
    await fireEvent.press(tela.getByLabelText('Suggest routes'));
    await waitFor(() => expect(tela.getByText('permission denied')).toBeTruthy());
  });
});
