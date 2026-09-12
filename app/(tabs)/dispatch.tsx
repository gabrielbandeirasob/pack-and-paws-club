import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { buildDay, type RecurringExceptionRecord, type RecurringScheduleRecord, type ReservationRecord } from '@/features/calendar/dayMath';
import { todayLocalISO } from '@/features/calendar/dates';
import { DispatchBoard, type DispatchConstraint, type DispatchDriver, type DispatchRoute, type DispatchStopItem } from '@/features/dispatch/DispatchBoard';
import { optimizeRoute } from '@/features/dispatch/routeOptimizer';
import { STALE_ROUTE_TITLE, expectedVersion, isStaleRouteError, routeErrorMessage } from '@/features/dispatch/staleRoute';
import { fetchTravelTimes } from '@/features/dispatch/trafficProvider';
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
  pickup_proof_path: string | null;
  dropoff_proof_path: string | null;
  dog: { id: string; name: string; client: { name: string; latitude: number | null; longitude: number | null } };
};
type RouteRow = { id: string; driver_id: string; status: DispatchRoute['status']; lock_version: number | null; route_stops: StopRow[] | null };

function toDogRef(dog: { id: string; name: string; client: { name: string } }) {
  return { id: dog.id, dogName: dog.name, clientName: dog.client.name };
}

