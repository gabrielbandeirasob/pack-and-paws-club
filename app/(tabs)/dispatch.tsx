import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { buildDay, type DayItem, type RecurringScheduleRecord, type ReservationRecord } from '@/features/calendar/dayMath';
import { todayLocalISO } from '@/features/calendar/dates';
import { DispatchBoard, type DispatchDriver, type DispatchRoute, type DispatchStopItem } from '@/features/dispatch/DispatchBoard';
import { colors } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';

type DriverRow = { user_id: string; profiles: { full_name: string | null } | null };
type ReservationRow = { id: string; service_type: 'daycare' | 'boarding'; start_date: string; end_date: string; dog: { id: string; name: string; client: { name: string } } };
type RecurringRow = { id: string; weekdays: number[]; start_date: string; end_date: string | null; active: boolean; dog: { id: string; name: string; client: { name: string } } };
type RouteRow = { id: string; driver_id: string; status: DispatchRoute['status']; route_stops: { dog: { id: string; name: string; client: { name: string } } }[] };

function toDogRef(dog: { id: string; name: string; client: { name: string } }) {
  return { id: dog.id, dogName: dog.name, clientName: dog.client.name };
}

export default function DispatchScreen() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [date, setDate] = useState(todayLocalISO());
  const [drivers, setDrivers] = useState<DispatchDriver[]>([]);
  const [dayItems, setDayItems] = useState<DispatchStopItem[]>([]);
  const [routes, setRoutes] = useState<DispatchRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: memberships } = await supabase.from('organization_members').select('organization_id').eq('user_id', user.id).eq('status', 'active').limit(1);
    const orgId = (memberships as { organization_id: string }[] | null)?.[0]?.organization_id ?? null;
    setOrganizationId(orgId);
    if (!orgId) { setLoading(false); return; }
    const [driverResult, reservationResult, recurringResult, routeResult] = await Promise.all([
      supabase.from('organization_members').select('user_id, profiles(full_name)').eq('organization_id', orgId).eq('role', 'driver').eq('status', 'active'),
      supabase.from('reservations').select('id, service_type, start_date, end_date, dog:dogs(id, name, client:clients(name))').eq('organization_id', orgId).eq('status', 'confirmed'),
      supabase.from('recurring_schedules').select('id, weekdays, start_date, end_date, active, dog:dogs(id, name, client:clients(name))').eq('organization_id', orgId).eq('active', true),
      supabase.from('routes').select('id, driver_id, status, route_stops(dog:dogs(id, name, client:clients(name)))').eq('organization_id', orgId).eq('route_date', date),
    ]);
    const firstError = driverResult.error ?? reservationResult.error ?? recurringResult.error ?? routeResult.error;
    if (firstError) { setError(firstError.message); setLoading(false); return; }

    const driverRows = (driverResult.data as unknown as DriverRow[]) ?? [];
    setDrivers(driverRows.map((row) => ({ id: row.user_id, name: row.profiles?.full_name?.trim() || 'Driver' })));

    const reservations: ReservationRecord[] = ((reservationResult.data as unknown as ReservationRow[]) ?? []).map((row) => ({
      id: row.id, dog: toDogRef(row.dog), serviceType: row.service_type, startDate: row.start_date, endDate: row.end_date,
    }));
    const recurring: RecurringScheduleRecord[] = ((recurringResult.data as unknown as RecurringRow[]) ?? []).map((row) => ({
      id: row.id, dog: toDogRef(row.dog), weekdays: row.weekdays, startDate: row.start_date, endDate: row.end_date, active: row.active,
    }));

    const day = buildDay(date, reservations, recurring);
    const items = [...day.daycare, ...day.boarding];
    const seen = new Set<string>();
    setDayItems(items.filter((item) => (seen.has(item.dogId) ? false : (seen.add(item.dogId), true))).map((item) => ({ dogId: item.dogId, clientName: item.clientName, dogName: item.dogName, reservationKind: item.kind })));

    const routeRows = (routeResult.data as unknown as RouteRow[]) ?? [];
    setRoutes(routeRows.map((row) => ({
      driverId: row.driver_id,
      status: row.status,
      stops: (row.route_stops ?? []).map((stop) => ({ dogId: stop.dog.id, clientName: stop.dog.client.name, dogName: stop.dog.name })),
    })));
    setLoading(false);
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const assign = useCallback(async (dogId: string, driverId: string) => {
    if (!organizationId) throw new Error('Organization not found.');
    const { data: route, error: routeError } = await supabase.from('routes').upsert(
      { organization_id: organizationId, route_date: date, driver_id: driverId, status: 'draft' },
      { onConflict: 'organization_id,route_date,driver_id' },
    ).select('id').single();
    if (routeError) throw new Error(routeError.message);
    const routeId = (route as { id: string }).id;
    // Remove the dog from any other route on this date, then add it to this route.
    const { error: moveError } = await supabase.rpc('move_stop_to_route', { p_route_id: routeId, p_dog_id: dogId });
    if (moveError) {
      // Fallback for environments without the RPC: plain sequential deletes/inserts.
      const { data: dayRoutes } = await supabase.from('routes').select('id').eq('organization_id', organizationId).eq('route_date', date);
      for (const other of (dayRoutes as { id: string }[]) ?? []) {
        await supabase.from('route_stops').delete().eq('route_id', other.id).eq('dog_id', dogId);
      }
      const { data: existing } = await supabase.from('route_stops').select('sequence').eq('route_id', routeId).order('sequence', { ascending: false }).limit(1);
      const next = ((existing as { sequence: number }[] | null)?.[0]?.sequence ?? 0) + 1;
      const { error: insertError } = await supabase.from('route_stops').insert({ route_id: routeId, dog_id: dogId, sequence: next });
      if (insertError) throw new Error(insertError.message);
    }
    await load();
  }, [organizationId, date, load]);

  const publish = useCallback(async (driverId: string) => {
    if (!organizationId) return;
    const { error } = await supabase.from('routes').update({ status: 'published', published_at: new Date().toISOString() })
      .eq('organization_id', organizationId).eq('route_date', date).eq('driver_id', driverId);
    if (error) throw new Error(error.message);
    await load();
  }, [organizationId, date, load]);

  const summary = useMemo(() => ({ date, drivers, dayItems, routes }), [date, drivers, dayItems, routes]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {loading ? <ActivityIndicator style={styles.center} color={colors.gold} size="large" /> : error ? <Text style={styles.errorText}>{error}</Text> : (
        <DispatchBoard
          date={summary.date}
          drivers={summary.drivers}
          dayItems={summary.dayItems}
          routes={summary.routes}
          onAssign={assign}
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
