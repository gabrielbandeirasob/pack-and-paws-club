import { act, render, waitFor } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';

import RouteStopsScreen from '@/app/route-stops';
import { supabase } from '@/lib/supabase';

/**
 * TELA "ROUTE STOPS" (gestor) — pedido do cliente em áudio (01/10/2026): *"no Today's Routes seria
 * ideal se você conseguisse clicar no driver e abrir uma lista dos pick-up que tem e os que ainda
 * falta e que hora foi feita cada pick-up"*.
 *
 * A consulta é falsificada (nunca rede): o que se prova aqui é o que a tela MOSTRA — a lista na
 * ordem da busca, com situação e hora de cada parada, e o resumo de quantas já saíram.
 */
const emLocal = (hora: number, minuto: number) => new Date(2026, 9, 1, hora, minuto).toISOString();

const paradas = [
  {
    id: 'stop-1', sequence: 1, status: 'completed', arrived_at: emLocal(8, 18), picked_up_at: emLocal(8, 18),
    completed_at: emLocal(8, 18), skipped_at: null, delivered_at: emLocal(14, 5), exact_time: null, window_end: null,
    dog: { name: 'Lucky', client: { name: 'Cristina', address_line_1: '100 Middlefield Rd', city: 'Menlo Park' } },
  },
  {
    id: 'stop-2', sequence: 5, status: 'completed', arrived_at: emLocal(8, 54), picked_up_at: emLocal(8, 55),
    completed_at: emLocal(8, 55), skipped_at: null, delivered_at: null, exact_time: null, window_end: null,
    dog: { name: 'Oreo', client: { name: 'Andrea', address_line_1: '329 Middlefield Rd', city: 'Palo Alto' } },
  },
  {
    id: 'stop-3', sequence: 7, status: 'pending', arrived_at: null, picked_up_at: null,
    completed_at: null, skipped_at: null, delivered_at: null, exact_time: '09:30:00', window_end: null,
    dog: { name: 'Winter', client: { name: 'Jez', address_line_1: '5 Oak Ave', city: 'Atherton' } },
  },
];

let mockErro: string | null = null;
let mockRota: unknown = { id: 'rota-1', route_stops: paradas };

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn(async () => (
            mockErro ? { data: null, error: { message: mockErro } } : { data: mockRota, error: null }
          )),
        })),
      })),
    })),
  },
}));

const mockVoltar = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ route: 'rota-1', driver: 'Rafael', day: '2026-10-01' }),
  useRouter: () => ({ back: mockVoltar, push: jest.fn() }),
  // A tela recarrega ao voltar o foco (vistoria 02/10/2026): aqui o efeito roda como um useEffect.
  useFocusEffect: (callback: () => void | (() => void)) => {
    (require('react') as typeof import('react')).useEffect(callback, []);
  },
}));

beforeEach(() => {
  mockErro = null;
  mockRota = { id: 'rota-1', route_stops: paradas };
  mockVoltar.mockClear();
  (supabase.from as jest.Mock).mockClear();
});

describe('tela Route stops (gestor)', () => {
  it('lista as paradas com situação e a hora de cada marco', async () => {
    const tela = await render(<RouteStopsScreen />);

    await waitFor(() => expect(tela.getByText('Cristina · Lucky')).toBeTruthy());
    expect(tela.getByText('Andrea · Oreo')).toBeTruthy();
    expect(tela.getByText('Jez · Winter')).toBeTruthy();
    // horas (fuso local do aparelho)
    expect(tela.getByText('arrived 08:18 · done 08:18 · delivered 14:05')).toBeTruthy();
    expect(tela.getByText('arrived 08:54 · done 08:55')).toBeTruthy();
    // pendente cai na previsão
    expect(tela.getByText('Must arrive by 09:30')).toBeTruthy();
    // situação e endereço
    expect(tela.getAllByText('Completed')).toHaveLength(2);
    expect(tela.getByText('Pending')).toBeTruthy();
    expect(tela.getByText('329 Middlefield Rd, Palo Alto')).toBeTruthy();
  });

  it('mostra o resumo e qual é a próxima parada', async () => {
    const tela = await render(<RouteStopsScreen />);

    await waitFor(() => expect(tela.getByText('2 of 3 done')).toBeTruthy());
    expect(tela.getByText('Next: Winter · Must arrive by 09:30')).toBeTruthy();
    // resumo do topo: as feitas da BUSCA mais as ENTREGUES da tarde (só a stop-1 foi entregue)
    expect(tela.getByText('Rafael · Thu, Oct 01 · 2 of 3 done · 1 of 3 delivered')).toBeTruthy();
  });

  it('lê a rota pelo id que veio da Home (a tela do gestor não usa outra consulta)', async () => {
    await render(<RouteStopsScreen />);
    await waitFor(() => expect(supabase.from).toHaveBeenCalledWith('routes'));
    const consulta = (supabase.from as jest.Mock).mock.results[0].value;
    expect(consulta.select).toHaveBeenCalledWith(expect.stringContaining('arrived_at'));
    expect(consulta.select).toHaveBeenCalledWith(expect.stringContaining('delivered_at'));
    expect(consulta.select.mock.results[0].value.eq).toHaveBeenCalledWith('id', 'rota-1');
  });

  it('rota indisponível (RLS/rota de outra organização) avisa em vez de mentir lista vazia', async () => {
    mockRota = null;
    const tela = await render(<RouteStopsScreen />);
    await waitFor(() => expect(tela.getByText('This route is not available on this account.')).toBeTruthy());
  });

  it('erro da consulta aparece na tela', async () => {
    mockErro = 'permission denied for table routes';
    const tela = await render(<RouteStopsScreen />);
    await waitFor(() => expect(tela.getByText('permission denied for table routes')).toBeTruthy());
  });

  /**
   * 🪤 VISTORIA (02/10/2026): a lista era carregada UMA vez por `routeId` — sem foco, sem puxar para
   * atualizar e sem tempo real. O gestor abria para ver "quem já foi e a que hora" e o número não mudava
   * mais enquanto o motorista trabalhava. Aqui se prova que puxar a lista RELÊ a rota de verdade.
   */
  it('puxar para atualizar relê a rota (a lista não fica congelada)', async () => {
    const tela = await render(<RouteStopsScreen />);
    await waitFor(() => expect(tela.getByText(/1 of 3 delivered/)).toBeTruthy());
    const antes = (supabase.from as jest.Mock).mock.calls.length;

    // o motorista entregou mais um cão enquanto o gestor olhava a lista
    mockRota = { id: 'rota-1', route_stops: paradas.map((parada, indice) => (indice === 1 ? { ...parada, delivered_at: emLocal(15, 0) } : parada)) };

    // Puxar para atualizar: a lista tem de ter o RefreshControl e ele relê a rota.
    const lista = tela.getByTestId('route-stops-lista');
    const refreshControl = lista.props.refreshControl;
    expect(refreshControl).toBeTruthy();
    expect(typeof refreshControl.props.onRefresh).toBe('function');
    expect(refreshControl.type).toBe(RefreshControl);
    await act(async () => { await refreshControl.props.onRefresh(); });

    expect((supabase.from as jest.Mock).mock.calls.length).toBeGreaterThan(antes);
    await waitFor(() => expect(tela.getByText(/2 of 3 delivered/)).toBeTruthy());
  });
});
