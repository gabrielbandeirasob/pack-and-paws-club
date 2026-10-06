// Pedido do cliente (04/10/2026): calendário e Dispatch identificam apenas o cão; as asserções permanecem.
// A tela do Dispatch usa `useFocusEffect` (as vans são relidas ao voltar para ela): sem
// NavigationContainer o hook do expo-router quebra — mesmo mock das outras telas de teste do projeto.
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return { useFocusEffect: (cb: () => void) => useEffect(cb, [cb]), useRouter: () => ({ push: jest.fn() }) };
});

import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { Alert } from 'react-native';
import DispatchScreen from '@/app/(tabs)/dispatch';
import { supabase } from '@/lib/supabase';

const mockParadas = ['Luna', 'Max', 'Filó'].map((nome, indice) => ({
  dog_id: nome, sequence: indice + 1, status: 'pending', priority: 'normal',
  window_start: null, window_end: null, exact_time: null,
  dog: { id: nome, name: nome, client: { name: 'Sarah', latitude: 37.8, longitude: -122.4 } },
}));
let mockVersao = 4;
let mockOrdem = mockParadas;
const mockEventos: Record<string, () => void> = {};
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'gestor' } } })) },
    from: jest.fn((tabela: string) => {
      let selecao = '';
      const consulta: Record<string, any> = {};
      for (const metodo of ['select', 'eq', 'in', 'gte', 'lte', 'limit', 'order', 'update', 'delete', 'single']) {
        consulta[metodo] = (...args: unknown[]) => {
          if (metodo === 'select') selecao = args[0] as string;
          return consulta;
        };
      }
      consulta.then = (resolver: (valor: unknown) => unknown) => Promise.resolve({
        data: tabela === 'organization_members'
          ? selecao === 'organization_id' ? [{ organization_id: 'clube' }]
            : [{ user_id: 'motorista', role: 'driver', profiles: { full_name: 'Rafael' } }]
          : tabela === 'routes' ? [{
            id: 'rota', phase: 'pickup', driver_id: 'motorista', status: 'draft', lock_version: mockVersao, route_stops: mockOrdem,
          }, { id: 'entrega', phase: 'dropoff', driver_id: 'motorista', status: 'draft', lock_version: 9, route_stops: ['Rex', 'Bolt'].map((name, i) => ({ ...mockParadas[0], dog_id: name, sequence: i + 1, dog: { ...mockParadas[0].dog, name } })) }] : tabela === 'dogs' ? [{ id: 'extra', name: 'Milo', client: { id: 'client-extra', name: 'Taylor' } }] : [], error: null,
      }).then(resolver);
      return consulta;
    }),
    rpc: jest.fn(),
    channel: () => {
      const canal = {
        on: (_tipo: string, filtro: { table: string }, callback: () => void) => {
          mockEventos[filtro.table] = callback;
          return canal;
        },
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: jest.fn(),
  },
}));

jest.mock('@/features/dispatch/trafficProvider', () => ({ fetchTravelTimes: jest.fn(async () => ({ travel: null, source: 'estimated' })) }));

const rpc = supabase.rpc as jest.Mock;
let confirmar: ((valor: { data: null; error: { message: string } | null }) => void)[];
beforeEach(() => {
  jest.clearAllMocks();
  mockOrdem = mockParadas;
  mockVersao = 4;
  confirmar = [];
  rpc.mockImplementation(() => new Promise((resolve) => confirmar.push(resolve)));
});


