/**
 * AUDITORIA DO GESTOR (02/10/2026) — provas das correções da HOME.
 *
 * A2: rota cancelada/concluída aparecia como "Draft" e contava no progresso do dia.
 * M2: o cartão "Day plan" mostrava "Saved" mesmo quando o banco recusou a escrita.
 * B1: swipe rápido dispara cargas em paralelo e a resposta VELHA sobrescrevia o dia novo.
 */
let mockFoco: (() => void) | null = null;

jest.mock('expo-router', () => {
  const React = require('react') as typeof import('react');
  return {
    useRouter: () => ({ replace: () => undefined, push: () => undefined }),
    useFocusEffect: (callback: () => void) => {
      mockFoco = callback;
      React.useEffect(callback, [callback]); // como o hook real: re-roda quando o dia muda
    },
  };
});

jest.mock('@/features/auth/useOrganizationRole', () => ({
  useOrganizationRole: () => ({ role: 'manager', view: 'manager', isLoading: false }),
}));

let mockRows: Record<string, unknown> = {};
let mockDeferRotas = false;
const mockResolvedoresRotas: ((valor: { data: unknown; error: null }) => void)[] = [];

jest.mock('@/lib/supabase', () => {
  const chainFor = (name: string) => {
    const chain: any = new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (prop === 'then') {
            if (name === 'routes' && mockDeferRotas) {
              return (resolve: (v: unknown) => unknown) =>
                new Promise<{ data: unknown; error: null }>((res) => { mockResolvedoresRotas.push(res); }).then(resolve);
            }
            return (resolve: (v: unknown) => unknown) =>
              Promise.resolve({ data: mockRows[name] ?? null, error: null }).then(resolve);
          }
          if (prop === 'maybeSingle') {
            const linhas = mockRows[name] as unknown[] | undefined;
            return () => Promise.resolve({ data: linhas?.[0] ?? null, error: null });
          }
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
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import HomeScreen, { toDashboardRoute } from '@/app/(tabs)/index';

const hoje = new Date().toISOString().slice(0, 10);

function parada(nome: string, status = 'pending'): any {
  return { id: `s-${nome}`, sequence: 1, status, window_end: null, exact_time: null, updated_at: null, dog: { name: nome, client: { latitude: null, longitude: null } } };
}
function rota(id: string, status: string, stops: unknown[]): any {
  return { id, driver_id: 'driver-1', status, route_stops: stops };
}
function baseRows(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    organization_members: [{ organization_id: 'org-1', user_id: 'manager-1', profiles: { full_name: 'Raphael' } }],
    profiles: [{ full_name: 'Raphael' }],
    reservations: [], recurring_schedules: [], recurring_exceptions: [],
    routes: [], driver_locations: [], daily_plans: [], daily_todos: [], pack_entries: [],
    organization_locations: [],
    ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFoco = null;
  mockDeferRotas = false;
  mockResolvedoresRotas.length = 0;
  mockRows = baseRows();
});

describe('A2 — rótulo de status e filtro do dia', () => {
  it('toDashboardRoute dá o rótulo certo para cada status (cancelada/concluída ≠ Draft)', () => {
    const paradas = [parada('Mowgli')];
    expect(toDashboardRoute(rota('r', 'draft', paradas), {}, null).statusLabel).toBe('Draft');
    expect(toDashboardRoute(rota('r', 'published', paradas), {}, null).statusLabel).toBe('Ready');
    expect(toDashboardRoute(rota('r', 'completed', paradas), {}, null).statusLabel).toBe('Completed');
    expect(toDashboardRoute(rota('r', 'cancelled', paradas), {}, null).statusLabel).toBe('Cancelled');
    expect(toDashboardRoute(rota('r', 'published', [{ ...parada('Mowgli'), status: 'completed' }]), {}, null).statusLabel).toBe('Done');
  });

  it('rota cancelada NÃO entra na lista nem no progresso do dia', async () => {
    mockRows = baseRows({
      routes: [
        rota('r-ok', 'published', [parada('Mowgli')]),
        rota('r-cancel', 'cancelled', [parada('Ghost')]),
        rota('r-done', 'completed', [parada('Zombie')]),
      ],
    });
    const tela = await render(<HomeScreen />);
    await waitFor(() => expect(tela.getByText('1 stop')).toBeTruthy());
    expect(tela.queryByText('Ghost')).toBeNull();
    expect(tela.queryByText('Zombie')).toBeNull();
  });
});

describe('M2 — "Saved" só quando o banco confirmou', () => {
  async function digitarESalvar(tela: Awaited<ReturnType<typeof render>>, texto: string) {
    await waitFor(() => expect(tela.getByLabelText('Walk location of the day')).toBeTruthy());
    await fireEvent.changeText(tela.getByLabelText('Walk location of the day'), texto);
    await fireEvent.press(tela.getByRole('button', { name: 'Save the day plan' }));
  }

  it('escrita recusada (0 linha) NÃO mostra "Saved" e avisa o motivo', async () => {
    mockRows = baseRows({ daily_plans: [] });
    const alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    try {
      const tela = await render(<HomeScreen />);
      await digitarESalvar(tela, 'Golden Gate Park');
      await waitFor(() => expect(alerta.mock.calls.map((c) => c[0])).toContain('Could not save the day plan'));
      expect(tela.queryByText('Saved')).toBeNull();
    } finally {
      alerta.mockRestore();
    }
  });

  it('escrita confirmada (1 linha) mostra "Saved"', async () => {
    mockRows = baseRows({ daily_plans: [{ id: 'p1' }] });
    const alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    try {
      const tela = await render(<HomeScreen />);
      await digitarESalvar(tela, 'Golden Gate Park');
      await waitFor(() => expect(tela.getByText('Saved')).toBeTruthy());
      expect(alerta).not.toHaveBeenCalled();
    } finally {
      alerta.mockRestore();
    }
  });
});

describe('B1 — resposta de carga velha não sobrescreve o dia novo', () => {
  it('descarta a resposta que chega FORA DE ORDEM', async () => {
    mockRows = baseRows({ routes: [] });
    mockDeferRotas = true; // controlamos QUANDO cada carga de rotas responde
    const tela = await render(<HomeScreen />);
    // A carga inicial (#1) ficou pendente nas rotas.
    await waitFor(() => expect(mockResolvedoresRotas.length).toBe(1));

    // O dia muda / nova carga (#2) começa, já com uma rota de 2 paradas.
    await act(async () => { mockFoco?.(); });
    await waitFor(() => expect(mockResolvedoresRotas.length).toBe(2));
    const rotaDoisStops = rota('r-2', 'published', [parada('Mowgli'), { ...parada('Kona'), id: 's-Kona', sequence: 2 }]);

    // A carga NOVA responde primeiro.
    await act(async () => { mockResolvedoresRotas[1]({ data: [rotaDoisStops], error: null }); });
    await waitFor(() => expect(tela.getByText('2 stops')).toBeTruthy());

    // A carga VELHA responde depois — não pode apagar a tela.
    await act(async () => { mockResolvedoresRotas[0]({ data: [], error: null }); });
    expect(tela.getByText('2 stops')).toBeTruthy();
  });
});
