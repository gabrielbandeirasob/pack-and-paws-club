// Route optimizer: window/priority aware ordering with feasibility detection.
// Pure module — no I/O, fully unit-testable. Tempos reais de transito entram por
// `options.travel` (ver travelMatrix.ts); sem eles, cai na linha reta + velocidade media.

import type { TravelTimes } from '@/features/dispatch/travelMatrix';

export type OptimizeStop = {
  dogId: string;
  clientName: string;
  dogName: string;
  latitude: number | null;
  longitude: number | null;
  windowStart: string | null; // 'HH:MM'
  windowEnd: string | null;
  exactTime: string | null; // 'HH:MM' — must be reached by this time
  priority: 'normal' | 'priority';
  serviceMinutes?: number;
};

export type OptimizedStop = OptimizeStop & {
  sequence: number;
  plannedArrival: string | null; // 'HH:MM' local
  waitsMinutes: number;
};

export type OptimizeResult = {
  stops: OptimizedStop[];
  feasible: boolean;
  reason: string | null;
};

export type OptimizeOptions = {
  startAtMinutes?: number; // departure from base (default 08:00)
  speedKph?: number; // average urban speed (default 25)
  serviceMinutes?: number; // default service time per stop (default 8)
  homeLatitude?: number | null; // driver origin; travel to the first stop counts from here
  homeLongitude?: number | null;
  /**
   * DE ONDE A ENTREGA COMEÇA — pedido do CLIENTE (02/10/2026): *"Posição do driver inicia rota dos drop
   * offs"*. Na prática ele começa a entregar vindo do YARD (é onde os cães passam o dia), então a
   * primeira perna da entrega conta daqui; sem esta origem, ela conta da base (a van), que estava errada.
   */
  dropoffLatitude?: number | null;
  dropoffLongitude?: number | null;
  /** Tempos reais (Google, via servidor). Ausente/incompleto = estimativa por linha reta. */
  travel?: TravelTimes | null;
};

const DEFAULT_START = 8 * 60;
const DEFAULT_SPEED_KPH = 25;
const DEFAULT_SERVICE_MIN = 8;

export function hhmmToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function minutesToHHMM(minutes: number): string {
  const clamped = Math.max(0, Math.round(minutes));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

/** Great-circle distance in kilometers (haversine). */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(s));
}

function travelMinutesBetween(a: OptimizeStop, b: OptimizeStop, options: OptimizeOptions): number {
  const real = options.travel?.between(a.dogId, b.dogId);
  if (typeof real === 'number' && Number.isFinite(real)) return real;
  if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) return 0;
  const km = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
  return (km / (options.speedKph ?? DEFAULT_SPEED_KPH)) * 60;
}

/** A origem de uma sequência: a base (van) ou, na ENTREGA, de onde o motorista está saindo (o yard). */
type Origem = { latitude: number | null | undefined; longitude: number | null | undefined };

function travelMinutesFromHome(stop: OptimizeStop, options: OptimizeOptions, origem?: Origem | null): number {
  const temOrigemPropria = Boolean(origem && origem.latitude != null && origem.longitude != null);
  // A matriz real tem UMA base (a van): só vale quando a origem pedida é a própria base.
  if (!temOrigemPropria) {
    const real = options.travel?.homeTo(stop.dogId);
    if (typeof real === 'number' && Number.isFinite(real)) return real;
  }
  if (stop.latitude == null || stop.longitude == null) return 0;
  const lat = temOrigemPropria ? origem!.latitude! : options.homeLatitude;
  const lon = temOrigemPropria ? origem!.longitude! : options.homeLongitude;
  if (lat == null || lon == null) return 0;
  const km = haversineKm(lat, lon, stop.latitude, stop.longitude);
  return (km / (options.speedKph ?? DEFAULT_SPEED_KPH)) * 60;
}

/**
 * Minutos de DESLOCAMENTO + SERVIÇO de uma ordem JÁ definida, com as MESMAS contas do otimizador.
 *
 * Existe para o gestor CONFERIR o que o Optimize fez (dúvida do dono, 01/10/2026: *"cliquei em otimizar e
 * fez algumas mudanças, só não consigo confirmar se está realmente fazendo a melhor rota"*): com o número
 * das duas ordens ele lê "Pick-up: 52 min → 41 min (-11)" em vez de confiar na palavra do app.
 *
 * Devolve null quando falta dado para a conta (id desconhecido ou parada sem coordenada e sem matriz
 * real) — número inventado seria pior do que nenhum número.
 */
