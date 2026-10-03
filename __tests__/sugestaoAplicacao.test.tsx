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
let mockPhases = false;
let mockCollision = false;
let mockReads: any[] = [];
let mockRotas: any[] = [];
let mockWrites: any[] = [];
let mockFailDog: string | null = null;
let mockLocationGate: Promise<void> | null = null;
let mockStatus: string = 'draft';
let mockDrivers = [{ user_id: 'rafa', role: 'driver', profiles: { full_name: 'Rafael' } }];
// Vans cadastradas na organização (dono, 01/10/2026: "vamos supor que tenhas várias vans").
const vanUnica = [{ id: 'van', name: 'Van', kind: 'van', is_default: true, latitude: 37.39, longitude: -122.14 }];
let mockLocations: any[] = vanUnica;
// Canais de tempo real criados pela tela (para provar que a van cadastrada em outro aparelho aparece).
let mockCanais: any[] = [];
// A tela usa `useFocusEffect` (as vans são relidas ao voltar para o Dispatch): sem NavigationContainer
// o hook do expo-router quebra — mesmo mock que as outras telas de teste do projeto usam.
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return { useFocusEffect: (cb: () => void) => useEffect(cb, [cb]), useRouter: () => ({ push: jest.fn() }) };
});

jest.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'gestor' } } })) },
  from: jest.fn((table: string) => {
    let select = '', operation = '', payload: any; const filters: Record<string, any> = {};
    const q: any = {};
    for (const method of ['select', 'eq', 'in', 'gte', 'lte', 'limit', 'order', 'update', 'delete', 'upsert', 'insert']) {
      q[method] = (...args: any[]) => {
        if (method === 'select') select = args[0];
        if (method === 'eq') filters[args[0]] = args[1];
        if (['insert','upsert','update','delete'].includes(method)) { operation = method; payload = args[0]; }
        return q;
      };
    }
    const result = async () => {
      if (table === 'routes' && !operation && select === 'id, lock_version, status') {
        mockReads.push({ ...filters });
        return { data: mockRotas.find(r => r.driver_id === filters.driver_id && r.phase === filters.phase), error: null };
      }
      if (table === 'routes' && !operation && select.startsWith('phase,') && !mockPhases) return { data: null, error: { code: '42703', message: 'column routes.phase does not exist' } };
      if (table === 'organization_locations' && mockLocationGate) await mockLocationGate;
      if (operation) {
        mockWrites.push({ table, operation, payload });
        if (table === 'routes' && ['insert', 'upsert'].includes(operation)) {
          let route = mockRotas.find(r => r.driver_id === payload.driver_id && (r.phase ?? 'pickup') === (payload.phase ?? 'pickup'));
          if (!route) { route = { id: mockPhases ? `${payload.driver_id}-${payload.phase}` : 'rota', phase: payload.phase, driver_id: payload.driver_id, status: mockStatus, lock_version: 1, route_stops: [] }; mockRotas.push(route); }
          else if (operation === 'upsert') route.status = payload.status;
          if (mockCollision) { mockCollision = false; route.lock_version = 5; return { data: null, error: { code: '23505', message: 'duplicate route' } }; }
          return { data: { id: route.id, lock_version: route.lock_version }, error: null };
        }
      }
      return { data: table === 'organization_members' ? (select === 'organization_id' ? [{ organization_id: 'clube' }] : mockDrivers)
        : table === 'reservations' ? mockReservas
        : table === 'routes' ? JSON.parse(JSON.stringify(mockRotas))
        : table === 'organization_locations' ? mockLocations : [], error: null };
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
  channel: () => {
    const c: any = { handlers: [] as { table?: string; cb: () => void }[] };
    c.on = (_evento: string, cfg: { table?: string }, cb: () => void) => { c.handlers.push({ table: cfg?.table, cb }); return c; };
    c.subscribe = () => c;
    mockCanais.push(c);
    return c;
  }, removeChannel: jest.fn(),
} }));

