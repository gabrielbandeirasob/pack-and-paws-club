/**
 * DEFEITO B (03/10/2026) — criar a PERNA de drop-off que nunca existiu.
 *
 * A seção "Drop-offs · <motorista>" era TEXTO PURO ("No drop-off route.") sem nenhuma ação: num dia em
 * que a perna de entrega não nasceu, o gestor não tinha caminho nenhum para criá-la. A ação nova cria a
 * perna do jeito que `assign(…, 'dropoff')` já cria (`routeIdForDriver`), com os cães elegíveis do dia
 * como paradas pendentes — e NÃO publica nada ("Drop-offs are draft only" continua).
 */
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return { useFocusEffect: (cb: () => void) => useEffect(cb, [cb]), useRouter: () => ({ push: jest.fn() }) };
});

/** Inserções na tabela `routes` e chamadas de RPC — a prova de COMO a perna nasce. */
const mockRotasInseridas: Record<string, unknown>[] = [];
const mockRpcs: { nome: string; args: Record<string, unknown> }[] = [];

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'gestor' } } })) },
    from: jest.fn((tabela: string) => {
      let selecao = '';
      let inseriu = false;
      const consulta: Record<string, unknown> = {};
      for (const metodo of ['select', 'eq', 'in', 'gte', 'lte', 'limit', 'order', 'update', 'delete']) {
        consulta[metodo] = (...args: unknown[]) => {
          if (metodo === 'select') selecao = args[0] as string;
          return consulta;
        };
      }
      consulta.insert = (valores: Record<string, unknown>) => {
        inseriu = true;
        mockRotasInseridas.push(valores);
        return consulta;
      };
      consulta.single = () => consulta;
      consulta.then = (resolver: (valor: unknown) => unknown) => {
        const hoje = new Date().toISOString().slice(0, 10);
        const dados = inseriu
          ? { id: 'rota-dropoff', lock_version: 1 }
          : tabela === 'organization_members'
            ? selecao === 'organization_id'
              ? [{ organization_id: 'clube' }]
              : [{ user_id: 'motorista', role: 'driver', profiles: { full_name: 'Rafael' } }]
            : tabela === 'reservations'
              ? [{
                id: 'res-1', service_type: 'daycare', start_date: hoje, end_date: hoje,
                transport_required: true, goes_to_daycare: true,
                dog: { id: 'dog-billy', name: 'Billy', client: { id: 'cli-1', name: 'Amy', latitude: 37.4, longitude: -122.1 } },
              }]
              : [];
        return Promise.resolve({ data: dados, error: null }).then(resolver);
      };
      return consulta;
    }),
    rpc: jest.fn((nome: string, args: Record<string, unknown>) => {
      mockRpcs.push({ nome, args });
      return Promise.resolve({ data: null, error: null });
    }),
    channel: () => {
      const canal: Record<string, unknown> = {};
      canal.on = () => canal;
      canal.subscribe = () => canal;
      return canal;
    },
    removeChannel: jest.fn(),
    storage: { from: () => ({ createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://example.test/foto.jpg' }, error: null }) }) },
  },
}));

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import DispatchScreen from '@/app/(tabs)/dispatch';
import { DispatchBoard, type DispatchDriver } from '@/features/dispatch/DispatchBoard';

const drivers: DispatchDriver[] = [{ id: 'driver-maui', name: 'Maui' }];
const Billy = { dogId: 'dog-billy', clientName: 'Amy', dogName: 'Billy', reservationKind: 'daycare' };

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

describe('Dispatch — ação "Create drop-off route" (tela do quadro)', () => {
  it('mostra a ação quando a perna não existe e há cão elegível para entregar', async () => {
    const onCreateDropoffRoute = jest.fn().mockResolvedValue(undefined);
    const tela = await render(
      <DispatchBoard date="2026-10-03" drivers={drivers} dayItems={[]} dropoffItems={[Billy]} routes={[]} {...noops} onCreateDropoffRoute={onCreateDropoffRoute} />,
    );
    await fireEvent.press(tela.getByRole('button', { name: 'Create drop-off route for Maui' }));
    expect(onCreateDropoffRoute).toHaveBeenCalledWith('driver-maui');
  });

  it('não oferece a ação quando não há nada a entregar', async () => {
    const tela = await render(
      <DispatchBoard date="2026-10-03" drivers={drivers} dayItems={[]} dropoffItems={[]} routes={[]} {...noops} onCreateDropoffRoute={jest.fn()} />,
    );
    expect(tela.getByText('No drop-off route.')).toBeTruthy();
    expect(tela.queryByRole('button', { name: 'Create drop-off route for Maui' })).toBeNull();
  });

  it('não oferece a ação quando a perna de drop-off já existe', async () => {
    const tela = await render(
      <DispatchBoard date="2026-10-03" drivers={drivers} dayItems={[]} dropoffItems={[Billy]}
        routes={[{ routeId: 'r-d', driverId: 'driver-maui', phase: 'dropoff', status: 'draft', stops: [] }]}
        {...noops} onCreateDropoffRoute={jest.fn()} />,
    );
    expect(tela.queryByRole('button', { name: 'Create drop-off route for Maui' })).toBeNull();
  });

  it('não oferece a ação sem a prop (comportamento antigo preservado)', async () => {
    const tela = await render(
      <DispatchBoard date="2026-10-03" drivers={drivers} dayItems={[]} dropoffItems={[Billy]} routes={[]} {...noops} />,
    );
    expect(tela.queryByRole('button', { name: 'Create drop-off route for Maui' })).toBeNull();
  });
});

describe('Dispatch — a ação cria a perna de verdade (tela com Supabase falsificado)', () => {
  beforeEach(() => {
    mockRotasInseridas.length = 0;
    mockRpcs.length = 0;
  });

  it('cria a perna como `draft`/drop-off e põe os cães elegíveis do dia como paradas pendentes — sem publicar', async () => {
    const tela = await render(<DispatchScreen />);
    const botao = await tela.findByRole('button', { name: 'Create drop-off route for Rafael' });
    await fireEvent.press(botao);

    await waitFor(() => expect(mockRotasInseridas).toHaveLength(1));
    expect(mockRotasInseridas[0]).toMatchObject({
      organization_id: 'clube', route_date: new Date().toISOString().slice(0, 10),
      driver_id: 'motorista', status: 'draft', phase: 'dropoff',
    });
    expect(mockRpcs.some((c) => c.nome === 'assign_stop_to_route' && c.args.p_dog_id === 'dog-billy'
      && c.args.p_route_id === 'rota-dropoff')).toBe(true);
    // "Drop-offs are draft only": a ação NUNCA publica.
    expect(mockRpcs.some((c) => c.nome === 'publish_route')).toBe(false);
  });
});
