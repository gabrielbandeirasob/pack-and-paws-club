import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { buildDay, type RecurringExceptionRecord, type RecurringScheduleRecord, type ReservationRecord } from '@/features/calendar/dayMath';
import { todayLocalISO } from '@/features/calendar/dates';
import { DispatchBoard, type DispatchConstraint, type DispatchDriver, type DispatchRoute, type DispatchStopItem } from '@/features/dispatch/DispatchBoard';
import { optimizeRoute } from '@/features/dispatch/routeOptimizer';
import { colors } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';

type DriverRow = { user_id: string; profiles: { full_name: string | null } | null };
type ReservationRow = { id: string; service_type: 'daycare' | 'boarding'; start_date: string; end_date: string; transport_required: boolean; dog: { id: string; name: string; client: { name: string } } };
type RecurringRow = { id: string; weekdays: number[]; start_date: string; end_date: string | null; active: boolean; transport_required: boolean; dog: { id: string; name: string; client: { name: string } } };
type ExceptionRow = { id: string; recurring_schedule_id: string; action: 'skip' | 'transport_on' | 'transport_off'; start_date: string; end_date: string };
type StopRow = {
  dog_id: string;
  sequence: number;
  status: 'pending' | 'arrived' | 'picked_up' | 'completed' | 'skipped';
  window_start: string | null;
  window_end: string | null;
  exact_time: string | null;
  priority: 'normal' | 'priority';
  dog: { id: string; name: string; client: { name: string; latitude: number | null; longitude: number | null } };
};
type RouteRow = { id: string; driver_id: string; status: DispatchRoute['status']; route_stops: StopRow[] | null };

function toDogRef(dog: { id: string; name: string; client: { name: string } }) {
  return { id: dog.id, dogName: dog.name, clientName: dog.client.name };
}

