/**
 * A SEQUÊNCIA DO DIA DO MOTORISTA, de ponta a ponta na TELA — pickup → YARD → drop-off → VAN.
 *
 * Dono (03/10/2026, verbatim): *"driver vai pra van, dá clock in, começa a etapa de pick up dos cachorros,
 * depois de pegar todos os cachorros é pra ir pro yard, depois do yard começa o drop off, e após deixar
 * todos os cachorros o driver volta pra onde pegou a van e dá clock off."*
 *
 * As regras PURAS (`faseEfetiva`, `etapaDoDia`) já têm vetor próprio em `fase-do-dia.test.tsx`. Aqui o que
 * se prova é o CAMINHO DA TELA de verdade — a carga salvando a fase no aparelho, a tela mostrando a etapa
 * certa e a virada da perna saindo pelo botão que existe:
 *
 *  - O BUG: com 'dropoff' gravado e cão ainda para buscar, a tela abre em PICK-UPS (antes abria em
 *    DROP-OFFS e cobrava a entrega de um cão que ninguém buscou);
 *  - com 'dropoff' gravado e a busca JÁ feita, abre em DROP-OFFS (a fase gravada continua valendo);
 *  - depois da última busca o app PEDE O YARD (navegação na jornada) e a virada aparece com a ORDEM no
 *    rótulo visível — `I'm at the yard — start drop-offs` — num botão SÓ (`start-dropoffs`);
 *  - terminadas as entregas, o destino volta a ser a VAN (é onde se bate o clock off).
 */
import React from 'react';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { gravarFase } from '@/features/driver/dayPhaseStore';

/* ------------------------------------------------------------------ *
 * MOCKS (o mesmo desenho do vetor da sede — banco com ESTADO)
 * ------------------------------------------------------------------ */

const mockPosicao: {
  compartilhada: { latitude: number; longitude: number } | null;
  fresca: { latitude: number; longitude: number } | null;
} = { compartilhada: null, fresca: null };

