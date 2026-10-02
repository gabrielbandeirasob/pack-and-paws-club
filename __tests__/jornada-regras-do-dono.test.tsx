/**
 * REGRAS DE JORNADA DITADAS PELO DONO (áudio do dono, 02/10/2026) — prova na TELA do motorista.
 *
 * O dono testou e ditou:
 *   (1) clock-in TRAVADO pela localização: *"o clock-in eu QUIS travar… por isso que eu pedi uma
 *       location: conta a localização na hora do clock-in"*;
 *   (2) clock-out em QUALQUER lugar: *"quando o driver estiver indo embora ele vai lá e dá clock-out
 *       de novo, independente de onde ele esteja… mas NÃO que o clock-out só possa ser feito por lá"*;
 *   (3) NADA de clock automático: *"o clock-in e o clock-out NÃO podem ser automáticos. Os dois não
 *       podem."*
 *
 * O que estes testes travam (reafirmando o que já existia e provando o que faltava):
 *   - longe da van, o clock-in é RECUSADO e só entra pelo botão de exceção "Clock in anyway"
 *     (a distância vai no motivo gravado);
 *   - o clock-out FUNCIONA longe da van e, mais forte que a frase, **não consulta a localização**
 *     (`getCurrentDriverLocation` nunca é chamado no caminho do clock-out);
 *   - sem toque do motorista, NENHUMA linha nasce em `driver_shifts` — nem com a rota toda concluída
 *     (a jornada deduzida é EXIBIÇÃO, não registro), nem ao reabrir/trocar de conta.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

/* ------------------------------------------------------------------ *
 * BANCO FALSIFICADO (só o que a tela escreve importa). Variáveis lidas
 * dentro do factory do jest.mock levam prefixo `mock` (exigência do babel-jest).
 * ------------------------------------------------------------------ */

type Linha = Record<string, unknown>;

const mockEstado: {
  falhaRede: boolean;
  semRota: boolean;
  orgDoVinculo: string | null;
  comVan: boolean;
  userId: string;
  shifts: Linha[];
  insercoes: { tabela: string; payload: Linha }[];
  atualizacoes: { tabela: string; payload: Linha }[];
} = {
  falhaRede: false,
  semRota: false,
  orgDoVinculo: 'org-1',
  comVan: true,
  userId: 'driver-1',
  shifts: [],
  insercoes: [],
  atualizacoes: [],
};

/** ~Palo Alto. */
const mockVanCoords = { latitude: 37.4419, longitude: -122.143 };
/** ~3,2 km ao norte da van (fora do raio de 300 m). */
const mockLonge = { latitude: 37.471, longitude: -122.143 };

const mockLinhaVan: Linha = {
  id: 'van-1', name: 'Van — Palo Alto', kind: 'van', address_line_1: '3111 La Selva', city: 'Palo Alto',
  latitude: mockVanCoords.latitude, longitude: mockVanCoords.longitude, radius_meters: 300, is_default: true,
};

function mockParada(): Linha {
  return {
    id: 's1', sequence: 1, status: 'pending', stop_group_id: null,
    window_start: null, window_end: null, exact_time: null, priority: 'normal',
    pickup_proof_path: null, dropoff_proof_path: null,
    arrived_at: null, picked_up_at: null, completed_at: null, skipped_at: null, delivered_at: null,
    travel_seconds: null, dropoff_travel_seconds: null, status_updated_at: null,
    eta_notice_at: null, eta_notice_kind: null,
    dog: {
      id: 'd1', name: 'Bob', behavior_notes: null, medical_notes: null, photo_url: null,
      client: { name: 'Maria', address_line_1: '9 Client St', city: 'Palo Alto', phone: null, latitude: 37.01, longitude: -122.01, client_instructions: null },
    },
  };
}

const mockRota = {
  id: 'r1', organization_id: 'org-1', lock_version: 1, published_at: '2026-10-02T12:00:00.000Z',
  start_location_id: 'van-1', end_location_id: null,
  route_stops: [mockParada()],
};

function mockLeitura(tabela: string): Linha[] {
  if (tabela === 'routes') return mockEstado.semRota ? [] : [mockRota];
  if (tabela === 'organization_members') return mockEstado.orgDoVinculo ? [{ organization_id: mockEstado.orgDoVinculo, role: 'driver' }] : [];
  if (tabela === 'organization_locations') return mockEstado.comVan ? [mockLinhaVan] : [];
  if (tabela === 'driver_shifts') return mockEstado.shifts;
  if (tabela === 'profiles') return [{ full_name: 'Rafael' }];
  return [];
}

