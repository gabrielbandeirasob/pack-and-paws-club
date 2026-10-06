import { haversineKm, hhmmToMinutes, minutosDaOrdem, minutesToHHMM, optimizeRoute, quilometrosDaOrdem, type OptimizeStop } from '@/features/dispatch/routeOptimizer';

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

describe('optimizeRoute — tempo de serviço por parada (3 min por pick-up)', () => {
  /**
   * Pedido do cliente (áudios de 30/09/2026): "na hora de calcular a rota tem como botar ali…
   * normalmente pôr três minutinhos, né, por pick-up". O otimizador JÁ tinha `serviceMinutes`
   * (padrão 8) e a tela nunca passava — aqui o vetor trava o número usado pelo Dispatch.
   * As duas paradas ficam na MESMA coordenada, então o único tempo entre elas é o de serviço.
   */
  const paradas: OptimizeStop[] = [
    stop({ dogId: 'a', dogName: 'A', longitude: 0.01 }),
    stop({ dogId: 'b', dogName: 'B', longitude: 0.01 }),
  ];
  const opcoes = { homeLatitude: 0, homeLongitude: 0, startAtMinutes: 480, speedKph: 50 };
  const intervalo = (route: ReturnType<typeof optimizeRoute>) =>
    (hhmmToMinutes(route.stops[1].plannedArrival) ?? 0) - (hhmmToMinutes(route.stops[0].plannedArrival) ?? 0);

  it('com serviceMinutes 3 a 2ª parada chega 3 min depois da 1ª (o valor que o Dispatch manda)', () => {
    expect(intervalo(optimizeRoute(paradas, { ...opcoes, serviceMinutes: 3 }))).toBe(3);
  });

  it('o padrão antigo (sem opção) continua sendo 8 min por parada — a mudança é da tela', () => {
    expect(intervalo(optimizeRoute(paradas, opcoes))).toBe(8);
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

/**
 * DESTINO FIXO POR PERNA — regra de negócio do dono (05/10/2026):
 * **pick-up SEMPRE termina no YARD** e **entrega SEMPRE termina na VAN**. Van e Yard são pontas fixas;
 * o otimizador só mexe nas paradas de cliente que ficam no meio. O destino entra na CONTA (última perna)
 * — é ele que decide QUEM fica por último.
 *
 * Conta do teste (1 grau de longitude ≈ 111 km, 60 km/h ⇒ 1 km por minuto; tudo deslocado 0,5° a leste
 * porque (0,0) é "sem coordenada" no app):
 *   van (0, 0.50) · yard (0, 0.54) = 4,4 km · parada A (0, 0.53) = 3,3 km · parada B (0, 0.46) = 4,4 km
 *   Ordem A→B (sem olhar o destino): 3,3 + 7,8 + 8,9 (B→yard) = 20,0 min
 *   Ordem B→A (fechando no destino): 4,4 + 7,8 + 1,1 (A→yard) = 13,3 min
 */
describe('optimizeRoute — destino fixo (yard no pick-up, van na entrega)', () => {
  const van = { latitude: 0, longitude: 0.5 };
  const yard = { latitude: 0, longitude: 0.54 };
  const A = stop({ dogId: 'A', dogName: 'Ana', latitude: 0, longitude: 0.53 });
  const B = stop({ dogId: 'B', dogName: 'Bia', latitude: 0, longitude: 0.46 });
  const opcoes = {
    homeLatitude: van.latitude, homeLongitude: van.longitude, speedKph: 60,
    destinationLatitude: yard.latitude, destinationLongitude: yard.longitude,
  };

  it('termina o pick-up no YARD: a última parada é a que fica no caminho de volta', () => {
    const rota = optimizeRoute([A, B], opcoes);
    expect(rota.feasible).toBe(true);
    expect(rota.stops.map((s) => s.dogId)).toEqual(['B', 'A']);
    // E fecha no destino: A (0, 0.53) está a 1,1 km do yard, B estaria a 8,9 km.
    expect(quilometrosDaOrdem([A, B], ['B', 'A'], van, yard)).toBeCloseTo(13.3, 0);
    expect(quilometrosDaOrdem([A, B], ['A', 'B'], van, yard)).toBeCloseTo(20.0, 0);
  });

  it('sem o destino informado o comportamento antigo continua (nada muda para quem não tem yard)', () => {
    const rota = optimizeRoute([A, B], { homeLatitude: van.latitude, homeLongitude: van.longitude, speedKph: 60 });
    expect(rota.stops.map((s) => s.dogId)).toEqual(['A', 'B']);
  });

  it('a ENTREGA sai do YARD e fecha na VAN (mesma regra, pontas trocadas)', () => {
    const rotaEntrega = optimizeRoute([A, B], {
      speedKph: 60,
      destinationLatitude: van.latitude, destinationLongitude: van.longitude,
    }, yard);
    expect(rotaEntrega.feasible).toBe(true);
    // Sai do yard (A está a 1,1 km, B a 8,9 km) e a última perna entra na conta.
    expect(rotaEntrega.stops.map((s) => s.dogId)).toEqual(['A', 'B']);
    const comDestino = minutosDaOrdem([A, B], ['A', 'B'], {
      speedKph: 60, destinationLatitude: van.latitude, destinationLongitude: van.longitude,
    }, yard);
    const semDestino = minutosDaOrdem([A, B], ['A', 'B'], { speedKph: 60 }, yard);
    expect(comDestino).toBeGreaterThan((semDestino ?? 0));
  });

  it('distância sem coordenada em alguma parada é null (não inventa número)', () => {
    const semPonto = stop({ dogId: 'C', dogName: 'Cao', latitude: null, longitude: null });
    expect(quilometrosDaOrdem([A, semPonto], ['A', 'C'], van, yard)).toBeNull();
  });
});
