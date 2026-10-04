/**
 * FLUXO DE 2 TOQUES DO MOTORISTA — pedido do dono (áudios de 30/09/2026):
 * "resolver a questão do driver, o aplicativo do driver. Se diminuir a quantidade de vezes que você
 *  tem que clicar. Tem que ser, tipo assim, I arrived e next. Talvez dois cliques."
 *
 * O que este arquivo prova (tela de verdade, com o banco falsificado):
 *  - o 1º toque ("I arrived") grava `arrived`;
 *  - o 2º toque ("Next") grava `picked_up` E `completed`, NESTA ORDEM e em DUAS escritas — é o que
 *    faz o trigger do banco carimbar `picked_up_at` e `completed_at`: os 3 registros de auditoria da
 *    parada (chegou / pegou / concluiu) continuam existindo, sem buraco no meio;
 *  - sem rede, a fila do aparelho guarda os passos e sobe TODOS quando o sinal voltar (a foto
 *    continua fora do fluxo e o "Problem" continua pedindo motivo — nada disso mudou).
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockEstado: {
  atualizacoes: { tabela: string; payload: Record<string, unknown> }[];
  rpcs: { nome: string; params: Record<string, unknown> }[];
  /** Status atual da parada no "banco": o app relê a rota depois de cada toque. */
  statusDaParada: 'pending' | 'arrived' | 'picked_up' | 'completed' | 'skipped';
  /** Sem sinal: todo `update` responde erro de rede. */
  falhaDeRede: boolean;
  /** O servidor RECUSOU a escrita (RLS, parada fora da rota) — erro que não é de rede. */
  recusaDoServidor: string | null;
  /** `true` = o `update` responde SUCESSO com ZERO linha (policy bloqueou). */
  escritaSemLinha: boolean;
  /** `delivered_at` da parada no "banco" (a entrega confirmada, migration 041). */
  deliveredAtDaParada: string | null;
  /** Sedes que a ROTA aponta (o fim = o yard, pedido do cliente 02/10/2026). */
  startLocationId: string | null;
  endLocationId: string | null;
  /** Rota PUBLICADA sem nenhuma parada (vistoria 02/10/2026 — não pode virar "No published route"). */
  semParadas: boolean;
  /** `getUser` devolve SESSÃO AUSENTE (vistoria 02/10/2026 — não pode virar "No published route"). */
  semSessao: boolean;
  /** Quantas vezes a ROTA foi consultada — prova a guarda de `load()` em execução em curso. */
  consultasRota: number;
} = {
  atualizacoes: [],
  rpcs: [],
  statusDaParada: 'pending',
  falhaDeRede: false,
  recusaDoServidor: null,
  escritaSemLinha: false,
  deliveredAtDaParada: null,
  startLocationId: null,
  endLocationId: null,
  semParadas: false,
  semSessao: false,
  consultasRota: 0,
};

/** Rota publicada de hoje com UMA parada pendente (o caminho curto: chegou → pegou+concluiu). */
/** Sedes da organização (van/yard). Vazio por padrão: os testes antigos não precisam delas. */
let mockLocais: unknown[] = [];
let mockDuasPernas = false;
let mockDriverId = 'driver-1';
let mockLeituraOffline = false;
let mockSemColunaFase = false;
let mockConsultas: { campos: string; filtros: Record<string, unknown>; limite?: number }[] = [];
const mockRotasDoDia = () => {
  const pickup = { ...mockRota(), phase: 'pickup' };
  if (!mockDuasPernas) return [pickup];
  return [{ ...pickup, id: 'r2', phase: 'dropoff', end_location_id: 'van-1',
    route_stops: pickup.route_stops.map(stop => ({ ...stop, id: 's2', status: 'pending',
      dog: { ...stop.dog, id: 'd2', name: 'Luna' } })) }, pickup];
};

