/**
 * TOQUE NÃO PODE SER DESFEITO PELA CARGA (dono, 03/10/2026, testando o app):
 *
 * *"quando eu clico que clock in, que cheguei ou qualquer outro botão o sistema trava e dá roll Back
 * sendo necessário apertar duas vezes"*
 *
 * São DOIS defeitos, os dois na tela do motorista:
 *
 * 1. ROLL BACK — a carga disparada pelo foco/tempo real/puxar-para-atualizar pode estar EM VOO quando ele
 *    toca. A resposta dela é do estado ANTERIOR à escrita: aplicá-la apaga da tela o passo que ele já deu
 *    (a parada volta a `pending`) e ele toca de novo achando que nada aconteceu. Agora `load()` guarda uma
 *    GERAÇÃO de escrita: se o motorista gravou no meio da carga, a resposta dela é descartada.
 *
 * 2. TRAVA — a virada de perna ("I'm at the yard — start drop-offs") terminava em `await load()` SEM
 *    silêncio: a lista sumia e voltava com o indicador de carregando por cima a cada virada. Escrita do
 *    próprio motorista é otimista e a recarga é silenciosa (regra do projeto desde 01/10/2026).
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

/** O "banco" falso: o status da parada e o que já foi gravado. */
const mockEstado: {
  atualizacoes: { tabela: string; payload: Record<string, unknown> }[];
  statusDaParada: 'pending' | 'arrived' | 'picked_up' | 'completed' | 'skipped';
  deliveredAtDaParada: string | null;
  /** `true` = a PRÓXIMA consulta da rota congela os dados de AGORA e fica pendurada. */
  segurarConsulta: boolean;
} = { atualizacoes: [], statusDaParada: 'pending', deliveredAtDaParada: null, segurarConsulta: false };

/** Consulta em voo: guarda o que o banco responderia AGORA e libera quando o teste mandar. */
let mockConsultaEmVoo: { liberar: () => void } | null = null;

let mockPausaTabela: string | null = null;
let mockEscritaPendente: (() => void) | null = null;
let mockSegurarEscrita = false;
let mockOffline = false;
let mockLeituraOffline = false;
let mockRotaCancelada = false;
let mockRecusarStatus: string | null = null;
let mockRealtime: (() => void) | null = null;
let mockPausaLeitura: (() => void) | null = null;
let mockLocais: unknown[] = [];
let mockDuasPernas = false;
let mockDriverId = 'driver-1';

const mockRota = () => ({
  id: 'r1',
  organization_id: 'org-1',
  lock_version: 3,
  published_at: '2026-10-03T12:00:00.000Z',
  start_location_id: mockLocais.length ? 'van-1' : null,
  end_location_id: mockLocais.length ? 'yard-1' : null,
  phase: 'pickup',
  route_stops: [
    {
      id: 's1', sequence: 1, status: mockEstado.statusDaParada, stop_group_id: null,
      window_start: null, window_end: null, exact_time: null, priority: 'normal',
      pickup_proof_path: null, dropoff_proof_path: null,
      arrived_at: null, picked_up_at: null, completed_at: null, skipped_at: null,
      delivered_at: mockEstado.deliveredAtDaParada, status_updated_at: null,
      eta_notice_at: null, eta_notice_kind: null, handed_from_name: null, handed_at: null,
      travel_seconds: null, dropoff_travel_seconds: null, dropoff_sequence: null,
      phase: 'pickup',
      dog: {
        id: 'd1', name: 'Bob', behavior_notes: null, medical_notes: null, photo_url: null,
        client: {
          name: 'Maria', address_line_1: '9 Client St', city: 'Palo Alto', phone: '+155****1111',
          latitude: 37.01, longitude: -122.01, client_instructions: null,
        },
      },
    },
  ],
});

const mockRotasDoDia = () => {
  if (mockRotaCancelada) return [];
  const pickup = mockRota();
  if (!mockDuasPernas) return [pickup];
  return [{
    ...pickup, id: 'r2', phase: 'dropoff',
    route_stops: [{ ...pickup.route_stops[0], id: 's2', status: 'pending', phase: 'dropoff', dog: { ...pickup.route_stops[0].dog, id: 'd2', name: 'Luna' } }],
  }, pickup];
};

