// A tela do Dispatch usa `useFocusEffect` (as vans são relidas ao voltar para ela): sem
// NavigationContainer o hook do expo-router quebra — mesmo mock das outras telas de teste do projeto.
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return { useFocusEffect: (cb: () => void) => useEffect(cb, [cb]), useRouter: () => ({ push: jest.fn() }) };
});

/**
 * UM CLIQUE PARA A MESMA CASA — teste de tela do Dispatch (áudio do dono, 29/09/2026).
 *
 * Cenário real do calendário dele: **Sam** e **Ollie**, os dois cães do cliente Jose (56 Melrose Pl),
 * mais o **Sammy** (cliente Chuck, outra casa) para provar que o vizinho não é arrastado junto.
 *
 * O que este teste trava:
 *  1. a folha de atribuição avisa que o irmão de casa vai junto ("Same house: Ollie goes to the same driver.");
 *  2. salvar manda DUAS escritas (um cão por parada — eles continuam sendo dois cães), com a versão da
 *     rota andando a cada escrita (a trava `stale_route` do banco recusaria a segunda com a versão velha);
 *  3. no fim, os dois aparecem no carro do motorista e o cão da outra casa continua na fila.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import DispatchScreen from '@/app/(tabs)/dispatch';
import { todayLocalISO } from '@/features/calendar/dates';
import { supabase } from '@/lib/supabase';

const HOJE = todayLocalISO();
const reserva = (id: string, dogId: string, dogName: string, clientId: string, clientName: string) => ({
  id, service_type: 'daycare' as const, start_date: HOJE, end_date: HOJE, transport_required: true,
  goes_to_daycare: true, dog: { id: dogId, name: dogName, client: { id: clientId, name: clientName } },
});
const mockReservas = [
  reserva('r1', 'sam', 'Sam', 'casa-jose', 'Jose'),
  reserva('r2', 'ollie', 'Ollie', 'casa-jose', 'Jose'),
  reserva('r3', 'sammy', 'Sammy', 'casa-chuck', 'Chuck'),
];

let mockParadasDaRota: unknown[] = [];
/** Status da rota que o banco devolve (o motorista JÁ na rua tem rota `published`). */
let mockStatusDaRota: 'draft' | 'published' = 'draft';
/** Toda escrita que o app tentou (tabela + método) — é assim que se prova que ele NÃO escreveu. */
const mockEscritas: Array<{ tabela: string; metodo: string; payload?: Record<string, unknown> }> = [];

/** Sedes da organização (van/yard) — o yard é o FIM da rota (pedido do cliente, 02/10/2026). */
let mockLocais: unknown[] = [];
const mockEventos: Record<string, () => void> = {};
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'gestor' } } })) },
    from: jest.fn((tabela: string) => {
      let selecao = '';
      const consulta: Record<string, any> = {};
      for (const metodo of ['select', 'eq', 'in', 'gte', 'lte', 'limit', 'order', 'update', 'delete', 'upsert', 'insert']) {
        consulta[metodo] = (...args: unknown[]) => {
          if (metodo === 'select') selecao = args[0] as string;
          if (['insert', 'upsert', 'update'].includes(metodo)) mockEscritas.push({ tabela, metodo, payload: args[0] as Record<string, unknown> });
          if (metodo === 'delete') mockEscritas.push({ tabela, metodo });
          return consulta;
        };
      }
      consulta.single = () => Promise.resolve({ data: { id: 'rota' }, error: null });
      consulta.then = (resolver: (valor: unknown) => unknown) => Promise.resolve({
        data: tabela === 'organization_members'
          ? selecao === 'organization_id' ? [{ organization_id: 'clube' }]
            : [{ user_id: 'motorista', role: 'driver', profiles: { full_name: 'Rafael' } }]
          : tabela === 'reservations' ? mockReservas
            : tabela === 'routes' ? (mockParadasDaRota.length > 0 ? [{ id: 'rota', driver_id: 'motorista', status: mockStatusDaRota, lock_version: 5, route_stops: mockParadasDaRota }] : [])
              : tabela === 'organization_locations' ? mockLocais
                : [],
        error: null,
      }).then(resolver);
      return consulta;
    }),
    rpc: jest.fn(),
    channel: () => {
      const canal = {
        on: (_tipo: string, filtro: { table: string }, callback: () => void) => { mockEventos[filtro.table] = callback; return canal; },
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
  mockParadasDaRota = [];
  mockStatusDaRota = 'draft';
  mockLocais = [];
  mockEscritas.length = 0;
  confirmar = [];
  rpc.mockImplementation(() => new Promise((resolve) => confirmar.push(resolve)));
});

async function montar() {
  const tela = await render(<DispatchScreen />);
  await waitFor(() => expect(tela.getByRole('button', { name: 'Assign Jose · Sam' })).toBeTruthy());
  return tela;
}

it('a folha avisa que o irmão de casa vai junto, e o cão de outra casa não é citado', async () => {
  const tela = await montar();
  await fireEvent.press(tela.getByRole('button', { name: 'Assign Jose · Sam' }));
  expect(tela.getByText('Same house: Ollie goes to the same driver.')).toBeTruthy();
  await fireEvent.press(tela.getByRole('button', { name: 'Close' }));
  await fireEvent.press(tela.getByRole('button', { name: 'Assign Chuck · Sammy' }));
  expect(tela.queryByText(/Same house/)).toBeNull();
});