const mockRota = () => ({
  id: 'r1',
  organization_id: 'org-1',
  lock_version: 3,
  published_at: '2026-09-30T12:00:00.000Z',
  start_location_id: mockEstado.startLocationId,
  end_location_id: mockEstado.endLocationId,
  organization: { proof_pickup_required: false, proof_dropoff_required: false },
  route_stops: mockEstado.semParadas ? [] : [
    {
      id: 's1',
      sequence: 1,
      status: mockEstado.statusDaParada,
      stop_group_id: null,
      window_start: null,
      window_end: null,
      exact_time: null,
      priority: 'normal',
      pickup_proof_path: null,
      dropoff_proof_path: null,
      arrived_at: null,
      picked_up_at: null,
      completed_at: null,
      skipped_at: null,
      delivered_at: mockEstado.deliveredAtDaParada,
      status_updated_at: null,
      eta_notice_at: null,
      eta_notice_kind: null,
      dog: {
        id: 'd1',
        name: 'Bob',
        behavior_notes: null,
        medical_notes: null,
        photo_url: null,
        client: {
          name: 'Maria',
          address_line_1: '9 Client St',
          city: 'Palo Alto',
          phone: '+155****1111',
          latitude: 37.01,
          longitude: -122.01,
          client_instructions: null,
        },
      },
    },
  ],
});

