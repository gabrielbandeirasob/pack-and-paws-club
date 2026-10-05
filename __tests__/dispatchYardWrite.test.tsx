// A tela do Dispatch usa `useFocusEffect` — mesmo mock das outras telas de teste do projeto.
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return { useFocusEffect: (cb: () => void) => useEffect(cb, [cb]), useRouter: () => ({ push: jest.fn() }) };
});

/**
 * ESCRITA DO YARD (dono, 05/10/2026 — item 7 do redesenho; ÚNICA escrita nova autorizada).
 *
 * O gestor toca no YARD do cartão e o app grava `routes.end_location_id` pelo MESMO caminho da van:
 * a trava otimista (`.eq('lock_version', versao)` + `.select('id')`; 0 linha = `stale_route`). Estes
 * vetores provam o payload e a trava no nível da TELA (Supabase falsificado), não só o callback.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import DispatchScreen from '@/app/(tabs)/dispatch';
import { supabase } from '@/lib/supabase';

const mockParadas = ['Luna', 'Max'].map((nome, indice) => ({
  dog_id: nome, sequence: indice + 1, status: 'pending', priority: 'normal',
  pickup_pin: null, pickup_pin_position: null, dropoff_pin: null, dropoff_pin_position: null, dropoff_sequence: null,
  window_start: null, window_end: null, exact_time: null,
  dog: { id: nome, name: nome, client: { name: 'Sarah', latitude: 37.8, longitude: -122.4 } },
}));

let mockVersao = 4;
/** O que o app tentou gravar em `routes` (payload + args do `.eq`). */
let mockUpdates: Record<string, unknown>[] = [];
let mockEqs: unknown[][] = [];

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'gestor' } } })) },
    from: jest.fn((tabela: string) => {
      let selecao = '';
      const consulta: Record<string, any> = {};
      consulta.update = (valores: Record<string, unknown>) => {
        if (tabela === 'routes') mockUpdates.push(valores);
        return consulta;
      };
      for (const metodo of ['select', 'eq', 'in', 'gte', 'lte', 'limit', 'order', 'delete', 'single']) {
        consulta[metodo] = (...args: unknown[]) => {
          if (metodo === 'eq' && tabela === 'routes') mockEqs.push(args);
          if (metodo === 'select') selecao = args[0] as string;
          return consulta;
        };
      }
      consulta.then = (resolver: (valor: unknown) => unknown) => Promise.resolve({
        data: tabela === 'organization_members'
          ? selecao === 'organization_id' ? [{ organization_id: 'clube' }]
            : [{ user_id: 'motorista', role: 'driver', profiles: { full_name: 'Rafael' } }]
          : tabela === 'routes' ? [{
            id: 'rota', phase: 'pickup', driver_id: 'motorista', status: 'draft', lock_version: mockVersao,
            start_location_id: 'v1', end_location_id: 'ya', route_stops: mockParadas,
          }]
          : tabela === 'organization_locations' ? [
            { id: 'v1', name: 'Van 1', kind: 'van', is_default: true, latitude: 37.45, longitude: -122.12 },
            { id: 'ya', name: 'Main Yard', kind: 'yard', is_default: true, latitude: 37.36, longitude: -121.95 },
            { id: 'yb', name: 'North Yard', kind: 'yard', is_default: false, latitude: 37.4, longitude: -121.9 },
          ] : [], error: null,
      }).then(resolver);
      return consulta;
    }),
    rpc: jest.fn(),
    channel: () => { const canal = { on: () => canal, subscribe: () => canal }; return canal; },
    removeChannel: jest.fn(),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockVersao = 4;
  mockUpdates = [];
  mockEqs = [];
  (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: null });
});

it('tocar no yard grava routes.end_location_id com a trava de versão', async () => {
  const tela = await render(<DispatchScreen />);
  // O seletor de yard só existe com 2+ yards: o radio ativo é o `end_location_id` da rota ('ya').
  const outro = await tela.findByLabelText('Use North Yard for Rafael');
  await act(async () => { fireEvent.press(outro); });

  await waitFor(() => expect(mockUpdates).toHaveLength(1));
  expect(mockUpdates[0]).toMatchObject({ end_location_id: 'yb', lock_version: mockVersao + 1 });
  // A trava otimista: o update filtra por `lock_version` (mesmo caminho da van).
  expect(mockEqs).toEqual(expect.arrayContaining([['id', 'rota'], ['lock_version', mockVersao]]));
});
