// Route optimizer: window/priority aware ordering with feasibility detection.
// Pure module — no I/O, fully unit-testable. Traffic-aware matrices arrive with GCP (Fase 6 follow-up).

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
  if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) return 0;
  const km = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
  return (km / (options.speedKph ?? DEFAULT_SPEED_KPH)) * 60;
}

function travelMinutesFromHome(stop: OptimizeStop, options: OptimizeOptions): number {
  if (stop.latitude == null || stop.longitude == null) return 0;
  if (options.homeLatitude == null || options.homeLongitude == null) return 0;
  const km = haversineKm(options.homeLatitude, options.homeLongitude, stop.latitude, stop.longitude);
  return (km / (options.speedKph ?? DEFAULT_SPEED_KPH)) * 60;
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

export function optimizeRoute(stops: OptimizeStop[], options: OptimizeOptions = {}): OptimizeResult {
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
      const travel = previous ? travelMinutesBetween(previous, candidate, options) : travelMinutesFromHome(candidate, options);
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