jest.mock('@/lib/supabase', () => {
  const dados = (tabela: string) => (
    tabela === 'routes' ? mockRotasDoDia()
      : tabela === 'organization_locations' ? mockLocais
        : tabela === 'driver_shifts' ? [{
          id: 'sh-turno', started_at: new Date().toISOString(), ended_at: null,
          start_reason: 'Journey started', end_reason: null, route_id: 'r1',
        }]
          : []
  );
  const cadeia = (tabela: string) => {
    const chain: Record<string, unknown> = { __tabela: tabela };
    let payloadDoUpdate: Record<string, unknown> | null = null;
    const mesmo = () => chain;
    const consulta = { campos: '', filtros: {} as Record<string, unknown>, limite: undefined as number | undefined };
    if (tabela === 'routes') mockConsultas.push(consulta);
    chain.select = (campos: string) => { consulta.campos = campos; return chain; };
    chain.eq = (campo: string, valor: unknown) => { consulta.filtros[campo] = valor; return chain; };
    chain.gte = mesmo;
    chain.lt = mesmo;
    chain.lte = mesmo;
    chain.order = mesmo;
    chain.limit = (limite: number) => { consulta.limite = limite; return chain; };
    chain.maybeSingle = mesmo;
    chain.insert = mesmo;
    chain.upsert = () => Promise.resolve({ error: null });
    chain.delete = mesmo;
    chain.update = (payload: Record<string, unknown>) => {
      payloadDoUpdate = payload;
      mockEstado.atualizacoes.push({ tabela, payload });
      return chain;
    };
    chain.then = (res: (v: unknown) => unknown) => {
      if (tabela === 'routes' && mockLeituraOffline) return Promise.resolve({ data: null, error: { message: 'Network request failed' } }).then(res);
      if (tabela === 'routes' && mockSemColunaFase && consulta.campos.startsWith('phase,')) {
        return Promise.resolve({ data: null, error: { code: '42703', message: 'column routes.phase does not exist' } }).then(res);
      }
      if (payloadDoUpdate) {
        if (mockEstado.falhaDeRede) {
          return Promise.resolve({ data: null, error: { message: 'Network request failed' } }).then(res);
        }
        // O servidor RECUSOU (RLS/parada fora da rota): erro que não é de rede.
        if (mockEstado.recusaDoServidor) {
          return Promise.resolve({ data: null, error: { message: mockEstado.recusaDoServidor } }).then(res);
        }
        // UPDATE que não pega linha nenhuma (policy bloqueou): SUCESSO com zero linha.
        if (mockEstado.escritaSemLinha) {
          return Promise.resolve({ data: [], error: null }).then(res);
        }
        // O servidor aceitou: o "banco" falso passa a devolver o status novo na releitura.
        if (tabela === 'route_stops' && typeof payloadDoUpdate.status === 'string') {
          mockEstado.statusDaParada = payloadDoUpdate.status as typeof mockEstado.statusDaParada;
        }
        if (tabela === 'route_stops' && typeof payloadDoUpdate.delivered_at === 'string') {
          mockEstado.deliveredAtDaParada = payloadDoUpdate.delivered_at as string;
        }
        // Escrita com `.select('id')`: o PostgREST devolve a linha atingida (é o que faz o app
        // perceber um UPDATE que não pegou linha nenhuma).
        return Promise.resolve({ data: [{ id: 's1' }], error: null }).then(res);
      }
      return Promise.resolve({ data: dados(tabela), error: null }).then(res);
    };
    return chain;
  };
  return {
    supabase: {
      auth: { getUser: async () => (mockEstado.semSessao
        ? { data: { user: null } }
        : { data: { user: { id: mockDriverId } } }) },
      from: (tabela: string) => {
        if (tabela === 'routes') mockEstado.consultasRota += 1;
        return cadeia(tabela);
      },
      rpc: async (nome: string, params: Record<string, unknown>) => {
        mockEstado.rpcs.push({ nome, params });
        return { data: null, error: null };
      },
      channel: () => ({ on: () => ({ on: () => ({ subscribe: () => undefined }), subscribe: () => undefined }) }),
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

let mockPapel: { role: string | null; view: string | null; isLoading: boolean } = { role: 'driver', view: 'driver', isLoading: false };
jest.mock('@/features/auth/useOrganizationRole', () => ({
  useOrganizationRole: () => mockPapel,
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

const { loadOutbox, passosDoEvento } = require('@/features/driver/offlineStore') as typeof import('@/features/driver/offlineStore');
const AsyncStorage = require('@react-native-async-storage/async-storage') as typeof import('@react-native-async-storage/async-storage').default;

/**
 * A ETAPA DO DIA (dono, 03/10/2026): a lista de cães só aparece depois de o motorista apertar "Start
 * pick-ups" — estes vetores olham a LISTA, então já entram com o dia COMEÇADO (rota `r1` × usuário do caso).
 */
async function abrirTelaDoMotorista() {
  await (require('@/features/driver/dayPhaseStore') as typeof import('@/features/driver/dayPhaseStore')).gravarBuscaIniciada('r1', mockDriverId);
  const Tela = require('../app/(tabs)/driver').default;
  const tela = await render(<Tela />);
  await waitFor(() => expect(tela.getByLabelText('Next stop: I arrived for Bob')).toBeTruthy());
  return tela;
}

/** Status gravados, na ordem em que saíram para o banco. */
const statusGravados = () => mockEstado.atualizacoes.map((linha) => linha.payload.status).filter(Boolean);

beforeEach(async () => {
  // A fila offline (e o retrato da rota) moram no aparelho: limpar entre os casos evita que o
  // "sem rede" de um teste suba a fila no seguinte.
  await AsyncStorage.clear();
  mockDuasPernas = false;
  mockDriverId = 'driver-1';
  mockLeituraOffline = false;
  mockSemColunaFase = false;
  mockConsultas = [];
  mockEstado.deliveredAtDaParada = null;
  mockEstado.atualizacoes.length = 0;
  mockEstado.rpcs.length = 0;
  mockEstado.statusDaParada = 'pending';
  mockEstado.falhaDeRede = false;
  mockEstado.recusaDoServidor = null;
  mockEstado.escritaSemLinha = false;
  mockEstado.semParadas = false;
  mockEstado.semSessao = false;
  mockEstado.consultasRota = 0;
});

describe('2 toques: I arrived e Next', () => {
  it('o 1º toque marca a chegada e o 2º grava pegou + concluiu, nesta ordem', async () => {
    const tela = await abrirTelaDoMotorista();

    await fireEvent.press(tela.getByLabelText('Next stop: I arrived for Bob'));
    await waitFor(() => expect(statusGravados()).toEqual(['arrived']));

    // A parada já está em `arrived`: o painel oferece o 2º toque (o MESMO caminho da lista).
    await waitFor(() => expect(tela.getByLabelText('Next stop: Next for Bob')).toBeTruthy());
    await fireEvent.press(tela.getByLabelText('Next stop: Next for Bob'));

    // DUAS escritas para o 2º toque: o trigger do banco carimba picked_up_at e completed_at.
    await waitFor(() => expect(statusGravados()).toEqual(['arrived', 'picked_up', 'completed']));
    // Todas na MESMA parada — nada de mexer em outra parada nem em outra tabela.
    expect(mockEstado.atualizacoes.every((linha) => linha.tabela === 'route_stops')).toBe(true);
  });

  it('sem rede, a fila guarda TODOS os passos e nenhum marco é perdido', async () => {
    mockEstado.falhaDeRede = true;
    const tela = await abrirTelaDoMotorista();

    await fireEvent.press(tela.getByLabelText('Next stop: I arrived for Bob'));
    // A tela segue otimista (o motorista não fica esperando o sinal) e oferece o 2º toque.
    await waitFor(() => expect(tela.getByLabelText('Next stop: Next for Bob')).toBeTruthy());
    await fireEvent.press(tela.getByLabelText('Next stop: Next for Bob'));

    await waitFor(async () => {
      const fila = await loadOutbox();
      expect(fila).toHaveLength(1);
      expect(fila[0].status).toBe('completed');
      // Chegou → pegou → concluiu: os três sobem quando o sinal voltar.
      expect(passosDoEvento(fila[0])).toEqual(['arrived', 'picked_up', 'completed']);
    });
  });

  it('flush SEM REDE não apaga a fila: o passo continua no aparelho (mutação pegou isto)', async () => {
    mockEstado.falhaDeRede = true;
    const tela = await abrirTelaDoMotorista();
    await fireEvent.press(tela.getByLabelText('Next stop: I arrived for Bob'));
    await waitFor(async () => expect((await loadOutbox()).length).toBeGreaterThan(0));
    const antes = (await loadOutbox()).length;

    // O motorista puxa a tela para atualizar AINDA sem rede: a subida da fila falha por REDE.
    const rolagem = tela.getByTestId('driver-scroll');
    await act(async () => {
      await rolagem.props.refreshControl.props.onRefresh();
    });

    // 🪤 O QUE NÃO PODE ACONTECER (auditoria 02/10/2026): a tentativa que falha por rede levar a fila
    // junto — o motorista perderia os passos achando que subiram. A fila fica INTEIRA.
    const depois = await loadOutbox();
    expect(depois.length).toBe(antes);
    mockEstado.falhaDeRede = false;
  });

  it('depois do 2º toque o dia continua: o yard libera a ENTREGA', async () => {
    const tela = await abrirTelaDoMotorista();
    await fireEvent.press(tela.getByLabelText('Next stop: I arrived for Bob'));
    await waitFor(() => expect(tela.getByLabelText('Next stop: Next for Bob')).toBeTruthy());
    await fireEvent.press(tela.getByLabelText('Next stop: Next for Bob'));

    /*
     * ENTREGA (conferência do dono, 01/10/2026 — itens 2 e 5): o 2º toque deixa a parada `completed` com
     * o cão NA VAN. Antes o app escrevia "Route finished" aqui, às 9 da manhã, e a tarde inteira ficava
     * sem próximo cão, sem ETA e sem aviso ao tutor. Agora o painel oferece o toque da entrega.
     */
    await waitFor(() => expect(tela.getByTestId('start-dropoffs')).toBeTruthy());
    expect(tela.queryByLabelText('Next stop: Delivered for Bob')).toBeNull();
    await fireEvent.press(tela.getByTestId('start-dropoffs'));
    await waitFor(() => expect(tela.getByLabelText('Next stop: Delivered for Bob')).toBeTruthy());
    expect(tela.queryByText('Route finished')).toBeNull();
    expect(tela.queryByLabelText('Next stop: Next for Bob')).toBeNull();
  });

/**
 * TOQUE NÃO PODE RECARREGAR A TELA INTEIRA (queixa do dono, 01/10/2026: *"toda vez que eu apertava next,
 * ou arrive a tela inteira carregava, o que deixa o aplicativo lento e pesado"*).
 *
 * Antes cada toque chamava a carga completa (rota, van, jornada e fila) com o spinner por cima — e ainda
 * levava uma SEGUNDA recarga do evento de tempo real da própria escrita. Agora a recarga pós-escrita é
 * silenciosa: a lista fica na tela e o banco reconcilia por baixo.
 */
it('depois do toque a tela NÃO volta para o "carregando"', async () => {
  const tela = await abrirTelaDoMotorista();
  expect(tela.queryByTestId('driver-loading')).toBeNull();

  await fireEvent.press(tela.getByLabelText('Next stop: I arrived for Bob'));
  await waitFor(() => expect(tela.getByLabelText('Next stop: Next for Bob')).toBeTruthy());
  expect(tela.queryByTestId('driver-loading')).toBeNull();

  await fireEvent.press(tela.getByLabelText('Next stop: Next for Bob'));
  await waitFor(() => expect(tela.getByTestId('start-dropoffs')).toBeTruthy());
  expect(tela.queryByTestId('driver-loading')).toBeNull();
  await fireEvent.press(tela.getByTestId('start-dropoffs'));
  await waitFor(() => expect(tela.getByLabelText('Next stop: Delivered for Bob')).toBeTruthy());
  expect(tela.queryByTestId('driver-loading')).toBeNull();
});

  /**
   * VISTORIA (02/10/2026) — A RODINHA ETERNA.
   *
   * Conta sem vínculo ativo na organização ficava travada na rodinha para sempre: `view` = null faz o
   * guard não redirecionar nunca e a tela não dizia nada. Agora ela EXPLICA e dá saída.
   */
  it('conta sem vínculo: explica e oferece sair, em vez de rodinha eterna', async () => {
    mockPapel = { role: null, view: null, isLoading: false };
    try {
      const Tela = require('../app/(tabs)/driver').default;
      const tela = await render(<Tela />);

      await waitFor(() => expect(tela.getByText('This account has no daycare')).toBeTruthy());
      expect(tela.getByLabelText('Sign out')).toBeTruthy();
      expect(tela.queryByTestId('driver-loading')).toBeNull();
    } finally {
      mockPapel = { role: 'driver', view: 'driver', isLoading: false };
    }
  });

  /**
   * VISTORIA (02/10/2026) — PASSO QUE O BANCO NÃO RECEBEU NÃO PODE PARECER GRAVADO.
   *
   * O UPDATE dos passos não conferia linhas: com a policy bloqueando, o PostgREST responde sucesso com
   * ZERO linha e o cartão avançava como se tivesse registrado. Agora a tela não marca e explica.
   */
  it('servidor recusa o passo: a tela NÃO marca e diz o motivo', async () => {
    mockEstado.recusaDoServidor = 'new row violates row-level security policy';
    try {
      const tela = await abrirTelaDoMotorista();
      await fireEvent.press(tela.getByLabelText('Next stop: I arrived for Bob'));

      await waitFor(() => expect(tela.getByText(/did not accept this step/)).toBeTruthy());
      // A parada segue pendente: nada de marcar no aparelho o que o banco não recebeu.
      expect(mockEstado.statusDaParada).toBe('pending');
    } finally {
      mockEstado.recusaDoServidor = null;
    }
  });

  it('UPDATE que não pega linha (0 linha, sem erro): também não marca na tela', async () => {
    mockEstado.escritaSemLinha = true;
    try {
      const tela = await abrirTelaDoMotorista();
      await fireEvent.press(tela.getByLabelText('Next stop: I arrived for Bob'));

      await waitFor(() => expect(tela.getByText(/did not accept this step/)).toBeTruthy());
      expect(mockEstado.statusDaParada).toBe('pending');
    } finally {
      mockEstado.escritaSemLinha = false;
    }
  });

  /**
   * 🪤 VISTORIA (02/10/2026): o motorista perdia o sinal, fazia os registros offline e, com o sinal de
   * volta, nada subia sozinho — a fila só saía no foco da aba (ou seja: sair da tela e voltar). Agora a
   * tela tem PUXAR PARA ATUALIZAR, e ele também sobe a fila.
   */
  it('puxar para atualizar sobe a fila de escritas offline', async () => {
    mockEstado.falhaDeRede = true;
    const tela = await abrirTelaDoMotorista();

    await fireEvent.press(tela.getByLabelText('Next stop: I arrived for Bob'));
    await waitFor(() => expect(mockEstado.atualizacoes.length).toBeGreaterThan(0));

    // O sinal voltou: o motorista puxa a tela — e a fila sobe SEM sair da aba.
    mockEstado.falhaDeRede = false;
    const lista = tela.getByTestId('driver-scroll');
    expect(lista.props.refreshControl).toBeTruthy();
    await act(async () => { await lista.props.refreshControl.props.onRefresh(); });

    await waitFor(() => expect(mockEstado.statusDaParada).toBe('arrived'));
  });

  /**
   * 🪤 PEDIDO DO CLIENTE (02/10/2026, print encaminhado pelo dono): *"as rota de pick up não tão
   * acabando no yard. E as de drop off não tão acabando no local da van. Tem como adicionar isso
   * automaticamente?"* — depois da última BUSCA a lista tem de mostrar o destino final (o yard) e, no
   * fim do dia, o retorno para a van.
   */
  it('a rota FECHA no yard depois da busca e volta para a van no fim do dia', async () => {
    mockLocais = [
      { id: 'van-1', name: 'Van 1', kind: 'van', address_line_1: '3111 La Selva', city: 'San Mateo', latitude: 37.5427669, longitude: -122.2849451, radius_meters: 300, is_default: true },
      { id: 'yard-1', name: 'Yard', kind: 'yard', address_line_1: '1089 Memorex Drive', city: 'Santa Clara', latitude: 37.362643, longitude: -122.9527423, radius_meters: 300, is_default: false },
    ];
    mockEstado.startLocationId = 'van-1';
    mockEstado.endLocationId = 'yard-1';
    try {
      const tela = await abrirTelaDoMotorista();

      // Enquanto tem busca pendente, não existe fechamento (a rota ainda está indo buscar).
      expect(tela.queryByTestId('route-closing')).toBeNull();

      // Dois toques fecham a busca: o cão está na van → o dia vai para o YARD.
      await fireEvent.press(tela.getByLabelText('Next stop: I arrived for Bob'));
      await waitFor(() => expect(tela.getByLabelText('Next stop: Next for Bob')).toBeTruthy());
      await fireEvent.press(tela.getByLabelText('Next stop: Next for Bob'));

      await waitFor(() => expect(tela.getByText('Back to the yard')).toBeTruthy());
      expect(tela.getByText('1089 Memorex Drive · Santa Clara')).toBeTruthy();
      expect(tela.getByText('All dogs on board — drop them at the yard.')).toBeTruthy();

      // O yard libera a entrega; confirmada, o dia fecha voltando para a VAN.
      expect(tela.queryByLabelText('Delivered Bob')).toBeNull();
      await fireEvent.press(tela.getByTestId('start-dropoffs'));
      await waitFor(() => expect(tela.getByLabelText('Delivered Bob')).toBeTruthy());
      await fireEvent.press(tela.getByLabelText('Delivered Bob'));
      await waitFor(() => expect(tela.getByText('Back to the van')).toBeTruthy());
      expect(tela.getByText('All dogs delivered — the day ends here.')).toBeTruthy();
    } finally {
      mockLocais = [];
      mockEstado.startLocationId = null;
      mockEstado.endLocationId = null;
    }
  });

  /**
   * 🪤 VISTORIA (02/10/2026): rota PUBLICADA sem paradas caía no estado vazio com o texto "No
   * published route today" — um dia vazio real ficava indistinguível de não ter rota (o motorista
   * achava que o gestor não tinha publicado).
   */
  it('rota PUBLICADA sem paradas diz que não há paradas hoje (não "No published route today")', async () => {
    mockEstado.semParadas = true;
    const Tela = require('../app/(tabs)/driver').default;
    const tela = await render(<Tela />);

    await waitFor(() => expect(tela.getByText('Route published — no stops today')).toBeTruthy());
    expect(tela.queryByText('No published route today')).toBeNull();
  });

  /**
   * 🪤 VISTORIA (02/10/2026): sessão ausente/expirada fazia a consulta rodar com `driver_id = ''`,
   * voltar vazia e a tela AFIRMAR "No published route today" — o motorista ia embora achando que o
   * gestor não publicou, quando o problema era o login.
   */
  it('sessão sem usuário NÃO vira "No published route today" (diz que a sessão expirou)', async () => {
    mockEstado.semSessao = true;
    const Tela = require('../app/(tabs)/driver').default;
    const tela = await render(<Tela />);

    await waitFor(() => expect(tela.getByText('Session expired')).toBeTruthy());
    expect(tela.queryByText('No published route today')).toBeNull();
  });

  /**
   * 🪤 ACHADO DA VISTORIA (02/10/2026): `load()` era disparado por QUATRO gatilhos ao mesmo tempo
   * (foco da aba, intervalo de 30 s, tempo real com debounce e puxar-para-atualizar) SEM guarda de
   * execução em curso. Cada carga dispara ≥6 requisições + o RPC de limpeza — era uma tempestade.
   * Agora, duas cargas simultâneas viram UMA: a segunda espera a primeira.
   */
  it('dois load() simultâneos consultam o Supabase UMA vez (guarda de carga em curso)', async () => {
    const tela = await abrirTelaDoMotorista();

    // Zera a contagem DEPOIS da carga inicial (o alvo é só o par simultâneo).
    mockEstado.consultasRota = 0;
    const rolagem = tela.getByTestId('driver-scroll');
    const onRefresh = rolagem.props.refreshControl.props.onRefresh;

    await act(async () => {
      // Dois "puxar para atualizar" no mesmo tique: sem a guarda, sairiam DUAS consultas à rota.
      await Promise.all([onRefresh(), onRefresh()]);
    });

    await waitFor(() => expect(mockEstado.consultasRota).toBeGreaterThanOrEqual(1));
    expect(mockEstado.consultasRota).toBe(1);
  });

  /**
   * 🪤 VISTORIA (02/10/2026): `events` era lido ANTES do `syncOutbox`. O evento que o servidor RECUSOU
   * saía da fila e o aviso "…removed from the queue" aparecia — mas o `applyPendingEvents` seguinte
   * usava a lista ANTIGA e PINTAVA o passo na tela. O motorista lia "não foi aceito" e via a parada
   * concluída ao mesmo tempo. A fila passou a ser relida DEPOIS do sync.
   */
  it('passo recusado pelo servidor não volta a pintar a tela no MESMO carregamento', async () => {
    mockEstado.recusaDoServidor = 'new row violates row-level security policy';
    const { enqueueEvent, saveOutbox } = require('@/features/driver/offlineStore') as typeof import('@/features/driver/offlineStore');
    // Um passo ficou na fila de um período OFFLINE anterior; agora o app abre COM sinal.
    await saveOutbox(enqueueEvent([], { stopId: 's1', status: 'completed', createdAt: new Date().toISOString() }));

    const Tela = require('../app/(tabs)/driver').default;
    // A lista de cães só aparece depois de "Start pick-ups" (etapa do dia, dono 03/10/2026).
    await (require('@/features/driver/dayPhaseStore') as typeof import('@/features/driver/dayPhaseStore')).gravarBuscaIniciada('r1', mockDriverId);
    const tela = await render(<Tela />);

    // O aviso de recusa aparece (o evento foi removido da fila pelo sync)...
    await waitFor(() => expect(tela.getByText(/did not accept this step/)).toBeTruthy());
    // ...e a parada NÃO foi pintada como concluída no mesmo carregamento.
    expect(tela.getByLabelText('Next stop: I arrived for Bob')).toBeTruthy();
    expect(tela.queryByLabelText('Next stop: Delivered for Bob')).toBeNull();
  });
});

describe('duas pernas publicadas do motorista', () => {
  async function abrirBuscaConcluida() {
    mockEstado.statusDaParada = 'completed';
    // A lista de cães só aparece depois de "Start pick-ups" (etapa do dia, dono 03/10/2026) — e a marca é POR
    // USUÁRIO: este caso troca de conta no meio, então os dois entram com o dia começado.
    const { gravarBuscaIniciada } = require('@/features/driver/dayPhaseStore') as typeof import('@/features/driver/dayPhaseStore');
    await gravarBuscaIniciada('r1', 'driver-1');
    await gravarBuscaIniciada('r1', 'driver-2');
    const Tela = require('../app/(tabs)/driver').default;
    const tela = await render(<Tela />);
    await waitFor(() => expect(tela.getByTestId('start-dropoffs')).toBeTruthy());
    return tela;
  }

  it('ignora a ordem de publicação, troca a lista inteira e restaura a entrega na recarga', async () => {
    mockDuasPernas = true;
    const tela = await abrirBuscaConcluida();
    expect(tela.queryByLabelText('Delivered Luna')).toBeNull();
    expect(tela.queryByLabelText('Delivered Bob')).toBeNull();
    expect(tela.getByText('PICK-UPS')).toBeTruthy();
    expect(mockConsultas[0].filtros).toMatchObject({ driver_id: 'driver-1', status: 'published' });
    expect(mockConsultas[0].limite).toBeUndefined();
    await fireEvent.press(tela.getByTestId('start-dropoffs'));
    await waitFor(() => expect(tela.getByLabelText('Next stop: Delivered for Luna')).toBeTruthy());
    expect(tela.queryByLabelText('Delivered Bob')).toBeNull();
    expect(tela.queryByLabelText('Next stop: I arrived for Luna')).toBeNull();
    await tela.unmount();
    const Tela = require('../app/(tabs)/driver').default;
    const reaberta = await render(<Tela />);
    /*
     * ETAPA DO DIA (dono, 04/10/2026): *"os cachorros do drop off aparecem antes de apertar no botão que
     * chegou no yard"*. A fase gravada é do DIA, mas quem ABRE a entrega é o toque no botão do yard: reabrir
     * o app no meio da entrega volta para a BUSCA, com o botão do yard esperando.
     */
    await waitFor(() => expect(reaberta.getByText('PICK-UPS')).toBeTruthy());
    await fireEvent.press(reaberta.getByTestId('start-dropoffs'));
    await waitFor(() => expect(reaberta.getByLabelText('Next stop: Delivered for Luna')).toBeTruthy());
    mockDriverId = 'driver-2';
    await act(async () => { await reaberta.getByTestId('driver-scroll').props.refreshControl.props.onRefresh(); });
    await waitFor(() => expect(reaberta.getByText('PICK-UPS')).toBeTruthy());
    expect(reaberta.queryByLabelText('Delivered Luna')).toBeNull();
    mockDriverId = 'driver-1';
    await act(async () => { await reaberta.getByTestId('driver-scroll').props.refreshControl.props.onRefresh(); });
    await waitFor(() => expect(reaberta.getByLabelText('Next stop: Delivered for Luna')).toBeTruthy());
  });

  it('sem entrega publicada mantém as mesmas paradas e suporta banco sem phase', async () => {
    mockSemColunaFase = true;
    const tela = await abrirBuscaConcluida();
    await fireEvent.press(tela.getByTestId('start-dropoffs'));
    await waitFor(() => expect(tela.getByText('DROP-OFFS')).toBeTruthy());
    expect(tela.getByLabelText('Delivered Bob')).toBeTruthy();
    expect(mockConsultas.some(c => !c.campos.startsWith('phase,'))).toBe(true);
  });

  it('troca para a entrega em cache quando perde a rede', async () => {
    mockDuasPernas = true;
    const tela = await abrirBuscaConcluida();
    mockLeituraOffline = true;
    await fireEvent.press(tela.getByTestId('start-dropoffs'));
    await waitFor(() => expect(tela.getByLabelText('Next stop: Delivered for Luna')).toBeTruthy());
    expect(tela.queryByLabelText('Delivered Bob')).toBeNull();
  });

  it('não vira automaticamente nem oferece a virada enquanto falta buscar', async () => {
    mockDuasPernas = true;
    const tela = await abrirTelaDoMotorista();
    expect(tela.queryByTestId('start-dropoffs')).toBeNull();
    expect(tela.getByText('PICK-UPS')).toBeTruthy();
    expect(tela.queryByLabelText('Delivered Luna')).toBeNull();
  });
});

it('duas pernas mantêm fechamento navegável na busca (yard) e na entrega (van)', async () => {
  mockDuasPernas = true;
  mockEstado.statusDaParada = 'completed';
  mockEstado.endLocationId = 'yard-1';
  mockLocais = [
    { id: 'van-1', name: 'Van', kind: 'van', latitude: 37, longitude: -122, is_default: true },
    { id: 'yard-1', name: 'Yard', kind: 'yard', latitude: 38, longitude: -122, is_default: false },
  ];
  try {
    const Tela = require('../app/(tabs)/driver').default;
    const tela = await render(<Tela />);
    await waitFor(() => expect(tela.getByLabelText('Navigate to yard')).toBeTruthy());
    await fireEvent.press(tela.getByTestId('start-dropoffs'));
    await waitFor(() => expect(tela.getByLabelText('Next stop: Delivered for Luna')).toBeTruthy());
    // The yard is now the drop-off start; its navigation moved from route-start into JOURNEY.
    expect(tela.getByLabelText('Navigate to yard')).toBeTruthy();
    expect(tela.queryByTestId('navigate-start')).toBeNull();
    await fireEvent.press(tela.getByLabelText('Next stop: Delivered for Luna'));
    await waitFor(() => expect(tela.getByLabelText('Navigate to van')).toBeTruthy());
    expect(tela.queryByLabelText('Navigate to yard')).toBeNull();
    expect(tela.queryByLabelText('Next stop: Delivered for Luna')).toBeNull();
  } finally {
    mockLocais = [];
    mockEstado.endLocationId = null;
  }
});
