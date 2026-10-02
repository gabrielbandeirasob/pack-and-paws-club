import { GRACE_MINUTES, isPastDeadline, lateMinutesForStop, minutesAgo, minutesBetweenKm, nextStopEta, type EtaStop } from '@/features/driver/eta';

let nextSequence = 1;
const stop = (overrides: Partial<EtaStop> & { id: string }): EtaStop => ({
  sequence: nextSequence++,
  clientName: 'Maria',
  dogName: 'Bob',
  latitude: 0,
  longitude: 0,
  windowEnd: null,
  exactTime: null,
  status: 'pending',
  ...overrides,
});

beforeEach(() => {
  nextSequence = 1;
});

describe('eta helpers', () => {
  it('converts distance to minutes at the given speed', () => {
    expect(minutesBetweenKm(10, 50)).toBeCloseTo(12, 5);
    expect(minutesBetweenKm(0)).toBe(0);
  });

  it('formats how long ago a position was recorded', () => {
    const now = new Date('2026-09-09T12:00:00Z');
    expect(minutesAgo('2026-09-09T11:55:00Z', now)).toBe(5);
    expect(minutesAgo('2026-09-09T12:05:00Z', now)).toBe(0); // never negative
    expect(minutesAgo('not-a-date', now)).toBe(0);
  });
});

describe('nextStopEta', () => {
  it('estimates minutes to the next pending stop from the current position', () => {
    const stops = [
      stop({ id: 's1', sequence: 1, latitude: 0, longitude: 0.1, status: 'completed' }),
      stop({ id: 's2', sequence: 2, latitude: 0, longitude: 0.2 }),
    ];
    // Driver at 0,0; s1 is done, so s2 is next — ~22 km away → ~53 min at 25 km/h.
    const eta = nextStopEta(stops, { latitude: 0, longitude: 0 });
    expect(eta?.stopId).toBe('s2');
    expect(eta?.minutes).toBeGreaterThan(50);
    expect(eta?.lateMinutes).toBe(0);
  });

  it('keeps an arrived stop as the current one and honors route order', () => {
    const stops = [
      stop({ id: 's2', sequence: 1, latitude: 0, longitude: 0.01, status: 'arrived' }),
      stop({ id: 's1', sequence: 2, latitude: 0, longitude: 0.2 }),
    ];
    const eta = nextStopEta(stops, { latitude: 0, longitude: 0 });
    expect(eta?.stopId).toBe('s2'); // sequence 1 is still active
  });

  /**
   * ENTREGA (conferência do dono, 01/10/2026): `completed` é o fim da BUSCA, não do dia. O cão está na
   * van e a entrega ainda vai acontecer — o "próximo cão" (e o ETA) continuam existindo até o marco
   * `deliveredAt`. Antes disto o app dava a rota por terminada depois da última busca, às 9 da manhã.
   */
  it('depois das buscas o próximo é a ENTREGA pendente (o dia não acabou)', () => {
    const stops = [stop({ id: 's1', status: 'completed' }), stop({ id: 's2', status: 'skipped' })];
    expect(nextStopEta(stops, null)?.stopId).toBe('s1');
  });

  it('returns null only when every stop is delivered or skipped', () => {
    const entregues = [
      stop({ id: 's1', status: 'completed', deliveredAt: '2026-10-01T21:00:00.000Z' }),
      stop({ id: 's2', status: 'skipped' }),
    ];
    expect(nextStopEta(entregues, null)).toBeNull();
  });

  it('flags how late the projected arrival is against a window', () => {
    // 22 km ≈ 53 min. Now 08:00 + 53 = 08:53, deadline 08:00 → ~53 min late.
    const stops = [stop({ id: 's1', latitude: 0, longitude: 0.2, windowEnd: '08:00' })];
    const eta = nextStopEta(stops, { latitude: 0, longitude: 0 }, new Date(2026, 8, 9, 8, 0));
    expect(eta?.lateMinutes).toBeGreaterThan(50);
  });

  it('uses the exact time as deadline and reports zero delay when reachable', () => {
    const stops = [stop({ id: 's1', latitude: 0, longitude: 0.01, exactTime: '09:00' })];
    const eta = nextStopEta(stops, { latitude: 0, longitude: 0 }, new Date(2026, 8, 9, 8, 45));
    expect(eta?.lateMinutes).toBe(0);
  });
});

describe('isPastDeadline', () => {
  it('compares the local time against window end and exact time', () => {
    const now = new Date(2026, 8, 9, 8, 30);
    expect(isPastDeadline('08:00', null, now)).toBe(true);
    expect(isPastDeadline('09:00', null, now)).toBe(false);
    expect(isPastDeadline(null, '08:15', now)).toBe(true);
    expect(isPastDeadline(null, null, now)).toBe(false);
  });
});

