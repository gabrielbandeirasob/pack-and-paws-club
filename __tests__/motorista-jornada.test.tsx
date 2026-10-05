/**
 * JORNADA DO MOTORISTA — os dois defeitos de ALTA da vistoria (02/10/2026):
 *
 *  - A1: o clock out só enxergava as jornadas do BANCO. A jornada aberta SEM SINAL mora na fila
 *        local; o app criava uma SEGUNDA jornada fechada e a entrada da fila subia depois como
 *        ABERTA, órfã para sempre (o dia nunca fechava no relatório de horas).
 *  - M6: sem rota publicada a organização ficava nula e o clock in era impossível ("Organization
 *        not found for this account.") — além de o cartão da jornada nem aparecer.
 *
 * O banco é falsificado: o que se prova é o que o app GRAVA (a fila e as escritas) em cada caminho.
 */
import React from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { ScrollView } from 'react-native';

const mockEstado: {
  falhaDeRede: boolean;
  semRota: boolean;
  orgDoVinculo: string | null;
  /** O escritório recusa DE VEZ o registro (constraint/RLS): repetir não adianta -> sai da fila. */
  recusaDefinitiva: boolean;
  insercoes: { tabela: string; payload: Record<string, unknown> }[];
} = { falhaDeRede: false, semRota: false, orgDoVinculo: 'org-1', recusaDefinitiva: false, insercoes: [] };

/** Configurações passadas para `channel.on(...)` (para provar o filtro do tempo real — M8). */
const mockAssinaturas: Record<string, unknown>[] = [];

const mockRotaPublicada = {
  id: 'r1',
  organization_id: 'org-1',
  lock_version: 1,
  published_at: '2026-10-02T12:00:00.000Z',
  start_location_id: null,
  end_location_id: null,
  organization: { proof_pickup_required: false, proof_dropoff_required: false },
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

jest.mock('@/lib/supabase', () => {
  const leitura = (tabela: string) => {
    if (tabela === 'routes') return mockEstado.semRota ? [] : [mockRotaPublicada];
    if (tabela === 'organization_members') return mockEstado.orgDoVinculo ? [{ organization_id: mockEstado.orgDoVinculo }] : [];
    if (tabela === 'profiles') return [{ full_name: null }];
    return [];
  };
  const cadeia = (tabela: string) => {
    const chain: Record<string, unknown> = {};
    let payloadDeInsert: Record<string, unknown> | null = null;
    const mesmo = () => chain;
    for (const metodo of ['select', 'eq', 'gte', 'lt', 'lte', 'order', 'limit']) chain[metodo] = mesmo;
    chain.maybeSingle = async () => ({ data: leitura(tabela)[0] ?? null, error: null });
    chain.insert = (payload: Record<string, unknown>) => { payloadDeInsert = payload; return chain; };
    chain.update = mesmo;
    chain.upsert = async () => ({ error: null });
    chain.delete = mesmo;
    chain.single = async () => {
      if (mockEstado.falhaDeRede) return { data: null, error: { code: '', message: 'Network request failed' } };
      if (mockEstado.recusaDefinitiva) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "driver_shifts_uma_aberta"' } };
      mockEstado.insercoes.push({ tabela, payload: payloadDeInsert ?? {} });
      return { data: { id: 'novo' }, error: null };
    };
    chain.then = (res: (v: unknown) => unknown) => {
      if (payloadDeInsert) {
        const payload = payloadDeInsert;
        if (mockEstado.falhaDeRede) return Promise.resolve({ data: null, error: { message: 'Network request failed' } }).then(res);
        if (mockEstado.recusaDefinitiva) return Promise.resolve({ data: null, error: { message: 'duplicate key value violates unique constraint "driver_shifts_uma_aberta"' } }).then(res);
        mockEstado.insercoes.push({ tabela, payload });
        return Promise.resolve({ data: [{ id: 'novo' }], error: null }).then(res);
      }
      return Promise.resolve({ data: leitura(tabela), error: null }).then(res);
    };
    return chain;
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'driver-1', user_metadata: { full_name: 'Rafael' } } } }) },
      from: (tabela: string) => cadeia(tabela),
      rpc: async () => ({ data: null, error: null }),
      channel: () => {
        const c: any = {
          on: (_event: string, config: Record<string, unknown>) => { mockAssinaturas.push(config); return c; },
          subscribe: () => undefined,
        };
        return c;
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
const { loadPendingWrites, savePendingWrites } = require('@/features/driver/pendingWrites') as typeof import('@/features/driver/pendingWrites');

function insercoesDe(tabela: string) {
  return mockEstado.insercoes.filter((linha) => linha.tabela === tabela);
}

async function abrirTela() {
  // A lista de cães só aparece depois de "Start pick-ups" (etapa do dia, dono 03/10/2026).
  await (require('@/features/driver/dayPhaseStore') as typeof import('@/features/driver/dayPhaseStore')).gravarBuscaIniciada('r1', 'driver-1');
  const Tela = require('../app/(tabs)/driver').default;
  return render(<Tela />);
}

/** Botão do cartão da jornada → motivo (≥3 letras) → salvar — o caminho REAL da tela. */
async function registrar(tela: any, botao: string, motivo: string) {
  await fireEvent.press(tela.getByLabelText(botao));
  await waitFor(() => expect(tela.getByLabelText('Reason for the manual record')).toBeTruthy());
  await fireEvent.changeText(tela.getByLabelText('Reason for the manual record'), motivo);
  await fireEvent.press(tela.getByLabelText('Save manual record'));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockEstado.falhaDeRede = false;
  mockEstado.semRota = false;
  mockEstado.orgDoVinculo = 'org-1';
  mockEstado.recusaDefinitiva = false;
  mockEstado.insercoes.length = 0;
  mockAssinaturas.length = 0;
});