// Pedido do dono (04/10): a perna selecionada governa lista e escrita.
it('Drop-offs mostra só entrega e reordena a rota de entrega', async () => {
  const tela = await render(<DispatchScreen />);
  await tela.findByTestId('dispatch-leg-pickup-motorista');
  expect(tela.queryByTestId('dispatch-leg-dropoff-motorista')).toBeNull();
  await fireEvent.press(tela.getByRole('button', { name: 'Drop-offs' }));
  expect(tela.queryByTestId('dispatch-leg-pickup-motorista')).toBeNull();
  const entrega = within(tela.getByTestId('dispatch-leg-dropoff-motorista'));
  expect(entrega.getByText('Rex')).toBeTruthy();
  expect(entrega.queryByText('Luna')).toBeNull();
  // DONO (05/10/2026): a entrega PASSOU a publicar — é o que faz a ordem dela chegar ao motorista
  // (antes ficava presa no rascunho e ele via a ordem da perna de pick-up). O botão FALSO `Draft only`
  // continua fora: ele só repetia o estado.
  expect(tela.queryByText('Draft only')).toBeNull();
  expect(tela.getByLabelText('Publish Rafael route')).toBeTruthy();
  expect(tela.getByText('Publish route')).toBeTruthy();
  await fireEvent(entrega.getByTestId('reorder-dropoff-Rex'), 'accessibilityAction', { nativeEvent: { actionName: 'moveDown' } });
  expect(rpc).toHaveBeenCalledWith('apply_route_order', {
    p_route_id: 'entrega', p_pickup_ids: null, p_dropoff_ids: ['Bolt', 'Rex'], p_esperado: 9,
  });
  await act(async () => confirmar[0]({ data: null, error: null }));
  await fireEvent.press(tela.getByRole('button', { name: 'Pick-ups' }));
  expect(tela.queryByTestId('dispatch-leg-dropoff-motorista')).toBeNull();
  expect(within(tela.getByTestId('dispatch-leg-pickup-motorista')).getAllByText(/^(Luna|Max|Filó)$/).map(n => n.props.children)).toEqual(['Luna', 'Max', 'Filó']);
});

it('Optimize e Publish usam o ID da perna selecionada, com cães distintos', async () => {
  const tela = await render(<DispatchScreen />);
  await tela.findByTestId('dispatch-leg-pickup-motorista');
  await fireEvent.press(tela.getByLabelText('Publish Rafael route'));
  expect(rpc).toHaveBeenCalledWith('publish_route', { p_route_id: 'rota', p_esperado: 4 });
  await act(async () => confirmar[0]({ data: null, error: null }));
  await fireEvent.press(tela.getByLabelText('Drop-offs'));
  // DONO (05/10/2026): a entrega publica, e a RPC leva o ID DA PERNA DELA (`entrega`, versão 9) — não o
  // da pick-up. Era essa publicação que faltava para a ordem da entrega valer no motorista.
  await fireEvent.press(tela.getByLabelText('Publish Rafael route'));
  expect(rpc).toHaveBeenLastCalledWith('publish_route', { p_route_id: 'entrega', p_esperado: 9 });
  expect(rpc).toHaveBeenCalledTimes(2);
  await act(async () => confirmar[1]({ data: null, error: null }));
  await fireEvent.press(tela.getByLabelText('Optimize Rafael route'));
  /**
   * O Optimize trabalha SÓ na perna selecionada, com os cães DELA: a rota que vai para a RPC é a de
   * entrega (`entrega`) e as paradas são Rex e Bolt — nenhum cão da busca (Luna) entra. Até 05/10/2026
   * isso era provado pelo TEXTO do alerta; agora a ordem é aplicada direto (e o Undo existe), então a
   * prova é o que a RPC recebe.
   */
  await waitFor(() => expect(rpc).toHaveBeenLastCalledWith('apply_route_order', {
    p_route_id: 'entrega', p_pickup_ids: null, p_dropoff_ids: ['Rex', 'Bolt'], p_esperado: 9,
  }));
  const ultima = (rpc as jest.Mock).mock.calls.at(-1)?.[1] as { p_dropoff_ids: string[] };
  expect(ultima.p_dropoff_ids).not.toContain('Luna');
  await act(async () => confirmar[1]({ data: null, error: null }));
});


it('Add any dog inclui apenas na fila da perna escolhida', async () => {
  const tela = await render(<DispatchScreen />);
  await tela.findByTestId('dispatch-leg-pickup-motorista');
  await fireEvent.press(tela.getByLabelText('Drop-offs'));
  await fireEvent.press(tela.getByLabelText('Add any dog'));
  await fireEvent.press(tela.getByLabelText('Select dog'));
  await fireEvent.press(tela.getByLabelText('Select Milo of Taylor'));
  expect(tela.getByLabelText('Assign Milo')).toBeTruthy();
  await fireEvent.press(tela.getByLabelText('Pick-ups'));
  expect(tela.queryByLabelText('Assign Milo')).toBeNull();
  await fireEvent.press(tela.getByLabelText('Drop-offs'));
  expect(tela.getByLabelText('Assign Milo')).toBeTruthy();
  expect(rpc).not.toHaveBeenCalled();
});
