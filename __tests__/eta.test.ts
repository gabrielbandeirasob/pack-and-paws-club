import { isPastDeadline, minutesAgo, minutesBetweenKm, nextStopEta, type EtaStop } from '@/features/driver/eta';

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

  it('returns null when every stop is finished', () => {
    const stops = [stop({ id: 's1', status: 'completed' }), stop({ id: 's2', status: 'skipped' })];
    expect(nextStopEta(stops, null)).toBeNull();
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