/**
 * A JORNADA está ABERTA? A lista de cães só vive com a jornada aberta + "Start pick-ups" (etapa do dia,
 * dono 03/10/2026, print do app: com "Journey closed." a lista do Billy NÃO pode estar na tela). Sem
 * turno aberto, a tela é só o cartão da jornada.
 */
let mockTurnoAberto = false;
/** O REGISTRO MANUAL ENCERRADO do print do dono ("7:56 PM → 9:13 PM"): o ponto foi batido e o dia acabou. */
let mockTurnoFechado = false;
const turnoDaJornada = () => ({
  id: 'sh-turno', started_at: new Date().toISOString(), ended_at: null,
  start_reason: 'Journey started', end_reason: null, route_id: 'r1',
});
const turnoEncerrado = () => ({
  id: 'sh-encerrado', started_at: new Date(Date.now() - 3600e3).toISOString(),
  ended_at: new Date().toISOString(), start_reason: 'Journey started',
  end_reason: 'Journey finished', route_id: 'r1',
});

/** A PRÓXIMA consulta segurada responde com ERRO DE REDE (o caminho offline, que aplica o snapshot velho). */
let mockFalharConsulta = false;

jest.mock('@/lib/supabase', () => {
  const dados = (tabela: string) => (
    tabela === 'routes' ? mockRotasDoDia()
      : tabela === 'organization_locations' ? mockLocais
        : tabela === 'driver_shifts' ? (mockTurnoAberto ? [turnoDaJornada()] : mockTurnoFechado ? [turnoEncerrado()] : [])
          : []
  );
  const cadeia = (tabela: string) => {
    const chain: Record<string, unknown> = {};
    let payloadDoUpdate: Record<string, unknown> | null = null;
    const mesmo = () => chain;
    chain.select = mesmo;
    chain.eq = mesmo; chain.gte = mesmo; chain.lt = mesmo; chain.lte = mesmo; chain.order = mesmo; chain.limit = mesmo;
    chain.or = mesmo;
    chain.maybeSingle = mesmo; chain.insert = mesmo; chain.delete = mesmo; chain.upsert = () => Promise.resolve({ error: null });
    chain.update = (payload: Record<string, unknown>) => { payloadDoUpdate = payload; mockEstado.atualizacoes.push({ tabela, payload }); return chain; };
    chain.then = (res: (v: unknown) => unknown) => {
      if (tabela === 'routes' && mockLeituraOffline) return Promise.resolve({ data: null, error: { message: 'Network request failed' } }).then(res);
      if (tabela === 'routes' && mockEstado.segurarConsulta && !mockConsultaEmVoo) {
        // CONGELA o que o banco responderia AGORA e segura a resposta (é a carga que nasceu antes do toque).
        mockEstado.segurarConsulta = false;
        const congelado = { data: dados('routes'), error: null };
        return new Promise((resolve) => {
          mockConsultaEmVoo = {
            liberar: () => resolve(mockFalharConsulta
              ? { data: null, error: { message: 'Network request failed' } }
              : congelado),
          };
        }).then(res);
      }
      if (!payloadDoUpdate && tabela === mockPausaTabela) {
        mockPausaTabela = null;
        const congelado = { data: dados(tabela), error: null };
        return new Promise(resolve => { mockPausaLeitura = () => resolve(congelado); }).then(res);
      }
      if (payloadDoUpdate) {
        if (mockRecusarStatus && payloadDoUpdate.status === mockRecusarStatus) return Promise.resolve({ data: null, error: { message: 'row-level security policy' } }).then(res);
        if (mockOffline) return Promise.resolve({ data: null, error: { message: 'Network request failed' } }).then(res);
        if (mockSegurarEscrita) {
          mockSegurarEscrita = false;
          return new Promise(resolve => { mockEscritaPendente = () => {
            mockEstado.statusDaParada = payloadDoUpdate!.status as typeof mockEstado.statusDaParada;
            resolve({ data: [{ id: 's1' }], error: null });
          }; }).then(res);
        }
        if (tabela === 'route_stops' && typeof payloadDoUpdate.status === 'string') {
          mockEstado.statusDaParada = payloadDoUpdate.status as typeof mockEstado.statusDaParada;
        }
        if (tabela === 'route_stops' && typeof payloadDoUpdate.delivered_at === 'string') {
          mockEstado.deliveredAtDaParada = payloadDoUpdate.delivered_at as string;
        }
        return Promise.resolve({ data: [{ id: 's1' }], error: null }).then(res);
      }
      return Promise.resolve({ data: dados(tabela), error: null }).then(res);
    };
    return chain;
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: mockDriverId } } }) },
      from: (tabela: string) => cadeia(tabela),
      rpc: async () => ({ data: null, error: null }),
      channel: () => {
        const channel = { on: (_event: unknown, _filter: unknown, callback: () => void) => { mockRealtime = callback; return channel; }, subscribe: () => undefined };
        return channel;
      },
      removeChannel: () => undefined,
    },
  };
});

