/**
 * PRÉ-CLOCK-IN — a tela "Today's Route" fica MÍNIMA (pedido do dono, 05/10/2026).
 *
 * Antes de bater o ponto a tela expunha demais: o interruptor "Drive today", a linha administrativa
 * JOURNEY, o seletor Pick-ups/Drop-offs, o aviso de geofence TRUNCADO com "…" e três frases repetindo
 * a mesma ideia. Este arquivo trava o redesenho item a item (12 mudanças da tarefa):
 *
 *   (a) não existe "Drive today"/"driver view" NA TELA DO MOTORISTA (o interruptor vive em Home/More/Perfil);
 *   (b) existe um cartão de início com o nome da van e o endereço;
 *   (c) UMA única instrução ("Head to Van 2 to start your day.") e NENHUMA das frases antigas;
 *   (d) o seletor Pick-ups/Drop-offs NÃO aparece antes do clock in;
 *   (e) o mapa e a lista de paradas NÃO aparecem antes do clock in;
 *   (f) fora do raio → Clock in DESABILITADO (accessibilityState.disabled), distância REAL ("9,702 km away"),
 *       "Available within 300 m of Van 2" e aviso SEM truncamento (nenhum numberOfLines numérico no nó);
 *   (g) dentro do raio → Clock in habilitado (primário) e sem "Clock in 🔒";
 *   (h) cabeçalho "2 stops" + chip "Ready to start";
 *   (i) pills na ordem: Ready to start / Clocked in / Route complete;
 *   (j) a aba "Assigned" usa glifo DIFERENTE do "Profile";
 *   (k) o progresso (RouteSummary) continua com testID "route-summary" + progressbar, agora compacto.
 *
 * É Chromium/Jest (React Native de verdade), NÃO iOS.
 */
import React from 'react';
import { cleanup, render, waitFor, within } from '@testing-library/react-native';

import { StartStateCard } from '@/features/driver/StartStateCard';
import { clockInGate, type OrganizationLocation } from '@/features/organization/locations';

/* ------------------------------------------------------------------ *
 * FIXTURES — van em San Mateo; o motorista "longe" está a ~9.702 km
 * ------------------------------------------------------------------ */

const VAN = { latitude: 37.4693, longitude: -122.1537 };
/** ~9.702 km da van (o dono testa do Brasil) — a MESMA distância do relato de 05/10/2026. */
const LONGE = { latitude: -15.2702, longitude: -47.9292 };
/** ~22 m da van: dentro do raio de 300 m. */
const NA_VAN = { latitude: 37.4695, longitude: -122.1537 };

const VAN_LOC: OrganizationLocation = {
  id: 'van-2', name: 'Van 2', kind: 'van', addressLine1: '3111 La Selva', city: 'San Mateo',
  latitude: VAN.latitude, longitude: VAN.longitude, radiusMeters: 300, isDefault: true,
};

const SEDE_ROW = {
  id: 'van-2', name: 'Van 2', kind: 'van', address_line_1: '3111 La Selva', city: 'San Mateo',
  latitude: VAN.latitude, longitude: VAN.longitude, radius_meters: 300, is_default: true,
};

const mockEstado: {
  posicao: { latitude: number; longitude: number; capturedAt?: number } | null;
  sedes: Record<string, unknown>[];
  turno: 'none' | 'open' | 'closed';
} = { posicao: null, sedes: [SEDE_ROW], turno: 'none' };

