import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { todayLocalISO, weekdayOfISO } from '@/features/calendar/dates';
import {
  buildDay,
  type RecurringExceptionRecord,
  type RecurringScheduleRecord,
  type ReservationRecord,
} from '@/features/calendar/dayMath';
import { ManagerDashboard, type DashboardMember, type DashboardRoute } from '@/features/dashboard/ManagerDashboard';
import { packProgress, totalPack as contarPack, type PackRoute } from '@/features/dashboard/packProgress';
import { dayIndicatorsFrom, nextTodoPosition, packRows, pendingTodos, type DailyTodo, type DayDog, type PackEntry } from '@/features/dashboard/dayOperation';
import {
  addTodo,
  dogsOfDaySummary,
  loadDayPlan,
  loadPackEntries,
  loadTodos,
  PLANO_VAZIO,
  removeTodo,
  saveDayPlan,
  setPackFlag,
  setPackWalker,
  setTodoDone,
  updateTodoText,
  type DayPlan,
} from '@/features/dashboard/dayService';
import { registrarTodosPendentes } from '@/features/dashboard/dayTodosStore';
import {
  dayHeadline,
  dayPrefix,
  dentroDaJanela,
  shiftDay,
} from '@/features/dashboard/dayNavigation';
import { DriveSwitchRow } from '@/features/auth/DriveSwitchRow';
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
  goes_to_daycare: boolean | null;
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
  const { view, isLoading: roleLoading } = useOrganizationRole();
  const landingRoute = landingRouteForRole(view, roleLoading);
  useEffect(() => {
    if (landingRoute) router.replace(landingRoute as never);
  }, [landingRoute, router]);
  const [managerName, setManagerName] = useState('');
  const [counts, setCounts] = useState({ daycare: 0, boarding: 0 });
  const [routes, setRoutes] = useState<DashboardRoute[]>([]);
  const [totalPack, setTotalPack] = useState(0);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  // DIA DA OPERAÇÃO (operação, 26/09/2026): 5 indicadores, pack (caminhada), to-do e fechamento.
  const [dayDogs, setDayDogs] = useState<DayDog[]>([]);
  const [packEntries, setPackEntries] = useState<PackEntry[]>([]);
  const [plan, setPlan] = useState<DayPlan>(PLANO_VAZIO);
  const [todos, setTodos] = useState<DailyTodo[]>([]);
  const [members, setMembers] = useState<DashboardMember[]>([]);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [packBusy, setPackBusy] = useState(false);
  const [todosBusy, setTodosBusy] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [planSaved, setPlanSaved] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * DIA MOSTRADO NO PAINEL (pedido do dono, áudio de 27/09/2026: "arrastar pro lado, pra ir pro
   * próximo dia"). Começa em hoje; o cabeçalho verde navega e TODO o painel (indicadores, pack,
   * to-do, plano do dia e rotas) passa a ler esse dia.
   */
  const [selectedDay, setSelectedDay] = useState<string>(() => todayLocalISO());
  const hojeISO = todayLocalISO();
  const isToday = selectedDay === hojeISO;
  /** Sábado (6) é o dia em que a semana fecha — o atalho do resumo diz isso. */
  const ehSabado = weekdayOfISO(hojeISO) === 6;

  /** Arrasta o painel para o lado: -1 = dia anterior, +1 = dia seguinte (limite: ±30 dias). */
  const irParaDia = useCallback((passo: number) => {
    setSelectedDay((atual) => {
      const alvo = shiftDay(atual, passo);
      return dentroDaJanela(alvo) ? alvo : atual;
    });
  }, []);

  const irParaHoje = useCallback(() => setSelectedDay(todayLocalISO()), []);

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
    setOrganizationId(organizationId);
    if (!organizationId) {
      setError('Your account is not linked to an organization yet.');
      setLoading(false);
      return;
    }

    const dia = selectedDay;
    const [profileResult, driverResult, memberResult, reservationResult, recurringResult, exceptionResult, routeResult, locationResult, planResult, todoResult, packResult] = await Promise.all([
      supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
      supabase.from('organization_members').select('user_id, profiles(full_name)').eq('organization_id', organizationId).eq('role', 'driver').eq('status', 'active'),
      // Quem pode CAMINHAR com um cão (operação, 26/09): qualquer membro ativo, não só o motorista da rota.
      supabase.from('organization_members').select('user_id, profiles(full_name)').eq('organization_id', organizationId).eq('status', 'active'),
      supabase.from('reservations').select('id, service_type, start_date, end_date, transport_required, goes_to_daycare, dog:dogs(id, name, client:clients(name))').eq('organization_id', organizationId).eq('status', 'confirmed'),
      supabase.from('recurring_schedules').select('id, weekdays, start_date, end_date, active, transport_required, dog:dogs(id, name, client:clients(name))').eq('organization_id', organizationId).eq('active', true),
      supabase.from('recurring_exceptions').select('id, recurring_schedule_id, action, start_date, end_date').eq('organization_id', organizationId),
      supabase
        .from('routes')
        .select('id, driver_id, status, route_stops(id, sequence, status, window_end, exact_time, updated_at, dog:dogs(name, client:clients(latitude, longitude)))')
        .eq('organization_id', organizationId)
        .eq('route_date', dia),
      supabase.from('driver_locations').select('driver_id, latitude, longitude, updated_at').eq('organization_id', organizationId),
      // Plano do dia, to-do list e pack do dia (migração 035) — sempre do dia escolhido.
      supabase.from('daily_plans').select('revenue_cents, walk_location, photo_idea').eq('organization_id', organizationId).eq('day', dia).maybeSingle(),
      supabase.from('daily_todos').select('id, text, done, position').eq('organization_id', organizationId).eq('day', dia).order('position', { ascending: true }),
      supabase.from('pack_entries').select('dog_id, in_pack, walker_id').eq('organization_id', organizationId).eq('day', dia),
    ]);

    const firstError =
      profileResult.error ??
      driverResult.error ??
      memberResult.error ??
      reservationResult.error ??
      recurringResult.error ??
      exceptionResult.error ??
      routeResult.error ??
      planResult.error ??
      todoResult.error ??
      packResult.error;
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
      goesToDaycare: row.goes_to_daycare ?? true,
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
    const day = buildDay(dia, reservations, recurring, exceptions);
    setCounts({ daycare: day.daycare.length, boarding: day.boarding.length });

    // Cães do dia: os indicadores e o pack saem da MESMA conta do calendário (`buildDay`).
    setDayDogs(dogsOfDaySummary(day));
    const membros = ((memberResult.data as unknown as DriverRow[]) ?? [])
      .map((row) => ({ id: row.user_id, name: row.profiles?.full_name?.trim() || 'Team member' }))
      .sort((a, b) => a.name.localeCompare(b.name));
    setMembers(membros);

    const planoLinha = planResult.data as { revenue_cents: number | null; walk_location: string | null; photo_idea: string | null } | null;
    setPlan({
      revenueCents: planoLinha?.revenue_cents ?? null,
      walkLocation: planoLinha?.walk_location ?? null,
      photoIdea: planoLinha?.photo_idea ?? null,
    });

    const listaTodos = ((todoResult.data as DailyTodo[] | null) ?? []);
    setTodos(listaTodos);
    // A bolinha do menu é sobre HOJE: olhando outro dia, não se mexe nela.
    if (dia === hojeISO) registrarTodosPendentes(dia, pendingTodos(listaTodos));

    setPackEntries(
      ((packResult.data as { dog_id: string; in_pack: boolean; walker_id: string | null }[] | null) ?? []).map((linha) => ({
        dogId: linha.dog_id,
        inPack: linha.in_pack,
        walkerId: linha.walker_id,
      })),
    );

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
    setTotalPack(contarPack(packRoutes));
    setProgress(packProgress(packRoutes));
    setLoading(false);
  }, [hojeISO, selectedDay]);

  /* -------------------- dia da operação: indicadores, pack, to-do (26/09/2026) -------------------- */

  const linhasDoPack = packRows(dayDogs, packEntries);
  const indicadores = dayIndicatorsFrom({
    daycareCount: counts.daycare,
    boardingCount: counts.boarding,
    dogs: dayDogs,
    entries: packEntries,
    revenueCents: plan.revenueCents,
  });

  /** Toda escrita do dia volta pelo banco: se falhar, a tela se recarrega em vez de mentir. */
  const comTratamento = useCallback(
    async (acao: () => Promise<void>) => {
      try {
        await acao();
      } catch {
        void load();
      }
    },
    [load],
  );

  /** X do pack: tira/põe o cão na caminhada do dia (nada de apagar reserva ou evento). */
  const alternarPack = useCallback(
    async (dogId: string, inPack: boolean) => {
      if (!organizationId) return;
      const anterior = packEntries;
      setPackEntries((atual) => [
        ...atual.filter((item) => item.dogId !== dogId),
        { dogId, inPack, walkerId: atual.find((item) => item.dogId === dogId)?.walkerId ?? null },
      ]);
      setPackBusy(true);
      await comTratamento(async () => {
        await setPackFlag(supabase, { organizationId, day: selectedDay, dogId, inPack });
      });
      setPackBusy(false);
    },
    [comTratamento, selectedDay, organizationId, packEntries, load],
  );

  /** Quem CAMINHA com o cão hoje (pode ser diferente de quem pega na rota). */
  const escolherCaminhante = useCallback(
    async (dogId: string, walkerId: string | null) => {
      if (!organizationId) return;
      setPackEntries((atual) => [
        ...atual.filter((item) => item.dogId !== dogId),
        { dogId, inPack: atual.find((item) => item.dogId === dogId)?.inPack ?? true, walkerId },
      ]);
      setPackBusy(true);
      await comTratamento(async () => {
        await setPackWalker(supabase, { organizationId, day: selectedDay, dogId, walkerId });
      });
      setPackBusy(false);
    },
    [comTratamento, selectedDay, organizationId],
  );

  const salvarFaturamento = useCallback(
    async (cents: number | null) => {
      if (!organizationId) return;
      setPlan((atual) => ({ ...atual, revenueCents: cents }));
      await comTratamento(async () => {
        await saveDayPlan(supabase, { organizationId, day: selectedDay, revenueCents: cents });
      });
    },
    [comTratamento, selectedDay, organizationId],
  );

  const salvouAviso = useCallback(() => {
    setPlanSaved('Saved');
    setTimeout(() => setPlanSaved(null), 2500);
  }, []);

  const adicionarTodo = useCallback(
    async (text: string) => {
      if (!organizationId) return;
      setTodosBusy(true);
      await comTratamento(async () => {
        const item = await addTodo(supabase, { organizationId, day: selectedDay, text, position: nextTodoPosition(todos) });
        setTodos((atual) => {
          const lista = [...atual, item];
          if (selectedDay === hojeISO) registrarTodosPendentes(selectedDay, pendingTodos(lista));
          return lista;
        });
      });
      setTodosBusy(false);
    },
    [comTratamento, hojeISO, selectedDay, organizationId, todos],
  );

  const marcarTodo = useCallback(
    async (id: string, done: boolean) => {
      setTodos((atual) => {
        const lista = atual.map((item) => (item.id === id ? { ...item, done } : item));
        if (selectedDay === hojeISO) registrarTodosPendentes(selectedDay, pendingTodos(lista));
        return lista;
      });
      await comTratamento(async () => {
        await setTodoDone(supabase, id, done);
      });
    },
    [comTratamento, hojeISO, selectedDay],
  );

  const editarTodo = useCallback(
    async (id: string, text: string) => {
      setTodos((atual) => atual.map((item) => (item.id === id ? { ...item, text } : item)));
      await comTratamento(async () => {
        await updateTodoText(supabase, id, text);
      });
    },
    [comTratamento],
  );

  const apagarTodo = useCallback(
    async (id: string) => {
      setTodos((atual) => {
        const lista = atual.filter((item) => item.id !== id);
        if (selectedDay === hojeISO) registrarTodosPendentes(selectedDay, pendingTodos(lista));
        return lista;
      });
      await comTratamento(async () => {
        await removeTodo(supabase, id);
      });
    },
    [comTratamento, hojeISO, selectedDay],
  );

  const salvarPlano = useCallback(
    async (values: { walkLocation: string; photoIdea: string }) => {
      if (!organizationId) return;
      setPlanBusy(true);
      await comTratamento(async () => {
        await saveDayPlan(supabase, { organizationId, day: selectedDay, walkLocation: values.walkLocation, photoIdea: values.photoIdea });
      });
      setPlan((atual) => ({ ...atual, walkLocation: values.walkLocation || null, photoIdea: values.photoIdea || null }));
      setPlanBusy(false);
      salvouAviso();
    },
    [comTratamento, selectedDay, organizationId, salvouAviso],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const header = useMemo(
    () => ({
      // O rótulo é do DIA ESCOLHIDO: arrastando para amanhã, o cabeçalho diz "TOMORROW · …".
      dateLabel: dayHeadline(selectedDay, hojeISO),
      prefix: dayPrefix(selectedDay, hojeISO),
      greeting: `${salutation(new Date())}, ${managerName || 'there'}`,
      initials: initialsOf(managerName),
    }),
    [hojeISO, managerName, selectedDay],
  );

  // Motorista nao tem painel de gestao (nem "Add from Contacts"/"New reservation"):
  // enquanto a visão carrega, ou quando é motorista, mostramos o carregando e o efeito
  // acima leva ele para "Today's Route". Antes ele abria o painel do gerente.
  if (roleLoading || view !== 'manager') {
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
          <DriveSwitchRow />
          <Text style={styles.error}>{error}</Text>
        </SafeAreaView>
      ) : (
        // Sem SafeAreaView aqui: o ManagerDashboard tem o seu proprio e absorve o recuo do topo.
        // Embrulhar de novo pintava uma faixa creme atras da status bar (bug do topo).
        <ManagerDashboard
          dateLabel={header.dateLabel}
          dayNav={{
            prefix: header.prefix,
            isToday,
            canGoBack: dentroDaJanela(shiftDay(selectedDay, -1), hojeISO),
            canGoForward: dentroDaJanela(shiftDay(selectedDay, 1), hojeISO),
            onPreviousDay: () => irParaDia(-1),
            onNextDay: () => irParaDia(1),
            onToday: irParaHoje,
          }}
          viewSwitch={<DriveSwitchRow />}
          greeting={header.greeting}
          initials={header.initials}
          daycare={counts.daycare}
          boarding={counts.boarding}
          progress={progress}
          routes={routes}
          day={{
            totalDogs: indicadores.totalDogs,
            pack: indicadores.pack,
            revenueCents: plan.revenueCents,
            packRows: linhasDoPack,
            members,
            packBusy,
            onTogglePack: (dogId, inPack) => void alternarPack(dogId, inPack),
            onSetWalker: (dogId, walkerId) => void escolherCaminhante(dogId, walkerId),
            onSaveRevenue: (cents) => void salvarFaturamento(cents),
            todos,
            todosBusy,
            onAddTodo: (text) => void adicionarTodo(text),
            onToggleTodo: (id, done) => void marcarTodo(id, done),
            onEditTodo: (id, text) => void editarTodo(id, text),
            onRemoveTodo: (id) => void apagarTodo(id),
            plan: { walkLocation: plan.walkLocation, photoIdea: plan.photoIdea },
            planBusy,
            planSaved,
            onSavePlan: (values) => void salvarPlano(values),
            onOpenDaySummary: () => router.push('/day-summary'),
          }}
          onOpenProgress={() => router.push({ pathname: '/day-progress', params: { day: selectedDay } })}
          onOpenDispatch={() => router.push('/dispatch')}
          onOpenClients={() => router.push('/clients')}
          onNewReservation={() => router.push('/calendar')}
          onOpenDriverHours={() => router.push('/driver-hours')}
          onOpenWeekSummary={() => router.push('/week-summary')}
          weekSummaryHint={
            ehSabado ? 'The week is closed — check who came' : 'Monday to Saturday — who came day by day'
          }
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
