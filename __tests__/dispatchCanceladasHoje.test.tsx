jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn(), storage: { from: jest.fn(() => ({ createSignedUrl: jest.fn() })) } },
}));

import { fireEvent, render, within } from '@testing-library/react-native';
import { dayIndicatorsFrom, packRows } from '@/features/dashboard/dayOperation';
import { StyleSheet } from 'react-native';
import { loadDayDogs, dogsOfDaySummary } from '@/features/dashboard/dayService';
import { buildDay, transportPool, vanPool, type ReservationRecord } from '@/features/calendar/dayMath';
import { DispatchBoard, type DispatchRoute } from '@/features/dispatch/DispatchBoard';
import { NextStopCard } from '@/features/driver/NextStopCard';
import { DriverRouteView } from '@/features/driver/DriverRouteView';
import { colors } from '@/features/theme/tokens';

const date = '2026-10-14';
const dog = (id: string) => ({ id, name: id, client: { name: 'Owner' } });
const reservation = (id: string, status = 'confirmed') => ({
  id, status, service_type: 'daycare', start_date: date, end_date: date,
  transport_required: true, dog: dog(id),
});
function client(rows: Record<string, unknown[]>) {
  const calls: unknown[][] = [];
  return { calls, value: { from: (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'lte', 'gte']) chain[method] = (...args: unknown[]) => {
      calls.push([table, method, ...args]); return chain;
    };
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: rows[table] ?? [], error: null }));
    return chain;
  } } as never };
}
const cancelled = { dogId: 'Cancelled', dogName: 'Cancelled', clientName: 'Owner', serviceType: 'daycare' as const, reason: 'Cancelled in Google Calendar' as const };
const active = { dogId: 'Active', dogName: 'Active', clientName: 'Owner' };
const callbacks = {
  onAssign: jest.fn(), onSaveStop: jest.fn(), onRemoveStop: jest.fn(), onMoveStop: jest.fn(),
  onOptimize: jest.fn(), onPublish: jest.fn(), onUnpublish: jest.fn(), onCancelRoute: jest.fn(),
  onCompleteRoute: jest.fn(), onDateChange: jest.fn(),
};
const props = { date, drivers: [{ id: 'driver', name: 'Driver' }], dayItems: [active], routes: [] as DispatchRoute[], ...callbacks };
const route: DispatchRoute = {
  routeId: 'route', driverId: 'driver', status: 'published',
  stops: [active, cancelled].map((item, index) => ({
    ...item, sequence: index + 1, status: 'pending', latitude: null, longitude: null,
    windowStart: null, windowEnd: null, exactTime: null, priority: 'normal', travelSeconds: 600,
  })),
};

it('day with one cancellation preserves confirmed dogs and order and returns its reason', async () => {
  const fake = client({ reservations: [reservation('Z'), reservation('Cancelled', 'cancelled'), reservation('A')] });
  const result = await loadDayDogs(fake.value, 'org', date);
  const baseline = await loadDayDogs(client({ reservations: [reservation('Z'), reservation('A')] }).value, 'org', date);
  expect(result.dogsByDay).toEqual(baseline.dogsByDay);
  expect(result.dogsByDay[date].map(d => d.dogName)).toEqual(['A', 'Z']);
  expect(result.cancelledByDay[date]).toEqual([cancelled]);
  expect(fake.calls).toEqual(expect.arrayContaining([
    ['reservations', 'in', 'status', ['confirmed', 'cancelled']],
    ['reservations', 'lte', 'start_date', date], ['reservations', 'gte', 'end_date', date],
  ]));
});

it('day without cancellation keeps confirmed dogs and returns an empty cancelled list', async () => {
  const result = await loadDayDogs(client({ reservations: [reservation('Active')] }).value, 'org', date);
  expect(result.dogsByDay[date]).toEqual([{ ...active, serviceType: 'daycare', goesToDaycare: true }]);
  expect(result.cancelledByDay[date]).toEqual([]);
});

