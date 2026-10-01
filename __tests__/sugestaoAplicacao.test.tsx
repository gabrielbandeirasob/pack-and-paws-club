import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import DispatchScreen from '@/app/(tabs)/dispatch';
import { todayLocalISO, addDaysISO } from '@/features/calendar/dates';
import { supabase } from '@/lib/supabase';

const mockHoje = todayLocalISO();
const mockReservas = ['sam', 'ollie', 'sammy', 'hotel'].map((id, i) => ({
  id, service_type: i === 3 ? 'boarding' : 'daycare', start_date: i === 3 ? addDaysISO(mockHoje, -1) : mockHoje,
  end_date: i === 3 ? addDaysISO(mockHoje, 1) : mockHoje, transport_required: i !== 3, goes_to_daycare: true,
  dog: { id, name: id, client: { id: i < 2 ? 'jose' : id, name: i < 2 ? 'Jose' : id, latitude: 37.4 + i * .001, longitude: -122.14 } },
}));
// Coordenadas são do cliente, portanto iguais para irmãos.
mockReservas[1].dog.client.latitude = mockReservas[0].dog.client.latitude;
let mockRotas: any[] = [];
let mockWrites: any[] = [];
let mockFailDog: string | null = null;
let mockLocationGate: Promise<void> | null = null;
let mockStatus: string = 'draft';
let mockDrivers = [{ user_id: 'rafa', role: 'driver', profiles: { full_name: 'Rafael' } }];
jest.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'gestor' } } })) },
  from: jest.fn((table: string) => {
    let select = '', operation = '', payload: any; const filters: Record<string, any> = {};
    const q: any = {};
    for (const method of ['select', 'eq', 'in', 'limit', 'order', 'update', 'delete', 'upsert', 'insert']) {
      q[method] = (...args: any[]) => {
        if (method === 'select') select = args[0];
        if (method === 'eq') filters[args[0]] = args[1];
        if (['insert','upsert','update','delete'].includes(method)) { operation = method; payload = args[0]; }
        return q;
      };
    }
    const result = async () => {
      if (table === 'organization_locations' && mockLocationGate) await mockLocationGate;
      if (operation) {
        mockWrites.push({ table, operation, payload });
        if (table === 'routes' && ['insert', 'upsert'].includes(operation)) {
          let route = mockRotas.find(r => r.driver_id === payload.driver_id);
          if (!route) { route = { id: 'rota', driver_id: payload.driver_id, status: mockStatus, lock_version: 1, route_stops: [] }; mockRotas.push(route); }
          else if (operation === 'upsert') route.status = payload.status;
          return { data: { id: route.id, lock_version: route.lock_version }, error: null };
        }
      }
      return { data: table === 'organization_members' ? (select === 'organization_id' ? [{ organization_id: 'clube' }] : mockDrivers)
        : table === 'reservations' ? mockReservas
        : table === 'routes' ? JSON.parse(JSON.stringify(mockRotas))
        : table === 'organization_locations' ? [{ id: 'van', name: 'Van', kind: 'van', is_default: true, latitude: 37.39, longitude: -122.14 }] : [], error: null };
    };
    q.single = result; q.then = (resolve: any, reject: any) => result().then(resolve, reject); return q;
  }),
  rpc: jest.fn(async (name: string, args: any) => {
    mockWrites.push({ name, args });
    if (args.p_dog_id === mockFailDog) return { error: { message: 'failure-test' } };
    const r = mockRotas.find(r => r.id === args.p_route_id);
    if (args.p_esperado !== null && args.p_esperado !== r.lock_version) return { error: { message: 'stale_route' } };
    const dog = mockReservas.find(x => x.dog.id === args.p_dog_id)!.dog;
    if (!r.route_stops.some((s: any) => s.dog_id === dog.id)) r.route_stops.push({ dog_id: dog.id, dog, sequence: r.route_stops.length + 1, status: 'pending', priority: 'normal' });
    r.lock_version++;
    return { error: null };
  }),
  channel: () => { const c = { on: () => c, subscribe: () => c }; return c; }, removeChannel: jest.fn(),
} }));

