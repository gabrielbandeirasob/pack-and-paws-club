import { optimizeDriverRoute, type DriverRouteStop } from '@/features/driver/driverRouteOptimizer';

const stop = (overrides: Partial<DriverRouteStop> & { stopId: string; dogId: string; dogName: string; longitude: number }): DriverRouteStop => ({
  sequence: 1,
  status: 'pending',
  clientName: 'Pack & Paws client',
  latitude: 0,
  windowStart: null,
  windowEnd: null,
  exactTime: null,
  priority: 'normal',
  ...overrides,
});

describe('optimizeDriverRoute — rota nasce na posição atual do motorista', () => {
  it('ordena as próximas coletas começando pelo cão mais perto do GPS atual', () => {
    const result = optimizeDriverRoute(
      [
        stop({ stopId: 's-far', dogId: 'dog-filo', dogName: 'Filó', longitude: 0.5, sequence: 1 }),
        stop({ stopId: 's-near', dogId: 'dog-bella', dogName: 'Bella', longitude: 0.01, sequence: 2 }),
        stop({ stopId: 's-mid', dogId: 'dog-mowgli', dogName: 'Mowgli', longitude: 0.1, sequence: 3 }),
      ],
      { latitude: 0, longitude: 0 },
      { startAtMinutes: 8 * 60, speedKph: 50 },
    );

    expect(result.feasible).toBe(true);
    expect(result.orderedDogIds).toEqual(['dog-bella', 'dog-mowgli', 'dog-filo']);
    expect(result.optimized.map((item) => item.dogName)).toEqual(['Bella', 'Mowgli', 'Filó']);
  });

  it('mantém etapas já iniciadas/concluídas na frente e só otimiza as pendentes', () => {
    const result = optimizeDriverRoute(
      [
        stop({ stopId: 's-done', dogId: 'dog-thor', dogName: 'Thor', longitude: -1, sequence: 1, status: 'completed' }),
        stop({ stopId: 's-current', dogId: 'dog-luna', dogName: 'Luna', longitude: 0.8, sequence: 2, status: 'arrived' }),
        stop({ stopId: 's-far', dogId: 'dog-filo', dogName: 'Filó', longitude: 0.5, sequence: 3 }),
        stop({ stopId: 's-near', dogId: 'dog-bella', dogName: 'Bella', longitude: 0.01, sequence: 4 }),
      ],
      { latitude: 0, longitude: 0 },
      { startAtMinutes: 8 * 60, speedKph: 50 },
    );

    expect(result.orderedDogIds).toEqual(['dog-thor', 'dog-luna', 'dog-bella', 'dog-filo']);
  });

  it('não inventa rota sem GPS atual', () => {
    const result = optimizeDriverRoute(
      [
        stop({ stopId: 's1', dogId: 'dog-bella', dogName: 'Bella', longitude: 0.01 }),
        stop({ stopId: 's2', dogId: 'dog-filo', dogName: 'Filó', longitude: 0.02 }),
      ],
      null,
    );

    expect(result.feasible).toBe(false);
    expect(result.reason).toContain('current location');
  });

  it('recusa otimização quando um cliente não tem coordenadas', () => {
    const result = optimizeDriverRoute(
      [
        stop({ stopId: 's1', dogId: 'dog-bella', dogName: 'Bella', longitude: 0.01 }),
        { ...stop({ stopId: 's2', dogId: 'dog-filo', dogName: 'Filó', longitude: 0.02 }), latitude: null, longitude: null },
      ],
      { latitude: 0, longitude: 0 },
    );

    expect(result.feasible).toBe(false);
    expect(result.reason).toContain('Filó');
  });
});