jest.mock('@/features/driver/locationService', () => ({
  getCurrentDriverLocation: async () => null,
  startLocationSharing: async () => ({ stop: () => undefined }),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('@/features/auth/useOrganizationRole', () => ({
  useOrganizationRole: () => ({ role: 'driver', view: 'driver', isLoading: false }),
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

const AsyncStorage = require('@react-native-async-storage/async-storage') as typeof import('@react-native-async-storage/async-storage').default;

async function abrirTela() {
  mockTurnoAberto = true; // jornada aberta: a lista vive depois do "Start pick-ups"
  // Este arquivo olha a lista: entra com o dia COMEÇADO (rota `r1` × `driver-1`).
  await (require('@/features/driver/dayPhaseStore') as typeof import('@/features/driver/dayPhaseStore')).gravarBuscaIniciada('r1', mockDriverId);
  const Tela = require('../app/(tabs)/driver').default;
  const tela = await render(<Tela />);
  await waitFor(() => expect(tela.getByLabelText('Next stop: I arrived for Bob')).toBeTruthy());
  return tela;
}

/** Solta a resposta da consulta que ficou em voo. */
async function liberarConsulta() {
  const emVoo = mockConsultaEmVoo;
  mockConsultaEmVoo = null;
  await act(async () => { emVoo?.liberar(); });
}

const statusGravados = () => mockEstado.atualizacoes.map((linha) => linha.payload.status).filter(Boolean);

beforeEach(async () => {
  await AsyncStorage.clear();
  mockConsultaEmVoo = null;
  mockPausaTabela = null;
  mockPausaLeitura = null;
  mockEscritaPendente = null;
  mockSegurarEscrita = false;
  mockOffline = false;
  mockLeituraOffline = false;
  mockRotaCancelada = false;
  mockRecusarStatus = null;
  mockRealtime = null;
  mockDuasPernas = false;
  mockLocais = [];
  mockDriverId = 'driver-1';
  mockEstado.atualizacoes.length = 0;
  mockEstado.statusDaParada = 'pending';
  mockEstado.deliveredAtDaParada = null;
  mockEstado.segurarConsulta = false;
  mockTurnoAberto = false;
  mockTurnoFechado = false;
  mockFalharConsulta = false;
});

describe('o toque do motorista sobrevive à carga em voo', () => {
  it('a resposta VELHA de uma carga em voo não desfaz o toque (nada de apertar duas vezes)', async () => {
    const tela = await abrirTela();

    // Uma carga fica EM VOO: ela congelou o estado de AGORA (parada `pending`) e ainda não voltou.
    mockEstado.segurarConsulta = true;
    const rolagem = tela.getByTestId('driver-scroll');
    await act(async () => { void rolagem.props.refreshControl.props.onRefresh(); });
    await waitFor(() => expect(mockConsultaEmVoo).not.toBeNull());

    // O motorista toca: a escrita LANDOU no banco (a releitura já devolve `arrived`).
    await fireEvent.press(tela.getByLabelText('Next stop: I arrived for Bob'));
    await waitFor(() => expect(statusGravados()).toContain('arrived'));
    expect(tela.getByLabelText('Next stop: Next for Bob')).toBeTruthy();

    // Agora chega a resposta daquela carga antiga. Ela NÃO pode ser aplicada: o estado da tela é mais novo.
    await liberarConsulta();

    await waitFor(() => expect(tela.getByLabelText('Next stop: Next for Bob')).toBeTruthy());
    expect(tela.queryByLabelText('Next stop: I arrived for Bob')).toBeNull();
    // E sem "carregando" por cima: quem tocou não fica olhando rodinha.
    expect(tela.queryByTestId('driver-loading')).toBeNull();
  });

  it('a carga que CAI POR REDE também não desfaz o toque (o snapshot velho não pode voltar)', async () => {
    /*
     * O dono descreveu exatamente isto, com vídeo: *"eu aperto o botão, ele confirma a ação e logo em seguida
     * volta pra ação passada"*. Era a carga que caía por REDE e aplicava o SNAPSHOT local — mais velho que o
     * toque — por cima do estado da tela (o caminho offline não tinha a mesma proteção do online).
     */
    const tela = await abrirTela();

    mockEstado.segurarConsulta = true;
    mockFalharConsulta = true; // a carga desta vez cai por rede e vai aplicar o cache
    const rolagem = tela.getByTestId('driver-scroll');
    await act(async () => { void rolagem.props.refreshControl.props.onRefresh(); });
    await waitFor(() => expect(mockConsultaEmVoo).not.toBeNull());

    await fireEvent.press(tela.getByLabelText('Next stop: I arrived for Bob'));
    await waitFor(() => expect(mockEstado.statusDaParada).toBe('arrived'));

    // A resposta de rede chega agora: o cache é mais VELHO que o toque, então ele não é aplicado.
    await act(async () => { liberarConsulta(); });
    await waitFor(() => expect(tela.getByLabelText('Next stop: Next for Bob')).toBeTruthy());
    expect(tela.queryByTestId('driver-loading')).toBeNull();
  });

  it('a virada para o DROP-OFF não joga a tela em "carregando" (a lista não some)', async () => {
    mockDuasPernas = true;
    mockLocais = [
      { id: 'van-1', name: 'Van 1', kind: 'van', address_line_1: '3111 La Selva', city: 'San Mateo', latitude: 37.54, longitude: -122.28, radius_meters: 300, is_default: true },
      { id: 'yard-1', name: 'Yard', kind: 'yard', address_line_1: '1089 Memorex Drive', city: 'Santa Clara', latitude: 37.36, longitude: -122.95, radius_meters: 300, is_default: false },
    ];
    const tela = await abrirTela();

    // Fecha a busca (chegou → pegou+concluiu): o cão está na van e o dia pede o YARD.
    await fireEvent.press(tela.getByLabelText('Next stop: I arrived for Bob'));
    await waitFor(() => expect(tela.getByLabelText('Next stop: Next for Bob')).toBeTruthy());
    await fireEvent.press(tela.getByLabelText('Next stop: Next for Bob'));
    await waitFor(() => expect(tela.getByText("I'm at the yard — start drop-offs")).toBeTruthy());

    // A carga que a virada dispara fica em voo: é justo o instante em que a tela NÃO pode entrar em "carregando".
    mockEstado.segurarConsulta = true;
    await fireEvent.press(tela.getByText("I'm at the yard — start drop-offs"));

    expect(tela.queryByTestId('driver-loading')).toBeNull();
    await waitFor(() => expect(mockConsultaEmVoo).not.toBeNull());
    expect(tela.queryByTestId('driver-loading')).toBeNull();

    await liberarConsulta();
    await waitFor(() => expect(tela.getByText('DROP-OFFS')).toBeTruthy());
  });

  /**
   * A ETAPA DO DIA (dono, 03/10/2026): *"quero que tudo siga pelas etapas: os cachorros do pick up só
   * apareçam depois de dar clock in e apertar pick up"*. Antes de o motorista começar, a tela é SÓ o cartão
   * da jornada (é ele que tem o "Start pick-ups"); a marca fica no APARELHO, então a recarga (foco, tempo
   * real, reabrir o app) não volta a esconder a lista.
   */
  it('antes de "Start pick-ups" a tela é só o cartão da jornada (sem lista de cães)', async () => {
    const Tela = require('../app/(tabs)/driver').default;
    const tela = await render(<Tela />);
    await waitFor(() => expect(tela.getByTestId('cartao-jornada')).toBeTruthy());

    // Nada de lista: nem o cartão da próxima parada, nem a parada do dia.
    expect(tela.queryByLabelText('Next stop: I arrived for Bob')).toBeNull();
    expect(tela.getByText("Clock in and tap Start Route to see today's stops.")).toBeTruthy();
  });

  it('com a JORNADA FECHADA a lista não aparece — mesmo com o dia já começado antes (print do dono)', async () => {
    /*
     * O dono viu exatamente isto no app: "Journey closed." e a lista do Billy na tela. A marca do "Start
     * pick-ups" continua gravada (ele já tinha começado o dia antes), mas o registro manual está ENCERRADO:
     * o ponto de saída foi batido, o dia acabou para a tela e a lista tem de sair.
     */
    mockTurnoFechado = true;
    await (require('@/features/driver/dayPhaseStore') as typeof import('@/features/driver/dayPhaseStore')).gravarBuscaIniciada('r1', 'driver-1');
    const Tela = require('../app/(tabs)/driver').default;
    const tela = await render(<Tela />);

    await waitFor(() => expect(tela.getByTestId('cartao-jornada')).toBeTruthy());
    expect(tela.queryByLabelText('Next stop: I arrived for Bob')).toBeNull();
    expect(tela.getByText("Clock in and tap Start Route to see today's stops.")).toBeTruthy();
  });

  it('a fase gravada do DIA não abre a entrega antes do yard NESTA sessão (dono, 04/10/2026)', async () => {
    /*
     * *"os cachorros do drop off aparecem antes de apertar no botão que chegou no yard"*.
     *
     * O caso dele: a busca já acabou (as paradas todas `completed`) e a fase do dia ficou gravada em `dropoff`
     * — então a tela reabria DIRETO na entrega. Quem abre a entrega é o toque no botão do yard: a carga nova
     * volta para a BUSCA e o botão do yard fica esperando.
     */
    mockDuasPernas = true;
    mockEstado.statusDaParada = 'completed'; // a busca terminou (é o estado real do dia dele)
    mockTurnoAberto = true; // a jornada está aberta (a lista pode aparecer)
    const store = require('@/features/driver/dayPhaseStore') as typeof import('@/features/driver/dayPhaseStore');
    await store.gravarBuscaIniciada('r1', 'driver-1'); // o dia já começou: "Start pick-ups" já foi apertado
    await store.gravarFase('r1', 'driver-1', 'dropoff'); // e a fase do dia ficou na ENTREGA

    const Tela = require('../app/(tabs)/driver').default;
    const tela = await render(<Tela />);

    await waitFor(() => expect(tela.getByText('PICK-UPS')).toBeTruthy());
    expect(tela.queryByText('DROP-OFFS')).toBeNull();
    // E o caminho para a entrega continua na mão dele: o botão do yard está lá.
    expect(tela.getByLabelText('Start drop-offs')).toBeTruthy();
  });

  it('com a marca gravada e a jornada ABERTA o dia abre com a lista (a recarga não volta a esconder)', async () => {
    mockTurnoAberto = true;
    await (require('@/features/driver/dayPhaseStore') as typeof import('@/features/driver/dayPhaseStore')).gravarBuscaIniciada('r1', 'driver-1');
    const Tela = require('../app/(tabs)/driver').default;
    const tela = await render(<Tela />);

    await waitFor(() => expect(tela.getByLabelText('Next stop: I arrived for Bob')).toBeTruthy());
    expect(tela.queryByText("Clock in and tap Start Route to see today's stops.")).toBeNull();
  });
});


describe('reconciliação da tela após as consultas de rota', () => {
  it.each(['organization_locations', 'driver_shifts'])('não desfaz botão quando %s termina depois do toque', async tabela => {
    const tela = await abrirTela();
    mockPausaTabela = tabela;
    let refresh: Promise<void>;
    await act(async () => { refresh = tela.getByTestId('driver-scroll').props.refreshControl.props.onRefresh(); });
    await waitFor(() => expect(mockPausaLeitura).not.toBeNull());
    await fireEvent.press(tela.getByLabelText('Next stop: I arrived for Bob'));
    await waitFor(() => expect(mockEstado.statusDaParada).toBe('arrived'));
    await act(async () => { mockPausaLeitura!(); await refresh!; });
    expect(tela.getByLabelText('Next stop: Next for Bob')).toBeTruthy();
  });

  it('refresh iniciado durante UPDATE pendente não apaga o estado otimista', async () => {
    const tela = await abrirTela();
    mockSegurarEscrita = true;
    await fireEvent.press(tela.getByLabelText('Next stop: I arrived for Bob'));
    await waitFor(() => expect(mockEscritaPendente).not.toBeNull());
    let refresh: Promise<void>;
    await act(async () => { refresh = tela.getByTestId('driver-scroll').props.refreshControl.props.onRefresh(); });
    expect(tela.getByLabelText('Next stop: Next for Bob')).toBeTruthy();
    await act(async () => { mockEscritaPendente!(); await refresh!; });
    expect(tela.getByLabelText('Next stop: Next for Bob')).toBeTruthy();
  });

  it('o botão offline confirmado pelo sync não volta ao snapshot anterior ao sync', async () => {
    const tela = await abrirTela();
    mockOffline = true;
    await fireEvent.press(tela.getByLabelText('Next stop: I arrived for Bob'));
    await waitFor(() => expect(tela.getByText(/This change is saved on your device/)).toBeTruthy());
    mockOffline = false;
    await act(async () => { await tela.getByTestId('driver-scroll').props.refreshControl.props.onRefresh(); });
    expect(mockEstado.statusDaParada).toBe('arrived');
    expect(tela.getByLabelText('Next stop: Next for Bob')).toBeTruthy();
    const { loadOutbox } = require('@/features/driver/offlineStore');
    expect(await loadOutbox()).toEqual([]);
  });
});


it('realtime durante UPDATE mantém o botão otimista e reconcilia depois da confirmação', async () => {
  const tela = await abrirTela();
  mockSegurarEscrita = true;
  await fireEvent.press(tela.getByLabelText('Next stop: I arrived for Bob'));
  await waitFor(() => expect(mockEscritaPendente).not.toBeNull());
  jest.useFakeTimers();
  try {
    await act(async () => { mockRealtime!(); jest.advanceTimersByTime(800); });
    expect(tela.getByLabelText('Next stop: Next for Bob')).toBeTruthy();
    await act(async () => { mockEscritaPendente!(); });
    expect(tela.getByLabelText('Next stop: Next for Bob')).toBeTruthy();
  } finally { jest.useRealTimers(); }
});

it('replay atrasado de arrived não sobrescreve o Next enviado enquanto sincroniza', async () => {
  const tela = await abrirTela();
  mockOffline = true;
  await fireEvent.press(tela.getByLabelText('Next stop: I arrived for Bob'));
  await waitFor(() => expect(tela.getByText(/This change is saved on your device/)).toBeTruthy());
  mockOffline = false;
  mockSegurarEscrita = true;
  let refresh: Promise<void>;
  await act(async () => { refresh = tela.getByTestId('driver-scroll').props.refreshControl.props.onRefresh(); });
  await waitFor(() => expect(mockEscritaPendente).not.toBeNull());
  await fireEvent.press(tela.getByLabelText('Next stop: Next for Bob'));
  // A escrita nova não ultrapassa o replay antigo no servidor.
  expect(statusGravados()).not.toContain('picked_up');
  await act(async () => { mockEscritaPendente!(); await refresh!; });
  expect(mockEstado.statusDaParada).toBe('completed');
  expect(tela.queryByLabelText('Next stop: Next for Bob')).toBeNull();
  expect(statusGravados().slice(-2)).toEqual(['picked_up', 'completed']);
});

it('confirmação removida da fila sobrevive à próxima consulta offline em ambas as pernas do cache', async () => {
  const tela = await abrirTela();
  mockOffline = true;
  await fireEvent.press(tela.getByLabelText('Next stop: I arrived for Bob'));
  await waitFor(() => expect(tela.getByText(/This change is saved on your device/)).toBeTruthy());
  mockOffline = false;
  await act(async () => { await tela.getByTestId('driver-scroll').props.refreshControl.props.onRefresh(); });
  mockLeituraOffline = true;
  await act(async () => { await tela.getByTestId('driver-scroll').props.refreshControl.props.onRefresh(); });
  expect(tela.getByLabelText('Next stop: Next for Bob')).toBeTruthy();
  const { loadRouteSnapshot, loadOutbox } = require('@/features/driver/offlineStore');
  const cache = await loadRouteSnapshot();
  expect(cache.stops[0].status).toBe('arrived');
  expect(cache.routes[0].route_stops[0].status).toBe('arrived');
  expect(await loadOutbox()).toEqual([]);
});

it('yard liberado para uma conta não libera a entrega da outra conta', async () => {
  mockDuasPernas = true;
  mockEstado.statusDaParada = 'completed';
  mockTurnoAberto = true;
  const store = require('@/features/driver/dayPhaseStore');
  for (const id of ['driver-1', 'driver-2']) {
    await store.gravarBuscaIniciada('r1', id);
    await store.gravarFase('r1', id, 'dropoff');
  }
  const Tela = require('../app/(tabs)/driver').default;
  const tela = await render(<Tela />);
  await waitFor(() => expect(tela.getByTestId('start-dropoffs')).toBeTruthy());
  await fireEvent.press(tela.getByTestId('start-dropoffs'));
  await waitFor(() => expect(tela.getByLabelText('Next stop: Delivered for Luna')).toBeTruthy());
  mockDriverId = 'driver-2';
  await act(async () => { await tela.getByTestId('driver-scroll').props.refreshControl.props.onRefresh(); });
  expect(tela.getByText('PICK-UPS')).toBeTruthy();
  expect(tela.queryByLabelText('Next stop: Delivered for Luna')).toBeNull();
});


it('troca de fase solicitada durante locations termina com rota e jornada da entrega', async () => {
  mockDuasPernas = true;
  mockEstado.statusDaParada = 'completed';
  mockTurnoAberto = true;
  await (require('@/features/driver/dayPhaseStore')).gravarBuscaIniciada('r1', mockDriverId);
  const Tela = require('../app/(tabs)/driver').default;
  const tela = await render(<Tela />);
  await waitFor(() => expect(tela.getByTestId('start-dropoffs')).toBeTruthy());
  mockPausaTabela = 'organization_locations';
  let refresh: Promise<void>;
  await act(async () => { refresh = tela.getByTestId('driver-scroll').props.refreshControl.props.onRefresh(); });
  await waitFor(() => expect(mockPausaLeitura).not.toBeNull());
  await fireEvent.press(tela.getByTestId('start-dropoffs'));
  await act(async () => { mockPausaLeitura!(); await refresh!; });
  await waitFor(() => expect(tela.getByLabelText('Next stop: Delivered for Luna')).toBeTruthy());
  expect(tela.getByText('DROP-OFFS')).toBeTruthy();
  expect(tela.queryByTestId('start-dropoffs')).toBeNull();
  expect(tela.queryByTestId('driver-loading')).toBeNull();
});

it('uma ação aguardando replay não é enviada usando a conta que entrou depois', async () => {
  const tela = await abrirTela();
  mockOffline = true;
  await fireEvent.press(tela.getByLabelText('Next stop: I arrived for Bob'));
  await waitFor(() => expect(tela.getByText(/This change is saved on your device/)).toBeTruthy());
  mockOffline = false;
  mockSegurarEscrita = true;
  let refresh: Promise<void>;
  await act(async () => { refresh = tela.getByTestId('driver-scroll').props.refreshControl.props.onRefresh(); });
  await waitFor(() => expect(mockEscritaPendente).not.toBeNull());
  await fireEvent.press(tela.getByLabelText('Next stop: Next for Bob'));
  mockDriverId = 'driver-2';
  await act(async () => { mockEscritaPendente!(); await refresh!; });
  expect(statusGravados()).not.toContain('picked_up');
  expect(statusGravados()).not.toContain('completed');
  expect(tela.queryByLabelText('Next stop: Next for Bob')).toBeNull();
  expect(tela.getByText("Clock in and tap Start Route to see today's stops.")).toBeTruthy();
  const outro = await AsyncStorage.getItem('pnp:driver:outbox:driver-2');
  expect(JSON.parse(outro ?? '[]')).toEqual([]);
});


it('recusa do segundo passo do Next preserva só picked_up confirmado e mostra o aviso', async () => {
  const tela = await abrirTela();
  await fireEvent.press(tela.getByLabelText('Next stop: I arrived for Bob'));
  await waitFor(() => expect(mockEstado.statusDaParada).toBe('arrived'));
  mockRecusarStatus = 'completed';
  await fireEvent.press(tela.getByLabelText('Next stop: Next for Bob'));
  await waitFor(() => expect(tela.getByText(/The office did not accept this step/)).toBeTruthy());
  expect(mockEstado.statusDaParada).toBe('picked_up');
  expect(tela.getByLabelText('Next stop: Next for Bob')).toBeTruthy();
  const cache = await (require('@/features/driver/offlineStore')).loadRouteSnapshot();
  expect(cache.stops[0].status).toBe('picked_up');
  expect(cache.routes[0].route_stops[0].status).toBe('picked_up');
});

it('rota cancelada descarta o cache mesmo depois de um botão confirmado', async () => {
  const tela = await abrirTela();
  await fireEvent.press(tela.getByLabelText('Next stop: I arrived for Bob'));
  await waitFor(() => expect(mockEstado.statusDaParada).toBe('arrived'));
  mockRotaCancelada = true;
  await act(async () => { await tela.getByTestId('driver-scroll').props.refreshControl.props.onRefresh(); });
  expect(await (require('@/features/driver/offlineStore')).loadRouteSnapshot()).toBeNull();
  expect(tela.queryByLabelText('Next stop: Next for Bob')).toBeNull();
  mockLeituraOffline = true;
  await act(async () => { await tela.getByTestId('driver-scroll').props.refreshControl.props.onRefresh(); });
  expect(tela.queryByLabelText('Next stop: Next for Bob')).toBeNull();
});

it('concluir a busca não oferece Delivered antes do botão do yard, inclusive durante refresh lento', async () => {
  const tela = await abrirTela();
  await fireEvent.press(tela.getByLabelText('Next stop: I arrived for Bob'));
  await waitFor(() => expect(tela.getByLabelText('Next stop: Next for Bob')).toBeTruthy());
  await fireEvent.press(tela.getByLabelText('Next stop: Next for Bob'));
  await waitFor(() => expect(tela.getByTestId('start-dropoffs')).toBeTruthy());
  expect(tela.queryByLabelText('Next stop: Delivered for Bob')).toBeNull();
  expect(tela.queryByLabelText('Delivered Bob')).toBeNull();
  mockPausaTabela = 'organization_locations';
  let refresh: Promise<void>;
  await act(async () => { refresh = tela.getByTestId('driver-scroll').props.refreshControl.props.onRefresh(); });
  await waitFor(() => expect(mockPausaLeitura).not.toBeNull());
  await fireEvent.press(tela.getByTestId('start-dropoffs'));
  await act(async () => { mockPausaLeitura!(); await refresh!; });
  await waitFor(() => expect(tela.getByLabelText('Next stop: Delivered for Bob')).toBeTruthy());
});
