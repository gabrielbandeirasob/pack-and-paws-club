// Pedido do cliente (04/10/2026): calendário e Dispatch identificam apenas o cão; as asserções permanecem.
// A tela do Dispatch usa `useFocusEffect` (as vans são relidas ao voltar para ela): sem
// NavigationContainer o hook do expo-router quebra — mesmo mock das outras telas de teste do projeto.
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return { useFocusEffect: (cb: () => void) => useEffect(cb, [cb]), useRouter: () => ({ push: jest.fn() }) };
});

/**
 * UM ERRO NÃO CANCELA O LOTE DE ATRIBUIÇÃO (melhoria do dono, 01/10/2026).
 *
 * Caso real: **Sam** e **Ollie** são da mesma casa (cliente Jose) e entram com um clique só. Se o
 * banco recusasse o PRIMEIRO, o `break` antigo deixava o segundo sem nem ser tentado — e o gestor
 * achava que tinha mandado os dois. Agora o lote segue, e a frase final diz quem ficou de fora.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import DispatchScreen from '@/app/(tabs)/dispatch';
import { todayLocalISO } from '@/features/calendar/dates';
import { supabase } from '@/lib/supabase';

const HOJE = todayLocalISO();
const reserva = (id: string, dogId: string, dogName: string) => ({
  id, service_type: 'daycare' as const, start_date: HOJE, end_date: HOJE, transport_required: true,
  goes_to_daycare: true, dog: { id: dogId, name: dogName, client: { id: 'casa-jose', name: 'Jose' } },
});
const mockReservas = [reserva('r1', 'sam', 'Sam'), reserva('r2', 'ollie', 'Ollie')];

let mockParadasDaRota: unknown[] = [];
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'gestor' } } })) },
    from: jest.fn((tabela: string) => {
      let selecao = '';
      const consulta: Record<string, any> = {};
      for (const metodo of ['select', 'eq', 'in', 'gte', 'lte', 'limit', 'order', 'update', 'delete', 'upsert', 'insert']) {
        consulta[metodo] = (...args: unknown[]) => {
          if (metodo === 'select') selecao = args[0] as string;
          return consulta;
        };
      }
      consulta.single = () => Promise.resolve({ data: { id: 'rota' }, error: null });
      consulta.then = (resolver: (valor: unknown) => unknown) => Promise.resolve({
        data: tabela === 'organization_members'
          ? selecao === 'organization_id' ? [{ organization_id: 'clube' }]
            : [{ user_id: 'motorista', role: 'driver', profiles: { full_name: 'Rafael' } }]
          : tabela === 'reservations' ? mockReservas
            : tabela === 'routes' ? (mockParadasDaRota.length > 0 ? [{ id: 'rota', driver_id: 'motorista', status: 'draft', lock_version: 5, route_stops: mockParadasDaRota }] : [])
              : [],
        error: null,
      }).then(resolver);
      return consulta;
    }),
    rpc: jest.fn(),
    channel: () => { const canal = { on: () => canal, subscribe: () => canal }; return canal; },
    removeChannel: jest.fn(),
  },
}));

const rpc = supabase.rpc as jest.Mock;
let confirmar: ((valor: { data: null; error: { message: string } | null }) => void)[];
beforeEach(() => {
  jest.clearAllMocks();
  mockParadasDaRota = [];
  confirmar = [];
  rpc.mockImplementation(() => new Promise((resolve) => confirmar.push(resolve)));
});

it('RPC que "dá certo" sem gravar nada NÃO fecha a folha em silêncio — a tela diz que não atribuiu', async () => {
  /*
   * Dono (04/10/2026, com vídeo: *"Tentei fazer um dispatch"*): o spinner girava, a folha FECHAVA como se
   * tivesse atribuído, o cão continuava em UNASSIGNED e nenhuma mensagem aparecia. A RPC
   * `assign_stop_to_route` é VOID — o silêncio dela não prova nada. Agora o lote é conferido depois da
   * RECARGA: sem a parada na rota, a folha fala em vez de fechar.
   */
  mockParadasDaRota = [{
    // Formato CRU do banco (é o que `routes.select(...)` devolve): `dog_id` + `dog: { name, client }`.
    // O teste montava o formato já convertido (`dogId`/`clientName`), o que só passava por acaso de
    // corrida: a conversão da tela lê `stop.dog.client` (05/10/2026).
    dog_id: 'outro-cao', sequence: 1, status: 'pending', priority: 'normal',
    window_start: null, window_end: null, exact_time: null,
    pickup_pin: null, dropoff_pin: null,
    dog: { id: 'outro-cao', name: 'Outro cão', client: { id: 'casa-outro', name: 'Outro', latitude: null, longitude: null } },
  }] as never;

  const tela = await render(<DispatchScreen />);
  await waitFor(() => expect(tela.getByRole('button', { name: 'Assign Sam' })).toBeTruthy());
  await fireEvent.press(tela.getByRole('button', { name: 'Assign Sam' }));
  await fireEvent.press(tela.getByRole('button', { name: 'Driver Rafael' }));
  await fireEvent.press(tela.getByRole('button', { name: 'Save stop' }));
  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));

  // O banco responde "ok" — e a recarga continua mostrando a rota SEM o Sam.
  await act(async () => confirmar[0]({ data: null, error: null }));

  // A folha NÃO pode fechar: o único caminho que a mantém aberta é a mensagem de falha.
  await waitFor(() => expect(tela.getByRole('button', { name: 'Save stop' })).toBeTruthy());
  tela.unmount();
});