export function minutosDaOrdem(
  stops: OptimizeStop[],
  ordemDeIds: string[],
  options: OptimizeOptions = {},
  /** De onde esta sequência SAI (na entrega: de onde o motorista está — o yard). */
  origem?: Origem | null,
): number | null {
  const porId = new Map(stops.map((stop) => [stop.dogId, stop]));
  const ids = ordemDeIds.filter((id) => porId.has(id));
  if (ids.length === 0) return null;

  let total = 0;
  for (let i = 0; i < ids.length; i += 1) {
    const parada = porId.get(ids[i]) as OptimizeStop;
    const anterior = i === 0 ? null : (porId.get(ids[i - 1]) as OptimizeStop);
    if (parada.latitude == null || parada.longitude == null) {
      // Sem coordenada a estimativa de linha reta não existe; só a matriz real cobre essa perna.
      const temOrigemPropria = Boolean(origem && origem.latitude != null && origem.longitude != null);
      const real = anterior
        ? options.travel?.between(anterior.dogId, parada.dogId)
        : (temOrigemPropria ? null : options.travel?.homeTo(parada.dogId));
      if (typeof real !== 'number' || !Number.isFinite(real)) return null;
      total += real + serviceOf(parada, options);
      continue;
    }
    total += (anterior ? travelMinutesBetween(anterior, parada, options) : travelMinutesFromHome(parada, options, origem))
      + serviceOf(parada, options);
  }
  return total;
}

function serviceOf(stop: OptimizeStop, options: OptimizeOptions): number {
  return stop.serviceMinutes ?? options.serviceMinutes ?? DEFAULT_SERVICE_MIN;
}

/** Latest minute by which the stop must be reached (window end or exact time). */
function deadlineOf(stop: OptimizeStop): number | null {
  const exact = hhmmToMinutes(stop.exactTime);
  if (exact != null) return exact;
  return hhmmToMinutes(stop.windowEnd);
}

/** Earliest minute at which service may start (window start; exact time has no wait). */
function windowStartOf(stop: OptimizeStop): number | null {
  return hhmmToMinutes(stop.windowStart);
}

export function optimizeRoute(
  stops: OptimizeStop[],
  options: OptimizeOptions = {},
  /** Na ENTREGA o cliente pediu que a rota comece da POSIÇÃO do motorista (na prática, o yard). */
  origem?: Origem | null,
): OptimizeResult {
  const missing = stops.filter((stop) => stop.latitude == null || stop.longitude == null).map((stop) => stop.dogName);
  if (missing.length > 0) {
    return {
      stops: [],
      feasible: false,
      reason: `Missing coordinates for: ${missing.join(', ')}. Add an address to these clients first.`,
    };
  }
  if (stops.length <= 1) {
    return {
      stops: stops.map((stop, index) => ({ ...stop, sequence: index + 1, plannedArrival: null, waitsMinutes: 0 })),
      feasible: true,
      reason: null,
    };
  }

  const pending = [...stops];
  const ordered: OptimizedStop[] = [];
  let now = options.startAtMinutes ?? DEFAULT_START;

  while (pending.length > 0) {
    const previous = ordered[ordered.length - 1] ?? null;
    let bestIndex = -1;
    let bestArrival = 0;
    let bestWaits = 0;
    let bestKey: number | null = null;

    const withDeadline = pending.filter((candidate) => deadlineOf(candidate) != null);

    // Windows dominate: while any pending stop has a window, only windowed stops are candidates.
    const candidates = withDeadline.length > 0 ? withDeadline : pending;

    for (let index = 0; index < pending.length; index += 1) {
      const candidate = pending[index];
      if (!candidates.includes(candidate)) continue;
      const travel = previous ? travelMinutesBetween(previous, candidate, options) : travelMinutesFromHome(candidate, options, origem);
      const rawArrival = now + travel;
      const windowStart = windowStartOf(candidate);
      const deadline = deadlineOf(candidate);
      const waits = windowStart != null && rawArrival < windowStart ? windowStart - rawArrival : 0;
      const arrival = windowStart != null ? Math.max(rawArrival, windowStart) : rawArrival;

      if (deadline != null && arrival > deadline) continue; // cannot honor this stop's window from here

      // Multi-criteria key: deadline first (windowed stops only), then priority, then distance.
      const deadlineKey = deadline ?? 0;
      const key = deadlineKey * 1_000_000 + (candidate.priority === 'priority' ? 0 : 1000) + travel;
      if (bestKey === null || key < bestKey) {
        bestKey = key;
        bestIndex = index;
        bestArrival = arrival;
        bestWaits = waits;
      }
    }

    if (bestIndex < 0) {
      const firstWindowed = withDeadline[0];
      const target = firstWindowed ?? pending[0];
      return {
        stops: [],
        feasible: false,
        reason: `Infeasible schedule: cannot reach "${target.dogName}" (${target.clientName}) within its time window after the previous stops.`,
      };
    }

    const [chosen] = pending.splice(bestIndex, 1);
    ordered.push({ ...chosen, sequence: ordered.length + 1, plannedArrival: minutesToHHMM(bestArrival), waitsMinutes: bestWaits });
    now = bestArrival + serviceOf(chosen, options);
  }

  return { stops: ordered, feasible: true, reason: null };
}
