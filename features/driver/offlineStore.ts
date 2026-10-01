import AsyncStorage from '@react-native-async-storage/async-storage';

import type { DriverStop } from '@/features/driver/DriverRouteView';

export type DriverEventStatus = 'arrived' | 'picked_up' | 'completed' | 'skipped';

export type DriverEvent = {
  stopId: string;
  status: DriverEventStatus;
  /**
   * Sequência de passos ainda NÃO gravados nesta parada, na ordem. Existe por causa do fluxo de
   * 2 toques (pedido do dono, 30/09/2026): o 2º toque ("Next") grava `picked_up` E `completed`, e
   * os DOIS têm de subir quando o sinal voltar — senão o marco do meio (e a linha de auditoria)
   * some. `status` continua sendo o ÚLTIMO passo (é o que a tela mostra de imediato).
   * Ausente = fila antiga/simples: grava só o `status`.
   */
  steps?: DriverEventStatus[];
  createdAt: string;
  /**
   * Comprovante tirado sem rede. A foto fica no aparelho e sobe para o Storage antes de o status
   * ser aplicado (por isso guardamos o caminho de destino junto do evento).
   */
  proof?: {
    kind: 'pickup' | 'dropoff';
    localUri: string;
    path: string;
    capturedAt: string;
    /** Tipo do arquivo informado pelo seletor (no navegador o caminho e um `blob:` sem extensao). */
    mimeType?: string | null;
  };
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

/** Removes the cached route (used when the route ends/expires, so sensitive instructions do not linger). */
export async function clearRouteSnapshot(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ROUTE_KEY);
  } catch {
    // Best-effort.
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

/** Passos que um evento da fila tem de gravar, na ordem (fila antiga/simples = só o `status`). */
export function passosDoEvento(event: DriverEvent): DriverEventStatus[] {
  return event.steps && event.steps.length > 0 ? event.steps : [event.status];
}

/**
 * Adds a new event and replaces older events for the same stop — mas NUNCA descarta um passo que
 * ainda não subiu (o 2º toque do motorista grava `picked_up` e `completed`: os dois têm de chegar ao
 * servidor, senão o marco do meio e a linha de auditoria ficam faltando).
 */
export function enqueueEvent(events: DriverEvent[], event: DriverEvent): DriverEvent[] {
  const anterior = events.find((existing) => existing.stopId === event.stopId);
  const jaNaFila = anterior ? passosDoEvento(anterior) : [];
  const novos = passosDoEvento(event);
  const steps = [...jaNaFila, ...novos.filter((passo) => !jaNaFila.includes(passo))];
  return [...events.filter((existing) => existing.stopId !== event.stopId), { ...event, steps }];
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
