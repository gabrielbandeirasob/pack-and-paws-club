/**
 * DEFEITO A (03/10/2026) — a lista do Dispatch tem de CONFERIR as reservas CONFIRMADAS do dia.
 *
 * Caso real: o dono cancelou a reserva de Akmal · Enso e criou Amy · Billy. A rota publicada de manhã
 * continuou com a PARADA do Enso e nunca recebeu o Billy. O Dispatch desenhava as linhas a partir de
 * `route_stops` sem conferir o dia — mostrava o cão cancelado e escondia o novo.
 *
 * O que estes vetores travam:
 *  1. a parada que não está mais no dia ganha SELO em inglês na própria linha;
 *  2. o topo do cartão diz quantas e QUAIS paradas estão nessa situação;
 *  3. a saída continua acessível (o app NÃO remove a parada sozinho);
 *  4. o cão que ESTÁ no dia e não está na rota continua na fila de não-atribuídos (o cálculo vem do
 *     pool do dia, não das paradas).
 */
jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn(), storage: { from: jest.fn(() => ({ createSignedUrl: jest.fn() })) } },
}));

import { fireEvent, render } from '@testing-library/react-native';
import { DispatchBoard, type DispatchDriver, type DispatchRoute } from '@/features/dispatch/DispatchBoard';

const drivers: DispatchDriver[] = [{ id: 'driver-maui', name: 'Maui' }];

// Dia CONFIRMADO (buildDay → transportPool): só Amy · Billy. A reserva de Akmal · Enso foi cancelada.
const dayItems = [{ dogId: 'dog-billy', clientName: 'Amy', dogName: 'Billy' }];

// Rota PUBLICADA de manhã: ficou com a parada do cão cancelado e nunca recebeu o cão novo.
const rotaComOCancelado: DispatchRoute[] = [{
  routeId: 'rota-1', driverId: 'driver-maui', status: 'published',
  stops: [{
    dogId: 'dog-enso', clientName: 'Akmal', dogName: 'Enso', sequence: 1, status: 'pending',
    latitude: null, longitude: null, windowStart: null, windowEnd: null, exactTime: null, priority: 'normal',
  }],
}];

const rotaDoBilly: DispatchRoute[] = [{
  routeId: 'rota-2', driverId: 'driver-maui', status: 'draft',
  stops: [{
    dogId: 'dog-billy', clientName: 'Amy', dogName: 'Billy', sequence: 1, status: 'pending',
    latitude: null, longitude: null, windowStart: null, windowEnd: null, exactTime: null, priority: 'normal',
  }],
}];

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

describe('Dispatch — parada que saiu do dia (Defeito A)', () => {
  it('marca a parada cancelada com selo em inglês', async () => {
    const tela = await render(<DispatchBoard date="2026-10-03" drivers={drivers} dayItems={dayItems} routes={rotaComOCancelado} {...noops} />);
    expect(tela.getByText("Booking cancelled — no longer in today's day")).toBeTruthy();
  });

  it('avisa no topo do cartão quantas e quais paradas estão fora do dia', async () => {
    const tela = await render(<DispatchBoard date="2026-10-03" drivers={drivers} dayItems={dayItems} routes={rotaComOCancelado} {...noops} />);
    expect(tela.getByText("1 stop is no longer in today's day: Akmal · Enso")).toBeTruthy();
  });

  it('mantém a saída da parada cancelada acessível (o app não remove sozinho)', async () => {
    const tela = await render(<DispatchBoard date="2026-10-03" drivers={drivers} dayItems={dayItems} routes={rotaComOCancelado} {...noops} />);
    await fireEvent.press(tela.getByLabelText('Options for Enso'));
    expect(tela.getByRole('button', { name: 'Remove from route' })).toBeTruthy();
  });

  it('o cão que ESTÁ no dia e não está na rota continua na fila de não-atribuídos', async () => {
    const tela = await render(<DispatchBoard date="2026-10-03" drivers={drivers} dayItems={dayItems} routes={rotaComOCancelado} {...noops} />);
    expect(tela.getByText('1 unassigned')).toBeTruthy();
    expect(tela.getByText('Amy · Billy')).toBeTruthy();
  });

  it('não marca nada quando todas as paradas estão no dia', async () => {
    const tela = await render(<DispatchBoard date="2026-10-03" drivers={drivers} dayItems={dayItems} routes={rotaDoBilly} {...noops} />);
    expect(tela.queryByText(/no longer in today's day/)).toBeNull();
  });
});