jest.mock('@/features/driver/locationService', () => ({
  getCurrentDriverLocation: async () => mockPosicao.fresca,
  startLocationSharing: async (onUpdate: (update: { latitude: number; longitude: number }) => void) => {
    if (mockPosicao.compartilhada) onUpdate(mockPosicao.compartilhada);
    return { stop: () => undefined };
  },
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

/** A rota do dia: SEM `phase` (o dia de uma rota só — o motorista faz as duas pernas nela). */
const mockRota = {
  id: 'r1',
  organization_id: 'org-1',
  lock_version: 3,
  published_at: '2026-10-03T12:00:00.000Z',
  start_location_id: null as string | null,
  end_location_id: null as string | null,
  route_stops: [
    {
      id: 's1',
      sequence: 1,
      status: 'pending' as string,
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
      delivered_at: null as string | null,
      skipped_at: null,
      status_updated_at: null,
      eta_notice_at: null,
      eta_notice_kind: null,
      travel_seconds: null,
      dropoff_travel_seconds: null,
      handed_from_name: null,
      handed_at: null,
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
};

/** Sedes como o PostgREST devolve (snake_case). */
const mockEstado: {
  sedes: Record<string, unknown>[];
  erroSedes: boolean;
} = { sedes: [], erroSedes: false };

const VAN_ROW = {
  id: 'v1',
  name: 'Van — Palo Alto',
  kind: 'van',
  address_line_1: '1 Van Way',
  city: 'Palo Alto',
  latitude: 37,
  longitude: -122,
  radius_meters: 300,
  is_default: true,
};

const YARD_ROW = { ...VAN_ROW, id: 'y1', name: 'Day yard', kind: 'yard', latitude: 36, longitude: -120, is_default: false };

jest.mock('@/lib/supabase', () => {
  const dados = (tabela: string) => {
    if (tabela === 'routes') return [mockRota];
    if (tabela === 'organization_locations') return mockEstado.erroSedes ? null : mockEstado.sedes;
    // Turno manual aberto: a lista de cães só vive com a jornada ABERTA (etapa do dia, dono 03/10/2026).
    if (tabela === 'driver_shifts') return [{
      id: 'sh-turno', started_at: new Date().toISOString(), ended_at: null,
      start_reason: 'Journey started', end_reason: null, route_id: 'r1',
    }];
    return [];
  };
  const cadeia = (tabela: string) => {
    const chain: Record<string, unknown> = { __tabela: tabela };
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
    chain.update = mesmo;
    chain.upsert = () => Promise.resolve({ error: null });
    chain.delete = mesmo;
    chain.single = () => Promise.resolve({ data: { id: 'novo' }, error: null });
    chain.then = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: dados(tabela), error: mockEstado.erroSedes ? { message: 'sem permissão' } : null }).then(res);
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

async function montarTela() {
  // A lista de cães só aparece depois de "Start pick-ups" (etapa do dia, dono 03/10/2026).
  await (require('@/features/driver/dayPhaseStore') as typeof import('@/features/driver/dayPhaseStore')).gravarBuscaIniciada('r1', 'driver-1');
  const Tela = require('../app/(tabs)/driver').default;
  const tela = await render(<Tela />);
  await waitFor(() => expect(tela.getByTestId('cartao-jornada')).toBeTruthy());
  return tela;
}

describe('tela do motorista — sequência pickup → yard → drop-off → van', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockEstado.sedes = [VAN_ROW, YARD_ROW];
    mockEstado.erroSedes = false;
    mockRota.route_stops[0].status = 'pending';
    mockRota.route_stops[0].delivered_at = null;
    mockRota.start_location_id = null;
    mockRota.end_location_id = null;
  });

  afterEach(() => {
    cleanup();
    mockRota.route_stops[0].status = 'pending';
    mockRota.route_stops[0].delivered_at = null;
  });

  it('O BUG: com dropoff gravado e cão ainda para buscar, a tela abre em PICK-UPS', async () => {
    await gravarFase('r1', 'driver-1', 'dropoff');
    const tela = await montarTela();
    await waitFor(() => expect(tela.getByText('PICK-UPS')).toBeTruthy());
    expect(tela.queryByText('DROP-OFFS')).toBeNull();
    // E a fase errada gravada no aparelho é CORRIGIDA — o dia não abre errado de novo.
    await waitFor(async () => expect(await AsyncStorage.getItem('pnp:driver:phase:r1:driver-1')).toBe('pickup'));
    await tela.unmount();
  });

  it('com dropoff gravado e a busca JÁ feita, a tela abre em DROP-OFFS', async () => {
    await gravarFase('r1', 'driver-1', 'dropoff');
    mockRota.route_stops[0].status = 'completed';
    const tela = await montarTela();
    await waitFor(() => expect(tela.getByText('DROP-OFFS')).toBeTruthy());
    await tela.unmount();
  });

  it('depois da última busca pede o YARD (com navegação) e a virada traz a ordem no rótulo', async () => {
    mockRota.route_stops[0].status = 'completed';
    const tela = await montarTela();
    await waitFor(() => expect(tela.getByTestId('start-dropoffs')).toBeTruthy());

    // O app PEDE o yard: a navegação da jornada aponta para ele.
    const jornada = within(tela.getByTestId('cartao-jornada'));
    expect(jornada.getByRole('button', { name: 'Navigate to yard' })).toBeTruthy();

    // A virada é UMA só e diz a ORDEM: o motorista vai ao yard ANTES de liberar a entrega.
    expect(tela.getAllByTestId('start-dropoffs')).toHaveLength(1);
    expect(tela.getByText("I'm at the yard — start drop-offs")).toBeTruthy();

    await fireEvent.press(tela.getByTestId('start-dropoffs'));
    await waitFor(() => expect(tela.getByText('DROP-OFFS')).toBeTruthy());
    expect(tela.queryAllByTestId('start-dropoffs')).toHaveLength(0);
    await tela.unmount();
  });

  it('terminadas as entregas, o dia volta para a VAN (clock off)', async () => {
    await gravarFase('r1', 'driver-1', 'dropoff');
    mockRota.route_stops[0].status = 'completed';
    mockRota.route_stops[0].delivered_at = '2026-10-03T20:00:00.000Z';
    const tela = await montarTela();
    await waitFor(() => expect(tela.getByText('DROP-OFFS')).toBeTruthy());
    const jornada = within(tela.getByTestId('cartao-jornada'));
    await waitFor(() => expect(jornada.getByRole('button', { name: 'Navigate to van' })).toBeTruthy());
    await tela.unmount();
  });
});
