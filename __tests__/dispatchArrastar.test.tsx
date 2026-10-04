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
  dog: { id: nome, name: nome, client: { name: 'Sarah', latitude: null, longitude: null } },
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
            id: 'rota', driver_id: 'motorista', status: 'draft', lock_version: mockVersao, route_stops: mockOrdem,
          }] : [], error: null,
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

const rpc = supabase.rpc as jest.Mock;
let confirmar: ((valor: { data: null; error: { message: string } | null }) => void)[];
beforeEach(() => {
  jest.clearAllMocks();
  mockOrdem = mockParadas;
  mockVersao = 4;
  confirmar = [];
  rpc.mockImplementation(() => new Promise((resolve) => confirmar.push(resolve)));
});

function touch(y: number, time: number) {
  return { nativeEvent: { touches: [{}] }, touchHistory: {
    numberActiveTouches: 1, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: time,
    touchBank: [{ touchActive: true, startPageX: 0, startPageY: 0,
      currentPageX: 0, currentPageY: y, previousPageX: 0, previousPageY: 0,
      currentTimeStamp: time, previousTimeStamp: 0 }],
  } };
}
// Pedido do cliente: arrastar substitui as setas, pela mesma fila serializada.
it('o gesto leva o primeiro ao fim e o último ao início sem tocar no cão seguinte', async () => {
  const tela = await render(<DispatchScreen />);
  const handle = await tela.findByTestId('drag-pickup-Luna');
  for (const dog of ['Luna', 'Max', 'Filó']) {
    await fireEvent(tela.getByTestId(`reorder-layout-pickup-${dog}`), 'layout', { nativeEvent: { layout: { height: 80 } } });
  }
  await fireEvent(handle, 'responderGrant', touch(0, 1));
  await fireEvent(handle, 'responderMove', touch(1000, 2));
  await fireEvent(handle, 'responderRelease', touch(1000, 2));
  expect(rpc).toHaveBeenCalledWith('reorder_route_stops', {
    p_route_id: 'rota', p_dog_ids: ['Max', 'Filó', 'Luna'], p_esperado: 4,
  });
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(tela.queryByLabelText('Move Luna up')).toBeNull();
  await fireEvent(tela.getByTestId('drag-pickup-Luna'), 'responderGrant', touch(0, 1));
  await fireEvent(tela.getByTestId('drag-pickup-Luna'), 'responderMove', touch(-1000, 3));
  await fireEvent(tela.getByTestId('drag-pickup-Luna'), 'responderRelease', touch(-1000, 3));
  await act(async () => confirmar[0]({ data: null, error: null }));
  expect(rpc).toHaveBeenLastCalledWith('reorder_route_stops', {
    p_route_id: 'rota', p_dog_ids: ['Luna', 'Max', 'Filó'], p_esperado: 5,
  });
  await act(async () => confirmar[1]({ data: null, error: null }));
});

it('VoiceOver moveDown muda só a ordem e respeita os extremos', async () => {
  const tela = await render(<DispatchScreen />);
  const row = await tela.findByTestId('reorder-pickup-Luna');
  expect(row.props.accessibilityLabel).toBe('Luna');
  await fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'moveUp' } });
  expect(rpc).not.toHaveBeenCalled();
  await fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'moveDown' } });
  expect(rpc).toHaveBeenCalledWith('reorder_route_stops', {
    p_route_id: 'rota', p_dog_ids: ['Max', 'Luna', 'Filó'], p_esperado: 4,
  });
  await fireEvent(tela.getByTestId('reorder-pickup-Filó'), 'accessibilityAction', { nativeEvent: { actionName: 'moveDown' } });
  expect(rpc).toHaveBeenCalledTimes(1);
  await act(async () => confirmar[0]({ data: null, error: null }));
});


it('cancelar o gesto não grava nem muda a ordem', async () => {
  const tela = await render(<DispatchScreen />);
  const handle = await tela.findByTestId('drag-pickup-Luna');
  await fireEvent(handle, 'responderGrant', touch(0, 1));
  await fireEvent(handle, 'responderMove', touch(1000, 2));
  await fireEvent(handle, 'responderTerminate', touch(1000, 3));
  expect(rpc).not.toHaveBeenCalled();
  expect(within(tela.getByTestId('dispatch-leg-pickup-motorista')).getAllByText(/^(Luna|Max|Filó)$/).map(n => n.props.children)).toEqual(['Luna', 'Max', 'Filó']);
});
