import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
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

it('mostra a troca antes da RPC confirmar, sem desmontar o quadro nem consultar novamente', async () => {
  const tela = await montar();
  const consultas = (supabase.from as jest.Mock).mock.calls.length;
  await fireEvent.press(tela.getByRole('button', { name: 'Move Max up' }));
  expect(ordem(tela)).toEqual(['Sarah · Max', 'Sarah · Luna', 'Sarah · Filó']);
  expect(tela.getByTestId('driver-info')).toBeTruthy();
  expect(tela.queryAllByTestId("dispatch-loading")).toHaveLength(0);
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith('reorder_route_stops', {
    p_route_id: 'rota', p_dog_ids: ['Max', 'Luna', 'Filó'], p_esperado: 4,
  });
  await concluir(0);
  expect((supabase.from as jest.Mock).mock.calls).toHaveLength(consultas);
});

it('três toques respondem imediatamente e enviam apenas a última ordem após a confirmação', async () => {
  const tela = await montar();
  await fireEvent.press(tela.getByRole('button', { name: 'Move Max up' }));
  await fireEvent.press(tela.getByRole('button', { name: 'Move Filó up' }));
  await fireEvent.press(tela.getByRole('button', { name: 'Move Filó up' }));
  expect(ordem(tela)).toEqual(['Sarah · Filó', 'Sarah · Max', 'Sarah · Luna']);
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(tela.queryAllByTestId("dispatch-loading")).toHaveLength(0);
  await concluir(0);
  expect(rpc).toHaveBeenCalledTimes(2);
  expect(rpc).toHaveBeenLastCalledWith('reorder_route_stops', {
    p_route_id: 'rota', p_dog_ids: ['Filó', 'Max', 'Luna'], p_esperado: 5,
  });
  await concluir(1);
});

it('realtime preserva a ordem pendente e GPS consulta somente posições', async () => {
  const tela = await montar();
  await fireEvent.press(tela.getByRole('button', { name: 'Move Max up' }));
  jest.useFakeTimers();
  try {
    (supabase.from as jest.Mock).mockClear();
    await act(async () => {
      mockEventos.routes();
      mockEventos.route_stops();
      jest.advanceTimersByTime(700);
    });
    expect(ordem(tela)[0]).toBe('Sarah · Max');
    expect((supabase.from as jest.Mock).mock.calls).toEqual([['routes']]);
    (supabase.from as jest.Mock).mockClear();
    await act(async () => {
      mockEventos.driver_locations();
      jest.advanceTimersByTime(700);
    });
    expect((supabase.from as jest.Mock).mock.calls).toEqual([['driver_locations']]);
    expect(tela.queryAllByTestId("dispatch-loading")).toHaveLength(0);
    await concluir(0);
    await fireEvent.press(tela.getByRole('button', { name: 'Move Filó up' }));
    expect(rpc).toHaveBeenLastCalledWith('reorder_route_stops', {
      p_route_id: 'rota', p_dog_ids: ['Max', 'Filó', 'Luna'], p_esperado: 5,
    });
    await concluir(1);
  } finally {
    jest.useRealTimers();
  }
});

it('stale_route avisa e recupera a ordem do servidor silenciosamente', async () => {
  const alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    const tela = await montar();
    await fireEvent.press(tela.getByRole('button', { name: 'Move Max up' }));
    await act(async () => confirmar[0]({ data: null, error: { message: 'stale_route' } }));
    expect(alerta).toHaveBeenCalled();
    expect(ordem(tela)).toEqual(['Sarah · Luna', 'Sarah · Max', 'Sarah · Filó']);
    expect(tela.queryAllByTestId("dispatch-loading")).toHaveLength(0);
  } finally {
    alerta.mockRestore();
  }
});

/**
 * A fila de "N unassigned" vem do DIA (reservas), que é escrito pelo relógio do servidor. Ao separar
 * as recargas, o dia deixou de ser refeito a cada evento de rota — este vetor trava as duas pontas:
 * a fila continua sendo renovada, mas com janela, para não voltar a custar 7 consultas por toque.
 */
it('renova a fila do dia junto com os eventos de rota, mas no máximo a cada 2 minutos', async () => {
  const tela = await montar();
  jest.useFakeTimers();
  try {
    const tabelas = () => (supabase.from as jest.Mock).mock.calls.map((chamada: unknown[]) => chamada[0]);
    (supabase.from as jest.Mock).mockClear();
    await act(async () => {
      mockEventos.route_stops();
      jest.advanceTimersByTime(700);
    });
    expect(tabelas()).toEqual(['routes']);

    await act(async () => {
      jest.advanceTimersByTime(120_000);
      mockEventos.route_stops();
      jest.advanceTimersByTime(700);
    });
    expect(tabelas()).toContain('routes');
    expect(tabelas()).toContain('reservations');
    expect(tela.queryAllByTestId("dispatch-loading")).toHaveLength(0);
  } finally {
    jest.useRealTimers();
  }
});