export default function DispatchScreen() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [date, setDate] = useState(todayLocalISO());
  const [drivers, setDrivers] = useState<DispatchDriver[]>([]);
  const [dayItems, setDayItems] = useState<DispatchStopItem[]>([]);
  const [routes, setRoutes] = useState<DispatchRoute[]>([]);
  const [driverLocations, setDriverLocations] = useState<Record<string, { latitude: number; longitude: number; updatedAt: string }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const realtimeRefresh = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: memberships } = await supabase.from('organization_members').select('organization_id').eq('user_id', user.id).eq('status', 'active').limit(1);
    const orgId = (memberships as { organization_id: string }[] | null)?.[0]?.organization_id ?? null;
    setOrganizationId(orgId);
    if (!orgId) { setLoading(false); return; }
    const [driverResult, reservationResult, recurringResult, exceptionResult, routeResult] = await Promise.all([
      supabase.from('organization_members').select('user_id, profiles(full_name)').eq('organization_id', orgId).eq('role', 'driver').eq('status', 'active'),
      supabase.from('reservations').select('id, service_type, start_date, end_date, transport_required, dog:dogs(id, name, client:clients(name))').eq('organization_id', orgId).eq('status', 'confirmed'),
      supabase.from('recurring_schedules').select('id, weekdays, start_date, end_date, active, transport_required, dog:dogs(id, name, client:clients(name))').eq('organization_id', orgId).eq('active', true),
      supabase.from('recurring_exceptions').select('id, recurring_schedule_id, action, start_date, end_date').eq('organization_id', orgId),
      supabase.from('routes').select('id, driver_id, status, route_stops(dog_id, sequence, status, window_start, window_end, exact_time, priority, dog:dogs(id, name, client:clients(name, latitude, longitude)))').eq('organization_id', orgId).eq('route_date', date),
    ]);
    const firstError = driverResult.error ?? reservationResult.error ?? recurringResult.error ?? exceptionResult.error ?? routeResult.error;
    if (firstError) { setError(firstError.message); setLoading(false); return; }

    const driverRows = (driverResult.data as unknown as DriverRow[]) ?? [];
    setDrivers(driverRows.map((row) => ({ id: row.user_id, name: row.profiles?.full_name?.trim() || 'Driver' })));

    const reservations: ReservationRecord[] = ((reservationResult.data as unknown as ReservationRow[]) ?? []).map((row) => ({
      id: row.id, dog: toDogRef(row.dog), serviceType: row.service_type, startDate: row.start_date, endDate: row.end_date, transportRequired: row.transport_required,
    }));
    const recurring: RecurringScheduleRecord[] = ((recurringResult.data as unknown as RecurringRow[]) ?? []).map((row) => ({
      id: row.id, dog: toDogRef(row.dog), weekdays: row.weekdays, startDate: row.start_date, endDate: row.end_date, active: row.active, transportRequired: row.transport_required,
    }));
    const exceptions: RecurringExceptionRecord[] = ((exceptionResult.data as unknown as ExceptionRow[]) ?? []).map((row) => ({
      id: row.id, scheduleId: row.recurring_schedule_id, action: row.action, startDate: row.start_date, endDate: row.end_date,
    }));

    const day = buildDay(date, reservations, recurring, exceptions);
    const items = [...day.daycare, ...day.boarding].filter((item) => item.transportRequired);
    const seen = new Set<string>();
    setDayItems(items.filter((item) => (seen.has(item.dogId) ? false : (seen.add(item.dogId), true))).map((item) => ({ dogId: item.dogId, clientName: item.clientName, dogName: item.dogName, reservationKind: item.kind })));

    const routeRows = (routeResult.data as unknown as RouteRow[]) ?? [];
    setRoutes(routeRows.map((row) => ({
      routeId: row.id,
      driverId: row.driver_id,
      status: row.status,
      stops: (row.route_stops ?? []).map((stop) => ({
        dogId: stop.dog_id,
        sequence: stop.sequence,
        status: stop.status,
        clientName: stop.dog.client.name,
        dogName: stop.dog.name,
        reservationKind: undefined,
        latitude: stop.dog.client.latitude,
        longitude: stop.dog.client.longitude,
        windowStart: stop.window_start ? stop.window_start.slice(0, 5) : null,
        windowEnd: stop.window_end ? stop.window_end.slice(0, 5) : null,
        exactTime: stop.exact_time ? stop.exact_time.slice(0, 5) : null,
        priority: stop.priority,
      })),
    })));

    const { data: locationRows } = await supabase
      .from('driver_locations')
      .select('driver_id, latitude, longitude, updated_at')
      .eq('organization_id', orgId);
    setDriverLocations(
      Object.fromEntries(
        ((locationRows as unknown as { driver_id: string; latitude: number; longitude: number; updated_at: string }[]) ?? []).map((row) => [
          row.driver_id,
          { latitude: row.latitude, longitude: row.longitude, updatedAt: row.updated_at },
        ]),
      ),
    );
    setLoading(false);
  }, [date]);

  useEffect(() => { load(); }, [load]);

  // Realtime: route/stop/location changes from drivers land instantly on the board.
  useEffect(() => {
    if (!organizationId) return;
    const refresh = () => {
      if (realtimeRefresh.current) clearTimeout(realtimeRefresh.current);
      realtimeRefresh.current = setTimeout(() => void load(), 700);
    };
    const channel = supabase
      .channel(`dispatch-${organizationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'routes', filter: `organization_id=eq.${organizationId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'route_stops' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations', filter: `organization_id=eq.${organizationId}` }, refresh)
      .subscribe();
    return () => {
      if (realtimeRefresh.current) clearTimeout(realtimeRefresh.current);
      void supabase.removeChannel(channel);
    };
  }, [organizationId, load]);

  const routeIdForDriver = useCallback(async (driverId: string) => {
    if (!organizationId) throw new Error('Organization not found.');
    const { data: route, error: routeError } = await supabase.from('routes').upsert(
      { organization_id: organizationId, route_date: date, driver_id: driverId, status: 'draft' },
      { onConflict: 'organization_id,route_date,driver_id' },
    ).select('id').single();
    if (routeError) throw new Error(routeError.message);
    return (route as { id: string }).id;
  }, [organizationId, date]);

  const assign = useCallback(async (dogId: string, driverId: string, constraint: DispatchConstraint) => {
    const routeId = await routeIdForDriver(driverId);
    const { error } = await supabase.rpc('assign_stop_to_route', {
      p_route_id: routeId,
      p_dog_id: dogId,
      p_window_start: constraint.windowStart,
      p_window_end: constraint.windowEnd,
      p_exact_time: constraint.exactTime,
      p_priority: constraint.priority,
    });
    if (error) throw new Error(error.message);
    await load();
  }, [routeIdForDriver, load]);

  const saveStopConstraint = useCallback(async (routeId: string, dogId: string, constraint: DispatchConstraint) => {
    const { error } = await supabase.from('route_stops').update({
      window_start: constraint.windowStart,
      window_end: constraint.windowEnd,
      exact_time: constraint.exactTime,
      priority: constraint.priority,
    }).eq('route_id', routeId).eq('dog_id', dogId);
    if (error) throw new Error(error.message);
    await load();
  }, [load]);

  const removeStop = useCallback(async (routeId: string, dogId: string) => {
    const { error } = await supabase.from('route_stops').delete().eq('route_id', routeId).eq('dog_id', dogId);
    if (error) throw new Error(error.message);
    await load();
  }, [load]);

  const moveStop = useCallback(async (routeId: string, dogId: string, direction: -1 | 1) => {
    const route = routes.find((candidate) => candidate.routeId === routeId);
    if (!route) return;
    const ordered = [...route.stops].sort((a, b) => a.sequence - b.sequence);
    const index = ordered.findIndex((stop) => stop.dogId === dogId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    const { error } = await supabase.rpc('reorder_route_stops', { p_route_id: routeId, p_dog_ids: ordered.map((stop) => stop.dogId) });
    if (error) throw new Error(error.message);
    await load();
  }, [routes, load]);

  const publish = useCallback(async (routeId: string) => {
    const { error } = await supabase.rpc('publish_route', { p_route_id: routeId });
    if (error) throw new Error(error.message);
    await load();
  }, [load]);

  const optimize = useCallback(async (routeId: string) => {
    const route = routes.find((candidate) => candidate.routeId === routeId);
    if (!route) return;
    const sorted = [...route.stops].sort((a, b) => a.sequence - b.sequence);
    const finished = sorted.filter((stop) => stop.status === 'completed' || stop.status === 'skipped');
    const remaining = sorted.filter((stop) => stop.status !== 'completed' && stop.status !== 'skipped');
    if (remaining.length < 2) return;

    const result = optimizeRoute(
      remaining.map((stop) => ({
        dogId: stop.dogId,
        clientName: stop.clientName,
        dogName: stop.dogName,
        latitude: stop.latitude,
        longitude: stop.longitude,
        windowStart: stop.windowStart,
        windowEnd: stop.windowEnd,
        exactTime: stop.exactTime,
        priority: stop.priority,
      })),
    );
    if (!result.feasible) {
      Alert.alert('Cannot optimize this route', result.reason ?? 'The schedule is infeasible.');
      return;
    }
    const lines = result.stops.map((stop) => `• ${stop.sequence}. ${stop.clientName} · ${stop.dogName} — arrive ${stop.plannedArrival}`);
    Alert.alert('Optimized route', `Suggested order:\n${lines.join('\n')}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Apply',
        onPress: () => {
          const order = [...finished.map((stop) => stop.dogId), ...result.stops.map((stop) => stop.dogId)];
          void supabase.rpc('reorder_route_stops', { p_route_id: routeId, p_dog_ids: order }).then(({ error }) => {
            if (error) Alert.alert('Unable to apply the route', error.message);
            void load();
          });
        },
      },
    ]);
  }, [routes, load]);

  const summary = useMemo(() => ({ date, drivers, dayItems, routes }), [date, drivers, dayItems, routes]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {loading ? <ActivityIndicator style={styles.center} color={colors.gold} size="large" /> : error ? <Text style={styles.errorText}>{error}</Text> : (
        <DispatchBoard
          date={summary.date}
          drivers={summary.drivers}
          dayItems={summary.dayItems}
          routes={summary.routes}
          driverLocations={driverLocations}
          onAssign={assign}
          onSaveStop={saveStopConstraint}
          onRemoveStop={removeStop}
          onMoveStop={moveStop}
          onOptimize={optimize}
          onPublish={publish}
          onDateChange={setDate}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  center: { marginTop: 80 },
  errorText: { color: colors.urgency, textAlign: 'center', marginTop: 60, paddingHorizontal: 24 },
});
