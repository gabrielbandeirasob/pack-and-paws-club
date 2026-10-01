import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import DispatchScreen from '@/app/(tabs)/dispatch';
import { optimizeRoute } from '@/features/dispatch/routeOptimizer';
import { fetchTravelTimes } from '@/features/dispatch/trafficProvider';
import { supabase } from '@/lib/supabase';

jest.mock('@/features/dispatch/trafficProvider', () => ({
  fetchTravelTimes: jest.fn(async () => ({ travel: null, source: 'estimated' })),
}));

/**
 * Otimizador com espião: o comportamento é o REAL (a ordem continua sendo calculada de verdade) e o
 * teste consegue provar COM QUE OPÇÕES a tela chamou — é assim que se trava o "3 min por pick-up"
 * (pedido do cliente, 30/09/2026), que antes ficava no padrão de 8 min.
 */
jest.mock('@/features/dispatch/routeOptimizer', () => {
  const real = jest.requireActual('@/features/dispatch/routeOptimizer');
  return { ...real, optimizeRoute: jest.fn(real.optimizeRoute) };
});

const optimizeRouteEspiao = optimizeRoute as unknown as jest.Mock;

const mockParadas = ['Luna', 'Max', 'Filó'].map((nome, indice) => ({
  dog_id: nome, sequence: indice + 1, status: 'pending', priority: 'normal',
  pickup_pin: null as 'first' | 'last' | 'fixed' | null, pickup_pin_position: null as number | null,
  dropoff_pin: null as 'first' | 'last' | 'fixed' | null, dropoff_pin_position: null as number | null, dropoff_sequence: 3 - indice,
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
      for (const metodo of ['select', 'eq', 'in', 'limit', 'order', 'update', 'delete', 'single']) {
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
async function montar() {
  const tela = await render(<DispatchScreen />);
  await waitFor(() => expect(tela.getByRole('button', { name: 'Move Max up' })).toBeTruthy());
  return tela;
}
function ordem(tela: Awaited<ReturnType<typeof montar>>) {
  return tela.getAllByText(/^Sarah · /).map((item) => item.props.children.join(''));
}
async function concluir(indice: number) {
  await act(async () => confirmar[indice]({ data: null, error: null }));
}

it('alterna as ordens sem spinner e exibe selo apenas na perna correspondente', async () => {
  mockOrdem = mockParadas.map((stop) => ({ ...stop, dropoff_pin: stop.dog_id === 'Filó' ? 'first' : null }));
  const tela = await montar();
  expect(ordem(tela)).toEqual(['Sarah · Luna', 'Sarah · Max', 'Sarah · Filó']);
  expect(tela.queryByText('🔒 1st')).toBeNull();
  const consultas = (supabase.from as jest.Mock).mock.calls.length;
  await fireEvent.press(tela.getByRole('button', { name: 'Drop-off Rafael route' }));
  expect(ordem(tela)).toEqual(['Sarah · Filó', 'Sarah · Max', 'Sarah · Luna']);
  expect(tela.getByText('🔒 1st')).toBeTruthy();
  expect(tela.queryByTestId('dispatch-loading')).toBeNull();
  expect((supabase.from as jest.Mock).mock.calls).toHaveLength(consultas);
});

it('agrupa toques da entrega, incrementa versão e mantém busca independente', async () => {
  const tela = await montar();
  await fireEvent.press(tela.getByRole('button', { name: 'Drop-off Rafael route' }));
  await fireEvent.press(tela.getByRole('button', { name: 'Move Max up' }));
  expect(ordem(tela)).toEqual(['Sarah · Max', 'Sarah · Filó', 'Sarah · Luna']);
  expect(rpc).toHaveBeenLastCalledWith('apply_route_order', {
    p_route_id: 'rota', p_pickup_ids: null, p_dropoff_ids: ['Max', 'Filó', 'Luna'], p_esperado: 4,
  });
  await fireEvent.press(tela.getByRole('button', { name: 'Move Luna up' }));
  await fireEvent.press(tela.getByRole('button', { name: 'Move Luna up' }));
  expect(rpc).toHaveBeenCalledTimes(1);
  await concluir(0);
  expect(rpc).toHaveBeenLastCalledWith('apply_route_order', {
    p_route_id: 'rota', p_pickup_ids: null, p_dropoff_ids: ['Luna', 'Max', 'Filó'], p_esperado: 5,
  });
  await concluir(1);
  await fireEvent.press(tela.getByRole('button', { name: 'Pick-up Rafael route' }));
  expect(ordem(tela)).toEqual(['Sarah · Luna', 'Sarah · Max', 'Sarah · Filó']);
  await fireEvent.press(tela.getByRole('button', { name: 'Move Max up' }));
  expect(rpc).toHaveBeenLastCalledWith('reorder_route_stops', {
    p_route_id: 'rota', p_dog_ids: ['Max', 'Luna', 'Filó'], p_esperado: 6,
  });
  await concluir(2);
  expect(tela.queryByTestId('dispatch-loading')).toBeNull();
});

it('salva somente pernas alteradas e incrementa versão a cada trava confirmada', async () => {
  const tela = await montar();
  await fireEvent.press(tela.getByRole('button', { name: 'Options for Luna' }));
  await fireEvent.press(tela.getByRole('button', { name: 'Pick-up rule Last' }));
  await fireEvent.press(tela.getByRole('button', { name: 'Drop-off rule 1st' }));
  await fireEvent.press(tela.getByRole('button', { name: 'Save stop' }));
  expect(rpc).toHaveBeenLastCalledWith('set_stop_order_pin', {
    p_route_id: 'rota', p_dog_id: 'Luna', p_leg: 'pickup', p_pin: 'last', p_pin_position: null, p_esperado: 4,
  });
  await concluir(0);
  expect(rpc).toHaveBeenLastCalledWith('set_stop_order_pin', {
    p_route_id: 'rota', p_dog_id: 'Luna', p_leg: 'dropoff', p_pin: 'first', p_pin_position: null, p_esperado: 5,
  });
  mockVersao = 6;
  mockOrdem = mockParadas.map((stop) => ({ ...stop, pickup_pin: stop.dog_id === 'Luna' ? 'last' : null, dropoff_pin: stop.dog_id === 'Luna' ? 'first' : null }));
  await concluir(1);
  expect(tela.getByText('🔒 last')).toBeTruthy();
  expect(rpc).toHaveBeenCalledTimes(2);
  await fireEvent.press(tela.getByRole('button', { name: 'Options for Luna' }));
  await fireEvent.press(tela.getByRole('button', { name: 'Save stop' }));
  expect(rpc).toHaveBeenCalledTimes(2);
  await fireEvent.press(tela.getByRole('button', { name: 'Move Max up' }));
  expect(rpc).toHaveBeenLastCalledWith('reorder_route_stops', expect.objectContaining({ p_esperado: 6 }));
  await concluir(2);
});

it('trava recusada por stale_route recarrega silenciosamente sem selo inventado', async () => {
  const alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    const tela = await montar();
    await fireEvent.press(tela.getByRole('button', { name: 'Options for Luna' }));
    await fireEvent.press(tela.getByRole('button', { name: 'Drop-off rule 1st' }));
    await fireEvent.press(tela.getByRole('button', { name: 'Save stop' }));
    expect(rpc).toHaveBeenCalledWith('set_stop_order_pin', expect.objectContaining({ p_leg: 'dropoff', p_pin: 'first', p_esperado: 4 }));
    await act(async () => confirmar[0]({ data: null, error: { message: 'stale_route' } }));
    expect(alerta).toHaveBeenCalled();
    expect(tela.queryByText('🔒 1st')).toBeNull();
    expect(tela.queryByTestId('dispatch-loading')).toBeNull();
  } finally { alerta.mockRestore(); }
});

it('Optimize mostra duas listas e conflitos, usa uma matriz e aplica numa única escrita', async () => {
  mockOrdem = mockParadas.map((stop) => ({
    ...stop, pickup_pin: stop.dog_id === 'Filó' ? 'first' : null,
    dropoff_pin: stop.dog_id !== 'Filó' ? 'first' : null,
  }));
  const alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    const tela = await montar();
    await fireEvent.press(tela.getByRole('button', { name: 'Optimize Rafael route' }));
    expect(fetchTravelTimes).toHaveBeenCalledTimes(1);
    // 3 min por pick-up nas DUAS pernas (busca e entrega) — o pedido do cliente, 30/09/2026.
    expect(optimizeRouteEspiao).toHaveBeenCalledTimes(2);
    for (const [, opcoesDaChamada] of optimizeRouteEspiao.mock.calls) {
      expect(opcoesDaChamada).toMatchObject({ serviceMinutes: 3 });
    }
    const [, mensagem, botoes] = alerta.mock.calls[0];
    expect(mensagem).toContain('Pick-up:\n• 1. Filó');
    expect(mensagem).toContain('Drop-off:\n• 1. Luna');
    expect(mensagem).toContain('Conflicting locks #1: Luna, Max');
    await act(async () => botoes?.find((botao) => botao.text === 'Apply')?.onPress?.());
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('apply_route_order', {
      p_route_id: 'rota', p_pickup_ids: ['Filó', 'Luna', 'Max'],
      p_dropoff_ids: ['Luna', 'Filó', 'Max'], p_esperado: 4,
    });
    mockVersao = 5;
    await concluir(0);
    expect(tela.queryByTestId('dispatch-loading')).toBeNull();
  } finally { alerta.mockRestore(); }
});

it('Optimize mantém concluídas na frente e relata trava incompatível', async () => {
  mockOrdem = mockParadas.map((stop) => ({ ...stop,
    status: stop.dog_id === 'Max' ? 'completed' : 'pending',
    pickup_pin: stop.dog_id === 'Luna' ? 'first' : null,
  }));
  const alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    const tela = await montar();
    await fireEvent.press(tela.getByRole('button', { name: 'Optimize Rafael route' }));
    const [, mensagem, botoes] = alerta.mock.calls[0];
    expect(mensagem).toContain('Pick-up:\n• 1. Max');
    expect(mensagem).toContain('Conflicting locks #1: Max, Luna');
    await act(async () => botoes?.find((botao) => botao.text === 'Apply')?.onPress?.());
    expect(rpc).toHaveBeenCalledWith('apply_route_order', expect.objectContaining({
      p_pickup_ids: ['Max', 'Luna', 'Filó'], p_esperado: 4,
    }));
    await concluir(0);
  } finally { alerta.mockRestore(); }
});

it('não perde intenções ao alternar perna durante uma escrita pendente', async () => {
  const tela = await montar();
  await fireEvent.press(tela.getByRole('button', { name: 'Move Max up' }));
  await fireEvent.press(tela.getByRole('button', { name: 'Drop-off Rafael route' }));
  await fireEvent.press(tela.getByRole('button', { name: 'Move Luna up' }));
  await fireEvent.press(tela.getByRole('button', { name: 'Pick-up Rafael route' }));
  await fireEvent.press(tela.getByRole('button', { name: 'Move Filó up' }));
  await concluir(0);
  expect(rpc).toHaveBeenLastCalledWith('reorder_route_stops', {
    p_route_id: 'rota', p_dog_ids: ['Max', 'Filó', 'Luna'], p_esperado: 5,
  });
  await concluir(1);
  expect(rpc).toHaveBeenLastCalledWith('apply_route_order', {
    p_route_id: 'rota', p_pickup_ids: null, p_dropoff_ids: ['Filó', 'Luna', 'Max'], p_esperado: 6,
  });
  await concluir(2);
});

it('valida posição fixa e envia o número somente em fixed', async () => {
  const tela = await montar();
  await fireEvent.press(tela.getByRole('button', { name: 'Options for Luna' }));
  await fireEvent.press(tela.getByRole('button', { name: 'Drop-off rule Position #' }));
  await fireEvent.changeText(tela.getByLabelText('Drop-off position'), '0');
  await fireEvent.press(tela.getByRole('button', { name: 'Save stop' }));
  expect(rpc).not.toHaveBeenCalled();
  expect(tela.getByText('Position must be between 1 and 99.')).toBeTruthy();
  await fireEvent.changeText(tela.getByLabelText('Drop-off position'), '2');
  await fireEvent.press(tela.getByRole('button', { name: 'Save stop' }));
  expect(rpc).toHaveBeenCalledWith('set_stop_order_pin', {
    p_route_id: 'rota', p_dog_id: 'Luna', p_leg: 'dropoff', p_pin: 'fixed', p_pin_position: 2, p_esperado: 4,
  });
  mockVersao = 5;
  mockOrdem = mockParadas.map((stop) => ({ ...stop, dropoff_pin: stop.dog_id === 'Luna' ? 'fixed' : null, dropoff_pin_position: stop.dog_id === 'Luna' ? 2 : null }));
  await concluir(0);
  await fireEvent.press(tela.getByRole('button', { name: 'Options for Luna' }));
  await fireEvent.press(tela.getByRole('button', { name: 'Drop-off rule Free' }));
  await fireEvent.press(tela.getByRole('button', { name: 'Save stop' }));
  expect(rpc).toHaveBeenLastCalledWith('set_stop_order_pin', {
    p_route_id: 'rota', p_dog_id: 'Luna', p_leg: 'dropoff', p_pin: null, p_pin_position: null, p_esperado: 5,
  });
  await concluir(1);
});