it('o cão seguinte é tentado depois de uma recusa no meio do lote, e a tela diz quem falhou', async () => {
  const tela = await render(<DispatchScreen />);
  await waitFor(() => expect(tela.getByRole('button', { name: 'Assign Sam' })).toBeTruthy());

  await fireEvent.press(tela.getByRole('button', { name: 'Assign Sam' }));
  await fireEvent.press(tela.getByRole('button', { name: 'Driver Rafael' }));
  await fireEvent.press(tela.getByRole('button', { name: 'Save stop' }));

  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
  expect(rpc).toHaveBeenLastCalledWith('assign_stop_to_route', expect.objectContaining({ p_dog_id: 'sam' }));

  // O banco recusou o PRIMEIRO cão. Antes isto abortava o lote inteiro.
  await act(async () => confirmar[0]({ data: null, error: { message: 'permission denied' } }));

  // O irmão SEGUIU sendo tentado — e com a versão intacta: escrita recusada não incrementa lock_version.
  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
  expect(rpc).toHaveBeenLastCalledWith('assign_stop_to_route', expect.objectContaining({ p_dog_id: 'ollie', p_esperado: null }));

  mockParadasDaRota = [{
    dog_id: 'ollie', sequence: 1, status: 'pending', priority: 'normal', window_start: null,
    window_end: null, exact_time: null, dog: { id: 'ollie', name: 'Ollie', client: { name: 'Jose', latitude: null, longitude: null } },
  }];
  await act(async () => confirmar[1]({ data: null, error: null }));

  // A frase nomeia o que falhou e o que entrou — não é mais um erro cru do banco.
  await waitFor(() => expect(tela.getByText(/1 dog could not be saved: Sam — permission denied\. 1 dog was saved/)).toBeTruthy());
  // O cartão lista as DUAS pernas (busca e entrega, dono 03/10/2026): o mesmo cão aparece nos dois blocos.
  await waitFor(() => expect(tela.getAllByText('Ollie').length).toBeGreaterThan(0));
});

it('a versão do banco recusando (stale_route) continua parando o lote, como antes', async () => {
  const tela = await render(<DispatchScreen />);
  await waitFor(() => expect(tela.getByRole('button', { name: 'Assign Sam' })).toBeTruthy());

  await fireEvent.press(tela.getByRole('button', { name: 'Assign Sam' }));
  await fireEvent.press(tela.getByRole('button', { name: 'Driver Rafael' }));
  await fireEvent.press(tela.getByRole('button', { name: 'Save stop' }));

  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
  await act(async () => confirmar[0]({ data: null, error: { message: 'stale_route' } }));

  // Rota inteira inválida: não se tenta o resto com uma versão que a tela sabe ser velha.
  await waitFor(() => expect(tela.getByText(/changed on another device/i)).toBeTruthy());
  expect(rpc).toHaveBeenCalledTimes(1);
});