jest.mock('@/lib/supabase', () => {
  const cadeia = (tabela: string) => {
    const chain: Record<string, unknown> = {};
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: Linha | null = null;
    const mesmo = () => chain;
    for (const metodo of ['select', 'eq', 'gte', 'lt', 'lte', 'order', 'limit']) chain[metodo] = mesmo;
    chain.insert = (p: Linha) => { op = 'insert'; payload = p; return chain; };
    chain.update = (p: Linha) => { op = 'update'; payload = p; return chain; };
    chain.maybeSingle = async () => {
      if (mockEstado.falhaRede) return { data: null, error: { message: 'Network request failed' } };
      return { data: mockLeitura(tabela)[0] ?? null, error: null };
    };
    chain.single = async () => {
      if (mockEstado.falhaRede) return { data: null, error: { message: 'Network request failed' } };
      if (op === 'insert' && payload) {
        mockEstado.insercoes.push({ tabela, payload });
        if (tabela === 'driver_shifts') mockEstado.shifts.push({ id: `sh-${mockEstado.shifts.length + 1}`, ...payload });
        return { data: { id: 'novo' }, error: null };
      }
      return { data: mockLeitura(tabela)[0] ?? null, error: null };
    };
    chain.then = (res: (v: unknown) => unknown) => {
      if (mockEstado.falhaRede) return Promise.resolve({ data: null, error: { message: 'Network request failed' } }).then(res);
      if (op === 'insert' && payload) {
        mockEstado.insercoes.push({ tabela, payload });
        if (tabela === 'driver_shifts') mockEstado.shifts.push({ id: `sh-${mockEstado.shifts.length + 1}`, ...payload });
        return Promise.resolve({ data: [{ id: 'novo' }], error: null }).then(res);
      }
      if (op === 'update' && payload) {
        mockEstado.atualizacoes.push({ tabela, payload });
        if (tabela === 'driver_shifts') mockEstado.shifts = mockEstado.shifts.map((s) => ({ ...s, ...payload }));
        return Promise.resolve({ data: [{ id: 'sh' }], error: null }).then(res);
      }
      return Promise.resolve({ data: mockLeitura(tabela), error: null }).then(res);
    };
    return chain;
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: mockEstado.userId, user_metadata: { full_name: 'Rafael' } } } }) },
      from: (tabela: string) => cadeia(tabela),
      rpc: async () => ({ data: null, error: null }),
      channel: () => { const c: any = { on: () => c, subscribe: () => undefined }; return c; },
      removeChannel: () => undefined,
    },
  };
});

jest.mock('@/features/driver/locationService', () => ({
  getCurrentDriverLocation: jest.fn(async () => mockLonge),
  startLocationSharing: async () => ({ stop: () => undefined }),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('@/features/auth/useOrganizationRole', () => ({
  useOrganizationRole: () => ({ role: 'driver', view: 'driver', isLoading: false, canSwitchView: false, setView: () => undefined }),
}));

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    (require('react') as typeof React).useEffect(() => {
      const cleanup = callback();
      return typeof cleanup === 'function' ? cleanup : undefined;
    }, []);
  },
  useRouter: () => ({ push: () => undefined, replace: () => undefined, back: () => undefined }),
}));

const AsyncStorage = require('@react-native-async-storage/async-storage');
const { getCurrentDriverLocation } = require('@/features/driver/locationService') as {
  getCurrentDriverLocation: jest.Mock;
};

function insercoesDe(tabela: string) {
  return mockEstado.insercoes.filter((linha) => linha.tabela === tabela);
}

async function abrirTela() {
  const Tela = require('../app/(tabs)/driver').default;
  return render(<Tela />);
}

/** Botão do cartão → motivo (≥3 letras) → salvar. O caminho REAL da tela. */
async function registrar(tela: any, botao: string, motivo: string) {
  await fireEvent.press(tela.getByLabelText(botao));
  await waitFor(() => expect(tela.getByLabelText('Reason for the manual record')).toBeTruthy());
  await fireEvent.changeText(tela.getByLabelText('Reason for the manual record'), motivo);
  await fireEvent.press(tela.getByLabelText('Save manual record'));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockEstado.falhaRede = false;
  mockEstado.semRota = false;
  mockEstado.orgDoVinculo = 'org-1';
  mockEstado.comVan = true;
  mockEstado.userId = 'driver-1';
  mockEstado.shifts = [];
  mockEstado.insercoes = [];
  mockEstado.atualizacoes = [];
  mockRota.route_stops = [mockParada()]; // parada pendente (nada concluído por padrão)
  getCurrentDriverLocation.mockClear();
  getCurrentDriverLocation.mockResolvedValue(mockLonge);
});