/** Rota do dia com DUAS paradas em endereços diferentes → "2 stops". */
const mockRota = () => ({
  id: 'r1',
  organization_id: 'org-1',
  lock_version: 1,
  published_at: '2026-10-05T12:00:00.000Z',
  start_location_id: 'van-2',
  end_location_id: null,
  route_stops: [
    {
      id: 's1', sequence: 1, status: 'pending', stop_group_id: null,
      window_start: null, window_end: null, exact_time: null, priority: 'normal',
      pickup_proof_path: null, dropoff_proof_path: null,
      arrived_at: null, picked_up_at: null, completed_at: null, skipped_at: null, delivered_at: null,
      travel_seconds: null, dropoff_travel_seconds: null, status_updated_at: null,
      eta_notice_at: null, eta_notice_kind: null, dog: {
        id: 'd1', name: 'Bob', behavior_notes: null, medical_notes: null, photo_url: null,
        client: { name: 'Maria', address_line_1: '9 Client St', city: 'Palo Alto', phone: null, latitude: 37.01, longitude: -122.01, client_instructions: null },
      },
    },
    {
      id: 's2', sequence: 2, status: 'pending', stop_group_id: null,
      window_start: null, window_end: null, exact_time: null, priority: 'normal',
      pickup_proof_path: null, dropoff_proof_path: null,
      arrived_at: null, picked_up_at: null, completed_at: null, skipped_at: null, delivered_at: null,
      travel_seconds: null, dropoff_travel_seconds: null, status_updated_at: null,
      eta_notice_at: null, eta_notice_kind: null, dog: {
        id: 'd2', name: 'Luna', behavior_notes: null, medical_notes: null, photo_url: null,
        client: { name: 'Ana', address_line_1: '55 Oak Ave', city: 'Daly City', phone: null, latitude: 37.02, longitude: -122.02, client_instructions: null },
      },
    },
  ],
});

const jornadaAberta = () => ({
  id: 'sh-open', started_at: new Date().toISOString(), ended_at: null,
  start_reason: 'Journey started', end_reason: null, route_id: 'r1',
});
const jornadaFechada = () => ({
  id: 'sh-closed', started_at: '2026-10-05T07:00:00.000Z', ended_at: '2026-10-05T15:00:00.000Z',
  start_reason: 'Journey started', end_reason: 'End of the day', route_id: 'r1',
});

jest.mock('@/lib/supabase', () => {
  const dados = (tabela: string) => (
    tabela === 'routes' ? [mockRota()]
      : tabela === 'organization_locations' ? mockEstado.sedes
        : tabela === 'driver_shifts' ? (mockEstado.turno === 'open' ? [jornadaAberta()] : mockEstado.turno === 'closed' ? [jornadaFechada()] : [])
          : tabela === 'organization_members' ? [{ organization_id: 'org-1' }]
            : tabela === 'profiles' ? [{ full_name: 'Rafael' }]
              : []
  );
  const cadeia = (tabela: string) => {
    const chain: Record<string, unknown> = {};
    const mesmo = () => chain;
    chain.select = mesmo; chain.eq = mesmo; chain.or = mesmo; chain.gte = mesmo; chain.lt = mesmo;
    chain.lte = mesmo; chain.order = mesmo; chain.limit = mesmo; chain.is = mesmo;
    chain.maybeSingle = async () => ({ data: dados(tabela)[0] ?? null, error: null });
    chain.insert = mesmo; chain.delete = mesmo; chain.upsert = () => Promise.resolve({ error: null });
    chain.update = mesmo;
    chain.single = async () => ({ data: { id: 'novo' }, error: null });
    chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: dados(tabela), error: null }).then(res);
    return chain;
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'driver-1' } } }) },
      from: (tabela: string) => cadeia(tabela),
      rpc: async () => ({ data: null, error: null }),
      channel: () => ({ on: () => ({ on: () => ({ subscribe: () => undefined }), subscribe: () => undefined }) }),
      removeChannel: () => undefined,
    },
  };
});

jest.mock('@/features/driver/locationService', () => ({
  getCurrentDriverLocation: async () => mockEstado.posicao,
  startLocationSharing: async (onUpdate: (update: { latitude: number; longitude: number }) => void) => {
    if (mockEstado.posicao) onUpdate(mockEstado.posicao);
    return { stop: () => undefined };
  },
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('@/features/auth/useOrganizationRole', () => ({
  // Gestor dirigindo (canSwitchView true): ANTES o interruptor "Drive today" aparecia NESTA tela.
  useOrganizationRole: () => ({ role: 'manager', view: 'driver', isLoading: false, canSwitchView: true, setView: () => undefined }),
}));

jest.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'driver-1', email: 'driver@example.test' } } }),
}));

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