export default function DispatchScreen() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [date, setDate] = useState(todayLocalISO());
  const [drivers, setDrivers] = useState<DispatchDriver[]>([]);
  const [dayItems, setDayItems] = useState<DispatchStopItem[]>([]);
  const [routes, setRoutes] = useState<DispatchRoute[]>([]);
  // Versao de cada rota (lock otimista): o aparelho guarda o que leu; se outro gestor
  // escrever antes, o banco recusa a escrita velha com 'stale_route' em vez de sobrescrever.
  const [versoes, setVersoes] = useState<Record<string, number>>({});
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
      supabase.from('routes').select('id, driver_id, status, lock_version, route_stops(dog_id, sequence, status, window_start, window_end, exact_time, priority, pickup_proof_path, dropoff_proof_path, dog:dogs(id, name, client:clients(name, latitude, longitude)))').eq('organization_id', orgId).eq('route_date', date),
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
    setVersoes(Object.fromEntries(routeRows.map((row) => [row.id, row.lock_version ?? 1])));
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
        pickupProofPath: stop.pickup_proof_path,
        dropoffProofPath: stop.dropoff_proof_path,
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

  const versaoDe = useCallback((routeId: string) => expectedVersion(versoes, routeId), [versoes]);

  // Dois gestores na mesma rota: avisa e recarrega, em vez de deixar a escrita velha passar.
  const avisarRotaMudou = useCallback(() => {
    Alert.alert(STALE_ROUTE_TITLE, routeErrorMessage('stale_route'), [{ text: 'Reload', onPress: () => void load() }]);
  }, [load]);

  /** Trata erro de escrita: avisa quando for concorrencia e sempre devolve mensagem legivel. */
  const falhaDeEscrita = useCallback(
    (erro: { message: string } | null) => {
      if (!erro) return;
      if (isStaleRouteError(erro)) avisarRotaMudou();
      throw new Error(routeErrorMessage(erro));
    },
    [avisarRotaMudou],
  );

  /**
   * Mexeu nas paradas por fora das RPCs (editar janela, remover)? Marca a rota como alterada
   * para que a proxima acao de outro aparelho, que leu a versao antiga, tambem seja recusada.
   */
  const marcarRotaAlterada = useCallback(
    async (routeId: string) => {
      const versao = versaoDe(routeId);
      if (versao === null) return;
      await supabase.from('routes').update({ lock_version: versao + 1 }).eq('id', routeId).eq('lock_version', versao);
    },
    [versaoDe],
  );

  /** Troca o status da rota com trava de versao: 0 linhas = outro aparelho mudou antes. */
  const trocarStatus = useCallback(
    async (routeId: string, mudanca: { status: DispatchRoute['status']; published_at?: string | null }) => {
      const versao = versaoDe(routeId);
      const atualizacao: Record<string, unknown> = { ...mudanca, lock_version: (versao ?? 1) + 1 };
      let consulta = supabase.from('routes').update(atualizacao).eq('id', routeId);
      if (versao !== null) consulta = consulta.eq('lock_version', versao);
      const { data, error } = await consulta.select('id');
      falhaDeEscrita(error);
      if (versao !== null && (data ?? []).length === 0) {
        avisarRotaMudou();
        throw new Error(routeErrorMessage('stale_route'));
      }
      await load();
    },
    [versaoDe, falhaDeEscrita, avisarRotaMudou, load],
  );

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
      p_esperado: versaoDe(routeId),
    });
    falhaDeEscrita(error);
    await load();
  }, [routeIdForDriver, versaoDe, falhaDeEscrita, load]);

  const saveStopConstraint = useCallback(async (routeId: string, dogId: string, constraint: DispatchConstraint) => {
    const { error } = await supabase.from('route_stops').update({
      window_start: constraint.windowStart,
      window_end: constraint.windowEnd,
      exact_time: constraint.exactTime,
      priority: constraint.priority,
    }).eq('route_id', routeId).eq('dog_id', dogId);
    falhaDeEscrita(error);
    await marcarRotaAlterada(routeId);
    await load();
  }, [falhaDeEscrita, marcarRotaAlterada, load]);

  const removeStop = useCallback(async (routeId: string, dogId: string) => {
    const { error } = await supabase.from('route_stops').delete().eq('route_id', routeId).eq('dog_id', dogId);
    falhaDeEscrita(error);
    await marcarRotaAlterada(routeId);
    await load();
  }, [falhaDeEscrita, marcarRotaAlterada, load]);

  const moveStop = useCallback(async (routeId: string, dogId: string, direction: -1 | 1) => {
    const route = routes.find((candidate) => candidate.routeId === routeId);
    if (!route) return;
    const ordered = [...route.stops].sort((a, b) => a.sequence - b.sequence);
    const index = ordered.findIndex((stop) => stop.dogId === dogId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    const { error } = await supabase.rpc('reorder_route_stops', {
      p_route_id: routeId,
      p_dog_ids: ordered.map((stop) => stop.dogId),
      p_esperado: versaoDe(routeId),
    });
    falhaDeEscrita(error);
    await load();
  }, [routes, versaoDe, falhaDeEscrita, load]);

  const publish = useCallback(async (routeId: string) => {
    const { error } = await supabase.rpc('publish_route', { p_route_id: routeId, p_esperado: versaoDe(routeId) });
    falhaDeEscrita(error);
    await load();
  }, [versaoDe, falhaDeEscrita, load]);

  // Volta a rota para rascunho: o motorista deixa de ver a rota, mas nada e apagado.
  const unpublish = useCallback(async (routeId: string) => {
    await trocarStatus(routeId, { status: 'draft', published_at: null });
  }, [trocarStatus]);

  // Cancela a rota (status cancelado): sai da operacao e sai da tela do motorista.
  const cancelRoute = useCallback(async (routeId: string) => {
    await trocarStatus(routeId, { status: 'cancelled' });
  }, [trocarStatus]);

  // Fecha a rota: ela sai da operacao (motorista deixa de ver) e entra no historico.
  const completeRoute = useCallback(async (routeId: string) => {
    await trocarStatus(routeId, { status: 'completed' });
  }, [trocarStatus]);

  const optimize = useCallback(async (routeId: string) => {
    const route = routes.find((candidate) => candidate.routeId === routeId);
    if (!route) return;
    const sorted = [...route.stops].sort((a, b) => a.sequence - b.sequence);
    const finished = sorted.filter((stop) => stop.status === 'completed' || stop.status === 'skipped');
    const remaining = sorted.filter((stop) => stop.status !== 'completed' && stop.status !== 'skipped');
    if (remaining.length < 2) return;

    // Tempos reais de transito (servidor). Sem funcao/chave/internet, cai na estimativa de
    // linha reta e o gestor nem percebe atraso: a espera e limitada por timeout curto.
    const traffic = await fetchTravelTimes(remaining.map((stop) => ({
      dogId: stop.dogId,
      clientName: stop.clientName,
      dogName: stop.dogName,
      latitude: stop.latitude,
      longitude: stop.longitude,
      windowStart: stop.windowStart,
      windowEnd: stop.windowEnd,
      exactTime: stop.exactTime,
      priority: stop.priority,
    })));

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
      { travel: traffic.travel },
    );
    if (!result.feasible) {
      Alert.alert('Cannot optimize this route', result.reason ?? 'The schedule is infeasible.');
      return;
    }
    const lines = result.stops.map((stop) => `• ${stop.sequence}. ${stop.clientName} · ${stop.dogName} — arrive ${stop.plannedArrival}`);
    const origem = traffic.source === 'live' ? 'live traffic' : 'estimated times';
    Alert.alert(`Optimized route (${origem})`, `Suggested order:\n${lines.join('\n')}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Apply',
        onPress: () => {
          const order = [...finished.map((stop) => stop.dogId), ...result.stops.map((stop) => stop.dogId)];
          void supabase.rpc('reorder_route_stops', { p_route_id: routeId, p_dog_ids: order, p_esperado: versaoDe(routeId) }).then(({ error }) => {
            if (error) Alert.alert(isStaleRouteError(error) ? STALE_ROUTE_TITLE : 'Unable to apply the route', routeErrorMessage(error));
            void load();
          });
        },
      },
    ]);
  }, [routes, versaoDe, load]);

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
          onUnpublish={unpublish}
          onCancelRoute={cancelRoute}
          onCompleteRoute={completeRoute}
          onDateChange={setDate}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.forest700 },
  center: { marginTop: 80 },
  errorText: { color: colors.urgency, textAlign: 'center', marginTop: 60, paddingHorizontal: 24 },
});