beforeEach(() => { mockCollision = false; mockReads = []; mockPhases = false; jest.clearAllMocks(); mockRotas = []; mockWrites = []; mockFailDog = null; mockLocationGate = null; mockStatus = 'draft'; mockDrivers = [{ user_id: 'rafa', role: 'driver', profiles: { full_name: 'Rafael' } }]; mockLocations = vanUnica; mockCanais = []; });

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

/**
 * VAN NA ROTA QUE NASCE (pergunta do dono, 01/10/2026: *"vamos supor que tenhas várias vans, o erro não
 * vai se repetir?"*).
 *
 * Com UMA van, a rota nasce apontando para ela (explícito e estável — o mundo de hoje). Com DUAS ou mais
 * e nenhuma escolha do gestor, a rota nasce SEM van de propósito: o app resolve pela MAIS PRÓXIMA das
 * paradas, em vez de cair sempre na padrão (que era o defeito do clock in).
 */
it('com UMA van, a rota que nasce grava essa van', async () => {
  const screen = await open();
  await fireEvent.press(screen.getByLabelText('Apply suggestion'));
  await waitFor(() => expect(screen.queryByText('Suggested routes')).toBeNull());
  // A rota da sugestão nasce por INSERT (não sobrescreve rota existente).
  const criada = mockWrites.find(w => w.table === 'routes' && ['insert', 'upsert'].includes(w.operation));
  expect(criada.payload.start_location_id).toBe('van');
});

/**
 * O YARD NÃO É VAN (dono, 02/10/2026: *"tá mostrando van 1, van 2, yard (...) não é uma van o yard"*).
 *
 * Mesmo que o gestor marque o YARD como sede PADRÃO por engano, ele não vira a van da rota: a rota que
 * nasce aponta para a VAN. E como o yard não conta como van, o caso "uma van só" (rota nasce com a van
 * explícita) continua valendo numa organização que tem uma van E um yard.
 */
it('com UMA van + um YARD a rota nasce com a VAN (o yard não é van, nem sendo o padrão)', async () => {
  mockLocations = [
    { id: 'yard', name: 'Yard', kind: 'yard', is_default: true, latitude: 37.36, longitude: -121.95 },
    { id: 'van', name: 'Van 1', kind: 'van', is_default: false, latitude: 37.39, longitude: -122.14 },
  ];
  const screen = await open();
  await fireEvent.press(screen.getByLabelText('Apply suggestion'));
  await waitFor(() => expect(screen.queryByText('Suggested routes')).toBeNull());
  const criada = mockWrites.find(w => w.table === 'routes' && ['insert', 'upsert'].includes(w.operation));
  expect(criada.payload.start_location_id).toBe('van');
});

it('com DUAS vans e nenhuma escolha, a rota nasce SEM van (o app decide pela mais próxima)', async () => {
  mockLocations = [
    { id: 'sf', name: 'Van teste', kind: 'van', is_default: true, latitude: 37.7793, longitude: -122.4192 },
    { id: 'sm', name: 'Van 1', kind: 'van', is_default: false, latitude: 37.5427669, longitude: -122.2849451 },
  ];
  const screen = await open();
  await fireEvent.press(screen.getByLabelText('Apply suggestion'));
  await waitFor(() => expect(screen.queryByText('Suggested routes')).toBeNull());
  // A rota da sugestão nasce por INSERT (não sobrescreve rota existente).
  const criada = mockWrites.find(w => w.table === 'routes' && ['insert', 'upsert'].includes(w.operation));
  expect(criada.payload.start_location_id ?? null).toBeNull();
});