describe('Start pick-ups in JOURNEY', () => {
  it('requires clock-in and focuses the current pickup without writing dog status or phase', async () => {
    const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
    const tela = await abrirTela();
    await waitFor(() => expect(tela.getByLabelText('Clock in')).toBeTruthy());
    expect(tela.queryByLabelText('Start pick-ups')).toBeNull();
    mockEstado.falhaDeRede = true;
    await registrar(tela, 'Clock in', 'Journey started at the van');
    await waitFor(() => expect(tela.getByLabelText('Clock out')).toBeTruthy());
    expect(within(tela.getByTestId('cartao-jornada')).getByRole('button', { name: 'Start pick-ups' })).toBeTruthy();
    await fireEvent(tela.getByTestId('driver-body'), 'layout', { nativeEvent: { layout: { y: 120 } } });
    await fireEvent(tela.getByTestId('route-content'), 'layout', { nativeEvent: { layout: { y: 80 } } });
    await fireEvent(tela.getByTestId('pickup-focus'), 'layout', { nativeEvent: { layout: { y: 240 } } });
    const queueBefore = await loadPendingWrites();
    const storageBefore = await AsyncStorage.multiGet(await AsyncStorage.getAllKeys());
    await fireEvent.press(within(tela.getByTestId('cartao-jornada')).getByRole('button', { name: 'Start pick-ups' }));
    expect(scrollTo).toHaveBeenCalledWith({ y: 440, animated: true });
    expect(tela.getByText('PICK-UPS')).toBeTruthy();
    expect(mockRotaPublicada.route_stops[0].status).toBe('pending');
    expect(await loadPendingWrites()).toEqual(queueBefore);
    expect(await AsyncStorage.multiGet(await AsyncStorage.getAllKeys())).toEqual(storageBefore);
    expect(mockEstado.insercoes).toHaveLength(0);
    await tela.unmount();
    scrollTo.mockRestore();
  });
});

