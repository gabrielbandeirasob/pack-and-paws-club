/**
 * A aba "Assigned today" do motorista: UMA linha por CÃO, mesmo com as duas pernas publicadas.
 *
 * Medido na org e2e em 16/10/2026: duas rotas publicadas para o mesmo motorista no mesmo dia
 * (`phase='pickup'` e `phase='dropoff'`), cada uma com a parada dos MESMOS 2 cães. A tela somava as
 * paradas das duas rotas e mostrava **"4 dogs · 2 done"**, com o cão aparecendo duas vezes e com
 * status contraditório (`AUDIT 1 Pending` na perna de busca e `AUDIT 1 Done` na de entrega).
 */
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return { useFocusEffect: (cb: () => void) => useEffect(cb, [cb]), useRouter: () => ({ push: jest.fn() }) };
});

import { render, waitFor } from '@testing-library/react-native';

import DriverAssignedScreen from '@/app/(tabs)/assigned';
import { statusDoCao, umCaoPorLinha } from '@/features/driver/assignedDogs';

/** Duas rotas do dia (busca + entrega) com os MESMOS dois cães — o estado real observado. */
const ROTAS = [
  {
    id: 'rota-entrega',
    route_stops: [
      { id: 'p1-drop', sequence: 1, dropoff_sequence: 1, status: 'pending', dog: { id: 'cao-1', name: 'AUDIT 1', client: { name: 'Parent', address_line_1: '1 Market St', city: 'San Francisco' } } },
      { id: 'p2-drop', sequence: 2, dropoff_sequence: 2, status: 'skipped', dog: { id: 'cao-2', name: 'AUDIT 2', client: { name: 'Parent', address_line_1: '1 Market St', city: 'San Francisco' } } },
    ],
  },
  {
    id: 'rota-busca',
    route_stops: [
      { id: 'p1-pick', sequence: 1, dropoff_sequence: 1, status: 'completed', dog: { id: 'cao-1', name: 'AUDIT 1', client: { name: 'Parent', address_line_1: '1 Market St', city: 'San Francisco' } } },
      { id: 'p2-pick', sequence: 2, dropoff_sequence: 2, status: 'completed', dog: { id: 'cao-2', name: 'AUDIT 2', client: { name: 'Parent', address_line_1: '1 Market St', city: 'San Francisco' } } },
    ],
  },
];

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'motorista' } } })) },
    from: jest.fn(() => {
      const consulta: Record<string, any> = {};
      for (const metodo of ['select', 'eq', 'order', 'limit', 'in']) {
        consulta[metodo] = () => consulta;
      }
      consulta.then = (resolver: (valor: unknown) => unknown) =>
        Promise.resolve({ data: (globalThis as any).__rotasDoTeste ?? [], error: null }).then(resolver);
      return consulta;
    }),
  },
}));

describe('umCaoPorLinha — a regra pura', () => {
  it('junta as duas pernas numa linha por cão, na posição da primeira parada', () => {
    const linha = umCaoPorLinha([
      { id: 'a', status: 'completed', dogId: 'rex' },
      { id: 'b', status: 'pending', dogId: 'luna' },
      { id: 'c', status: 'pending', dogId: 'rex' },
    ]);
    expect(linha.map((parada) => parada.id)).toEqual(['a', 'b']);
    expect(linha.map((parada) => parada.dogId)).toEqual(['rex', 'luna']);
  });

  it('mostra o estado que ainda FALTA cumprir: pendente vence concluída; pulada vence concluída', () => {
    expect(statusDoCao(['completed', 'pending'])).toBe('pending');
    expect(statusDoCao(['completed', 'skipped'])).toBe('skipped');
    expect(statusDoCao(['completed', 'completed'])).toBe('completed');
    expect(statusDoCao(['arrived', 'picked_up'])).toBe('arrived');
  });

  it('parada sem vínculo de cão não some e não se mistura com outra', () => {
    const linha = umCaoPorLinha([
      { id: 'sem-dono-1', status: 'pending', dogId: null },
      { id: 'sem-dono-2', status: 'pending', dogId: null },
      { id: 'com-dono', status: 'pending', dogId: 'rex' },
    ]);
    expect(linha).toHaveLength(3);
  });
});

describe('Assigned today — a tela', () => {
  it('mostra 2 cães (não 4) quando a busca e a entrega estão publicadas para os mesmos cães', async () => {
    (globalThis as any).__rotasDoTeste = ROTAS;
    const tela = await render(<DriverAssignedScreen />);
    await waitFor(() => expect(tela.getByText(/dogs/)).toBeTruthy());

    // O contador conta CÃES, não paradas: 2 cães, 0 concluídos (um pendente e um pulado).
    expect(tela.getByText('2 dogs')).toBeTruthy();
    expect(tela.queryByText(/4 dogs/)).toBeNull();

    // Cada cão aparece UMA vez — antes o mesmo nome vinha duas vezes na lista.
    expect(tela.getAllByText(/AUDIT 1/)).toHaveLength(1);
    expect(tela.getAllByText(/AUDIT 2/)).toHaveLength(1);

    // E o estado é o que falta cumprir, não o da última perna lida.
    expect(tela.getByText('Pending')).toBeTruthy();
    expect(tela.queryByText('Done')).toBeNull();
  });

  it('com o dia inteiro concluído nas duas pernas, todos contam como Done', async () => {
    (globalThis as any).__rotasDoTeste = ROTAS.map((rota) => ({
      ...rota,
      route_stops: rota.route_stops.map((parada) => ({ ...parada, status: 'completed' })),
    }));
    const tela = await render(<DriverAssignedScreen />);
    await waitFor(() => expect(tela.getByText('2 dogs · 2 done')).toBeTruthy());
    expect(tela.getAllByText('Done')).toHaveLength(2);
  });
});
