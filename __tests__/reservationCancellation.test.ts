import { buildDay, transportPool, vanPool, type ReservationRecord } from '@/features/calendar/dayMath';
import { toLocalReservations } from '@/features/integrations/google/localReservations';
import { planCalendarSync, type RemoteEvent } from '@/features/integrations/google/calendarSync';
import { planCalendarImport, type BookingForImport } from '@/features/integrations/google/importPlan';
import { dayIndicatorsFrom } from '@/features/dashboard/dayOperation';
import { dogsOfDaySummary } from '@/features/dashboard/dayService';

const date = '2026-09-28';
const reservation: ReservationRecord = {
  id: 'kona', dog: { id: 'kona', dogName: 'Kona', clientName: 'Leigh Ann' },
  serviceType: 'daycare', startDate: date, endDate: date, transportRequired: true,
  status: 'confirmed', googleEventId: 'google-kona', source: 'google',
};
const remote: RemoteEvent = { id: 'google-kona', summary: 'Kona', startDate: date, endDate: '2026-09-29', colorId: '7' };

it('canceladas não entram nas listas, indicadores da Home ou nas duas filas do Dispatch', () => {
  const day = buildDay(date, [
    { ...reservation, status: 'cancelled' },
    { ...reservation, id: 'boarding', serviceType: 'boarding', status: 'cancelled' },
  ], []);
  expect(day).toEqual({ daycare: [], boarding: [] });
  expect(transportPool(day)).toEqual([]);
  expect(vanPool(day)).toEqual([]);
  expect(dayIndicatorsFrom({ daycareCount: day.daycare.length, boardingCount: day.boarding.length,
    dogs: dogsOfDaySummary(day), entries: [], revenueCents: null })).toMatchObject({ daycare: 0, boarding: 0, totalDogs: 0, pack: 0 });
});

it.each([null, 'res:kona'])('cancelada mantém appKey e produz só update Tomato (appKey remoto %s)', (appKey) => {
  const local = toLocalReservations([{ ...reservation, status: 'cancelled' }]);
  const actions = planCalendarSync(local, [{ ...remote, appKey, eventLabelId: 'blue' }]);
  expect(actions).toEqual([{ type: 'update', reservationId: 'res:kona', eventId: remote.id,
    event: { summary: 'Kona', start: { date }, end: { date: '2026-09-29' }, colorId: '11', eventLabelId: null,
      extendedProperties: { private: { appKey: 'res:kona', packpawsMirror: 'v1' } } } }]);
  expect(planCalendarSync(local, [{ ...remote, appKey: 'res:kona', colorId: '11' }])).toEqual([]);
});

it('a importação antes do Sync manual não recria nem reativa a reserva cancelada', () => {
  const booking: BookingForImport = { id: reservation.id, kind: 'reservation', dogId: reservation.dog.id,
    googleEventId: remote.id, source: 'google', serviceType: 'daycare', startDate: date, endDate: date, status: 'cancelled' };
  expect(planCalendarImport([remote], [{ id: 'kona', name: 'Kona', clientName: 'Leigh Ann' }], [booking], { from: date, to: '2026-09-30' })).toEqual([]);
});

it('Kona em dois eventos conta uma vez por serviço, preservando boarding, recorrência e transporte', () => {
  const reservations: ReservationRecord[] = [
    { ...reservation, transportRequired: false },
    { ...reservation, id: 'mowgli-kona' },
    { ...reservation, id: 'boarding', serviceType: 'boarding' },
    { ...reservation, id: 'boarding-2', serviceType: 'boarding' },
  ];
  const day = buildDay(date, reservations, [{ id: 'weekly', dog: reservation.dog, weekdays: [1], startDate: date,
    endDate: null, active: true, transportRequired: true }]);
  expect(day.daycare).toHaveLength(1);
  expect(day.boarding).toHaveLength(1);
  expect(day.daycare[0].transportRequired).toBe(true);
  // Contrato escrito do cliente (28/09/2026): quem está na seção "já na van" é o dia de HOTEL SEM
  // movimento. Aqui o dia de boarding do Kona é de MOVIMENTO (transporte marcado) — ele é ponto da
  // rota (fila principal) e não entra na seção. Antes desta regra ele aparecia nas duas.
  expect(vanPool(day)).toEqual([]);
  expect(transportPool(day).map((item) => item.dogId)).toEqual(['kona']);
  expect(dayIndicatorsFrom({ daycareCount: day.daycare.length, boardingCount: day.boarding.length,
    dogs: dogsOfDaySummary(day), entries: [], revenueCents: null })).toMatchObject({ daycare: 1, boarding: 1, totalDogs: 1 });
  expect(reservations).toHaveLength(4);
});