describe('A1 — clock out enxerga a jornada ABERTA NA FILA (sem sinal)', () => {
  it('fecha a MESMA jornada da fila; não cria jornada aberta órfã', async () => {
    const tela = await abrirTela();
    await waitFor(() => expect(tela.getByLabelText('Clock in')).toBeTruthy());

    // 1) clock in SEM SINAL: startManualShift falha por rede → jornada ABERTA na fila local.
    mockEstado.falhaDeRede = true;
    await registrar(tela, 'Clock in', 'Journey started at the van');
    await waitFor(() => expect(tela.getByText(/saved on your phone/)).toBeTruthy());
    expect(insercoesDe('driver_shifts')).toHaveLength(0);
    const filaAberta = await loadPendingWrites();
    expect(filaAberta).toHaveLength(1);
    expect(filaAberta[0]).toMatchObject({ kind: 'shift', endedAt: null });

    // 2) o sinal voltou: o clock out fecha a jornada que estava SÓ na fila.
    mockEstado.falhaDeRede = false;
    await registrar(tela, 'Clock out', 'End of the day');

    await waitFor(() => expect(insercoesDe('driver_shifts')).toHaveLength(1));
    const gravada = insercoesDe('driver_shifts')[0].payload;
    expect(typeof gravada.ended_at).toBe('string'); // fechada
    expect(gravada.start_reason).toBe('Journey started at the van'); // a MESMA entrada da fila
    // Nenhuma jornada ABERTA foi criada (a raiz da A1: o índice único de jornada aberta NÃO conflita
    // com uma fechada — uma segunda aberta ficaria órfã para sempre).
    expect(insercoesDe('driver_shifts').some((linha) => linha.payload.ended_at == null)).toBe(false);
    // A fila ficou limpa: nada de jornada aberta sobrando no aparelho.
    await waitFor(async () => expect(await loadPendingWrites()).toHaveLength(0));
  });
});

describe('M6 — clock in funciona SEM rota publicada (organização do vínculo)', () => {
  it('o cartão da JORNADA aparece e grava na organização do VÍNCULO', async () => {
    mockEstado.semRota = true;
    const tela = await abrirTela();

    // O cartão da jornada existe mesmo sem rota publicada (antes ele só aparecia com a lista).
    await waitFor(() => expect(tela.getByLabelText('Clock in')).toBeTruthy());
    expect(tela.getByText('No published route today')).toBeTruthy();

    await registrar(tela, 'Clock in', 'Forgot to press');

    await waitFor(() => expect(insercoesDe('driver_shifts')).toHaveLength(1));
    const gravada = insercoesDe('driver_shifts')[0].payload;
    expect(gravada.organization_id).toBe('org-1');
    expect(gravada.driver_id).toBe('driver-1');
    expect(tela.queryByText(/Organization not found/)).toBeNull();
  });
});

describe('M7 — a fila de jornada recusada pelo escritório AVISA (não some calada)', () => {
  it('mostra a mensagem quando o servidor recusa de vez e limpa a fila', async () => {
    const tela = await abrirTela();
    await waitFor(() => expect(tela.getByLabelText('Clock in')).toBeTruthy());

    // Uma jornada FECHADA ficou na fila local (feita sem sinal noutro momento).
    await savePendingWrites([{
      kind: 'shift', startedAt: '2026-10-01T07:00:00.000Z', endedAt: '2026-10-01T15:00:00.000Z',
      startReason: 'Manual', endReason: null, routeId: 'r1', queuedAt: '2026-10-01T15:00:00.000Z',
    }]);
    // O escritório recusa DE VEZ (ex.: já existe jornada aberta lá) quando a fila subir.
    mockEstado.recusaDefinitiva = true;
    const rolagem = tela.getByTestId('driver-scroll');
    await act(async () => { await rolagem.props.refreshControl.props.onRefresh(); });

    await waitFor(() => expect(tela.getByText(/did not accept/)).toBeTruthy());
    mockEstado.recusaDefinitiva = false;
    // Só a recusa DEFINITIVA sai da fila — e o motorista é avisado disso.
    await waitFor(async () => expect(await loadPendingWrites()).toHaveLength(0));
  });
});

describe('M8 — tempo real filtrado pela organização', () => {
  it('assina `routes` com filtro organization_id=eq.<org> (não a rota de todo mundo)', async () => {
    const tela = await abrirTela();
    await waitFor(() => expect(tela.getByLabelText('Clock in')).toBeTruthy());

    await waitFor(() => expect(
      mockAssinaturas.some((c) => (c as { table?: string }).table === 'routes' && (c as { filter?: string }).filter === 'organization_id=eq.org-1'),
    ).toBe(true));
    // A assinatura de `route_stops` continua filtrada pela ROTA específica.
    await waitFor(() => expect(
      mockAssinaturas.some((c) => (c as { table?: string }).table === 'route_stops' && (c as { filter?: string }).filter === 'route_id=eq.r1'),
    ).toBe(true));
  });
});
