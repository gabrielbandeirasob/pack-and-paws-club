// Trava de versão: publicar NÃO pode virar "outro aparelho mexeu" (dono, 05/10/2026).
// No banco: 3 publicações em 9 s (route_versions v10/v11/v12 em 14:28). O botão Publish não fica
// desabilitado durante a escrita, então um 2º toque chega ANTES de a recarga trazer a versão nova.
// Sem sincronizar a nossa cópia, o RPC recusava com `stale_route` e o modal "Route changed on another
// device" aparecia — alarme FALSO, porque quem mexeu na rota fomos nós mesmos.
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() };
  return { useFocusEffect: (cb: () => void) => useEffect(cb, []), useRouter: () => router };
});

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import DispatchScreen from '@/app/(tabs)/dispatch';
import { supabase } from '@/lib/supabase';

const mockRota = {
  id: 'rota', phase: 'pickup', driver_id: 'motorista', status: 'draft', lock_version: 4, published_at: null,
  route_stops: ['Luna', 'Max'].map((nome, i) => ({
    dog_id: `dog-${i}`, sequence: i + 1, status: 'pending', priority: 'normal',
    pickup_pin: null, pickup_pin_position: null, dropoff_pin: null, dropoff_pin_position: null,
    dropoff_sequence: null, window_start: null, window_end: null, exact_time: null,
    pickup_proof_path: null, dropoff_proof_path: null, travel_seconds: null, dropoff_travel_seconds: null,
    dog: { id: `dog-${i}`, name: nome, client: { id: 'cli', name: 'Sarah', latitude: 37.8, longitude: -122.4 } },
  })),
};
let versaoNoBanco = 4;
let mockLeiturasDeRotas = 0;

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'gestor' } } })) },
    from: jest.fn((tabela: string) => {
      let selecao = '';
      const consulta: Record<string, any> = {};
      for (const metodo of ['select', 'eq', 'in', 'gte', 'lte', 'limit', 'order', 'update', 'delete', 'single']) {
        consulta[metodo] = (...args: unknown[]) => { if (metodo === 'select') selecao = args[0] as string; return consulta; };
      }
      consulta.then = async (resolver: (valor: unknown) => unknown) => {
        if (tabela === 'routes') {
          mockLeiturasDeRotas += 1;
          // A recarga que vem DEPOIS da publicação fica pendurada: é a janela em que o gestor toca de novo.
          if (mockLeiturasDeRotas > 1) return new Promise(() => {});
        }
        const data = tabela === 'organization_members'
          ? selecao === 'organization_id' ? [{ organization_id: 'clube' }]
            : [{ user_id: 'motorista', role: 'driver', profiles: { full_name: 'Rafael' } }]
          : tabela === 'routes' ? [mockRota]
            : [];
        return resolver({ data, error: null });
      };
      return consulta;
    }),
    rpc: jest.fn(),
    channel: () => { const c = { on: () => c, subscribe: () => c }; return c; },
    removeChannel: jest.fn(),
  },
}));

const rpc = supabase.rpc as jest.Mock;
beforeEach(() => {
  jest.clearAllMocks();
  versaoNoBanco = 4;
  mockLeiturasDeRotas = 0;
  // O banco de verdade: recusa quando `p_esperado` não bate com a versão de agora; senão grava (+1).
  rpc.mockImplementation(async (nome: string, args: { p_esperado: number | null }) => {
    if (nome !== 'publish_route') return { data: null, error: null };
    if (args.p_esperado !== null && args.p_esperado !== versaoNoBanco) return { data: null, error: { message: 'stale_route' } };
    versaoNoBanco += 1;
    return { data: null, error: null };
  });
});

it('dois toques seguidos em Publish não viram "Route changed on another device"', async () => {
  const tela = await render(<DispatchScreen />);
  await tela.findByLabelText('Publish Rafael route');

  await fireEvent.press(tela.getByLabelText('Publish Rafael route'));
  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
  await fireEvent.press(tela.getByLabelText('Publish Rafael route'));
  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));

  // A nossa cópia da versão acompanhou a gravação (4 → 5) em vez de repetir a versão velha.
  expect(rpc.mock.calls[0][1].p_esperado).toBe(4);
  expect(rpc.mock.calls[1][1].p_esperado).toBe(5);
  expect(rpc.mock.calls.every((chamada) => chamada[0] === 'publish_route')).toBe(true);
  // E o alarme falso NÃO aparece.
  expect(tela.queryByText('Route changed on another device')).toBeNull();
});
