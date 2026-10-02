import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  chaveDeEscopo,
  decidirAdocao,
  gravarCru,
  lerCru,
} from '@/features/driver/scopedStorage';
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
   * ENTREGA confirmada sem rede (conferência do dono, 01/10/2026): o toque da tarde grava
   * `delivered_at` na parada em vez de trocar o status. Guardado aqui para subir quando o sinal
   * voltar — o mesmo cuidado dos passos do fluxo de 2 toques.
   */
  deliveredAt?: string | null;
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

/** Chaves LEGADAS (globais, sem dono) — bases do escopo por usuário (`scopedStorage.ts`). */
const ROUTE_KEY = 'pnp:driver:route:today';
const OUTBOX_KEY = 'pnp:driver:outbox';
/** Marcadores de quem já reivindicou cada valor legado (não são herdados por um 2º usuário). */
const ROUTE_OWNER_KEY = 'pnp:driver:route:owner';
const OUTBOX_OWNER_KEY = 'pnp:driver:outbox:owner';

/**
 * ESCOPO ATUAL do outbox/rota = usuário logado (mesmo defeito e mesma correção da jornada: chave global
 * sem dono vazava passos da rota e a rota em cache entre contas — ver `scopedStorage.ts`). Sem usuário
 * (bootstrap/web) cai na chave legada.
 */
let escopoDoOutbox: string | null = null;

/** Define de QUEM é o outbox/rota daqui pra frente (a tela chama quando a sessão é conhecida). */
export function definirEscopoDoOutbox(userId: string | null | undefined): void {
  const id = (userId ?? '').trim();
  escopoDoOutbox = id.length > 0 ? id : null;
}

function chaveDaRota(): string {
  return chaveDeEscopo(ROUTE_KEY, escopoDoOutbox);
}

function chaveDoOutbox(): string {
  return chaveDeEscopo(OUTBOX_KEY, escopoDoOutbox);
}

/**
 * Abre o outbox/rota DO USUÁRIO: define o escopo e migra (uma vez) o que ficou nas chaves legadas sem
 * dono — sem perder os passos/rota que já estavam no aparelho. Devolve o outbox dele.
 */
export async function abrirOutboxDoUsuario(userId: string): Promise<DriverEvent[]> {
  definirEscopoDoOutbox(userId);

  const [rawOutboxEscopado, rawOutboxLegado, donoOutbox, rawRotaEscopada, rawRotaLegada, donoRota] = await Promise.all([
    lerCru(chaveDoOutbox()),
    lerCru(OUTBOX_KEY),
    lerCru(OUTBOX_OWNER_KEY),
    lerCru(chaveDaRota()),
    lerCru(ROUTE_KEY),
    lerCru(ROUTE_OWNER_KEY),
  ]);

  const outboxLegado = sanearOutbox(rawOutboxLegado);
  const decisaoOutbox = decidirAdocao({
    chaveDoUsuarioExiste: rawOutboxEscopado !== null,
    legadoExiste: outboxLegado.length > 0,
    donoDoLegado: donoOutbox,
    userId,
  });
  if (decisaoOutbox.adotar) {
    await gravarCru(chaveDoOutbox(), JSON.stringify(outboxLegado));
    await gravarCru(OUTBOX_OWNER_KEY, userId);
  }

  const decisaoRota = decidirAdocao({
    chaveDoUsuarioExiste: rawRotaEscopada !== null,
    legadoExiste: rawRotaLegada !== null,
    donoDoLegado: donoRota,
    userId,
  });
  if (decisaoRota.adotar && rawRotaLegada !== null) {
    await gravarCru(chaveDaRota(), rawRotaLegada);
    await gravarCru(ROUTE_OWNER_KEY, userId);
  }

  return loadOutbox();
}

/** Saneia o outbox lido de uma chave (fila antiga/JSON torto não derruba a leitura). */
function sanearOutbox(raw: string | null): DriverEvent[] {
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as DriverEvent[]) : [];
  } catch {
    return [];
  }
}

// --- route snapshot -------------------------------------------------------

