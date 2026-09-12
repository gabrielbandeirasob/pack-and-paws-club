/**
 * Transito real: formato da resposta do servidor, comportamento quando a funcao nao existe
 * e — o teste que importa — provar que os tempos reais MUDAM a ordem sugerida.
 */
const mockInvoke = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => mockInvoke(...a) } },
}));

import { optimizeRoute, type OptimizeStop } from '@/features/dispatch/routeOptimizer';
import { BASE_ID, matrixFromMinutes, parseTravelTimes } from '@/features/dispatch/travelMatrix';
import { TRAVEL_TIMES_FUNCTION, fetchTravelTimes } from '@/features/dispatch/trafficProvider';

const paradas: OptimizeStop[] = [
  { dogId: 'a', clientName: 'Ana', dogName: 'Bolinha', latitude: 1, longitude: 1, windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' },
  { dogId: 'b', clientName: 'Bia', dogName: 'Fumaça', latitude: 1.01, longitude: 1, windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' },
  { dogId: 'c', clientName: 'Caio', dogName: 'Nina', latitude: 1.02, longitude: 1.01, windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' },
];

beforeEach(() => jest.clearAllMocks());

describe('formato da resposta (servidor -> app)', () => {
  it('aceita a matriz em segundos e converte para minutos', () => {
    const travel = parseTravelTimes(
      { dogIds: ['a', 'b', 'c'], durations: matrixFromMinutes([[0, 10, 20], [10, 0, 5], [20, 5, 0]]), source: 'google' },
      ['a', 'b', 'c'],
    );
    expect(travel).not.toBeNull();
    expect(travel!.between('a', 'b')).toBeCloseTo(10, 5);
    expect(travel!.between('c', 'b')).toBeCloseTo(5, 5);
    expect(travel!.homeTo('a')).toBeNull(); // sem base na consulta
  });

  it('usa a primeira linha como base quando o servidor manda a base junto', () => {
    const travel = parseTravelTimes(
      { dogIds: [BASE_ID, 'a', 'b'], durations: matrixFromMinutes([[0, 7, 9], [7, 0, 3], [9, 3, 0]]) },
      ['a', 'b'],
    );
    expect(travel!.homeTo('a')).toBeCloseTo(7, 5);
    expect(travel!.homeTo('b')).toBeCloseTo(9, 5);
  });

  it('trata a base sem id (null) como a saida do motorista', () => {
    const travel = parseTravelTimes(
      { dogIds: [null, 'a', 'b'], durations: matrixFromMinutes([[0, 7, 9], [7, 0, 3], [9, 3, 0]]) },
      ['a', 'b'],
    );
    expect(travel).not.toBeNull();
    expect(travel!.homeTo('b')).toBeCloseTo(9, 5);
  });

  it('recusa resposta torta em vez de chutar', () => {
    expect(parseTravelTimes(null, ['a'])).toBeNull();
    expect(parseTravelTimes({ dogIds: ['a'], durations: [[0]] }, ['a'])).toBeNull(); // menos de 2 pontos
    expect(parseTravelTimes({ dogIds: ['a', 'b'], durations: [[0, 1]] }, ['a', 'b'])).toBeNull(); // nao quadrada
    expect(parseTravelTimes({ dogIds: ['a', 'b'], durations: [[0, 'x'], [1, 0]] }, ['a', 'b'])).toBeNull(); // nao numerica
    expect(parseTravelTimes({ dogIds: ['a', 'z'], durations: [[0, 1], [1, 0]] }, ['a', 'b'])).toBeNull(); // id estranho
    expect(parseTravelTimes({ dogIds: ['a', 'b'], durations: [[0, -5], [1, 0]] }, ['a', 'b'])).toBeNull(); // negativo
  });

  it('descarta tempo absurdo (mais de 10h entre duas paradas)', () => {
    const travel = parseTravelTimes({ dogIds: ['a', 'b'], durations: [[0, 36000], [36000, 0]] }, ['a', 'b']);
    expect(travel!.between('a', 'b')).toBeNull();
  });
});

describe('busca no servidor', () => {
  it('usa os tempos reais quando a funcao responde', async () => {
    mockInvoke.mockResolvedValue({
      data: { dogIds: ['a', 'b', 'c'], durations: matrixFromMinutes([[0, 10, 20], [10, 0, 5], [20, 5, 0]]) },
      error: null,
    });
    const resultado = await fetchTravelTimes(paradas);
    expect(resultado.source).toBe('live');
    expect(resultado.travel).not.toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith(TRAVEL_TIMES_FUNCTION, expect.objectContaining({ body: expect.anything() }));
  });

  it('cai na estimativa quando a funcao nao existe (404/erro)', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'Function not found' } });
    const resultado = await fetchTravelTimes(paradas);
    expect(resultado.source).toBe('estimated');
    expect(resultado.travel).toBeNull();
    expect(resultado.reason).toBe('funcao-indisponivel');
  });

  it('cai na estimativa quando a resposta vem torta', async () => {
    mockInvoke.mockResolvedValue({ data: { dogIds: ['a'], durations: [[0]] }, error: null });
    const resultado = await fetchTravelTimes(paradas);
    expect(resultado.source).toBe('estimated');
    expect(resultado.reason).toBe('resposta-invalida');
  });

  it('cai na estimativa se o servidor demorar demais (o gestor nao fica esperando)', async () => {
    mockInvoke.mockImplementation(() => new Promise(() => {})); // nunca responde
    const resultado = await fetchTravelTimes(paradas, null, { timeoutMs: 30 });
    expect(resultado.source).toBe('estimated');
    expect(resultado.reason).toBe('timeout');
  });

  it('nao chama o servidor com menos de 2 paradas', async () => {
    const resultado = await fetchTravelTimes([paradas[0]]);
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(resultado.reason).toBe('poucas-paradas');
  });
});

describe('o transito real muda a rota sugerida', () => {
  it('sem transito, ordena pela distancia em linha reta', () => {
    const semTransito = optimizeRoute(paradas, {});
    expect(semTransito.stops.map((s) => s.dogId)).toEqual(['a', 'b', 'c']);
  });

  it('com transito, o otimizador obedece o tempo real (e nao a linha reta)', () => {
    // Em linha reta "a" e o mais perto da base; no transito real a rua para "b" esta livre
    // e "a" esta travada. O app tem de mandar o motorista comecar por "b".
    const travel = parseTravelTimes(
      {
        dogIds: [BASE_ID, 'a', 'b', 'c'],
        durations: matrixFromMinutes([
          [0, 45, 5, 50], // base -> a travado, b livre
          [45, 0, 8, 12],
          [5, 8, 0, 10],
          [50, 12, 10, 0],
        ]),
      },
      ['a', 'b', 'c'],
    );
    const comTransito = optimizeRoute(paradas, { travel, homeLatitude: 1, homeLongitude: 1 });
    expect(comTransito.stops[0].dogId).toBe('b');
    expect(comTransito.stops.map((s) => s.dogId)).not.toEqual(['a', 'b', 'c']);
  });

  it('continua funcionando (e igual) quando o servidor nao responde', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'offline' } });
    const traffic = await fetchTravelTimes(paradas);
    const resultado = optimizeRoute(paradas, { travel: traffic.travel });
    expect(resultado.stops.map((s) => s.dogId)).toEqual(['a', 'b', 'c']);
    expect(resultado.feasible).toBe(true);
  });
});
