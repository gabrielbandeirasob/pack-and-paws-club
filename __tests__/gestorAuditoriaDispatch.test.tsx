// A tela do Dispatch usa `useFocusEffect`: mesmo mock das outras telas de teste do projeto.
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return { useFocusEffect: (cb: () => void) => useEffect(cb, [cb]), useRouter: () => ({ push: jest.fn() }) };
});

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import DispatchScreen from '@/app/(tabs)/dispatch';
import { addDaysISO, todayLocalISO } from '@/features/calendar/dates';
import { optimizeRoute } from '@/features/dispatch/routeOptimizer';
import { supabase } from '@/lib/supabase';

jest.mock('@/features/dispatch/trafficProvider', () => ({
  fetchTravelTimes: jest.fn(async () => ({ travel: null, source: 'estimated' })),
}));

/** Otimizador REAL com espião: prova COM QUE PARADAS a tela chamou cada perna. */
jest.mock('@/features/dispatch/routeOptimizer', () => {
  const real = jest.requireActual('@/features/dispatch/routeOptimizer');
  return { ...real, optimizeRoute: jest.fn(real.optimizeRoute) };
});
const optimizeRouteEspiao = optimizeRoute as unknown as jest.Mock;

const COORD = { latitude: 37.8, longitude: -122.4 };

/** Uma parada de rota como o banco devolve. Sem coordenada quando `coords` é null. */
function mockParada(nome: string, coords: { latitude: number; longitude: number } | null, status = 'pending') {
  return {
    dog_id: nome, sequence: 1, status, priority: 'normal',
    pickup_pin: null as 'first' | 'last' | 'fixed' | null, pickup_pin_position: null as number | null,
    dropoff_pin: null as 'first' | 'last' | 'fixed' | null, dropoff_pin_position: null as number | null, dropoff_sequence: null,
    window_start: null, window_end: null, exact_time: null,
    dog: { id: nome, name: nome, client: { name: 'Sarah', latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null } },
  };
}

let mockVersao = 4;
let mockOrdem = [mockParada('Luna', COORD), mockParada('Max', COORD), mockParada('Filó', COORD)];
const mockRegistro: Record<string, [string, ...unknown[]][]> = {};
const mockFiltrosCanal: { table: string; filter?: string }[] = [];
const mockEventos: Record<string, () => void> = {};
let mockLinhasRemovidas: { id: string }[] = [];

