import { fireEvent, render } from '@testing-library/react-native';
import { DispatchBoard, type DispatchDriver, type DispatchRoute } from '@/features/dispatch/DispatchBoard';

const drivers: DispatchDriver[] = [{ id: 'driver-rafael', name: 'Rafael' }];

const publishedRoute: DispatchRoute[] = [
  {
    routeId: 'route-1',
    driverId: 'driver-rafael',
    status: 'published',
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

describe('rota publicada: despublicar e cancelar', () => {
  it('despublica a rota (volta para rascunho) — antes não havia como', async () => {
    const onUnpublish = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={[]} routes={publishedRoute} {...noops} onUnpublish={onUnpublish} />);
    fireEvent.press(screen.getByLabelText('Unpublish Rafael route'));
    expect(onUnpublish).toHaveBeenCalledWith('route-1');
  });

  it('cancela a rota', async () => {
    const onCancelRoute = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={[]} routes={publishedRoute} {...noops} onCancelRoute={onCancelRoute} />);
    fireEvent.press(screen.getByLabelText('Cancel Rafael route'));
    expect(onCancelRoute).toHaveBeenCalledWith('route-1');
  });

  it('não oferece despublicar quando a rota está em rascunho', async () => {
    const draft = [{ ...publishedRoute[0], status: 'draft' as const }];
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={[]} routes={draft} {...noops} />);
    expect(screen.queryByLabelText('Unpublish Rafael route')).toBeNull();
  });

  it('fecha a rota (status completed) — antes esse status nunca era atingido', async () => {
    const onCompleteRoute = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={[]} routes={publishedRoute} {...noops} onCompleteRoute={onCompleteRoute} />);
    fireEvent.press(screen.getByLabelText('Complete Rafael route'));
    expect(onCompleteRoute).toHaveBeenCalledWith('route-1');
  });
});
// Mesmo motivo do DispatchBoard: o painel importa o visualizador de comprovante, que usa o
// cliente do Supabase (e o módulo real valida a configuração na carga).
jest.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://example.test/foto.jpg' }, error: null }),
      }),
    },
  },
}));