/** As opções de cada aba passadas ao `<Tabs.Screen>` (para o vetor do ícone). */
const mockAbas: Record<string, any> = {};
jest.mock('expo-router', () => {
  const ReactLocal = require('react');
  const Tabs = ({ children }: any) => ReactLocal.createElement(ReactLocal.Fragment, null, children);
  Tabs.Screen = ({ name, options }: any) => { mockAbas[name] = options; return null; };
  const router = { replace: jest.fn(), push: jest.fn(), back: jest.fn() };
  return {
    Tabs,
    router,
    useRouter: () => router,
    useFocusEffect: (cb: () => void | (() => void)) => {
      ReactLocal.useEffect(() => {
        const c = cb();
        return typeof c === 'function' ? c : undefined;
      }, []);
    },
  };
});

const AsyncStorage = require('@react-native-async-storage/async-storage') as typeof import('@react-native-async-storage/async-storage').default;

async function abrirTela() {
  const Tela = require('../app/(tabs)/driver').default;
  const tela = await render(<Tela />);
  await waitFor(() => expect(tela.getByTestId('driver-body')).toBeTruthy());
  return tela;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockEstado.posicao = null;
  mockEstado.sedes = [SEDE_ROW];
  mockEstado.turno = 'none';
});
afterEach(cleanup);

describe('(a)(c)(d)(e) antes do clock in a tela é MÍNIMA', () => {
  it('(a) não existe o interruptor "Drive today" nem "driver view" na tela do motorista', async () => {
    const tela = await abrirTela();
    await waitFor(() => expect(tela.getByLabelText('Clock in')).toBeTruthy());
    expect(tela.queryByLabelText('Drive today')).toBeNull();
    expect(tela.queryByText('Drive today')).toBeNull();
    expect(tela.queryByText('driver view')).toBeNull();
  });

  it('(c) existe UMA instrução por estado e nenhuma das frases repetidas antigas', async () => {
    const tela = await abrirTela();
    await waitFor(() => expect(tela.getByText('Head to Van 2 to start your day.')).toBeTruthy());
    // As três frases que repetiam a mesma ideia não existem mais.
    expect(tela.queryByText('Journey not started yet')).toBeNull();
    expect(tela.queryByText("Clock in and tap Start Route to see today's stops.")).toBeNull();
    expect(tela.queryByText('Tap Start Route to open the pick-up list.')).toBeNull();
  });

  it('(d) o seletor Pick-ups/Drop-offs NÃO aparece antes do clock in', async () => {
    const tela = await abrirTela();
    await waitFor(() => expect(tela.getByLabelText('Clock in')).toBeTruthy());
    expect(tela.queryByRole('button', { name: 'Pick-ups' })).toBeNull();
    expect(tela.queryByRole('button', { name: 'Drop-offs' })).toBeNull();
  });

  it('(e) o mapa e a lista de paradas NÃO aparecem antes do clock in', async () => {
    const tela = await abrirTela();
    await waitFor(() => expect(tela.getByLabelText('Clock in')).toBeTruthy());
    expect(tela.queryByTestId('route-content')).toBeNull();
    expect(tela.queryByTestId('route-timeline')).toBeNull();
    expect(tela.queryByTestId('active-stop-card')).toBeNull();
    expect(tela.queryByLabelText('Next stop: I arrived for Bob')).toBeNull();
  });
});