/**
 * TOLERÂNCIA DE 3 MINUTOS (pedido do cliente, áudios de 30/09/2026): "imagina, eu vou descer para
 * pegar um cachorro, vai levar uns dois minutinhos, três minutinhos" → o app NÃO pode marcar atrasado
 * na hora. Fronteira exata: 2 min 59 s depois do prazo ainda não é atraso; 3 min 01 s é.
 */
describe('tolerância de atraso (grace period de 3 minutos)', () => {
  const prazo = '10:00';
  /** 09/09/2026, no fuso local do teste. */
  const as = (h: number, m: number, s = 0) => new Date(2026, 8, 9, h, m, s);

  it('a tolerância é UM número só, de 3 minutos', () => {
    expect(GRACE_MINUTES).toBe(3);
  });

  it('nada aparece como atrasado antes de 3 minutos do prazo', () => {
    expect(isPastDeadline(prazo, null, as(9, 59))).toBe(false);
    expect(isPastDeadline(prazo, null, as(10, 0))).toBe(false);
    expect(isPastDeadline(prazo, null, as(10, 2, 59))).toBe(false); // 2 min 59 s: dentro da tolerância
    expect(isPastDeadline(prazo, null, as(10, 3))).toBe(false); // exatamente 3 min: borda, ainda não
    expect(isPastDeadline(prazo, null, as(10, 3, 1))).toBe(true); // 3 min 01 s: já é atraso
  });

  it('a tolerância vale também para o horário exato (Must arrive by)', () => {
    expect(isPastDeadline(null, '08:15', as(8, 17))).toBe(false);
    expect(isPastDeadline(null, '08:15', as(8, 19))).toBe(true);
  });

  it('lateMinutesForStop: 0 dentro da tolerância e o atraso REAL depois dela', () => {
    // 2 min 59 s depois do prazo → ainda dentro: nada de atraso
    expect(lateMinutesForStop({ windowEnd: prazo }, 2 + 59 / 60, as(10, 0))).toBe(0);
    // 3 min 01 s depois do prazo → já é atraso, e o número mostrado é o atraso de verdade
    expect(lateMinutesForStop({ windowEnd: prazo }, 3 + 1 / 60, as(10, 0))).toBe(3);
    expect(lateMinutesForStop({ windowEnd: prazo }, 5, as(10, 0))).toBe(5);
    // atraso já acumulado no relógio (chegou 10:07 para um prazo de 10:00)
    expect(lateMinutesForStop({ windowEnd: prazo }, 0, as(10, 7))).toBe(7);
  });

  it('nextStopEta usa a MESMA tolerância para decidir o aviso', () => {
    // Sem posição, o motorista está "chegando agora" (0 min): prazo 3 min atrás = dentro da tolerância.
    expect(nextStopEta([stop({ id: 's1', windowEnd: '07:57' })], null, as(8, 0))?.lateMinutes).toBe(0);
    // Prazo 4 min atrás: passou da tolerância → o atraso real aparece.
    expect(nextStopEta([stop({ id: 's1', windowEnd: '07:56' })], null, as(8, 0))?.lateMinutes).toBe(4);
  });

  it('REGRESSÃO: parada sem prazo continua nunca atrasada', () => {
    expect(isPastDeadline(null, null, as(23, 59))).toBe(false);
    expect(lateMinutesForStop({ windowEnd: null, exactTime: null }, 10, as(10, 0))).toBe(0);
    expect(nextStopEta([stop({ id: 's1' })], null, as(23, 59))?.lateMinutes).toBe(0);
  });
});

/**
 * VISTORIA (02/10/2026) — "~0 min away" era INVENTADO.
 *
 * Sem perna de rota gravada e sem posição do motorista, `minutes` caía em 0 e a faixa do topo dizia
 * "~0 min away" (chegando!) quando o app não tinha base nenhuma. Agora o resultado diz se tem base.
 */
describe('ETA sem base não vira zero', () => {
  it('sem rota otimizada e sem posição: temBase = false (a tela escreve "route not timed yet")', () => {
    const stops = [stop({ id: 's1', sequence: 1, latitude: 10, longitude: 10 })];
    const eta = nextStopEta(stops, null);
    expect(eta?.minutes).toBe(0);
    expect(eta?.temBase).toBe(false);
  });

  it('com a posição do motorista: temBase = true', () => {
    const stops = [stop({ id: 's1', sequence: 1, latitude: 0, longitude: 0.2 })];
    const eta = nextStopEta(stops, { latitude: 0, longitude: 0 });
    expect(eta?.temBase).toBe(true);
    expect(eta?.minutes).toBeGreaterThan(0);
  });
});
