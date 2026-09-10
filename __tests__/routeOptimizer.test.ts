import { haversineKm, hhmmToMinutes, minutesToHHMM, optimizeRoute, type OptimizeStop } from '@/features/dispatch/routeOptimizer';

// ~1 km per 0.01 degrees of longitude at the equator.
const stop = (overrides: Partial<OptimizeStop> & { dogId: string; dogName: string }): OptimizeStop => ({
  clientName: 'Client',
  latitude: 0,
  longitude: 0,
  windowStart: null,
  windowEnd: null,
  exactTime: null,
  priority: 'normal',
  ...overrides,
});

describe('routeOptimizer helpers', () => {
  it('converts times and distances', () => {
    expect(hhmmToMinutes('08:15')).toBe(495);
    expect(hhmmToMinutes('')).toBeNull();
    expect(minutesToHHMM(495)).toBe('08:15');
    expect(minutesToHHMM(60.6)).toBe('01:01');
    // 0.01 degrees longitude at the equator ≈ 1.11 km
    expect(haversineKm(0, 0, 0, 0.01)).toBeCloseTo(1.11, 0);
  });
});

describe('optimizeRoute — nearest neighbour without constraints', () => {
  it('orders stops closest-first when nobody has a window', () => {
    const route = optimizeRoute(
      [
        stop({ dogId: 'far', dogName: 'Far', longitude: 0.5 }), // ~55 km away
        stop({ dogId: 'near', dogName: 'Near', longitude: 0.01 }), // ~1 km away
        stop({ dogId: 'mid', dogName: 'Mid', longitude: 0.1 }), // ~11 km away
      ],
      { homeLatitude: 0, homeLongitude: 0, speedKph: 50 },
    );
    expect(route.feasible).toBe(true);
    expect(route.stops.map((item) => item.dogId)).toEqual(['near', 'mid', 'far']);
  });
});

describe('optimizeRoute — acceptance criterion of Fase 6', () => {
  it('honors a mandatory window even when that stop is not the geographically closest', () => {
    // Home at 0,0. Dog A is ~33 km east (40 min at 50 km/h) with a hard window 08:00–08:15.
    // Dog B is ~1 km away with no window. Departure at 07:30: A is reachable by 08:15 only if visited first.
    const route = optimizeRoute(
      [
        stop({ dogId: 'b-close', dogName: 'B (close)', longitude: 0.01 }),
        stop({ dogId: 'a-window', dogName: 'A (window)', longitude: 0.3, windowStart: '08:00', windowEnd: '08:15' }),
      ],
      { homeLatitude: 0, homeLongitude: 0, startAtMinutes: hhmmToMinutes('07:30') ?? 450, speedKph: 50 },
    );
    expect(route.feasible).toBe(true);
    expect(route.stops[0].dogId).toBe('a-window'); // window wins over raw distance
    expect(route.stops[0].plannedArrival).toBe('08:10');
    expect(route.stops[1].dogId).toBe('b-close');
  });
});

describe('optimizeRoute — feasibility', () => {
  it('flags an infeasible schedule when a window cannot be reached', () => {
    // Both stops open at 08:00 and close at 08:05; each is 20 min from home in opposite directions.
    const route = optimizeRoute(
      [
        stop({ dogId: 'east', dogName: 'East', longitude: 0.25, windowStart: '08:00', windowEnd: '08:05' }),
        stop({ dogId: 'west', dogName: 'West', longitude: -0.25, windowStart: '08:00', windowEnd: '08:05' }),
      ],
      { homeLatitude: 0, homeLongitude: 0, startAtMinutes: hhmmToMinutes('08:00') ?? 480, speedKph: 50 },
    );
    expect(route.feasible).toBe(false);
    expect(route.reason).toContain('Infeasible');
  });

  it('reports missing coordinates before optimizing', () => {
    const route = optimizeRoute([stop({ dogId: 'x', dogName: 'NoCoords', latitude: null as unknown as number, longitude: null as unknown as number })]);
    expect(route.feasible).toBe(false);
    expect(route.reason).toContain('NoCoords');
  });
});

describe('optimizeRoute — priority and exact times', () => {
  it('sends a priority stop first when both are feasible and neither has a window', () => {
    const route = optimizeRoute(
      [
        stop({ dogId: 'normal', dogName: 'Normal', longitude: 0.01 }),
        stop({ dogId: 'priority', dogName: 'Priority', longitude: 0.02, priority: 'priority' }),
      ],
      { homeLatitude: 0, homeLongitude: 0 },
    );
    expect(route.stops[0].dogId).toBe('priority');
  });

  it('treats an exact time as a hard deadline', () => {
    const route = optimizeRoute(
      [
        stop({ dogId: 'exact', dogName: 'Exact', longitude: 0.15, exactTime: '08:00' }), // ~17 km away (~20 min at 50 km/h)
        stop({ dogId: 'later', dogName: 'Later', longitude: 0.01 }),
      ],
      { homeLatitude: 0, homeLongitude: 0, startAtMinutes: hhmmToMinutes('07:30') ?? 450, speedKph: 50 },
    );
    expect(route.feasible).toBe(true);
    expect(route.stops[0].dogId).toBe('exact');
    expect(route.stops[0].plannedArrival).toBe('07:50');
  });
});
