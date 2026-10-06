/**
 * DEFEITO DO DONO (05/10/2026): *"adicionei mais uns cachorros no calendário e eles não apareceram no
 * dispatch, esse erro já aconteceu outras vezes"*.
 *
 * Causa: a fila do dia (reservas) só era lida no `useEffect` da DATA. O Calendário se recarrega a cada
 * foco (`useFocusEffect`), mas o Dispatch só relia as VANS ao voltar — então cão criado no Calendário
 * ficava invisível na fila até trocar o dia ou reabrir o aplicativo. E o canal de tempo real não
 * escutava `reservations` (nem escala/exceção), só rota e van.
 *
 * Este teste é o vetor de regressão das três correções: reler o dia ao voltar para a tela, escutar a
 * reserva no tempo real e MOSTRAR o nome de quem já está na van (boarding não pode parecer "sumido").
 */
let focoCallback: (() => void) | null = null;

jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    useFocusEffect: (cb: () => void) => {
      focoCallback = cb;
      useEffect(cb, [cb]);
    },
  };
});

import { act, render, waitFor, within } from '@testing-library/react-native';
import DispatchScreen from '@/app/(tabs)/dispatch';
import { todayLocalISO } from '@/features/calendar/dates';
import { supabase } from '@/lib/supabase';

const mockHoje = todayLocalISO();

/** Cães que o "banco" devolve na fila do dia — o teste troca isto e força o foco de novo. */
let mockReservas = [{ id: 'gus', nome: 'Gus' }];
const mockConsultas: Record<string, number> = {};
const mockTabelas: string[] = [];

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'gestor' } } })) },
    from: jest.fn((tabela: string) => {
      mockConsultas[tabela] = (mockConsultas[tabela] ?? 0) + 1;
      let selecao = '';
      const consulta: Record<string, unknown> = {};
      for (const metodo of ['select', 'eq', 'in', 'gte', 'lte', 'limit', 'order', 'update', 'delete', 'single']) {
        consulta[metodo] = (...args: unknown[]) => {
          if (metodo === 'select') selecao = args[0] as string;
          return consulta;
        };
      }
      const dados = () => {
        if (tabela === 'organization_members') {
          return selecao === 'organization_id'
            ? [{ organization_id: 'clube' }]
            : [{ user_id: 'motorista', role: 'driver', profiles: { full_name: 'Rafael' } }];
        }
        if (tabela === 'reservations') {
          return mockReservas.map((cao) => ({
            id: `r-${cao.id}`, service_type: 'boarding', start_date: mockHoje, end_date: mockHoje,
            transport_required: true, goes_to_daycare: true,
            dog: { id: cao.id, name: cao.nome, client: { id: `c-${cao.id}`, name: 'Sarah', latitude: null, longitude: null } },
          }));
        }
        return [];
      };
      consulta.then = (resolver: (valor: unknown) => unknown) =>
        Promise.resolve({ data: dados(), error: null }).then(resolver);
      return consulta;
    }),
    rpc: jest.fn(),
    channel: () => {
      const canal = {
        on: (_tipo: string, filtro: { table: string }, callback: () => void) => {
          mockTabelas.push(filtro.table);
          void callback;
          return canal;
        },
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: jest.fn(),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  for (const chave of Object.keys(mockConsultas)) delete mockConsultas[chave];
  mockTabelas.length = 0;
  mockReservas = [{ id: 'gus', nome: 'Gus' }];
  focoCallback = null;
});

async function montar() {
  const tela = await render(<DispatchScreen />);
  await waitFor(() => expect(tela.getByText('Gus')).toBeTruthy());
  return tela;
}

describe('Dispatch acompanha o Calendário', () => {
  it('mostra o NOME de quem já está na van (boarding não parece sumido)', async () => {
    const tela = await montar();
    const linha = tela.getByTestId('dispatch-ja-na-van');
    // O nome aparece na própria linha recolhida — antes só havia o número.
    expect(within(linha).getByText('Gus')).toBeTruthy();
  });

  it('relê a fila do dia ao VOLTAR para a tela (cão criado no Calendário aparece)', async () => {
    const tela = await montar();
    const antes = mockConsultas.reservations ?? 0;
    expect(antes).toBeGreaterThan(0);

    // O gestor cria outro cão no Calendário e volta para o Dispatch: o foco tem de reler a fila.
    mockReservas = [...mockReservas, { id: 'mel', nome: 'Mel' }];
    await act(async () => {
      focoCallback?.();
    });

    // A linha junta os nomes num texto só (`Gus · Mel`): casa por regex.
    await waitFor(() => expect(tela.getByText(/Mel/)).toBeTruthy());
    expect(mockConsultas.reservations ?? 0).toBeGreaterThan(antes);
  });

  it('conta a mesma fila nas duas telas: o cão novo entra na seção da van', async () => {
    const tela = await montar();
    mockReservas = [
      { id: 'gus', nome: 'Gus' },
      { id: 'mel', nome: 'Mel' },
    ];
    await act(async () => {
      focoCallback?.();
    });
    const linha = await waitFor(() => tela.getByTestId('dispatch-ja-na-van'));
    expect(within(linha).getByText(/Gus/)).toBeTruthy();
    expect(within(linha).getByText(/Mel/)).toBeTruthy();
  });

  it('escuta a RESERVA no tempo real (cão criado em outro aparelho ou pelo robô do Google)', async () => {
    await montar();
    expect(mockTabelas).toContain('reservations');
    expect(mockTabelas).toContain('recurring_schedules');
    expect(mockTabelas).toContain('recurring_exceptions');
    // O que já existia continua escutado.
    expect(mockTabelas).toContain('routes');
    expect(mockTabelas).toContain('route_stops');
  });
});
