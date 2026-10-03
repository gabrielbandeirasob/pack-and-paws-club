import { readFileSync } from 'node:fs';
import { sugerirRotas, sugerirRotasPorFase, sugerirRotasDoDia, type CaoDoDiaParaSugerir } from '@/features/dispatch/routeSuggestion';
import { buildDay, type ReservationRecord } from '@/features/calendar/dayMath';

const drivers = [{ driverId: 'a', driverName: 'A' }, { driverId: 'b', driverName: 'B' }];
const dog = (id: string, lat = 37): CaoDoDiaParaSugerir => ({
  dogId: id, dogName: id, clientName: id, latitude: lat, longitude: -122,
  pickupRequired: true, dropoffRequired: true,
});
const ids = (proposal: ReturnType<typeof sugerirRotas>) => proposal.blocos.flatMap(b => b.caes.map(c => c.dogId)).sort();

test('20 dogs in one cluster and 6 in another become 13 + 13', () => {
  const dogs = Array.from({ length: 26 }, (_, i) => dog(`${i}`, i < 20 ? 37 + i / 10000 : 38 + i / 10000));
  const result = sugerirRotas(dogs, drivers);
  expect(result.blocos.map(b => b.caes.length)).toEqual([13, 13]);
  expect(new Set(ids(result)).size).toBe(26);
});

test('three drivers get floor/ceil counts, not just an upper limit', () => {
  const result = sugerirRotas(Array.from({ length: 7 }, (_, i) => dog(`${i}`, i < 1 ? 37 : 38 + i / 10000)),
    [...drivers, { driverId: 'c', driverName: 'C' }]);
  expect(result.blocos.map(b => b.caes.length).sort()).toEqual([2, 2, 3]);
});

test('house weights follow the geographic tour and non-contiguous fair partitions are found', () => {
  // Geographic order 2, 2, 3, 3 has no contiguous 5/5 cut, but two 2+3 groups exist.
  const dogs = [2, 2, 3, 3].flatMap((n, house) => Array.from({ length: n }, (_, i) => ({
    ...dog(`${house}-${i}`, 37 + house / 100), clientId: `house${house}`,
  })));
  for (const input of [dogs, [...dogs].reverse()]) {
    const result = sugerirRotas(input, drivers, { latitude: 36.9, longitude: -122 });
    expect(result.blocos.map(b => b.caes.length)).toEqual([5, 5]);
    for (let h = 0; h < 4; h++) expect(result.blocos.filter(b => b.caes.some(c => c.clientId === `house${h}`))).toHaveLength(1);
  }
});

test('indivisible oversized households stay together when exact balance is impossible', () => {
  const dogs = Array.from({ length: 5 }, (_, i) => ({ ...dog(`${i}`), clientId: 'family' }));
  const result = sugerirRotas([...dogs, dog('other')], drivers);
  expect(result.blocos.map(b => b.caes.length).sort()).toEqual([1, 5]);
});

test('delivery is independent of pickup membership, van state and assignment', () => {
  const result = sugerirRotasPorFase([
    { ...dog('pickup-only'), dropoffRequired: false },
    { ...dog('delivery-only'), pickupRequired: false, inVan: true },
    dog('both'),
    { ...dog('neither'), pickupRequired: false, dropoffRequired: false },
    { ...dog('boarding'), boarding: true, inVan: true },
  ], drivers, [{ phase: 'pickup', dogIds: ['both'] }]);
  expect(ids(result.pickup)).toEqual(['pickup-only']);
  expect(ids(result.dropoff)).toEqual(['both', 'delivery-only']);
  expect(result.pickup.phase).toBe('pickup');
  expect(result.dropoff.phase).toBe('dropoff');
  const assignedDelivery = sugerirRotasPorFase([dog('both')], drivers, [{ phase: 'dropoff', dogIds: ['both'] }]);
  expect(ids(assignedDelivery.pickup)).toEqual(['both']);
  expect(ids(assignedDelivery.dropoff)).toEqual([]);
});

test('calendar adapter preserves separate transport needs and boarding exclusion even with duplicate daycare', () => {
  const reservation = (id: string, extra: Partial<ReservationRecord> = {}): ReservationRecord => ({
    id, dog: { id, dogName: id, clientName: id }, serviceType: 'daycare',
    startDate: '2026-10-02', endDate: '2026-10-02', transportRequired: true, ...extra,
  });
  const day = buildDay('2026-10-02', [
    reservation('pickup', { dropoffRequired: false }),
    reservation('delivery', { pickupRequired: false }),
    reservation('none', { transportRequired: false }),
    reservation('boarding'), reservation('boarding', { serviceType: 'boarding' }),
  ], []);
  const coords = new Map(['pickup', 'delivery', 'none', 'boarding'].map(id => [id, { latitude: 37, longitude: -122 }]));
  const result = sugerirRotasDoDia(day, coords, drivers);
  expect(ids(result.pickup)).toEqual(['pickup']);
  expect(ids(result.dropoff)).toEqual(['delivery']);
});

test('migration replaces day uniqueness and scopes both transfer lookups to the phase without policy changes', () => {
  const sql = readFileSync('supabase/migrations/202610020053_rotas_por_fase.sql', 'utf8');
  expect(sql).toMatch(/phase text not null default 'pickup'/);
  expect(sql).toMatch(/check \(phase in \('pickup', 'dropoff'\)\)/);
  expect(sql).toMatch(/drop constraint routes_organization_id_route_date_driver_id_key/);
  expect(sql).toMatch(/unique \(organization_id, route_date, driver_id, phase\)/);
  expect(sql).toMatch(/and r\.phase = v_phase/);
  expect(sql).toMatch(/route_date = v_date and phase = v_phase/);
  expect(sql).toMatch(/p_esperado <> v_lock/);
  expect(sql).toMatch(/is_org_manager\(v_org\)/);
  expect(sql).toMatch(/where id = p_route_id for update/);
  expect(sql).not.toMatch(/(?:drop|create|alter) policy|disable row level security/i);
});