it.each(['Cancelled in Google Calendar', 'Skipped on this date'])('recurring skip preserves reason: %s', async reason => {
  const fake = client({
    recurring_schedules: [{ id: 'schedule', weekdays: [3], start_date: date, end_date: null, active: true, transport_required: true, dog: dog('Cancelled') }],
    recurring_exceptions: [{ id: 'skip', recurring_schedule_id: 'schedule', action: 'skip', start_date: date, end_date: date, reason }],
  });
  const result = await loadDayDogs(fake.value, 'org', date);
  expect(result.dogsByDay[date]).toEqual([]);
  expect(result.cancelledByDay[date]).toEqual([{ ...cancelled, reason }]);
  expect(fake.calls.find(c => c[0] === 'recurring_exceptions' && c[1] === 'select')?.[2]).toContain('reason');
});

it('cancelled dogs add zero to Total Pack, unassigned transport and van counts', () => {
  const rows: ReservationRecord[] = [
    { id: 'a', dog: { id: 'a', dogName: 'A', clientName: 'Owner' }, serviceType: 'daycare', startDate: date, endDate: date, status: 'confirmed', transportRequired: true },
    { id: 'b', dog: { id: 'b', dogName: 'B', clientName: 'Owner' }, serviceType: 'boarding', startDate: '2026-10-13', endDate: '2026-10-15', status: 'confirmed', transportRequired: true },
  ];
  const cancelledRows = rows.map(r => ({ ...r, id: r.id + '-cancelled', dog: { ...r.dog, id: r.dog.id + '-cancelled' }, status: 'cancelled' as const }));
  const day = buildDay(date, [...rows, ...cancelledRows], [], []);
  expect(dogsOfDaySummary(day)).toHaveLength(2);
  expect(packRows(dogsOfDaySummary(day), []).filter(row => row.inPack)).toHaveLength(2);
  expect(dayIndicatorsFrom({ daycareCount: 1, boardingCount: 1, dogs: dogsOfDaySummary(day), entries: [], revenueCents: null }).pack).toBe(2);
  expect(transportPool(day)).toHaveLength(1);
  expect(vanPool(day)).toHaveLength(1);
  expect(day).toEqual(buildDay(date, rows, [], []));
});

it('renders the cancelled pool name struck through and muted with no assignment or drag action', async () => {
  const screen = await render(<DispatchBoard {...props} cancelledByDay={{ [date]: [cancelled] }} />);
  const pool = within(screen.getByTestId('unassigned-pool'));
  expect(StyleSheet.flatten(pool.getByText('Cancelled').props.style)).toMatchObject({ textDecorationLine: 'line-through', color: colors.muted });
  expect(pool.getByText(cancelled.reason)).toBeTruthy();
  expect(screen.getByText('1 unassigned')).toBeTruthy();
  expect(screen.queryByLabelText('Assign Cancelled')).toBeNull();
  expect(screen.queryByTestId('drag-pickup-Cancelled')).toBeNull();
});

it('published off-day stop keeps its badge and position and gains strike-through without duplicate pool entry', async () => {
  const screen = await render(<DispatchBoard {...props} routes={[route]} cancelledByDay={{ [date]: [cancelled] }} />);
  expect(screen.getByText("Cancelled — removed from today's route")).toBeTruthy();
  expect(StyleSheet.flatten(screen.getByText('Cancelled').props.style)).toMatchObject({ textDecorationLine: 'line-through', color: colors.muted });
  expect(within(screen.getByTestId('unassigned-pool')).queryByText('Cancelled')).toBeNull();
  expect(screen.getByLabelText('Options for Cancelled')).toBeTruthy();
  expect(screen.getByText('1 stop')).toBeTruthy();
  expect(screen.getByText('Pick-ups · 1 stop')).toBeTruthy();
  expect(screen.getAllByText('10 min away')).toHaveLength(1);
});

it('cancelled stop in draft has no drag handle or accessible reorder actions', async () => {
  const screen = await render(<DispatchBoard {...props} routes={[{ ...route, status: 'draft' }]} cancelledByDay={{ [date]: [cancelled] }} />);
  expect(screen.queryByTestId('drag-pickup-Cancelled')).toBeNull();
  expect(screen.getByTestId('reorder-pickup-Cancelled').props.accessibilityActions).toEqual([]);
});

