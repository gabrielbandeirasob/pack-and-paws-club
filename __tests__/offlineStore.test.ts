import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  applyPendingEvents,
  enqueueEvent,
  isNetworkError,
  loadOutbox,
  loadRouteSnapshot,
  saveOutbox,
  saveRouteSnapshot,
  type DriverEvent,
} from '@/features/driver/offlineStore';
import type { DriverStop } from '@/features/driver/DriverRouteView';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const stop = (id: string, status: DriverStop['status'] = 'pending'): DriverStop => ({
  id, sequence: 1, status, clientName: 'Maria', dogName: 'Bob', address: null, city: null, instructions: null,
});

describe('enqueueEvent', () => {
  it('adds a new event and replaces older events for the same stop', () => {
    const arrived: DriverEvent = { stopId: 's1', status: 'arrived', createdAt: 't1' };
    const pickedUp: DriverEvent = { stopId: 's1', status: 'picked_up', createdAt: 't2' };
    const other: DriverEvent = { stopId: 's2', status: 'arrived', createdAt: 't3' };
    const queue = enqueueEvent(enqueueEvent([arrived], pickedUp), other);
    expect(queue).toHaveLength(2);
    expect(queue.find((event) => event.stopId === 's1')?.status).toBe('picked_up');
    expect(queue.find((event) => event.stopId === 's2')?.status).toBe('arrived');
  });
});

describe('applyPendingEvents', () => {
  it('applies pending statuses to stops and leaves the rest untouched', () => {
    const stops = [stop('s1'), stop('s2', 'arrived'), stop('s3')];
    const events: DriverEvent[] = [
      { stopId: 's1', status: 'completed', createdAt: 't' },
      { stopId: 's3', status: 'skipped', createdAt: 't' },
    ];
    const result = applyPendingEvents(stops, events);
    expect(result.find((item) => item.id === 's1')?.status).toBe('completed');
    expect(result.find((item) => item.id === 's2')?.status).toBe('arrived');
    expect(result.find((item) => item.id === 's3')?.status).toBe('skipped');
  });

  it('returns the same list when there are no events', () => {
    const stops = [stop('s1')];
    expect(applyPendingEvents(stops, [])).toBe(stops);
  });
});

describe('isNetworkError', () => {
  it('recognizes connectivity failures and ignores server errors', () => {
    expect(isNetworkError(new Error('Network request failed'))).toBe(true);
    expect(isNetworkError({ message: 'Failed to fetch' })).toBe(true);
    expect(isNetworkError('load failed')).toBe(true);
    expect(isNetworkError({ message: 'relation does not exist' })).toBe(false);
    expect(isNetworkError('row-level security')).toBe(false);
  });
});

describe('route snapshot persistence', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('round-trips a snapshot', async () => {
    expect(await loadRouteSnapshot()).toBeNull();
    await saveRouteSnapshot({ savedAt: 't', publishedAt: 'p', stops: [stop('s1', 'arrived')] });
    const loaded = await loadRouteSnapshot();
    expect(loaded?.publishedAt).toBe('p');
    expect(loaded?.stops).toHaveLength(1);
    expect(loaded?.stops[0].status).toBe('arrived');
  });

  it('returns null for corrupted data', async () => {
    await AsyncStorage.setItem('pnp:driver:route:today', 'not-json');
    expect(await loadRouteSnapshot()).toBeNull();
  });
});

describe('outbox persistence', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('round-trips events and tolerates corruption', async () => {
    expect(await loadOutbox()).toEqual([]);
    await saveOutbox([{ stopId: 's1', status: 'completed', createdAt: 't' }]);
    expect(await loadOutbox()).toHaveLength(1);
    await AsyncStorage.setItem('pnp:driver:outbox', '{"bad": true}');
    expect(await loadOutbox()).toEqual([]);
  });
});