/**
 * VAN CADASTRADA E O SELETOR QUE NÃO APARECIA (defeito relatado pelo dono, 01/10/2026: *"criei uma segunda
 * van de teste e mesmo assim não apareceu"*).
 *
 * A lista de vans era lida DENTRO do "dia", que tem trava de 2 minutos e não escutava a tabela de vans:
 * quem cadastrava a Van 2 e voltava para o Dispatch continuava vendo a lista velha (com uma van só o
 * seletor nem existe). Agora a tela escuta `organization_locations` e relê no foco.
 */
it('van cadastrada em outro aparelho aparece na hora, sem recarregar a tela', async () => {
  const screen = await render(<DispatchScreen />);
  await waitFor(() => expect(screen.getByLabelText('Suggest routes')).toBeTruthy());
  // Com UMA van não há o que escolher — nada de seletor.
  expect(screen.queryByTestId('driver-van-rafa')).toBeNull();

  // O gestor cadastra a Van 2 (em outro aparelho, ou na tela Van & yard e volta): o banco avisa.
  mockLocations = [
    { id: 'van', name: 'Van 1', kind: 'van', is_default: true, latitude: 37.5427669, longitude: -122.2849451 },
    { id: 'van2', name: 'Van 2', kind: 'van', is_default: false, latitude: 37.469288, longitude: -122.1537186 },
  ];
  await act(async () => {
    mockCanais.flatMap((c) => c.handlers).filter((h) => h.table === 'organization_locations').forEach((h) => h.cb());
  });

  await waitFor(() => expect(screen.getByTestId('driver-van-rafa')).toBeTruthy());
  expect(screen.getByLabelText('Use Van 2 for Rafael')).toBeTruthy();
});


