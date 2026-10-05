/**
 * Regressão (05/10/2026): o clock out SEM SINAL de uma jornada que JÁ ESTÁ ABERTA NO BANCO tem de
 * fechar AQUELA jornada quando a fila subir.
 *
 * O defeito: a fila guardava só as horas (entrada + saída + motivos) e o replay fazia INSERT de uma
 * jornada FECHADA. Resultado: a jornada original continuava ABERTA no banco (ninguém a fechava) e o
 * motorista ficava travado no dia seguinte — o app dizia "Journey not started yet" e o servidor
 * recusava o novo Clock in com "You already have a journey open." (relato do dono, 05/10/2026).
 */
import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ShiftRow } from '@/features/driver/shiftService';

const mockState = {
  rows: [] as (ShiftRow & { driver_id: string })[],
  inserts: 0,
  updates: [] as string[],
  /** INSERTs sem `.select()` que chegaram ao servidor (o replay de uma jornada fechada). */
  insertPayloads: [] as Record<string, unknown>[],
  failReads: false,
  failUpdates: false,
};

const jornadaAberta = (): ShiftRow & { driver_id: string } => ({
  id: 'open-journey', driver_id: 'driver-1',
  started_at: '2026-10-04T14:00:00.000Z', ended_at: null,
  start_reason: 'Started at the van', end_reason: null, route_id: null,
});

jest.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'driver-1' } } }) },
  from: (table: string) => {
    const filters: ((row: any) => boolean)[] = [];
    let insert: any = null;
    let update: any = null;
    const chain: any = {
      select: () => chain, order: () => chain, limit: () => chain,
      eq: (key: string, value: unknown) => { filters.push(r => r[key] === value); return chain; },
      is: (key: string, value: unknown) => { filters.push(r => r[key] === value); return chain; },
      gte: (key: string, value: string) => { filters.push(r => r[key] >= value); return chain; },
      lt: (key: string, value: string) => { filters.push(r => r[key] < value); return chain; },
      // Mesmo predicado PostgREST da consulta de jornadas: aberta OU iniciada no intervalo do dia.
      or: (value: string) => {
        const match = /^ended_at.is.null,and\(started_at.gte.([^,]+),started_at.lt.([^)]*)\)$/.exec(value);
        if (!match) throw new Error(`Unexpected filter: ${value}`);
        filters.push(r => r.ended_at === null || (r.started_at >= match[1] && r.started_at < match[2]));
        return chain;
      },
      insert: (payload: any) => { insert = payload; return chain; },
      update: (payload: any) => { update = payload; return chain; },
      upsert: async () => ({ error: null }),
      maybeSingle: async () => ({ data: table === 'organization_members' ? { organization_id: 'org-1' } : null, error: null }),
      single: async () => {
        mockState.inserts++;
        if (mockState.rows.some(r => r.driver_id === insert.driver_id && r.ended_at === null)) {
          return { data: null, error: { code: '23505', message: 'duplicate key violates driver_shifts_uma_aberta' } };
        }
        mockState.rows.push({ id: `new-${mockState.inserts}`, ...insert });
        return { data: { id: `new-${mockState.inserts}` }, error: null };
      },
      then: (resolve: (value: unknown) => unknown) => {
        if (table !== 'driver_shifts') return Promise.resolve({ data: [], error: null }).then(resolve);
        if (mockState.failReads && !update) return Promise.resolve({ data: null, error: { message: 'Network request failed' } }).then(resolve);
        // Deriva da rede: o UPDATE da jornada não chega ao servidor.
        if (update && mockState.failUpdates) return Promise.resolve({ data: null, error: { message: 'Network request failed' } }).then(resolve);
        const rows = mockState.rows.filter(r => filters.every(f => f(r)));
        if (update) rows.forEach(row => { mockState.updates.push(row.id); Object.assign(row, update); });
        // INSERT sem `.select()` (o `createClosedShift` do replay) também chega ao servidor: registra,
        // senão o defeito antigo — criar uma segunda jornada — passaria despercebido no teste.
        if (insert && !update) {
          mockState.insertPayloads.push(insert);
          const novo = { id: `ins-${mockState.insertPayloads.length}`, ...insert };
          mockState.rows.push(novo);
          return Promise.resolve({ data: [novo], error: null }).then(resolve);
        }
        return Promise.resolve({ data: rows.map(r => ({ ...r })), error: null }).then(resolve);
      },
    };
    return chain;
  },
  rpc: async () => ({ data: null, error: null }),
  channel: () => { const c: any = { on: () => c, subscribe: () => c }; return c; },
  removeChannel: () => undefined,
} }));
jest.mock('@/features/driver/locationService', () => ({
  getCurrentDriverLocation: jest.fn(async () => null),
  startLocationSharing: async () => ({ stop: () => undefined }),
}));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/features/auth/useOrganizationRole', () => ({ useOrganizationRole: () => ({ role: 'driver', view: 'driver', isLoading: false }) }));
jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => { require('react').useEffect(cb, []); },
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));