beforeEach(() => { jest.clearAllMocks(); mockRotas = []; mockWrites = []; mockFailDog = null; mockLocationGate = null; mockStatus = 'draft'; mockDrivers = [{ user_id: 'rafa', role: 'driver', profiles: { full_name: 'Rafael' } }]; });

it('gestor escolhe só ele: prévia e aplicação ficam no manager, não em todos os membros', async () => {
  mockDrivers.push({ user_id: 'gestor', role: 'manager', profiles: { full_name: 'Gabriel' } });
  const screen = await open();
  await fireEvent.press(screen.getByLabelText('Include Rafael in suggestion'));
  await waitFor(() => expect(screen.queryByTestId('sugestao-rafa')).toBeNull());
  expect(screen.getByTestId('sugestao-gestor')).toBeTruthy();
  expect(mockWrites).toHaveLength(0);
  await fireEvent.press(screen.getByLabelText('Apply suggestion'));
  await waitFor(() => expect(screen.queryByText('Suggested routes')).toBeNull());
  expect(mockRotas).toHaveLength(1);
  expect(mockRotas[0].driver_id).toBe('gestor');
  expect(mockRotas[0].route_stops).toHaveLength(3);
});

it('proposta obsoleta por escrita de outro gestor não grava nem rouba cão', async () => {
  const screen = await open();
  mockRotas.push({ id: 'rota', driver_id: 'rafa', status: 'published', lock_version: 9,
    route_stops: [{ dog_id: 'sam', dog: mockReservas[0].dog, sequence: 1, status: 'pending', priority: 'normal' }] });
  await fireEvent.press(screen.getByLabelText('Apply suggestion'));
  await waitFor(() => expect(screen.getByText(/0 dogs saved.*changed/)).toBeTruthy());
  expect(mockWrites).toHaveLength(0);
  expect(mockRotas[0].status).toBe('published');
});

it('trocar o dia enquanto calcula não mostra nem aplica proposta antiga', async () => {
  let release!: () => void;
  mockLocationGate = new Promise<void>(r => { release = r; });
  const screen = await render(<DispatchScreen />);
  await waitFor(() => expect(screen.getByLabelText('Suggest routes')).toBeTruthy());
  await fireEvent.press(screen.getByLabelText('Suggest routes'));
  await waitFor(() => expect((supabase.from as jest.Mock).mock.calls.some(c => c[0] === 'organization_locations')).toBe(true));
  await fireEvent.press(screen.getByLabelText('Next day'));
  await act(async () => release());
  await waitFor(() => expect(screen.queryByTestId('dispatch-loading')).toBeNull());
  expect(screen.queryByText('Suggested routes')).toBeNull();
  expect(mockWrites).toHaveLength(0);
});

it('preserva ordem, restrições e status de rascunho existente ao anexar os novos', async () => {
  const stop = { dog_id: 'sammy', dog: mockReservas[2].dog, sequence: 1, status: 'pending', priority: 'priority', exact_time: '09:00:00', dropoff_sequence: 1 };
  mockRotas = [{ id: 'rota', driver_id: 'rafa', status: 'draft', lock_version: 7, route_stops: [stop] }];
  const screen = await open();
  await fireEvent.press(screen.getByLabelText('Apply suggestion'));
  await waitFor(() => expect(screen.queryByText('Suggested routes')).toBeNull());
  expect(mockRotas[0].route_stops[0]).toEqual(stop);
  expect(mockWrites.filter(w => w.table === 'routes')).toHaveLength(0);
  expect((supabase.rpc as jest.Mock).mock.calls.map(c => c[1].p_esperado)).toEqual([7, 8]);
});

