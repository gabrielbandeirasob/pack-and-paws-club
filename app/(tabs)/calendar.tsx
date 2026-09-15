import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ModalScreen } from '@/features/ui/ModalScreen';
import { useFocusEffect, useRouter } from 'expo-router';

import { CalendarGrid, BOARDING_DOT, DAYCARE_DOT } from '@/features/calendar/CalendarGrid';
import { addDaysISO, formatDayLabel, todayLocalISO } from '@/features/calendar/dates';
import { buildDay, isSkipped, type DayItem, type DogRef, type RecurringExceptionRecord, type RecurringScheduleRecord, type ReservationRecord } from '@/features/calendar/dayMath';
import { addMonthsISO, monthLabel, monthMatrixISO, summarizeRange, weekDatesISO } from '@/features/calendar/gridMath';
import { NewReservationForm, type NewReservationPayload } from '@/features/calendar/NewReservationForm';
import { colors, radii } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';

type ViewMode = 'day' | 'week' | 'month';

type ReservationRow = { id: string; service_type: 'daycare' | 'boarding'; start_date: string; end_date: string; transport_required: boolean; dog: { id: string; name: string; client: { name: string } } };
type RecurringRow = { id: string; weekdays: number[]; start_date: string; end_date: string | null; active: boolean; transport_required: boolean; dog: { id: string; name: string; client: { name: string } } };
type ExceptionRow = { id: string; recurring_schedule_id: string; action: 'skip' | 'transport_on' | 'transport_off'; start_date: string; end_date: string; reason: string | null };
type DogRow = { id: string; name: string; client: { name: string } };

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function CalendarScreen() {
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState(todayLocalISO());
  const [view, setView] = useState<ViewMode>('day');
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [recurring, setRecurring] = useState<RecurringScheduleRecord[]>([]);
  const [exceptions, setExceptions] = useState<RecurringExceptionRecord[]>([]);
  const [dogs, setDogs] = useState<DogRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Mesma armadilha da aba de clientes: a tela fica montada, entao um cao recem-cadastrado
  // nao aparecia no seletor do agendamento ate fechar e abrir o app. Recarrega a cada foco,
  // silenciosamente depois da primeira vez.
  const jaCarregou = useRef(false);

  const load = useCallback(async (opcoes?: { silent?: boolean }) => {
    if (!opcoes?.silent) setLoading(true);
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: memberships } = await supabase.from('organization_members').select('organization_id').eq('user_id', user.id).eq('status', 'active').limit(1);
    const orgId = (memberships as { organization_id: string }[] | null)?.[0]?.organization_id ?? null;
    setOrganizationId(orgId);
    if (!orgId) { setLoading(false); return; }
    const [reservationResult, recurringResult, exceptionResult, dogResult] = await Promise.all([
      supabase.from('reservations').select('id, service_type, start_date, end_date, transport_required, dog:dogs(id, name, client:clients(name))').eq('organization_id', orgId).eq('status', 'confirmed'),
      supabase.from('recurring_schedules').select('id, weekdays, start_date, end_date, active, transport_required, dog:dogs(id, name, client:clients(name))').eq('organization_id', orgId).eq('active', true),
      supabase.from('recurring_exceptions').select('id, recurring_schedule_id, action, start_date, end_date, reason').eq('organization_id', orgId),
      supabase.from('dogs').select('id, name, client:clients(name)').eq('organization_id', orgId).eq('active', true),
    ]);
    const queryError = reservationResult.error ?? recurringResult.error ?? exceptionResult.error ?? dogResult.error;
    if (queryError) { setError(queryError.message); setLoading(false); return; }
    setReservations(((reservationResult.data as unknown as ReservationRow[]) ?? []).map((row) => ({
      id: row.id,
      dog: { id: row.dog.id, dogName: row.dog.name, clientName: row.dog.client.name },
      serviceType: row.service_type,
      startDate: row.start_date,
      endDate: row.end_date,
      transportRequired: row.transport_required,
    })));
    setRecurring(((recurringResult.data as unknown as RecurringRow[]) ?? []).map((row) => ({
      id: row.id,
      dog: { id: row.dog.id, dogName: row.dog.name, clientName: row.dog.client.name },
      weekdays: row.weekdays,
      startDate: row.start_date,
      endDate: row.end_date,
      active: row.active,
      transportRequired: row.transport_required,
    })));
    setExceptions(((exceptionResult.data as unknown as ExceptionRow[]) ?? []).map((row) => ({
      id: row.id,
      scheduleId: row.recurring_schedule_id,
      action: row.action,
      startDate: row.start_date,
      endDate: row.end_date,
      reason: row.reason,
    })));
    setDogs(((dogResult.data as unknown as DogRow[]) ?? []).map((row) => ({ id: row.id, dogName: row.name, clientName: row.client.name })));
    jaCarregou.current = true;
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load({ silent: jaCarregou.current });
    }, [load]),
  );

  const summary = useMemo(() => buildDay(selectedDay, reservations, recurring, exceptions), [selectedDay, reservations, recurring, exceptions]);

  const grid = useMemo(() => {
    if (view === 'day') return null;
    if (view === 'week') {
      const week = weekDatesISO(selectedDay);
      return { rows: [week] as (string | null)[][], counts: summarizeRange(week[0], week[6], reservations, recurring, exceptions), label: weekRangeLabel(week) };
    }
    const matrix = monthMatrixISO(selectedDay);
    const cells = matrix.weeks.flat().filter((cell): cell is string => cell !== null);
    return { rows: matrix.weeks, counts: summarizeRange(cells[0], cells[cells.length - 1], reservations, recurring, exceptions), label: matrix.label };
  }, [view, selectedDay, reservations, recurring, exceptions]);

  const pausedToday = useMemo(
    () => recurring.filter((schedule) => schedule.weekdays.includes(new Date(`${selectedDay}T00:00:00Z`).getUTCDay()) && isSkipped(schedule.id, selectedDay, exceptions)),
    [recurring, selectedDay, exceptions],
  );

  const navLabel = view === 'day' ? formatDayLabel(selectedDay) : grid?.label ?? formatDayLabel(selectedDay);

  const step = (direction: -1 | 1) => {
    if (view === 'day') setSelectedDay((day) => addDaysISO(day, direction));
    else if (view === 'week') setSelectedDay((day) => addDaysISO(day, direction * 7));
    else setSelectedDay((day) => addMonthsISO(day, direction));
  };

  const saveReservation = async (payload: NewReservationPayload) => {
    if (!organizationId) throw new Error('Organization not found.');
    if (payload.weekdays) {
      const { error: scheduleError } = await supabase.from('recurring_schedules').insert({
        organization_id: organizationId,
        dog_id: payload.dogId,
        weekdays: payload.weekdays,
        start_date: payload.startDate,
        transport_required: payload.transportRequired,
      });
      if (scheduleError) throw new Error(scheduleError.message);
    } else {
      const { error: reservationError } = await supabase.from('reservations').insert({
        organization_id: organizationId,
        dog_id: payload.dogId,
        service_type: payload.serviceType,
        start_date: payload.startDate,
        end_date: payload.endDate,
        transport_required: payload.transportRequired,
      });
      if (reservationError) throw new Error(reservationError.message);
    }
  };

  const finishAdd = async (payload: NewReservationPayload) => {
    await saveReservation(payload);
    setAdding(false);
    await load();
  };

  const removeReservation = async (item: DayItem) => {
    if (!item.reservationId) return;
    await supabase.from('reservations').delete().eq('id', item.reservationId);
    await load();
  };

  const skipDate = async (scheduleId: string) => {
    if (!organizationId) return;
    const { error } = await supabase.from('recurring_exceptions').insert({
      organization_id: organizationId,
      recurring_schedule_id: scheduleId,
      action: 'skip',
      start_date: selectedDay,
      end_date: selectedDay,
      reason: 'Skipped on this date',
    });
    if (error) Alert.alert('Unable to skip this date', error.message);
    await load();
  };

  const removeSkipOnDate = async (scheduleId: string) => {
    const { error } = await supabase
      .from('recurring_exceptions')
      .delete()
      .eq('recurring_schedule_id', scheduleId)
      .eq('action', 'skip')
      .eq('start_date', selectedDay)
      .eq('end_date', selectedDay);
    if (error) Alert.alert('Unable to restore this date', error.message);
    await load();
  };

  const toggleTransportOverride = async (schedule: RecurringScheduleRecord) => {
    if (!organizationId) return;
    const covering = exceptions.filter(
      (exception) =>
        exception.scheduleId === schedule.id &&
        exception.action !== 'skip' &&
        exception.startDate <= selectedDay &&
        exception.endDate >= selectedDay,
    );
    if (covering.length > 0) {
      const { error } = await supabase.from('recurring_exceptions').delete().in('id', covering.map((exception) => exception.id));
      if (error) Alert.alert('Unable to clear transport override', error.message);
    } else {
      const { error } = await supabase.from('recurring_exceptions').insert({
        organization_id: organizationId,
        recurring_schedule_id: schedule.id,
        action: schedule.transportRequired ? 'transport_off' : 'transport_on',
        start_date: selectedDay,
        end_date: selectedDay,
        reason: schedule.transportRequired ? 'No transport on this date' : 'Transport on this date',
      });
      if (error) Alert.alert('Unable to change transport', error.message);
    }
    await load();
  };

  const removeSeries = async (scheduleId: string) => {
    const { error } = await supabase.from('recurring_schedules').delete().eq('id', scheduleId);
    if (error) Alert.alert('Unable to remove the series', error.message);
    await load();
  };

  const openItemActions = (item: DayItem) => {
    const schedule = recurring.find((candidate) => candidate.id === item.recurringScheduleId);
    if (!schedule) return;
    const hasTransportOverride = exceptions.some(
      (exception) => exception.scheduleId === schedule.id && exception.action !== 'skip' && exception.startDate <= selectedDay && exception.endDate >= selectedDay,
    );
    const buttons = [
      {
        text: 'Skip this date',
        onPress: () => void skipDate(schedule.id),
      },
      {
        text: hasTransportOverride
          ? 'Clear transport override'
          : schedule.transportRequired
            ? 'Turn transport off on this date'
            : 'Add transport on this date',
        onPress: () => void toggleTransportOverride(schedule),
      },
      { text: 'Remove series', style: 'destructive' as const, onPress: () => void removeSeries(schedule.id) },
      { text: 'Cancel', style: 'cancel' as const },
    ];
    Alert.alert(`${item.clientName} · ${item.dogName}`, `Repeats ${schedule.weekdays.map((day) => WEEKDAY_NAMES[day]).join(' · ')}`, buttons);
  };

  const openReservationActions = (item: DayItem) => {
    if (!item.reservationId) { confirmRemoveReservation(item); return; }
    const label = `${item.clientName} · ${item.dogName}`;
    Alert.alert(label, 'What do you want to do with this reservation?', [
      { text: 'Edit reservation', onPress: () => router.push({ pathname: '/reservation-edit', params: { id: item.reservationId as string } }) },
      { text: 'Remove', style: 'destructive', onPress: () => void removeReservation(item) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const confirmRemoveReservation = (item: DayItem) => {
    const label = `${item.clientName} · ${item.dogName}`;
    Alert.alert('Remove reservation', `Remove ${label} from the calendar?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void removeReservation(item) },
    ]);
  };

  const restorePaused = (schedule: RecurringScheduleRecord) => {
    const label = `${schedule.dog.clientName} · ${schedule.dog.dogName}`;
    Alert.alert('Restore this date', `Add ${label} back to ${formatDayLabel(selectedDay)}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Restore', onPress: () => void removeSkipOnDate(schedule.id) },
    ]);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>PACK & PAWS CLUB</Text>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Calendar</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="New reservation" onPress={() => setAdding(true)} style={styles.plusButton}>
            <Text style={styles.plusText}>＋</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.viewSwitcher}>
        {(['day', 'week', 'month'] as ViewMode[]).map((mode) => (
          <Pressable key={mode} accessibilityRole="button" accessibilityLabel={`${mode[0].toUpperCase()}${mode.slice(1)} view`} onPress={() => setView(mode)} style={[styles.viewOption, view === mode && styles.viewOptionActive]}>
            <Text style={[styles.viewOptionText, view === mode && styles.viewOptionTextActive]}>{mode[0].toUpperCase()}{mode.slice(1)}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.daySwitcher}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous" onPress={() => step(-1)} style={styles.arrow}>
          <Text style={styles.arrowText}>‹</Text>
        </Pressable>
        <Text style={styles.dayLabel}>{navLabel}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Next" onPress={() => step(1)} style={styles.arrow}>
          <Text style={styles.arrowText}>›</Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        {loading ? <ActivityIndicator style={styles.marginTop} color={colors.gold} size="large" /> : error ? <Text style={styles.errorText}>{error}</Text> : (
          <ScrollView automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never" showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
            {grid && view !== 'day' ? (
              <View style={styles.gridCard}>
                <CalendarGrid rows={grid.rows} counts={grid.counts} selectedDate={selectedDay} onSelectDate={setSelectedDay} />
                <View style={styles.legendRow}>
                  <LegendDot color={DAYCARE_DOT} label="Daycare" />
                  <LegendDot color={BOARDING_DOT} label="Boarding" />
                </View>
              </View>
            ) : null}
            <Section
              title="Daycare"
              color={colors.gold}
              items={summary.daycare}
              empty="No daycare on this day"
              onPressItem={(item) => (item.kind === 'recurring-daycare' ? openItemActions(item) : openReservationActions(item))}
              onRemoveLabel={(item) => (item.kind === 'recurring-daycare' ? `Recurring options ${item.dogName}` : `Options ${item.dogName}`)}
            />
            <Section
              title="Boarding"
              color="#4E8D5C"
              items={summary.boarding}
              empty="No boarding on this day"
              onPressItem={openReservationActions}
              onRemoveLabel={(item) => `Options ${item.dogName}`}
            />
            {pausedToday.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectionHead}><View style={[styles.dot, { backgroundColor: colors.muted }]} /><Text style={styles.sectionTitle}>Paused this date</Text><Text style={styles.sectionCount}>{pausedToday.length}</Text></View>
                {pausedToday.map((schedule) => (
                  <View key={`paused-${schedule.id}`} style={styles.itemRow}>
                    <View style={styles.itemTextBlock}>
                      <Text style={styles.itemName}>{schedule.dog.clientName} · {schedule.dog.dogName}</Text>
                      <Text style={styles.itemHint}>Repeats {schedule.weekdays.map((day) => WEEKDAY_NAMES[day]).join(' · ')} · paused</Text>
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Restore ${schedule.dog.dogName}`} onPress={() => restorePaused(schedule)} hitSlop={8}>
                      <Text style={styles.restoreText}>↺</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}
          </ScrollView>
        )}
      </View>

      <Modal visible={adding} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setAdding(false)}>
        <ModalScreen>
          <NewReservationForm dogs={dogs} onSave={finishAdd} onCancel={() => setAdding(false)} />
        </ModalScreen>
      </Modal>
    </SafeAreaView>
  );
}

function weekRangeLabel(week: string[]): string {
  const [year, month] = week[0].split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, Number(week[0].slice(-2))));
  const end = new Date(Date.UTC(year, month - 1, Number(week[6].slice(-2))));
  const short = (date: Date) => date.toLocaleDateString('en-US', { day: '2-digit', month: 'short', timeZone: 'UTC' }).replace('.', '');
  if (start.getUTCMonth() === end.getUTCMonth()) return `${short(start)} – ${short(end)}, ${end.getUTCFullYear()}`;
  return `${short(start)} – ${short(end)}`;
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function Section({ title, color, items, empty, onPressItem, onRemoveLabel }: { title: string; color: string; items: DayItem[]; empty: string; onPressItem: (item: DayItem) => void; onRemoveLabel: (item: DayItem) => string }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}><View style={[styles.dot, { backgroundColor: color }]} /><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.sectionCount}>{items.length}</Text></View>
      {items.length === 0 ? <Text style={styles.emptyText}>{empty}</Text> : items.map((item) => (
        <View key={`${item.kind}-${item.dogId}-${item.recurringScheduleId ?? item.reservationId}`} style={styles.itemRow}>
          <View style={styles.itemTextBlock}>
            <Text style={styles.itemName}>{item.clientName} · {item.dogName}</Text>
            <View style={styles.itemBadges}>
              {item.kind === 'recurring-daycare' ? <Text style={styles.itemHint}>Repeats weekly</Text> : null}
              {item.transportRequired ? <View style={styles.transportBadge}><Text style={styles.transportBadgeText}>Transport</Text></View> : null}
            </View>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={onRemoveLabel(item)} onPress={() => onPressItem(item)} hitSlop={8}>
            <Text style={[styles.removeText, item.kind === 'recurring-daycare' && styles.menuText]}>{item.kind === 'recurring-daycare' ? '⋯' : '✕'}</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.forest700 },
  header: { backgroundColor: colors.forest700, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 22, borderBottomLeftRadius: radii.hero, borderBottomRightRadius: radii.hero },
  eyebrow: { color: colors.gold, fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  title: { color: 'white', fontFamily: 'serif', fontSize: 30, fontWeight: '800' },
  plusButton: { backgroundColor: colors.gold, width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  plusText: { color: colors.forest900, fontSize: 22, fontWeight: '900', lineHeight: 24 },
  viewSwitcher: { flexDirection: 'row', backgroundColor: '#EDE9DC', marginHorizontal: 16, marginTop: 14, borderRadius: 12, padding: 4 },
  viewOption: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 9 },
  viewOptionActive: { backgroundColor: colors.forest700 },
  viewOptionText: { color: colors.muted, fontWeight: '800', fontSize: 13 },
  viewOptionTextActive: { color: 'white' },
  daySwitcher: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.paper, borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 10, paddingHorizontal: 16 },
  arrow: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  arrowText: { color: colors.forest700, fontSize: 30, fontWeight: '700', lineHeight: 32 },
  dayLabel: { color: colors.forest900, fontFamily: 'serif', fontWeight: '800', fontSize: 16, textTransform: 'capitalize', textAlign: 'center', flexShrink: 1 },
  body: { flex: 1, backgroundColor: colors.cream },
  list: { padding: 18, paddingBottom: 40 },
  marginTop: { marginTop: 60 },
  errorText: { color: colors.urgency, textAlign: 'center', marginTop: 40, paddingHorizontal: 24 },
  gridCard: { backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 10, marginBottom: 18 },
  legendRow: { flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  section: { marginBottom: 22 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  sectionTitle: { fontFamily: 'serif', fontSize: 19, fontWeight: '800', color: colors.forest900, flex: 1 },
  sectionCount: { color: colors.muted, fontWeight: '800', fontSize: 13 },
  emptyText: { color: colors.muted, fontSize: 13, marginLeft: 18, marginBottom: 6 },
  itemRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 14, marginBottom: 8, gap: 12 },
  itemTextBlock: { flex: 1 },
  itemName: { color: colors.ink, fontWeight: '800', fontSize: 15 },
  itemBadges: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' },
  itemHint: { color: colors.muted, fontSize: 11 },
  transportBadge: { backgroundColor: colors.sage, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  transportBadgeText: { color: colors.forest900, fontSize: 10, fontWeight: '900' },
  removeText: { color: colors.urgency, fontSize: 15, fontWeight: '800' },
  menuText: { color: colors.forest700, fontSize: 20, lineHeight: 20 },
  restoreText: { color: colors.forest700, fontSize: 18, fontWeight: '900' },
});