describe('(2) CLOCK-OUT funciona LONGE da van — e nem consulta a localização', () => {
  it('fecha a jornada aberta sem tocar no GPS (prova: getCurrentDriverLocation não é chamado)', async () => {
    // Jornada manual ABERTA (o motorista já bateu o ponto; está longe da van agora).
    mockEstado.shifts = [{
      id: 'sh-open', started_at: '2026-10-02T07:00:00.000Z', ended_at: null,
      start_reason: 'Manual clock in', end_reason: null, route_id: null,
    }];

    const tela = await abrirTela();
    await waitFor(() => expect(tela.getByLabelText('Clock out')).toBeTruthy());

    const leiturasAntes = getCurrentDriverLocation.mock.calls.length; // 0: nada na tela lê GPS sozinho
    await registrar(tela, 'Clock out', 'Heading home');

    await waitFor(() => expect(mockEstado.atualizacoes.some((a) => a.tabela === 'driver_shifts')).toBe(true));
    const atual = mockEstado.atualizacoes.find((a) => a.tabela === 'driver_shifts')!.payload;
    expect(typeof atual.ended_at).toBe('string'); // fechou
    expect(atual.end_reason).toBe('Heading home');

    // 🎯 A PROVA: o clock-out NÃO consultou a localização (nem para negar, nem para permitir).
    expect(getCurrentDriverLocation).toHaveBeenCalledTimes(leiturasAntes);
    // E nenhum erro de "fora da van" apareceu no fechamento.
    expect(tela.queryByText(/Você está a/)).toBeNull();
  });
});

describe('(1) CLOCK-IN travado pela localização — longe da van é RECUSADO (exceto "anyway")', () => {
  it('longe da van: o toque normal NÃO grava; o botão de exceção grava com a distância no motivo', async () => {
    const tela = await abrirTela();
    await waitFor(() => expect(tela.getByLabelText('Clock in')).toBeTruthy());

    // Toque NORMAL, longe da van → recusado, nada gravado.
    await registrar(tela, 'Clock in', 'At the van');
    await waitFor(() => expect(tela.getByText(/Você está a/)).toBeTruthy());
    expect(insercoesDe('driver_shifts')).toHaveLength(0);
    expect(getCurrentDriverLocation).toHaveBeenCalled(); // o clock-in SIM consulta a localização (a trava)

    // A exceção explícita: registra mesmo longe, com a distância no motivo.
    await registrar(tela, 'Clock in anyway', 'Van broke down');
    await waitFor(() => expect(insercoesDe('driver_shifts')).toHaveLength(1));
    const gravada = insercoesDe('driver_shifts')[0].payload;
    expect(gravada.organization_id).toBe('org-1');
    expect(gravada.driver_id).toBe('driver-1');
    expect(String(gravada.start_reason)).toMatch(/outside the van/i); // a exceção fica VISÍVEL ao gestor
    expect(String(gravada.start_reason)).toMatch(/km|m\b/); // com a distância
  });
});

describe('(3) NENHUM clock automático', () => {
  it('rota toda concluída não cria jornada sozinha (a dedução é exibição, não registro)', async () => {
    mockEstado.shifts = [];
    // Parada já concluída → a jornada DEDUZIDA aparece como fechada, sem linha em driver_shifts.
    mockRota.route_stops = [{
      ...mockParada(), status: 'completed',
      arrived_at: '2026-10-02T11:00:00.000Z', completed_at: '2026-10-02T11:30:00.000Z',
    }];

    const tela = await abrirTela();
    await waitFor(() => expect(tela.getByTestId('cartao-jornada')).toBeTruthy());
    // A tela mostra uma jornada (deduzida)…
    await waitFor(() => expect(tela.getByText(/Worked out from your route stops/)).toBeTruthy());

    // …mas NADA foi gravado: sem toque do motorista não existe clock.
    expect(insercoesDe('driver_shifts')).toHaveLength(0);
    expect(mockEstado.atualizacoes).toHaveLength(0);
    expect(getCurrentDriverLocation).not.toHaveBeenCalled();
  });

  it('trocar de conta (mesma tela, outra identidade) não dá clock nem herda jornada aberta', async () => {
    const tela = await abrirTela();
    await waitFor(() => expect(tela.getByLabelText('Clock in')).toBeTruthy());

    // Trocou de conta: a MESMA tela recarrega como outro usuário (mesma organização).
    mockEstado.userId = 'admin-2';
    mockEstado.insercoes = [];
    mockEstado.atualizacoes = [];
    getCurrentDriverLocation.mockClear();
    const rolagem = tela.getByTestId('driver-scroll');
    await act(async () => { await rolagem.props.refreshControl.props.onRefresh(); });

    // Recarregar com outra conta NÃO cria jornada nem fecha nada sozinho.
    await waitFor(() => expect(tela.getByTestId('cartao-jornada')).toBeTruthy());
    expect(insercoesDe('driver_shifts')).toHaveLength(0);
    expect(mockEstado.atualizacoes).toHaveLength(0);
    expect(getCurrentDriverLocation).not.toHaveBeenCalled();
    tela.unmount();
  });
});