export async function loadRouteSnapshot(): Promise<RouteSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(chaveDaRota());
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
    await AsyncStorage.setItem(chaveDaRota(), JSON.stringify(snapshot));
  } catch {
    // Storage full/unavailable: offline cache is best-effort.
  }
}

/** Removes the cached route (used when the route ends/expires, so sensitive instructions do not linger). */
export async function clearRouteSnapshot(): Promise<void> {
  try {
    await AsyncStorage.removeItem(chaveDaRota());
  } catch {
    // Best-effort.
  }
}

// --- outbox ---------------------------------------------------------------

export async function loadOutbox(): Promise<DriverEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(chaveDoOutbox());
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DriverEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveOutbox(events: DriverEvent[]): Promise<void> {
  try {
    await AsyncStorage.setItem(chaveDoOutbox(), JSON.stringify(events));
  } catch {
    // Best-effort: if we cannot persist the queue we lose pending events.
  }
}

/** Identidade estável de um evento (parada + instante em que ENTROU na fila). */
export function chaveDoEvento(event: DriverEvent): string {
  return `${event.stopId}@${event.createdAt}`;
}

/**
 * SERIALIZADOR DO CICLO LER-MUDAR-GRAVAR DO OUTBOX.
 *
 * 🪤 ACHADO (02/10/2026): `loadOutbox()` → mudar → `saveOutbox(...)` corria em DOIS caminhos ao
 * mesmo tempo — a subida da fila (`saveOutbox(remaining)`) e o enfileiramento do `act` quando o
 * motorista toca "Next" sem rede. Intercalados, o `saveOutbox(remaining)` da subida APAGAVA o passo
 * recém-enfileirado: o motorista lia "salvo no aparelho" e o passo sumia da fila (nunca subia).
 * Aqui cada mudança entra na VEZ da anterior; nunca há dois ciclos intercalados.
 *
 * `mudanca` recebe o outbox MAIS NOVO (lido dentro da vez) e devolve o outbox novo; o retorno é a
 * fila já gravada. Uma falha rejeita o retorno de quem chamou sem travar a vez dos próximos.
 */
let vezDoOutbox: Promise<unknown> = Promise.resolve();

export function mudarOutbox(
  mudanca: (fila: DriverEvent[]) => DriverEvent[] | Promise<DriverEvent[]>,
): Promise<DriverEvent[]> {
  const proxima = vezDoOutbox.then(async () => {
    const fila = await loadOutbox();
    const nova = await mudanca(fila);
    await saveOutbox(nova);
    return nova;
  });
  vezDoOutbox = proxima.catch(() => undefined);
  return proxima;
}

/**
 * Só para a subida da fila: do outbox VIVO tira os eventos do RETRATO que realmente saíram (subiram
 * ou foram recusados de vez), casando parada + `createdAt`. Evento enfileirado DURANTE o envio fica.
 */
export function semRegistrosSaidos(
  atual: DriverEvent[],
  retrato: DriverEvent[],
  remaining: DriverEvent[],
): DriverEvent[] {
  const saidos = new Set(retrato.slice(0, retrato.length - remaining.length).map(chaveDoEvento));
  return atual.filter((event) => !saidos.has(chaveDoEvento(event)));
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
  // A entrega já registrada no aparelho não se perde quando outro passo entra na mesma fila.
  const deliveredAt = event.deliveredAt ?? anterior?.deliveredAt ?? null;
  return [...events.filter((existing) => existing.stopId !== event.stopId), { ...event, steps, deliveredAt }];
}

/** Applies pending events optimistically to the in-memory stop list. */
export function applyPendingEvents(stops: DriverStop[], events: DriverEvent[]): DriverStop[] {
  if (events.length === 0) return stops;
  const byStop = new Map(events.map((event) => [event.stopId, event]));
  return stops.map((stop) => {
    const event = byStop.get(stop.id);
    if (!event) return stop;
    return { ...stop, status: event.status, deliveredAt: stop.deliveredAt ?? event.deliveredAt ?? null };
  });
}

/** True when an error smells like a network/connectivity failure. */
export function isNetworkError(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : JSON.stringify(reason ?? '');
  return /network|failed to fetch|load failed|timed? ?out|internet connection|ECONN|fetch failed|request failed/i.test(message);
}
