import { optimizeRoute, type OptimizeOptions, type OptimizeStop, type OptimizedStop } from '@/features/dispatch/routeOptimizer';

export type DriverRouteStatus = 'pending' | 'arrived' | 'picked_up' | 'completed' | 'skipped';

export type DriverRouteStop = OptimizeStop & {
  stopId: string;
  sequence: number;
  status: DriverRouteStatus;
};

export type DriverOrigin = { latitude: number; longitude: number };

export type DriverRouteOptimization = {
  feasible: boolean;
  reason: string | null;
  /** Ordem completa que deve ser gravada no banco, incluindo etapas já iniciadas/concluídas. */
  orderedDogIds: string[];
  /** Apenas as coletas pendentes que foram recalculadas. */
  optimized: OptimizedStop[];
};

/**
 * Recalcula somente as próximas coletas a partir do GPS atual do motorista.
 * Etapas já iniciadas/concluídas ficam na frente e não mudam de posição relativa.
 */
export function optimizeDriverRoute(
  stops: DriverRouteStop[],
  origin: DriverOrigin | null,
  options: Omit<OptimizeOptions, 'homeLatitude' | 'homeLongitude'> = {},
): DriverRouteOptimization {
  const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);
  const fixed = sorted.filter((stop) => stop.status !== 'pending');
  const pending = sorted.filter((stop) => stop.status === 'pending');

  if (!origin) {
    return {
      feasible: false,
      reason: 'Your current location is not available. Allow location access and try again.',
      orderedDogIds: sorted.map((stop) => stop.dogId),
      optimized: [],
    };
  }

  const result = optimizeRoute(pending, {
    ...options,
    homeLatitude: origin.latitude,
    homeLongitude: origin.longitude,
  });

  if (!result.feasible) {
    return {
      feasible: false,
      reason: result.reason,
      orderedDogIds: sorted.map((stop) => stop.dogId),
      optimized: [],
    };
  }

  return {
    feasible: true,
    reason: null,
    orderedDogIds: [...fixed.map((stop) => stop.dogId), ...result.stops.map((stop) => stop.dogId)],
    optimized: result.stops,
  };
}
