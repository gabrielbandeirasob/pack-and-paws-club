import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { todayLocalISO } from '@/features/calendar/dates';
import {
  buildDay,
  type RecurringExceptionRecord,
  type RecurringScheduleRecord,
  type ReservationRecord,
} from '@/features/calendar/dayMath';
import { ManagerDashboard, type DashboardRoute } from '@/features/dashboard/ManagerDashboard';
import { totalPack as contarPack, type PackRoute } from '@/features/dashboard/packProgress';
import { useOrganizationRole } from '@/features/auth/useOrganizationRole';
import { landingRouteForRole } from '@/features/navigation/roleTabs';
import { haversineKm } from '@/features/dispatch/routeOptimizer';
import { isPastDeadline, nextStopEta } from '@/features/driver/eta';
import { colors } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';

type MembershipRow = { organization_id: string };
type ProfileRow = { full_name: string | null };
type DriverRow = { user_id: string; profiles: { full_name: string | null } | null };
type ReservationRow = {
  id: string;
  service_type: 'daycare' | 'boarding';
  start_date: string;
  end_date: string;
  transport_required: boolean;
  dog: { id: string; name: string; client: { name: string } };
};
type RecurringRow = {
  id: string;
  weekdays: number[];
  start_date: string;
  end_date: string | null;
  active: boolean;
  transport_required: boolean;
  dog: { id: string; name: string; client: { name: string } };
};
type ExceptionRow = { id: string; recurring_schedule_id: string; action: 'skip' | 'transport_on' | 'transport_off'; start_date: string; end_date: string };
type StopRow = {
  id: string;
  sequence: number;
  status: 'pending' | 'arrived' | 'picked_up' | 'completed' | 'skipped';
  window_end: string | null;
  exact_time: string | null;
  updated_at: string | null;
  dog: { name: string; client: { latitude: number | null; longitude: number | null } };
};
type RouteRow = { id: string; driver_id: string; status: 'draft' | 'published'; route_stops: StopRow[] };
type LocationRow = { driver_id: string; latitude: number; longitude: number; updated_at: string };

const KM_PER_MILE = 1.609344;

function salutation(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function todayLabel(date: Date): string {
  return date
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    .toUpperCase()
    .replace(',', ' ·');
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'PP';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return `${first}${last}`.toUpperCase() || 'PP';
}

/** Straight-line distance between consecutive stops (accurate enough for the daily overview). */
function routeMiles(stops: StopRow[]): number {
  const ordered = [...stops].sort((a, b) => a.sequence - b.sequence);
  let km = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const from = ordered[index - 1].dog.client;
    const to = ordered[index].dog.client;
    if (from.latitude == null || from.longitude == null || to.latitude == null || to.longitude == null) continue;
    km += haversineKm(from.latitude, from.longitude, to.latitude, to.longitude);
  }
  return Math.round(km / KM_PER_MILE);
}

function toDashboardRoute(
  route: RouteRow,
  driversById: Record<string, string>,
  location: { latitude: number; longitude: number } | null,
): DashboardRoute {
  const stops = [...route.route_stops].sort((a, b) => a.sequence - b.sequence);
  const finished = stops.filter((stop) => stop.status === 'completed' || stop.status === 'skipped');
  const late =
    route.status === 'published' &&
    stops.some((stop) =>
      stop.status === 'pending' && isPastDeadline(stop.window_end?.slice(0, 5) ?? null, stop.exact_time?.slice(0, 5) ?? null),
    );

  let statusLabel = 'Ready';
  if (route.status !== 'published') statusLabel = 'Draft';
  else if (stops.length > 0 && finished.length === stops.length) statusLabel = 'Done';
  else if (late) statusLabel = 'Late';
  else if (stops.some((stop) => stop.status === 'arrived' || stop.status === 'picked_up')) statusLabel = 'In progress';

  const next = stops.find((stop) => stop.status !== 'completed' && stop.status !== 'skipped');
  const eta = nextStopEta(
    stops.map((stop) => ({
      id: stop.id,
      sequence: stop.sequence,
      clientName: stop.dog.name,
      dogName: stop.dog.name,
      latitude: stop.dog.client.latitude,
      longitude: stop.dog.client.longitude,
      windowEnd: stop.window_end?.slice(0, 5) ?? null,
      exactTime: stop.exact_time?.slice(0, 5) ?? null,
      status: stop.status,
    })),
    location,
  );
  const suffix = eta
    ? `~${eta.minutes} min`
    : next?.exact_time
      ? next.exact_time.slice(0, 5)
      : next?.window_end
        ? `by ${next.window_end.slice(0, 5)}`
        : null;

  return {
    id: route.id,
    driverName: driversById[route.driver_id] ?? 'Driver',
    stops: stops.length,
    miles: routeMiles(stops),
    statusLabel,
    late,
    nextLabel: next ? `${next.dog.name}${suffix ? ` · ${suffix}` : ''}` : null,
  };
}