const { loadPendingWrites, savePendingWrites, abrirFilaDoUsuario } = require('@/features/driver/pendingWrites') as typeof import('@/features/driver/pendingWrites');
const Storage = require('@react-native-async-storage/async-storage');
const Driver = require('../app/(tabs)/driver').default;

async function registrar(screen: any, botao: string) {
  await fireEvent.press(screen.getByLabelText(botao));
  await fireEvent.changeText(screen.getByLabelText('Reason for the manual record'), 'End of the day');
  await fireEvent.press(screen.getByLabelText('Save manual record'));
}

beforeEach(async () => {
  await Storage.clear();
  mockState.rows = []; mockState.inserts = 0; mockState.updates = []; mockState.insertPayloads = [];
  mockState.failReads = false; mockState.failUpdates = false;
});
afterEach(cleanup);

it('clock out sem sinal guarda QUAL jornada fechar e o replay fecha a mesma — sem criar uma segunda', async () => {
  mockState.rows = [jornadaAberta()];
  const screen = await render(<Driver />);
  await waitFor(() => expect(screen.getByLabelText('Clock out')).toBeTruthy());

  mockState.failUpdates = true; // sem sinal na hora de fechar
  await registrar(screen, 'Clock out');
  await waitFor(async () => expect(await loadPendingWrites()).toHaveLength(1));

  const [naFila] = await loadPendingWrites();
  expect(naFila.kind).toBe('shift');
  // O que prova a correção: a entrada da fila LEMBRA a jornada aberta que precisava ser fechada.
  expect((naFila as { shiftId?: string | null }).shiftId).toBe('open-journey');

  mockState.failUpdates = false; // sinal voltou
  await act(async () => { await screen.getByTestId('driver-scroll').props.refreshControl.props.onRefresh(); });

  await waitFor(() => expect(mockState.updates).toEqual(['open-journey']));
  expect(mockState.inserts).toBe(0);            // nada de jornada nova
  expect(mockState.rows).toHaveLength(1);       // exatamente a jornada do dia anterior, agora fechada
  expect(mockState.rows[0].ended_at).not.toBeNull();
  expect(await loadPendingWrites()).toEqual([]);
  // Sem jornada é o CARTÃO DE INÍCIO (redesenho 05/10/2026): o marcador é o botão.
  await waitFor(() => expect(screen.getByLabelText('Clock in')).toBeTruthy());
});

it('o replay não insiste quando a jornada da fila já foi fechada em outro aparelho', async () => {
  mockState.rows = [{ ...jornadaAberta(), ended_at: '2026-10-04T22:00:00.000Z' }]; // já fechada
  // Pela API REAL da fila (escrever a chave do AsyncStorage à mão dava verificação vazia: a fila não
  // era encontrada e o caso passava sem exercitar nada).
  await abrirFilaDoUsuario('driver-1');
  await savePendingWrites([{
    kind: 'shift', shiftId: 'open-journey', startedAt: '2026-10-04T14:00:00.000Z',
    endedAt: '2026-10-04T22:00:00.000Z', startReason: 'Started at the van',
    endReason: 'End of the day', routeId: null, queuedAt: '2026-10-04T22:00:00.000Z',
  }]);
  const screen = await render(<Driver />);
  await act(async () => { await screen.getByTestId('driver-scroll').props.refreshControl.props.onRefresh(); });
  await waitFor(async () => expect(await loadPendingWrites()).toEqual([]));
  expect(mockState.insertPayloads).toEqual([]); // a segunda jornada NUNCA é criada
  expect(mockState.rows).toHaveLength(1);
  expect(mockState.rows[0].ended_at).toBe('2026-10-04T22:00:00.000Z'); // o fechamento de ontem continua valendo
});
