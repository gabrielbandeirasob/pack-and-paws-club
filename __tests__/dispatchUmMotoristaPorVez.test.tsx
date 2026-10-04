// Pedido do dono (04/10): escolher a perna antes de agir nela; mesmas asserções de negócio.
// Pedido do cliente (04/10/2026): calendário e Dispatch identificam apenas o cão; as asserções permanecem.
/**
 * PROPOSTA B (dono, 03/10/2026) — o Dispatch mostra UM MOTORISTA POR VEZ.
 *
 * Antes: para cada motorista a tela desenhava DOIS blocos (o cartão de Pick-ups e o bloco
 * "Drop-offs · <motorista>") — com 4 motoristas eram 8 cartões. Agora: uma LINHA de motoristas
 * (chips) escolhe quem está na tela, e o cartão único tem a troca de perna Pick-up | Drop-off.
 *
 * O que estes vetores travam:
 *  1. com N motoristas, só UM cartão do motorista está na tela;
 *  2. os chips trocam o motorista visível;
 *  3. a troca de perna mostra a rota de pick-up e a de drop-off do mesmo motorista;
 *  4. sem perna de drop-off, a aba Drop-off oferece "Create drop-off route";
 *  5. o dia sem motorista nenhum não desenha seletor vazio.
 */
jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn(), storage: { from: jest.fn(() => ({ createSignedUrl: jest.fn() })) } },
}));

import { fireEvent, render, within } from '@testing-library/react-native';
import { DispatchBoard, type DispatchDriver, type DispatchRoute } from '@/features/dispatch/DispatchBoard';

const drivers: DispatchDriver[] = [
  { id: 'driver-rafael', name: 'Rafael' },
  { id: 'driver-jordan', name: 'Jordan' },
  { id: 'driver-sam', name: 'Sam' },
];

const parada = (dogId: string, clientName: string, dogName: string, sequence = 1) => ({
  dogId, clientName, dogName, sequence, status: 'pending' as const,
  latitude: 37.8, longitude: -122.4, windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' as const,
});

const routes: DispatchRoute[] = [
  { routeId: 'r-rafael-pickup', driverId: 'driver-rafael', status: 'draft', stops: [parada('d-billy', 'Amy', 'Billy'), parada('d-maui', 'Adi', 'Maui', 2)] },
  { routeId: 'r-rafael-dropoff', driverId: 'driver-rafael', phase: 'dropoff', status: 'draft', stops: [parada('d-billy', 'Amy', 'Billy')] },
  { routeId: 'r-jordan-pickup', driverId: 'driver-jordan', status: 'draft', stops: [parada('d-ruby', 'Katia', 'Ruby')] },
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

const montar = (extra: Record<string, unknown> = {}) =>
  render(<DispatchBoard date="2026-10-03" drivers={drivers} dayItems={[]} routes={routes} {...noops} {...extra} />);

describe('Dispatch — um motorista por vez (Proposta B)', () => {
  it('desenha só o cartão do motorista escolhido (não os 3)', async () => {
    const tela = await montar();
    expect(tela.getByTestId('dispatch-route-driver-rafael-pickup')).toBeTruthy();
    expect(tela.queryByTestId('dispatch-route-driver-jordan-pickup')).toBeNull();
    expect(tela.queryByTestId('dispatch-route-driver-sam-pickup')).toBeNull();
  });

  it('a linha de motoristas troca quem está na tela', async () => {
    const tela = await montar();
    await fireEvent.press(tela.getByRole('button', { name: 'Show Jordan' }));
    expect(tela.getByTestId('dispatch-route-driver-jordan-pickup')).toBeTruthy();
    expect(tela.queryByTestId('dispatch-route-driver-rafael-pickup')).toBeNull();
  });

  it('mostra uma perna do mesmo motorista por vez, conforme o seletor', async () => {
    const tela = await montar();
    // Pedido de 04/10: o seletor alterna as listas de Rafael, sem trocar o motorista.
    const busca = within(tela.getByTestId('dispatch-leg-pickup-driver-rafael'));
    expect(busca.getByText('Billy')).toBeTruthy();
    expect(busca.getByText('Maui')).toBeTruthy();
    expect(tela.queryByTestId('dispatch-leg-dropoff-driver-rafael')).toBeNull();
    await fireEvent.press(tela.getByLabelText('Drop-offs'));
    expect(tela.queryByTestId('dispatch-leg-pickup-driver-rafael')).toBeNull();
    expect(within(tela.getByTestId('dispatch-leg-dropoff-driver-rafael')).getByText('Billy')).toBeTruthy();
    // Não existe seletor duplicado dentro do cartão.
    expect(tela.queryByRole('button', { name: /Show (pick-up|drop-off) for / })).toBeNull();
  });

  it('sem perna de drop-off, o cartão oferece o "Create drop-off route"', async () => {
    const onCreateDropoffRoute = jest.fn().mockResolvedValue(undefined);
    const tela = await montar({
      dropoffItems: [{ dogId: 'd-ruby', clientName: 'Katia', dogName: 'Ruby', reservationKind: 'daycare' }],
      onCreateDropoffRoute,
    });
    await fireEvent.press(tela.getByRole('button', { name: 'Show Jordan' }));
    await fireEvent.press(tela.getByLabelText('Drop-offs'));
    await fireEvent.press(tela.getByRole('button', { name: 'Create drop-off route for Jordan' }));
    expect(onCreateDropoffRoute).toHaveBeenCalledWith('driver-jordan');
  });

  it('não desenha seletor quando não há motorista', async () => {
    const tela = await render(<DispatchBoard date="2026-10-03" drivers={[]} dayItems={[]} routes={[]} {...noops} />);
    expect(tela.queryByRole('button', { name: 'Show Rafael' })).toBeNull();
  });
});