describe('(b)(h)(k) cartão de início, cabeçalho e progresso compacto', () => {
  it('(b) o cartão de início mostra o nome da van e o endereço', async () => {
    const tela = await abrirTela();
    await waitFor(() => expect(tela.getByTestId('cartao-inicio')).toBeTruthy());
    const cartao = within(tela.getByTestId('cartao-inicio'));
    expect(cartao.getByText('Ready to start')).toBeTruthy();
    expect(cartao.getByText('Start your day at Van 2')).toBeTruthy();
    expect(cartao.getByText('3111 La Selva San Mateo')).toBeTruthy();
  });

  it('(h) o cabeçalho mostra "2 stops" com o chip "Ready to start" na MESMA linha', async () => {
    const tela = await abrirTela();
    await waitFor(() => expect(tela.getByTestId('status-chip')).toBeTruthy());
    expect(tela.getByText("Today's Route")).toBeTruthy();
    expect(tela.getByTestId('stops-count').props.children).toBe('2 stops');
    expect(tela.getByTestId('status-chip').props.children).toBe('Ready to start');
    // "0 of 2 stops" saiu.
    expect(tela.queryByText(/0 of 2 stops/)).toBeNull();
  });

  it('(k) o progresso continua acessível e virou compacto (uma linha)', async () => {
    const tela = await abrirTela();
    await waitFor(() => expect(tela.getByTestId('route-summary')).toBeTruthy());
    expect(tela.getByRole('progressbar').props.accessibilityValue).toEqual({ min: 0, max: 2, now: 0 });
    // Formato compacto novo: "2 stops · Pick-ups" + "0/2" (era "0 of 2 completed").
    expect(tela.getByText('2 stops · Pick-ups')).toBeTruthy();
    expect(tela.getByText('0/2')).toBeTruthy();
    expect(tela.queryByText('0 of 2 completed')).toBeNull();
  });
});

describe('(f)(g) o Clock in reflete o estado REAL da geofence', () => {
  it('(f) fora do raio com leitura RECENTE: Clock in DESABILITADO, distância REAL e aviso sem truncamento', async () => {
    // Leitura RECENTE: é o caso em que a tela SABE que ele está fora e pode travar o botão.
    mockEstado.posicao = { ...LONGE, capturedAt: Date.now() };
    const tela = await abrirTela();
    await waitFor(() => expect(tela.getByTestId('gate-warning')).toBeTruthy());

    const botao = tela.getByLabelText('Clock in');
    expect(botao.props.accessibilityState).toMatchObject({ disabled: true });
    expect(tela.getByText('Clock in 🔒')).toBeTruthy();
    expect(tela.getByText('Available within 300 m of Van 2')).toBeTruthy();

    // A distância REAL, com separador de milhar (~9.702 km) e o raio REAL da van.
    expect(tela.getByText(/9,702 km away/)).toBeTruthy();
    expect(tela.getByText(/Clock-in available within 300 m/)).toBeTruthy();

    // SEM truncamento: nenhum `numberOfLines` numérico no nó do aviso.
    expect(tela.getByTestId('gate-warning').props.numberOfLines).toBeUndefined();

    // A exceção do dono continua ofertada (não some com o botão desabilitado).
    expect(tela.getByLabelText('Clock in anyway')).toBeTruthy();
  });

  it('(f2) fora do raio com leitura VENCIDA: o Clock in NÃO é travado (o GPS do toque decide) e o aviso diz a idade', async () => {
    /*
     * 🪤 A TRAVA NÃO PODE IMPEDIR O TRABALHO (01/10/2026): o clock in de verdade libera quando
     * QUALQUER uma das duas leituras diz "está na van" — a amostra visível OU o GPS fresco lido no
     * toque. Com amostra vencida a tela não sabe se ele está fora, então o botão continua primário e
     * quem decide é o toque; o aviso diz de quando é a leitura (não afirma "agora").
     */
    mockEstado.posicao = { ...LONGE, capturedAt: Date.now() - 60 * 60 * 1000 }; // 1 h atrás (> 15 min)
    const tela = await abrirTela();
    await waitFor(() => expect(tela.getByTestId('gate-warning')).toBeTruthy());

    const botao = tela.getByLabelText('Clock in');
    expect(botao.props.accessibilityState).toMatchObject({ disabled: false });
    expect(tela.queryByText('Clock in 🔒')).toBeNull();          // NÃO mostra o cadeado
    expect(tela.queryByText('Available within 300 m of Van 2')).toBeNull();
    expect(tela.getByText('Clock in')).toBeTruthy();

    // O aviso continua COMPLETO (mesma distância real) e agora carrega a idade da leitura.
    expect(tela.getByText(/9,702 km away \(1 h 0 min ago\)/)).toBeTruthy();
    expect(tela.getByTestId('gate-warning').props.numberOfLines).toBeUndefined();
    // E a exceção continua ofertada para quem quiser registrar sem esperar o GPS.
    expect(tela.getByLabelText('Clock in anyway')).toBeTruthy();
  });

  it('(g) dentro do raio: o cartão mostra o Clock in HABILITADO (primário) e sem o cadeado', async () => {
    /*
     * Provado no CARTÃO DE INÍCIO (apresentação) com o MESMO portão puro da tela: estando dentro do
     * raio o gate é `inside` → `clockInDisabled` falso. Na TELA, estar dentro do raio já ABRE a jornada
     * sozinho (regra existente — ver `sede-e-clock-in-agente2` "chegando na van, a jornada abre
     * sozinha"), então o botão primário "Clock in" aparece no estado em que o portão não bloqueia.
     */
    const dentro = clockInGate({ location: VAN_LOC, position: NA_VAN });
    expect(dentro.kind).toBe('inside');
    const tela = await render(
      <StartStateCard
        vanName="Van 2"
        address="3111 La Selva San Mateo"
        gate={dentro}
        clockInDisabled={dentro.kind === 'outside'}
        onClockIn={jest.fn()}
      />,
    );
    const botao = tela.getByLabelText('Clock in');
    expect(botao.props.accessibilityState).toMatchObject({ disabled: false });
    expect(tela.queryByText('Clock in 🔒')).toBeNull();
    expect(tela.queryByText('Available within 300 m of Van 2')).toBeNull();
    expect(tela.getByText('Clock in')).toBeTruthy();
  });

  it('(item 6) "Navigate to van" é um botão secundário outlined', async () => {
    const tela = await render(
      <StartStateCard
        vanName="Van 2"
        gate={clockInGate({ location: VAN_LOC, position: LONGE })}
        clockInDisabled
        navigation={{ kind: 'van', onPress: jest.fn() }}
        onClockIn={jest.fn()}
      />,
    );
    const navegar = tela.getByLabelText('Navigate to van');
    const estilo = navegar.props.style;
    expect(estilo).toBeTruthy(); // tem estilo próprio (um controle), não texto solto
    expect(navegar.props.accessibilityRole).toBe('button');
  });
});

