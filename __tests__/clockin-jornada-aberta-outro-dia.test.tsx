/** Regressão: a jornada aberta é global por motorista, não apenas do dia da rota. */
import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ShiftRow } from '@/features/driver/shiftService';

const mockState = {
  rows: [] as (ShiftRow & { driver_id: string })[],
  inserts: 0,
  updates: [] as string[],
  failReads: false,
};
const mockOld = () => ({
  id: 'previous-journey', driver_id: 'driver-1',
  started_at: '2026-09-01T16:00:00.000Z', ended_at: null,
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
      gte: (key: string, value: string) => { filters.push(r => r[key] >= value); return chain; },
      lt: (key: string, value: string) => { filters.push(r => r[key] < value); return chain; },
      // Mesmo predicado PostgREST da consulta: aberta OU iniciada no intervalo do dia.
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
        mockState.rows.push({ id: 'new-journey', ended_at: null, end_reason: null, ...insert });
        return { data: { id: 'new-journey' }, error: null };
      },
      then: (resolve: (value: unknown) => unknown) => {
        if (table !== 'driver_shifts') return Promise.resolve({ data: [], error: null }).then(resolve);
        if (mockState.failReads && !update) return Promise.resolve({ data: null, error: { message: 'Network request failed' } }).then(resolve);
        const rows = mockState.rows.filter(r => filters.every(f => f(r)));
        if (update) rows.forEach(row => { mockState.updates.push(row.id); Object.assign(row, update); });
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

const { supabase } = require('@/lib/supabase');
const { loadDriverShifts } = require('@/features/driver/shiftService') as typeof import('@/features/driver/shiftService');
const { loadPendingWrites, savePendingWrites, abrirFilaDoUsuario } = require('@/features/driver/pendingWrites') as typeof import('@/features/driver/pendingWrites');
const Storage = require('@react-native-async-storage/async-storage');
const Driver = require('../app/(tabs)/driver').default;

async function record(screen: any, name: string) {
  await fireEvent.press(screen.getByLabelText(name));
  await fireEvent.changeText(screen.getByLabelText('Reason for the manual record'), 'Manual journey record');
  await fireEvent.press(screen.getByLabelText('Save manual record'));
}
beforeEach(async () => {
  await Storage.clear();
  mockState.rows = []; mockState.inserts = 0; mockState.updates = []; mockState.failReads = false;
});
afterEach(cleanup);

it('reconcilia uma jornada aberta depois da carga quando o servidor recusa o novo Clock in', async () => {
  const screen = await render(<Driver />);
  await waitFor(() => expect(screen.getByText('Journey not started yet')).toBeTruthy());
  mockState.rows = [mockOld()]; // Outro aparelho / leitura anterior à escrita.
  await record(screen, 'Clock in');
  await waitFor(() => expect(screen.getByLabelText('Clock out')).toBeTruthy());
  expect(screen.queryByText('Journey not started yet')).toBeNull();
  expect(mockState.inserts).toBe(1); // Somente a tentativa recusada, nunca duplicação.
  expect(mockState.rows).toHaveLength(1);
  expect(await loadPendingWrites()).toEqual([]);
});

it('não enfileira uma nova entrada se a releitura após already-open falhar por rede', async () => {
  const screen = await render(<Driver />);
  await waitFor(() => expect(screen.getByLabelText('Clock in')).toBeTruthy());
  mockState.rows = [mockOld()];
  mockState.failReads = true;
  await record(screen, 'Clock in');
  await waitFor(() => expect(screen.getByText(/Pull down to refresh/)).toBeTruthy());
  expect(mockState.inserts).toBe(1);
  expect(await loadPendingWrites()).toEqual([]);
  mockState.failReads = false;
  await act(async () => { await screen.getByTestId('driver-scroll').props.refreshControl.props.onRefresh(); });
  await waitFor(() => expect(screen.getByLabelText('Clock out')).toBeTruthy());
  expect(mockState.inserts).toBe(1);
});

it('reconcilia a aberta global após recusa definitiva da fila, sem criar nem fechar jornada', async () => {
  await abrirFilaDoUsuario('driver-1');
  await savePendingWrites([{ kind: 'shift', startedAt: mockOld().started_at, endedAt: null,
    startReason: 'Offline clock in', endReason: null, routeId: null, queuedAt: mockOld().started_at }]);
  mockState.rows = [mockOld()];
  const screen = await render(<Driver />);
  await waitFor(() => expect(screen.getByLabelText('Clock out')).toBeTruthy());
  expect(screen.getByText(/office did not accept/)).toBeTruthy();
  expect(await loadPendingWrites()).toEqual([]);
  expect(mockState.rows).toHaveLength(1);
  expect(mockState.rows[0].ended_at).toBeNull();
});

it('carrega a aberta anterior sem importar jornadas fechadas antigas ou de outro motorista', async () => {
  mockState.rows = [mockOld(), { ...mockOld(), id: 'other-driver', driver_id: 'driver-2' },
    { ...mockOld(), id: 'closed-yesterday', ended_at: '2026-09-01T20:00:00.000Z' },
    { ...mockOld(), id: 'closed-today', started_at: '2026-10-05T08:00:00.000Z', ended_at: '2026-10-05T09:00:00.000Z' }];
  const rows = await loadDriverShifts(supabase, { driverId: 'driver-1', dayStart: '2026-10-05T00:00:00.000Z', dayEnd: '2026-10-06T00:00:00.000Z' });
  expect(rows.map(r => r.id)).toEqual(['previous-journey', 'closed-today']);
});

it('mostra Clock out para a jornada de outro dia e fecha o id original sem criar outro registro', async () => {
  mockState.rows = [mockOld()];
  const screen = await render(<Driver />);
  await waitFor(() => expect(screen.getByLabelText('Clock out')).toBeTruthy());
  expect(screen.queryByText('Journey not started yet')).toBeNull();
  expect(screen.queryByLabelText('Clock in')).toBeNull();
  expect(mockState.inserts).toBe(0);
  await record(screen, 'Clock out');
  await waitFor(() => expect(mockState.updates).toEqual(['previous-journey']));
  expect(mockState.rows[0].ended_at).not.toBeNull();
  expect(mockState.inserts).toBe(0);
});
