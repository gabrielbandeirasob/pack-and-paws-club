import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';

/**
 * Cobre o caminho do GERENTE na tela inicial: nome no cumprimento, contagem do dia
 * (daycare/boarding) e a lista de rotas — o pedaco que estava sem teste (31% de cobertura).
 */
/** O callback do `useFocusEffect`: chamar isto = voltar para a aba da Home. */
let mockFoco: (() => void | (() => void)) | null = null;

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    // Guarda o callback: o teste simula "saiu da aba e voltou" chamando `mockFoco()`.
    mockFoco = callback;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    (require('react') as typeof React).useEffect(() => {
      const cleanup = callback();
      return typeof cleanup === 'function' ? cleanup : undefined;
    }, []);
  },
}));

jest.mock('@/features/auth/useOrganizationRole', () => ({
  useOrganizationRole: () => ({ role: 'manager', view: 'manager', isLoading: false }),
}));

jest.mock('@/lib/supabase', () => {
  const table = (name: string) => ({
    data: (globalThis as any).__rows?.[name] ?? null,
    error: null,
  });
  const chainFor = (name: string) => {
    const chain: any = new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (prop === 'then') return (resolve: any) => Promise.resolve(table(name)).then(resolve);
          if (prop === 'maybeSingle') return () => Promise.resolve({ data: (globalThis as any).__rows?.[name]?.[0] ?? null, error: null });
          return () => chain;
        },
      },
    );
    return chain;
  };
  return {
    supabase: {
      from: (name: string) => chainFor(name),
      channel: () => ({ on: () => ({ subscribe: () => undefined }), unsubscribe: () => undefined }),
      removeChannel: () => undefined,
      auth: { getUser: async () => ({ data: { user: { id: 'manager-1', email: 'raphael@autonestmobile.com' } } }) },
    },
  };
});

// eslint-disable-next-line import/first
import HomeScreen from '@/app/(tabs)/index';

const hoje = new Date().toISOString().slice(0, 10);

describe('tela inicial do gerente', () => {
  beforeEach(() => {
    (globalThis as any).__rows = {
      organization_members: [{ organization_id: 'org-1', user_id: 'manager-1', profiles: { full_name: 'Raphael' } }],
      profiles: [{ full_name: 'Raphael' }],
      reservations: [
        {
          id: 'r1',
          service_type: 'daycare',
          start_date: hoje,
          end_date: hoje,
          transport_required: true,
          dog: { id: 'd1', name: 'Mowgli', client: { name: 'Maria Silva' } },
        },
        {
          id: 'r2',
          service_type: 'boarding',
          start_date: hoje,
          end_date: hoje,
          transport_required: true,
          dog: { id: 'd2', name: 'Kona', client: { name: 'Leigh Ann' } },
        },
      ],
      recurring_schedules: [],
      recurring_exceptions: [],
      routes: [
        {
          id: 'route-1',
          driver_id: 'driver-1',
          status: 'published',
          route_stops: [
            { id: 's1', sequence: 1, status: 'pending', window_end: null, exact_time: null, dog: { name: 'Mowgli', client: { latitude: null, longitude: null } } },
            { id: 's2', sequence: 2, status: 'pending', window_end: null, exact_time: null, dog: { name: 'Kona', client: { latitude: null, longitude: null } } },
          ],
        },
      ],
      driver_locations: [],
    };
  });

  it('mostra o nome do gerente, a contagem do dia e as rotas', async () => {
    const screen = await render(<HomeScreen />);
    await waitFor(() => expect(screen.getByText(/Raphael/)).toBeTruthy());
    expect(screen.getByText('Daycare')).toBeTruthy();
    expect(screen.getByText('Boarding')).toBeTruthy();
    expect(screen.getByText('2 stops')).toBeTruthy();
  });

  it('avisa quando a conta nao esta ligada a nenhuma organizacao', async () => {
    (globalThis as any).__rows = { ...(globalThis as any).__rows, organization_members: [] };
    const screen = await render(<HomeScreen />);
    await waitFor(() => expect(screen.getByText('Your account is not linked to an organization yet.')).toBeTruthy());
  });

  /**
   * 🪤 VISTORIA (02/10/2026): a Home dispara 11 consultas a cada volta na aba e trocava a TELA INTEIRA
   * por uma rodinha (`setLoading(true)`). O gestor ia no Dispatch, voltava, e a Home "piscava" toda.
   * Aqui se prova: a segunda carga (volta na aba) acontece POR BAIXO, sem a rodinha de tela cheia.
   */
  it('voltar para a aba NÃO troca a tela pela rodinha (a carga é por baixo)', async () => {
    (globalThis as any).__rows = {
      profiles: [{ full_name: 'Gabriel' }],
      organization_members: [{ organization_id: 'org-1', user_id: 'u-1', profiles: { full_name: 'Rafael' } }],
      reservations: [],
      routes: [],
      recurring_schedules: [],
      recurring_exceptions: [],
      organization_locations: [],
      day_plans: [],
      day_todos: [],
      pack_entries: [],
    };
    const tela = await render(<HomeScreen />);

    // Primeira carga: a rodinha sai quando os dados chegam.
    await waitFor(() => expect(tela.queryByTestId('home-loading')).toBeNull());
    expect(mockFoco).toBeTruthy();

    // O gestor foi no Dispatch e voltou: o foco recarrega as 11 consultas POR BAIXO.
    await act(async () => { mockFoco?.(); });

    expect(tela.queryByTestId('home-loading')).toBeNull();
    await waitFor(() => expect(tela.getByText(/Gabriel/)).toBeTruthy());
  });
});