describe('(i) os pills de estado evoluem na ordem pedida', () => {
  it('sem jornada: chip "Ready to start"', async () => {
    mockEstado.turno = 'none';
    const tela = await abrirTela();
    await waitFor(() => expect(tela.getByTestId('status-chip').props.children).toBe('Ready to start'));
  });

  it('jornada ABERTA e rota ainda não iniciada: chip "Clocked in"', async () => {
    mockEstado.turno = 'open';
    const tela = await abrirTela();
    await waitFor(() => expect(tela.getByTestId('cartao-jornada')).toBeTruthy());
    expect(tela.getByTestId('status-chip').props.children).toBe('Clocked in');
  });

  it('jornada FECHADA: chip "Route complete"', async () => {
    mockEstado.turno = 'closed';
    const tela = await abrirTela();
    await waitFor(() => expect(tela.getByTestId('status-chip').props.children).toBe('Route complete'));
  });
});

describe('(j) a aba Assigned tem ícone próprio', () => {
  it('"assigned" usa glifo DIFERENTE do "profile" (e o ♙ fica só no Profile)', async () => {
    const TabLayout = require('../app/(tabs)/_layout').default;
    await render(<TabLayout />);
    await waitFor(() => expect(mockAbas.assigned).toBeTruthy());
    const glifo = (aba: string) => mockAbas[aba].tabBarIcon({ color: '#000' }).props.children;
    expect(glifo('assigned')).not.toBe(glifo('profile'));
    expect(glifo('profile')).toBe('♙');
  });
});