it('irmão de cão já atribuído fica com o mesmo motorista, mesmo havendo outro participante', async () => {
  mockDrivers.push({ user_id: 'gestor', role: 'manager', profiles: { full_name: 'Gabriel' } });
  mockRotas = [{ id: 'rota', driver_id: 'rafa', status: 'draft', lock_version: 7,
    route_stops: [{ dog_id: 'sam', dog: mockReservas[0].dog, sequence: 1, status: 'pending', priority: 'normal' }] }];
  const screen = await open();
  expect(screen.getByTestId('sugestao-rafa')).toBeTruthy();
  const propostaRafa = screen.getByTestId('sugestao-rafa');
  expect(within(propostaRafa).getByText(/Jose · ollie/)).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Include Rafael in suggestion'));
  await waitFor(() => expect(screen.queryByTestId('sugestao-rafa')).toBeNull());
  expect(within(screen.getByTestId('sugestao-gestor')).queryByText(/Jose · ollie/)).toBeNull();
  expect(mockWrites).toHaveLength(0);
});

it('não altera rota com trava last para encaixar novos cães', async () => {
  mockRotas = [{ id: 'rota', driver_id: 'rafa', status: 'draft', lock_version: 7,
    route_stops: [{ dog_id: 'sammy', dog: mockReservas[2].dog, sequence: 1, status: 'pending', priority: 'normal', pickup_pin: 'last' }] }];
  const antes = JSON.stringify(mockRotas);
  const screen = await open();
  await fireEvent.press(screen.getByLabelText('Apply suggestion'));
  expect(mockWrites).toHaveLength(0);
  expect(JSON.stringify(mockRotas)).toBe(antes);
});
async function open() {
  const screen = await render(<DispatchScreen />);
  await waitFor(() => expect(screen.getByLabelText('Suggest routes')).toBeTruthy());
  await fireEvent.press(screen.getByLabelText('Suggest routes'));
  await waitFor(() => expect(screen.getByText('Suggested routes')).toBeTruthy());
  return screen;
}
it('aplica proposta real sem duplicar irmãos, sem boarding e sem publicar', async () => {
  const screen = await open();
  expect(mockWrites).toHaveLength(0);
  await fireEvent.press(screen.getByLabelText('Apply suggestion'));
  await waitFor(() => expect(screen.queryByText('Suggested routes')).toBeNull());
  const calls = (supabase.rpc as jest.Mock).mock.calls;
  expect(calls.map(c => c[1].p_dog_id)).toHaveLength(3);
  expect(new Set(calls.map(c => c[1].p_dog_id))).toEqual(new Set(['sam', 'ollie', 'sammy']));
  expect(mockRotas[0].route_stops.map((s: any) => s.dog_id)).toEqual(calls.map(c => c[1].p_dog_id));
  expect(mockRotas[0].status).toBe('draft');
  expect(calls.every(c => c[0] === 'assign_stop_to_route')).toBe(true);
});
it('não despublica nem escreve em rota publicada', async () => {
  mockRotas = [{ id: 'rota', driver_id: 'rafa', status: 'published', lock_version: 7, route_stops: [] }];
  const screen = await open();
  expect(screen.getByText(/No eligible dogs or drivers/)).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Apply suggestion'));
  expect(mockWrites).toHaveLength(0);
  expect(mockRotas[0].status).toBe('published');
});
it('falha parcial não cancela o lote: salva o resto, nomeia quem faltou e não repete escritas', async () => {
  mockFailDog = 'sam';
  const screen = await open();
  await fireEvent.press(screen.getByLabelText('Apply suggestion'));
  // O cão recusado aparece pelo nome e o lote NÃO parou nele (era o defeito até 01/10/2026).
  await waitFor(() => expect(screen.getByText(/1 dog could not be saved: sam/)).toBeTruthy());
  const salvos = mockRotas[0].route_stops.map((s: any) => s.dog_id);
  expect(salvos).not.toContain('sam');
  expect(new Set(salvos)).toEqual(new Set(['ollie', 'sammy']));
  // proposta invalidada: tocar de novo não repete escritas
  const n = mockWrites.length;
  await fireEvent.press(screen.getByLabelText('Apply suggestion'));
  expect(mockWrites).toHaveLength(n);
});