it('sugere e grava duas pernas independentes, sem boarding e sem publicar drop-offs', async () => {
  mockPhases = true;
  mockLocations = [...vanUnica, { id: 'yard', name: 'Yard', kind: 'yard', is_default: false, latitude: 37.36, longitude: -121.95 }];
  const screen = await open();
  expect(screen.getByTestId('sugestao-rafa')).toBeTruthy();
  expect(screen.getByTestId('sugestao-rafa-dropoff')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Apply suggestion'));
  await waitFor(() => expect(screen.queryByText('Suggested routes')).toBeNull());
  expect(mockRotas).toHaveLength(2);
  for (const phase of ['pickup', 'dropoff']) {
    const route = mockRotas.find(r => r.phase === phase);
    expect(route.status).toBe('draft');
    expect(route.route_stops.map((s: any) => s.dog_id).sort()).toEqual(['ollie', 'sam', 'sammy']);
  }
  const inserts = mockWrites.filter(w => w.operation === 'insert');
  expect(inserts.map(w => [w.payload.phase, w.payload.start_location_id, w.payload.end_location_id])).toEqual([
    ['pickup', 'van', 'yard'], ['dropoff', 'yard', 'van'],
  ]);
  // A troca de perna saiu (dono, 03/10/2026): as DUAS pernas ficam na tela ao mesmo tempo. A de ENTREGA
  // nunca publica (drop-off é só rascunho) — o botão de publicar é o da rota de BUSCA.
  expect(screen.getAllByText(/^Jose · sam$/)).toHaveLength(2);   // na busca E na entrega
  expect(screen.queryByText('Draft only')).toBeNull();
  expect((supabase.rpc as jest.Mock).mock.calls.every(c => c[0] === 'assign_stop_to_route')).toBe(true);
});

it('pick-up publicado não impede proposta independente de drop-off', async () => {
  mockPhases = true;
  mockRotas = [{ id: 'pickup', phase: 'pickup', driver_id: 'rafa', status: 'published', lock_version: 7,
    route_stops: [{ dog_id: 'sam', dog: mockReservas[0].dog, sequence: 1, status: 'pending', priority: 'normal' }] }];
  const screen = await open();
  expect(screen.queryByTestId('sugestao-rafa')).toBeNull();
  expect(within(screen.getByTestId('sugestao-rafa-dropoff')).getByText(/Jose · sam$/)).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Apply suggestion'));
  await waitFor(() => expect(screen.queryByText('Suggested routes')).toBeNull());
  expect(mockRotas[0].status).toBe('published');
  expect(mockRotas[0].route_stops).toHaveLength(1);
  expect(mockRotas.find(r => r.phase === 'dropoff').route_stops).toHaveLength(3);
});

it('atribuição manual de drop-off usa sua rota e não a rota publicada de pick-up', async () => {
  mockPhases = true;
  mockRotas = [{ id: 'pickup', phase: 'pickup', driver_id: 'rafa', status: 'published', lock_version: 7,
    route_stops: [{ dog_id: 'sam', dog: mockReservas[0].dog, sequence: 1, status: 'pending', priority: 'normal' }] }];
  const screen = await render(<DispatchScreen />);
  await waitFor(() => expect(screen.getByLabelText('Assign drop-offs')).toBeTruthy());
  await fireEvent.press(screen.getByLabelText('Assign drop-offs'));
  await fireEvent.press(screen.getByLabelText('Assign Jose · sam'));
  await fireEvent.press(screen.getByLabelText('Driver Rafael'));
  await fireEvent.press(screen.getByLabelText('Save stop'));
  await waitFor(() => expect(mockRotas.find(r => r.phase === 'dropoff')?.route_stops).toHaveLength(2));
  expect(mockRotas[0].route_stops).toHaveLength(1);
  expect(mockRotas[0].lock_version).toBe(7);
  expect((supabase.rpc as jest.Mock).mock.calls.map(c => c[1].p_route_id)).toEqual(['rafa-dropoff', 'rafa-dropoff']);
});

it('equilibra por cães também contando atribuições existentes na mesma fase', async () => {
  mockPhases = true;
  mockDrivers.push({ user_id: 'gestor', role: 'manager', profiles: { full_name: 'Gabriel' } });
  mockRotas = [{ id: 'pickup', phase: 'pickup', driver_id: 'rafa', status: 'draft', lock_version: 7,
    route_stops: ['a', 'b', 'c'].map((id, i) => ({ dog_id: id, dog: { id, name: id, client: { id, name: id, latitude: 37.4, longitude: -122.14 } }, sequence: i + 1, status: 'pending', priority: 'normal' })) }];
  const screen = await open();
  expect(screen.queryByTestId('sugestao-rafa')).toBeNull();
  expect(within(screen.getByTestId('sugestao-gestor')).getByText(/Gabriel · 3 dogs/)).toBeTruthy();
  expect(screen.getByTestId('sugestao-rafa-dropoff')).toBeTruthy();
  expect(screen.getByTestId('sugestao-gestor-dropoff')).toBeTruthy();
});


it('23505 relê por motorista e fase, usando a versão da rota concorrente', async () => {
  mockPhases = true;
  mockCollision = true;
  mockRotas = [{ id: 'pickup', phase: 'pickup', driver_id: 'rafa', status: 'published', lock_version: 7, route_stops: [] }];
  const screen = await render(<DispatchScreen />);
  await waitFor(() => expect(screen.getByLabelText('Assign drop-offs')).toBeTruthy());
  await fireEvent.press(screen.getByLabelText('Assign drop-offs'));
  await fireEvent.press(screen.getByLabelText('Assign Jose · sam'));
  await fireEvent.press(screen.getByLabelText('Driver Rafael'));
  await fireEvent.press(screen.getByLabelText('Save stop'));
  await waitFor(() => expect(mockRotas.find(r => r.phase === 'dropoff')?.route_stops).toHaveLength(2));
  expect(mockReads).toEqual([{ organization_id: 'clube', route_date: mockHoje, driver_id: 'rafa', phase: 'dropoff' }]);
  expect((supabase.rpc as jest.Mock).mock.calls.map(c => c[1].p_esperado)).toEqual([5, 6]);
  expect(mockRotas[0].lock_version).toBe(7);
});
