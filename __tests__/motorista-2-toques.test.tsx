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
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockEstado: {
  atualizacoes: { tabela: string; payload: Record<string, unknown> }[];
  rpcs: { nome: string; params: Record<string, unknown> }[];
  /** Status atual da parada no "banco": o app relê a rota depois de cada toque. */
  statusDaParada: 'pending' | 'arrived' | 'picked_up' | 'completed' | 'skipped';
  /** Sem sinal: todo `update` responde erro de rede. */
  falhaDeRede: boolean;
} = { atualizacoes: [], rpcs: [], statusDaParada: 'pending', falhaDeRede: false };

/** Rota publicada de hoje com UMA parada pendente (o caminho curto: chegou → pegou+concluiu). */
const mockRota = () => ({
  id: 'r1',
  organization_id: 'org-1',
  lock_version: 3,
  published_at: '2026-09-30T12:00:00.000Z',
  start_location_id: null,
  end_location_id: null,
  organization: { proof_pickup_required: false, proof_dropoff_required: false },
  route_stops: [
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
  const dados = (tabela: string) => (tabela === 'routes' ? [mockRota()] : []);
  const cadeia = (tabela: string) => {
    const chain: Record<string, unknown> = { __tabela: tabela };
    let payloadDoUpdate: Record<string, unknown> | null = null;
    const mesmo = () => chain;
    chain.select = mesmo;
    chain.eq = mesmo;
    chain.gte = mesmo;
    chain.lt = mesmo;
    chain.lte = mesmo;
    chain.order = mesmo;
    chain.limit = mesmo;
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
      if (payloadDoUpdate) {
        if (mockEstado.falhaDeRede) {
          return Promise.resolve({ data: null, error: { message: 'Network request failed' } }).then(res);
        }
        // O servidor aceitou: o "banco" falso passa a devolver o status novo na releitura.
        if (tabela === 'route_stops' && typeof payloadDoUpdate.status === 'string') {
          mockEstado.statusDaParada = payloadDoUpdate.status as typeof mockEstado.statusDaParada;
        }
        return Promise.resolve({ data: null, error: null }).then(res);
      }
      return Promise.resolve({ data: dados(tabela), error: null }).then(res);
    };
    return chain;
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'driver-1' } } }) },
      from: (tabela: string) => cadeia(tabela),
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

const { loadOutbox, passosDoEvento } = require('@/features/driver/offlineStore') as typeof import('@/features/driver/offlineStore');
const AsyncStorage = require('@react-native-async-storage/async-storage') as typeof import('@react-native-async-storage/async-storage').default;

async function abrirTelaDoMotorista() {
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
  mockEstado.atualizacoes.length = 0;
  mockEstado.rpcs.length = 0;
  mockEstado.statusDaParada = 'pending';
  mockEstado.falhaDeRede = false;
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

  it('depois do 2º toque o dia continua: o painel passa a oferecer a ENTREGA', async () => {
    const tela = await abrirTelaDoMotorista();
    await fireEvent.press(tela.getByLabelText('Next stop: I arrived for Bob'));
    await waitFor(() => expect(tela.getByLabelText('Next stop: Next for Bob')).toBeTruthy());
    await fireEvent.press(tela.getByLabelText('Next stop: Next for Bob'));

    /*
     * ENTREGA (conferência do dono, 01/10/2026 — itens 2 e 5): o 2º toque deixa a parada `completed` com
     * o cão NA VAN. Antes o app escrevia "Route finished" aqui, às 9 da manhã, e a tarde inteira ficava
     * sem próximo cão, sem ETA e sem aviso ao tutor. Agora o painel oferece o toque da entrega.
     */
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
  await waitFor(() => expect(tela.getByLabelText('Next stop: Delivered for Bob')).toBeTruthy());
  expect(tela.queryByTestId('driver-loading')).toBeNull();
});
});