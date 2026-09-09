import AsyncStorage from '@react-native-async-storage/async-storage';

import type { DriverStop } from '@/features/driver/DriverRouteView';

export type DriverEventStatus = 'arrived' | 'picked_up' | 'completed' | 'skipped';

export type DriverEvent = {
  stopId: string;
  status: DriverEventStatus;
  createdAt: string;
};

export type RouteSnapshot = {
  savedAt: string;
  publishedAt: string | null;
  stops: DriverStop[];
};

const ROUTE_KEY = 'pnp:driver:route:today';
const OUTBOX_KEY = 'pnp:driver:outbox';

// --- route snapshot -------------------------------------------------------

export async function loadRouteSnapshot(): Promise<RouteSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(ROUTE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RouteSnapshot;
    if (!Array.isArray(parsed.stops)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveRouteSnapshot(snapshot: RouteSnapshot): Promise<void> {
  try {
    await AsyncStorage.setItem(ROUTE_KEY, JSON.stringify(snapshot));
  } catch {
    // Storage full/unavailable: offline cache is best-effort.
  }
}

// --- outbox ---------------------------------------------------------------

export async function loadOutbox(): Promise<DriverEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DriverEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveOutbox(events: DriverEvent[]): Promise<void> {
  try {
    await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(events));
  } catch {
    // Best-effort: if we cannot persist the queue we lose pending events.
  }
}

/** Adds an event keeping only the newest per stop (status is overwritten server-side). */
export function enqueueEvent(events: DriverEvent[], event: DriverEvent): DriverEvent[] {
  return [...events.filter((existing) => existing.stopId !== event.stopId), event];
}

/** Applies pending events optimistically to the in-memory stop list. */
export function applyPendingEvents(stops: DriverStop[], events: DriverEvent[]): DriverStop[] {
  if (events.length === 0) return stops;
  const byStop = new Map(events.map((event) => [event.stopId, event.status]));
  return stops.map((stop) => {
    const status = byStop.get(stop.id);
    return status ? { ...stop, status } : stop;
  });
}

/** True when an error smells like a network/connectivity failure. */
export function isNetworkError(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : JSON.stringify(reason ?? '');
  return /network|failed to fetch|load failed|timed? ?out|internet connection|ECONN|fetch failed|request failed/i.test(message);
}