it('um clique manda as duas paradas, com a versão da rota andando a cada escrita', async () => {
  const tela = await montar();
  await fireEvent.press(tela.getByRole('button', { name: 'Assign Jose · Sam' }));
  await fireEvent.press(tela.getByRole('button', { name: 'Driver Rafael' }));
  await fireEvent.press(tela.getByRole('button', { name: 'Save stop' }));

  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
  expect(rpc).toHaveBeenCalledWith('assign_stop_to_route', {
    p_route_id: 'rota', p_dog_id: 'sam', p_window_start: null, p_window_end: null, p_exact_time: null, p_priority: 'normal', p_esperado: null,
  });

  // O banco devolveu o primeiro cão: agora a rota tem o Sam e a segunda escrita precisa da versão nova.
  mockParadasDaRota = [
    { dog_id: 'sam', sequence: 1, status: 'pending', priority: 'normal', window_start: null, window_end: null, exact_time: null, dog: { id: 'sam', name: 'Sam', client: { name: 'Jose', latitude: null, longitude: null } } },
  ];
  await act(async () => confirmar[0]({ data: null, error: null }));

  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
  expect(rpc).toHaveBeenLastCalledWith('assign_stop_to_route', {
    p_route_id: 'rota', p_dog_id: 'ollie', p_window_start: null, p_window_end: null, p_exact_time: null, p_priority: 'normal', p_esperado: 2,
  });

  mockParadasDaRota = [
    { dog_id: 'sam', sequence: 1, status: 'pending', priority: 'normal', window_start: null, window_end: null, exact_time: null, dog: { id: 'sam', name: 'Sam', client: { name: 'Jose', latitude: null, longitude: null } } },
    { dog_id: 'ollie', sequence: 2, status: 'pending', priority: 'normal', window_start: null, window_end: null, exact_time: null, dog: { id: 'ollie', name: 'Ollie', client: { name: 'Jose', latitude: null, longitude: null } } },
  ];
  await act(async () => confirmar[1]({ data: null, error: null }));

  await waitFor(() => {
    expect(tela.getByText('Jose · Sam')).toBeTruthy();
    expect(tela.getByText('Jose · Ollie')).toBeTruthy();
  });
  // O cão da outra casa continua na fila de quem não tem motorista.
  expect(tela.getByRole('button', { name: 'Assign Chuck · Sammy' })).toBeTruthy();
});

/**
 * ATRIBUIR CÃO NÃO PODE TIRAR A ROTA DO MOTORISTA DA RUA (achado CRÍTICO da vistoria, 02/10/2026).
 *
 * `assign` chama `routeIdForDriver` SEMPRE e a função fazia `upsert ... status: 'draft'`: atribuir mais
 * um cão a um motorista que já estava dirigindo devolvia a rota dele para RASCUNHO — e o app do motorista
 * só lê rota `published`, então a rota sumia do celular dele no meio do dia, sem aviso.
 */
it('atribuir cão a um motorista que já está na rua NÃO mexe na rota publicada', async () => {
  mockParadasDaRota = [
    { dog_id: 'ollie', sequence: 1, status: 'pending', priority: 'normal', window_start: null, window_end: null, exact_time: null, dog: { id: 'ollie', name: 'Ollie', client: { name: 'Jose', latitude: null, longitude: null } } },
  ];
  mockStatusDaRota = 'published';
  mockEscritas.length = 0;
  const tela = await montar();

  await fireEvent.press(tela.getByRole('button', { name: 'Assign Chuck · Sammy' }));
  await fireEvent.press(tela.getByRole('button', { name: 'Driver Rafael' }));
  await fireEvent.press(tela.getByRole('button', { name: 'Save stop' }));
  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
  await act(async () => confirmar[0]({ data: null, error: null }));

  // O cão entrou na rota do motorista (a escrita da parada aconteceu)...
  expect(rpc).toHaveBeenCalledWith('assign_stop_to_route', expect.objectContaining({ p_route_id: 'rota', p_dog_id: 'sammy' }));
  // ...e a ROTA em si não foi tocada: nada de insert/upsert/update em `routes`.
  expect(mockEscritas.filter((e) => e.tabela === 'routes')).toEqual([]);
  expect(mockStatusDaRota).toBe('published');
});

/**
 * PEDIDO DO CLIENTE (02/10/2026, print encaminhado pelo dono): *"as rota de pick up não tão acabando
   * no yard... tem como adicionar isso automaticamente?"* — a rota NASCE com o fim apontando para o
   * yard cadastrado pelo gestor (é onde o pick-up termina).
   */
  it('a rota nasce com o FIM no yard (automático, sem o gestor escolher)', async () => {
    mockLocais = [
      { id: 'van-1', name: 'Van 1', kind: 'van', address_line_1: '3111 La Selva', city: 'San Mateo', latitude: 37.5427669, longitude: -122.2849451, radius_meters: 300, is_default: true },
      { id: 'yard-1', name: 'Yard', kind: 'yard', address_line_1: '1089 Memorex Drive', city: 'Santa Clara', latitude: 37.362643, longitude: -122.9527423, radius_meters: 300, is_default: false },
    ];
    const tela = await montar();

    await fireEvent.press(tela.getByRole('button', { name: 'Assign Chuck · Sammy' }));
    await fireEvent.press(tela.getByRole('button', { name: 'Driver Rafael' }));
    await fireEvent.press(tela.getByRole('button', { name: 'Save stop' }));
    await waitFor(() => expect(mockEscritas.some((e) => e.tabela === 'routes')).toBe(true));

    const criacao = mockEscritas.find((e) => e.tabela === 'routes' && e.metodo === 'insert');
    expect(criacao?.payload).toMatchObject({ end_location_id: 'yard-1' });
  });