export default function HomeScreen() {
  const router = useRouter();
  const { role, isLoading: roleLoading } = useOrganizationRole();
  const landingRoute = landingRouteForRole(role, roleLoading);
  useEffect(() => {
    if (landingRoute) router.replace(landingRoute as never);
  }, [landingRoute, router]);
  const [managerName, setManagerName] = useState('');
  const [counts, setCounts] = useState({ daycare: 0, boarding: 0 });
  const [routes, setRoutes] = useState<DashboardRoute[]>([]);
  const [totalPack, setTotalPack] = useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data: memberships } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .limit(1);
    const organizationId = (memberships as MembershipRow[] | null)?.[0]?.organization_id ?? null;
    if (!organizationId) {
      setError('Your account is not linked to an organization yet.');
      setLoading(false);
      return;
    }

    const today = todayLocalISO();
    const [profileResult, driverResult, reservationResult, recurringResult, exceptionResult, routeResult, locationResult] = await Promise.all([
      supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
      supabase.from('organization_members').select('user_id, profiles(full_name)').eq('organization_id', organizationId).eq('role', 'driver').eq('status', 'active'),
      supabase.from('reservations').select('id, service_type, start_date, end_date, transport_required, dog:dogs(id, name, client:clients(name))').eq('organization_id', organizationId).eq('status', 'confirmed'),
      supabase.from('recurring_schedules').select('id, weekdays, start_date, end_date, active, transport_required, dog:dogs(id, name, client:clients(name))').eq('organization_id', organizationId).eq('active', true),
      supabase.from('recurring_exceptions').select('id, recurring_schedule_id, action, start_date, end_date').eq('organization_id', organizationId),
      supabase
        .from('routes')
        .select('id, driver_id, status, route_stops(id, sequence, status, window_end, exact_time, updated_at, dog:dogs(name, client:clients(latitude, longitude)))')
        .eq('organization_id', organizationId)
        .eq('route_date', today),
      supabase.from('driver_locations').select('driver_id, latitude, longitude, updated_at').eq('organization_id', organizationId),
    ]);

    const firstError = profileResult.error ?? driverResult.error ?? reservationResult.error ?? recurringResult.error ?? exceptionResult.error ?? routeResult.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    const profile = profileResult.data as unknown as ProfileRow | null;
    const fallbackName = user.email ? user.email.split('@')[0] : 'there';
    setManagerName(profile?.full_name?.trim() || fallbackName);

    const reservations: ReservationRecord[] = ((reservationResult.data as unknown as ReservationRow[]) ?? []).map((row) => ({
      id: row.id,
      dog: { id: row.dog.id, dogName: row.dog.name, clientName: row.dog.client.name },
      serviceType: row.service_type,
      startDate: row.start_date,
      endDate: row.end_date,
      transportRequired: row.transport_required,
    }));
    const recurring: RecurringScheduleRecord[] = ((recurringResult.data as unknown as RecurringRow[]) ?? []).map((row) => ({
      id: row.id,
      dog: { id: row.dog.id, dogName: row.dog.name, clientName: row.dog.client.name },
      weekdays: row.weekdays,
      startDate: row.start_date,
      endDate: row.end_date,
      active: row.active,
      transportRequired: row.transport_required,
    }));
    const exceptions: RecurringExceptionRecord[] = ((exceptionResult.data as unknown as ExceptionRow[]) ?? []).map((row) => ({
      id: row.id,
      scheduleId: row.recurring_schedule_id,
      action: row.action,
      startDate: row.start_date,
      endDate: row.end_date,
    }));
    const day = buildDay(today, reservations, recurring, exceptions);
    setCounts({ daycare: day.daycare.length, boarding: day.boarding.length });

    const driversById = Object.fromEntries(
      ((driverResult.data as unknown as DriverRow[]) ?? []).map((row) => [row.user_id, row.profiles?.full_name?.trim() || 'Driver']),
    );
    const locations = Object.fromEntries(
      ((locationResult.data as unknown as LocationRow[]) ?? []).map((row) => [row.driver_id, { latitude: row.latitude, longitude: row.longitude }]),
    );
    const routeRows = ((routeResult.data as unknown as RouteRow[]) ?? []).sort((a, b) => a.id.localeCompare(b.id));
    setRoutes(routeRows.map((row) => toDashboardRoute(row, driversById, locations[row.driver_id] ?? null)));

    // Total Pack e progresso do dia: um ponto = um cão, somando todas as rotas de hoje.
    const packRoutes: PackRoute[] = routeRows.map((row) => ({
      driverName: driversById[row.driver_id] ?? 'Driver',
      status: row.status,
      stops: [...row.route_stops]
        .sort((a, b) => a.sequence - b.sequence)
        .map((stop) => ({ status: stop.status, dogName: stop.dog.name, at: stop.updated_at })),
    }));
    // O progresso do dia saiu do painel a pedido do cliente (23/09/2026); o Total Pack continua.
    setTotalPack(contarPack(packRoutes));
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const header = useMemo(
    () => ({ dateLabel: todayLabel(new Date()), greeting: `${salutation(new Date())}, ${managerName || 'there'}`, initials: initialsOf(managerName) }),
    [managerName],
  );

  // Motorista nao tem painel de gestao (nem "Add from Contacts"/"New reservation"):
  // enquanto o papel carrega, ou quando e driver, mostramos o carregando e o efeito
  // acima leva ele para "Today's Route". Antes ele abria o painel do gerente.
  if (roleLoading || role !== 'manager') {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <ActivityIndicator style={styles.center} color={colors.gold} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <>
      {loading ? (
        <SafeAreaView style={styles.screen} edges={['top']}>
          <ActivityIndicator style={styles.center} color={colors.gold} size="large" />
        </SafeAreaView>
      ) : error ? (
        <SafeAreaView style={styles.screen} edges={['top']}>
          <Text style={styles.error}>{error}</Text>
        </SafeAreaView>
      ) : (
        // Sem SafeAreaView aqui: o ManagerDashboard tem o seu proprio e absorve o recuo do topo.
        // Embrulhar de novo pintava uma faixa creme atras da status bar (bug do topo).
        <ManagerDashboard
          dateLabel={header.dateLabel}
          greeting={header.greeting}
          initials={header.initials}
          daycare={counts.daycare}
          boarding={counts.boarding}
          totalPack={totalPack}
          routes={routes}
          onOpenDispatch={() => router.push('/dispatch')}
          onOpenClients={() => router.push('/clients')}
          onNewReservation={() => router.push('/calendar')}
          onOpenDriverHours={() => router.push('/driver-hours')}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  center: { marginTop: 90 },
  error: { color: colors.urgency, textAlign: 'center', marginTop: 90, paddingHorizontal: 30, fontWeight: '700' },
});