function mockDados(tabela: string, selecao: string): unknown {
  if (tabela === 'organization_members') {
    return selecao === 'organization_id'
      ? [{ organization_id: 'clube' }]
      : [{ user_id: 'motorista', role: 'driver', profiles: { full_name: 'Rafael' } }];
  }
  if (tabela === 'routes') return [{ id: 'rota', driver_id: 'motorista', status: 'draft', lock_version: mockVersao, route_stops: mockOrdem }];
  if (tabela === 'route_stops' && selecao === 'id') return mockLinhasRemovidas;
  return [];
}

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'gestor' } } })) },
    from: jest.fn((tabela: string) => {
      let selecao = '';
      const consulta: Record<string, any> = {};
      for (const metodo of ['select', 'eq', 'in', 'gte', 'lte', 'limit', 'order', 'update', 'delete', 'single']) {
        consulta[metodo] = (...args: unknown[]) => {
          if (metodo === 'select') selecao = args[0] as string;
          (mockRegistro[tabela] = mockRegistro[tabela] ?? []).push([metodo, ...args]);
          return consulta;
        };
      }
      consulta.then = (resolver: (valor: unknown) => unknown) =>
        Promise.resolve({ data: mockDados(tabela, selecao), error: null }).then(resolver);
      return consulta;
    }),
    rpc: jest.fn(),
    channel: () => {
      const canal = {
        on: (_tipo: string, filtro: { table: string; filter?: string }, callback: () => void) => {
          mockFiltrosCanal.push({ table: filtro.table, filter: filtro.filter });
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

beforeEach(() => {
  jest.clearAllMocks();
  mockVersao = 4;
  mockOrdem = [mockParada('Luna', COORD), mockParada('Max', COORD), mockParada('Filó', COORD)];
  mockLinhasRemovidas = [];
  for (const chave of Object.keys(mockRegistro)) delete mockRegistro[chave];
  mockFiltrosCanal.length = 0;
  rpc.mockResolvedValue({ data: null, error: null });
});

async function montar() {
  const tela = await render(<DispatchScreen />);
  await waitFor(() => expect(tela.getByRole('button', { name: 'Optimize Rafael route' })).toBeTruthy());
  return tela;
}

function titulosDeAlerta(alerta: jest.SpyInstance) {
  return alerta.mock.calls.map((chamada) => chamada[0]);
}

describe('M1 — Dispatch lê reservas/exceções com janela de data', () => {
  it('aplica gte/lte (−30 / +180) nas consultas do dia', async () => {
    await montar();
    const hoje = todayLocalISO();
    const de = addDaysISO(hoje, -30);
    const ate = addDaysISO(hoje, 180);
    expect(mockRegistro.reservations).toEqual(expect.arrayContaining([['gte', 'end_date', de], ['lte', 'start_date', ate]]));
    expect(mockRegistro.recurring_exceptions).toEqual(expect.arrayContaining([['gte', 'end_date', de], ['lte', 'start_date', ate]]));
  });
});

describe('B3 — realtime do Dispatch filtra por organização', () => {
  it('route_stops e routes recebem filter organization_id=eq.<org>', async () => {
    await montar();
    expect(mockFiltrosCanal.find((f) => f.table === 'route_stops')?.filter).toBe('organization_id=eq.clube');
    expect(mockFiltrosCanal.find((f) => f.table === 'routes')?.filter).toBe('organization_id=eq.clube');
  });
});

describe('B4 — Optimize não quebra por cão já resolvido sem endereço', () => {
  it('a perna da ENTREGA recebe só as paradas elegíveis (sem a concluída)', async () => {
    mockOrdem = [mockParada('Luna', COORD), mockParada('Max', null, 'completed'), mockParada('Filó', COORD)];
    const alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    try {
      const tela = await montar();
      await fireEvent.press(tela.getByRole('button', { name: 'Optimize Rafael route' }));
      await fireEvent.press(tela.getByLabelText('Drop-offs'));
      await fireEvent.press(tela.getByLabelText('Optimize Rafael route'));
      expect(optimizeRouteEspiao).toHaveBeenCalledTimes(2);
      const caesBusca = optimizeRouteEspiao.mock.calls[0][0].map((s: { dogId: string }) => s.dogId);
      const caesEntrega = optimizeRouteEspiao.mock.calls[1][0].map((s: { dogId: string }) => s.dogId);
      expect(caesBusca).not.toContain('Max');
      expect(caesEntrega).not.toContain('Max');
      expect(titulosDeAlerta(alerta)).not.toContain('Cannot optimize this route');
    } finally {
      alerta.mockRestore();
    }
  });

  it('com uma só parada pendente, avisa "Nothing to optimize" em vez de voltar mudo', async () => {
    mockOrdem = [mockParada('Luna', COORD), mockParada('Max', COORD, 'completed'), mockParada('Filó', COORD, 'skipped')];
    const alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    try {
      const tela = await montar();
      await fireEvent.press(tela.getByRole('button', { name: 'Optimize Rafael route' }));
      expect(titulosDeAlerta(alerta)).toContain('Nothing to optimize');
      expect(optimizeRouteEspiao).not.toHaveBeenCalled();
    } finally {
      alerta.mockRestore();
    }
  });
});

describe('B5 — remover parada confere a linha', () => {
  async function remover(tela: Awaited<ReturnType<typeof montar>>, alerta: jest.SpyInstance) {
    await fireEvent.press(tela.getByRole('button', { name: 'Options for Luna' }));
    await fireEvent.press(tela.getByRole('button', { name: 'Remove from route' }));
    const confirmacao = alerta.mock.calls.find((chamada) => chamada[0] === 'Remove stop');
    const botoes = (confirmacao?.[2] ?? []) as { text: string; onPress?: () => void }[];
    await act(async () => { botoes.find((botao) => botao.text === 'Remove')?.onPress?.(); });
  }

  it('0 linha removida = avisa e não finge que removeu', async () => {
    mockLinhasRemovidas = [];
    const alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    try {
      const tela = await montar();
      await remover(tela, alerta);
      expect(titulosDeAlerta(alerta)).toContain('Unable to remove this stop');
    } finally {
      alerta.mockRestore();
    }
  });

  it('1 linha removida = segue sem aviso', async () => {
    mockLinhasRemovidas = [{ id: 'stop-1' }];
    const alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    try {
      const tela = await montar();
      await remover(tela, alerta);
      expect(titulosDeAlerta(alerta)).not.toContain('Unable to remove this stop');
    } finally {
      alerta.mockRestore();
    }
  });
});
