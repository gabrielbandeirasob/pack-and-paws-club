/**
 * A JORNADA QUE "SOME" AO TROCAR DE CONTA (relato do dono, áudio de 02/10/2026).
 *
 * *"eu saí da conta e agora fui voltar para dar clock-in de novo… será que… você desloga e ele perde?
 * Mesma coisa aconteceu ontem."* O dono alterna entre a conta de MOTORISTA e a de ADMINISTRADOR no
 * MESMO aparelho, e a fila local era UMA chave global sem dono.
 *
 * Este teste prova, PELA TELA, que a correção (`scopedStorage.ts` + `pendingWritesScope.ts` +
 * `offlineStore.ts`) funciona de ponta a ponta:
 *  - o clock-in SEM SINAL fica na fila DO motorista (só na chave dele);
 *  - entrar com a conta de ADMINISTRADOR NÃO herda nem apaga essa jornada (e não grava nada em nome dela);
 *  - voltando com o MOTORISTA e com sinal, a jornada SUBE com o `driver_id` CERTO (não some).
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

type Linha = Record<string, unknown>;

const mockEstado: {
  falhaRede: boolean;
  semRota: boolean;
  orgDoVinculo: string | null;
  userId: string;
  shifts: Linha[];
  insercoes: { tabela: string; payload: Linha }[];
} = {
  falhaRede: false,
  semRota: false,
  orgDoVinculo: 'org-1',
  userId: 'driver-1',
  shifts: [],
  insercoes: [],
};

const mockRota = {
  id: 'r1', organization_id: 'org-1', lock_version: 1, published_at: '2026-10-02T12:00:00.000Z',
  start_location_id: null, end_location_id: null,
  route_stops: [
    {
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
    },
  ],
};

function mockLeitura(tabela: string): Linha[] {
  if (tabela === 'routes') return mockEstado.semRota ? [] : [mockRota];
  if (tabela === 'organization_members') return mockEstado.orgDoVinculo ? [{ organization_id: mockEstado.orgDoVinculo, role: 'driver' }] : [];
  if (tabela === 'organization_locations') return []; // sem sede: o clock-in não é travado por localização
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
    const concluir = () => {
      if (mockEstado.falhaRede) return { data: null, error: { message: 'Network request failed' } };
      if (op === 'insert' && payload) {
        mockEstado.insercoes.push({ tabela, payload });
        if (tabela === 'driver_shifts') mockEstado.shifts.push({ id: `sh-${mockEstado.shifts.length + 1}`, ...payload });
        return { data: { id: 'novo' }, error: null };
      }
      if (op === 'update' && payload) {
        if (tabela === 'driver_shifts') mockEstado.shifts = mockEstado.shifts.map((s) => ({ ...s, ...payload }));
        return { data: [{ id: 'sh' }], error: null };
      }
      return { data: mockLeitura(tabela), error: null };
    };
    chain.single = async () => concluir();
    chain.then = (res: (v: unknown) => unknown) => Promise.resolve(concluir()).then(res);
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
  getCurrentDriverLocation: async () => null,
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
const { carregarFilaDoUsuario } = require('@/features/driver/pendingWritesScope') as typeof import('@/features/driver/pendingWritesScope');

async function abrirTela() {
  const Tela = require('../app/(tabs)/driver').default;
  return render(<Tela />);
}

/** Botão do cartão → motivo (≥3 letras) → salvar — o caminho REAL da tela. */
async function registrar(tela: any, botao: string, motivo: string) {
  await fireEvent.press(tela.getByLabelText(botao));
  await waitFor(() => expect(tela.getByLabelText('Reason for the manual record')).toBeTruthy());
  await fireEvent.changeText(tela.getByLabelText('Reason for the manual record'), motivo);
  await fireEvent.press(tela.getByLabelText('Save manual record'));
}

async function recarregar(tela: any) {
  const rolagem = tela.getByTestId('driver-scroll');
  await act(async () => { await rolagem.props.refreshControl.props.onRefresh(); });
}

function jornadasGravadas() {
  return mockEstado.insercoes.filter((linha) => linha.tabela === 'driver_shifts');
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockEstado.falhaRede = false;
  mockEstado.semRota = false;
  mockEstado.orgDoVinculo = 'org-1';
  mockEstado.userId = 'driver-1';
  mockEstado.shifts = [];
  mockEstado.insercoes = [];
});

describe('a jornada não some nem é herdada ao trocar de conta', () => {
  it('clock-in SEM SINAL fica na fila do MOTORISTA; o ADMIN não herda nem apaga; de volta, sobe com o driver_id certo', async () => {
    const tela = await abrirTela();
    await waitFor(() => expect(tela.getByLabelText('Clock in')).toBeTruthy());

    // 1) CLOCK-IN SEM SINAL → a jornada ABERTA fica na fila DO motorista (chave dele).
    mockEstado.falhaRede = true;
    await registrar(tela, 'Clock in', 'Forgot to press');
    await waitFor(() => expect(tela.getByText(/saved on your phone/)).toBeTruthy());
    expect(jornadasGravadas()).toHaveLength(0);
    const filaDoMotorista = await carregarFilaDoUsuario('driver-1');
    expect(filaDoMotorista).toHaveLength(1);
    expect(filaDoMotorista[0]).toMatchObject({ kind: 'shift', endedAt: null, startReason: 'Forgot to press' });
    // não vazou para a chave do administrador:
    expect(await carregarFilaDoUsuario('admin-2')).toEqual([]);

    // 2) TROCA PARA O ADMINISTRADOR (mesma tela, outra identidade) e recarrega.
    mockEstado.userId = 'admin-2';
    mockEstado.falhaRede = false;
    await recarregar(tela);

    // O admin NÃO herda a jornada e NÃO grava nada em nome dele...
    expect(jornadasGravadas()).toHaveLength(0);
    // ...e a jornada do motorista continua INTACTA na fila dele (não foi apagada nem subiu errado).
    const aindaDoMotorista = await carregarFilaDoUsuario('driver-1');
    expect(aindaDoMotorista).toHaveLength(1);
    expect(aindaDoMotorista[0]).toMatchObject({ kind: 'shift', endedAt: null });

    // 3) VOLTA O MOTORISTA, agora COM sinal → a jornada sobe com o `driver_id` CERTO.
    mockEstado.userId = 'driver-1';
    await recarregar(tela);

    await waitFor(() => expect(jornadasGravadas()).toHaveLength(1));
    const gravada = jornadasGravadas()[0].payload;
    expect(gravada.driver_id).toBe('driver-1');
    expect(gravada.organization_id).toBe('org-1');
    expect(gravada.ended_at ?? null).toBeNull(); // continua a jornada aberta (foi um clock in: sem `ended_at`)
    // a fila do motorista ficou vazia (subiu) e o admin continua sem nada.
    await waitFor(async () => expect(await carregarFilaDoUsuario('driver-1')).toHaveLength(0));
    expect(await carregarFilaDoUsuario('admin-2')).toEqual([]);

    tela.unmount();
  });
});