it('day with no cancellations preserves normal pool styling and actions', async () => {
  const screen = await render(<DispatchBoard {...props} cancelledByDay={{ [date]: [] }} />);
  expect(screen.getByLabelText('Assign Active')).toBeTruthy();
  expect(StyleSheet.flatten(screen.getByText('Active').props.style).textDecorationLine).toBeUndefined();
  expect(screen.queryByText(cancelled.reason)).toBeNull();
});

it('driver keeps the cancelled stop visible with badge, reason and strike-through', async () => {
  const screen = await render(<DriverRouteView stops={[{
    id: 'stop', dogId: 'Cancelled', sequence: 1, status: 'pending', clientName: 'Owner', dogName: 'Cancelled',
    address: null, city: null, instructions: null, cancellationReason: cancelled.reason,
  }]} onAction={jest.fn()} />);
  expect(screen.getByText("Cancelled — removed from today's route")).toBeTruthy();
  expect(screen.getByText(cancelled.reason)).toBeTruthy();
  expect(StyleSheet.flatten(screen.getByText('1. Cancelled').props.style)).toMatchObject({ textDecorationLine: 'line-through', color: colors.muted });
});

it('cancelled published stop offers removal but cannot be reassigned through its edit sheet', async () => {
  const screen = await render(<DispatchBoard {...props} routes={[route]} cancelledByDay={{ [date]: [cancelled] }} />);
  await fireEvent.press(screen.getByLabelText('Options for Cancelled'));
  expect(screen.getByLabelText('Remove from route')).toBeTruthy();
  expect(screen.queryByLabelText('Save stop')).toBeNull();
  expect(screen.queryByLabelText('Driver Driver')).toBeNull();
});

it('cancelled published stop is excluded from driver chips and stale optimized duration', async () => {
  const screen = await render(<DispatchBoard {...props} drivers={[...props.drivers, { id: 'other', name: 'Other' }]}
    routes={[route]} cancelledByDay={{ [date]: [cancelled] }}
    optimizeInfo={{ route: { vanName: 'Van', yardName: 'Yard', state: { busy: false, result: null, error: null, canUndo: false } } }} />);
  expect(screen.getByText('Driver 1')).toBeTruthy();
  expect(screen.queryByLabelText('Optimize Driver route')).toBeNull();
  expect(screen.getByText('Remove cancelled stops to optimize.')).toBeTruthy();
});

it('driver active card uses the same strike-through and cancellation reason', async () => {
  const screen = await render(<NextStopCard stop={{
    id: 'stop', dogId: 'Cancelled', sequence: 1, status: 'pending', clientName: 'Owner', dogName: 'Cancelled',
    address: null, city: null, instructions: null, cancellationReason: 'Skipped on this date',
  }} nextAction="arrived" onAction={jest.fn()} onNavigate={jest.fn()} />);
  expect(StyleSheet.flatten(screen.getByText('Cancelled').props.style)).toMatchObject({ textDecorationLine: 'line-through', color: colors.muted });
  expect(screen.getByText('Skipped on this date')).toBeTruthy();
});

it('a confirmed visit for the same dog takes precedence over a cancelled duplicate', async () => {
  const screen = await render(<DispatchBoard {...props} dayItems={[active, cancelled]} cancelledByDay={{ [date]: [cancelled] }} />);
  expect(screen.getByLabelText('Assign Cancelled')).toBeTruthy();
  expect(screen.getAllByText('Cancelled')).toHaveLength(1);
  expect(StyleSheet.flatten(screen.getByText('Cancelled').props.style).textDecorationLine).toBeUndefined();
});

it('a day containing only cancellations keeps names visible with zero active transport dogs', async () => {
  const screen = await render(<DispatchBoard {...props} dayItems={[]} cancelledByDay={{ [date]: [cancelled] }} />);
  expect(screen.getByText('Cancelled')).toBeTruthy();
  expect(screen.getByText('0 transport dogs · 1 driver')).toBeTruthy();
  expect(screen.queryByText(/^[0-9]+ unassigned$/)).toBeNull();
});
