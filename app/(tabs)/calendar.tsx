import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { buildDay, type DayItem, type DogRef, type RecurringScheduleRecord, type ReservationRecord } from '@/features/calendar/dayMath';
import { addDaysISO, formatDayLabel, todayLocalISO } from '@/features/calendar/dates';
import { NewReservationForm, type NewReservationPayload } from '@/features/calendar/NewReservationForm';
import { colors, radii } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';

type ReservationRow = { id: string; service_type: 'daycare' | 'boarding'; start_date: string; end_date: string; dog: { id: string; name: string; client: { name: string } } };
type RecurringRow = { id: string; weekdays: number[]; start_date: string; end_date: string | null; active: boolean; transport_required: boolean; dog: { id: string; name: string; client: { name: string } } };
type DogRow = { id: string; name: string; client: { name: string } };

export default function CalendarScreen() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState(todayLocalISO());
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [recurring, setRecurring] = useState<RecurringScheduleRecord[]>([]);
  const [dogs, setDogs] = useState<DogRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: memberships } = await supabase.from('organization_members').select('organization_id').eq('user_id', user.id).eq('status', 'active').limit(1);
    const orgId = (memberships as { organization_id: string }[] | null)?.[0]?.organization_id ?? null;
    setOrganizationId(orgId);
    if (!orgId) { setLoading(false); return; }
    const [reservationResult, recurringResult, dogResult] = await Promise.all([
      supabase.from('reservations').select('id, service_type, start_date, end_date, dog:dogs(id, name, client:clients(name))').eq('organization_id', orgId).eq('status', 'confirmed'),
      supabase.from('recurring_schedules').select('id, weekdays, start_date, end_date, active, transport_required, dog:dogs(id, name, client:clients(name))').eq('organization_id', orgId).eq('active', true),
      supabase.from('dogs').select('id, name, client:clients(name)').eq('organization_id', orgId).eq('active', true),
    ]);
    const reservationError = reservationResult.error ?? recurringResult.error ?? dogResult.error;
    if (reservationError) { setError(reservationError.message); setLoading(false); return; }
    setReservations(((reservationResult.data as unknown as ReservationRow[]) ?? []).map((row) => ({
      id: row.id,
      dog: { id: row.dog.id, dogName: row.dog.name, clientName: row.dog.client.name },
      serviceType: row.service_type,
      startDate: row.start_date,
      endDate: row.end_date,
    })));
    setRecurring(((recurringResult.data as unknown as RecurringRow[]) ?? []).map((row) => ({
      id: row.id,
      dog: { id: row.dog.id, dogName: row.dog.name, clientName: row.dog.client.name },
      weekdays: row.weekdays,
      startDate: row.start_date,
      endDate: row.end_date,
      active: row.active,
    })));
    setDogs(((dogResult.data as unknown as DogRow[]) ?? []).map((row) => ({ id: row.id, dogName: row.name, clientName: row.client.name })));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const summary = useMemo(() => buildDay(selectedDay, reservations, recurring), [selectedDay, reservations, recurring]);

  const saveReservation = async (payload: NewReservationPayload) => {
    if (!organizationId) throw new Error('Organization not found.');
    if (payload.weekdays) {
      const { error: scheduleError } = await supabase.from('recurring_schedules').insert({
        organization_id: organizationId,
        dog_id: payload.dogId,
        weekdays: payload.weekdays,
        start_date: payload.startDate,
      });
      if (scheduleError) throw new Error(scheduleError.message);
    } else {
      const { error: reservationError } = await supabase.from('reservations').insert({
        organization_id: organizationId,
        dog_id: payload.dogId,
        service_type: payload.serviceType,
        start_date: payload.startDate,
        end_date: payload.endDate,
      });
      if (reservationError) throw new Error(reservationError.message);
    }
  };

  const finishAdd = async (payload: NewReservationPayload) => {
    await saveReservation(payload);
    setAdding(false);
    await load();
  };

  const removeItem = (item: DayItem) => {
    const label = `${item.clientName} · ${item.dogName}`;
    Alert.alert('Remove reservation', `Remove ${label} from the calendar?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          if (item.recurringScheduleId) {
            await supabase.from('recurring_schedules').delete().eq('id', item.recurringScheduleId);
          } else if (item.reservationId) {
            await supabase.from('reservations').delete().eq('id', item.reservationId);
          }
          await load();
        },
      },
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
      <View style={styles.daySwitcher}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous day" onPress={() => setSelectedDay((day) => addDaysISO(day, -1))} style={styles.arrow}>
          <Text style={styles.arrowText}>‹</Text>
        </Pressable>
        <Text style={styles.dayLabel}>{formatDayLabel(selectedDay)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Next day" onPress={() => setSelectedDay((day) => addDaysISO(day, 1))} style={styles.arrow}>
          <Text style={styles.arrowText}>›</Text>
        </Pressable>
      </View>
      <View style={styles.body}>
        {loading ? <ActivityIndicator style={styles.marginTop} color={colors.gold} size="large" /> : error ? <Text style={styles.errorText}>{error}</Text> : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
            <Section title="Daycare" color={colors.gold} items={summary.daycare} empty="No daycare on this day" onRemove={removeItem} />
            <Section title="Boarding" color="#4E8D5C" items={summary.boarding} empty="No boarding on this day" onRemove={removeItem} />
          </ScrollView>
        )}
      </View>
      <Modal visible={adding} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setAdding(false)}>
        <SafeAreaView style={styles.screen}>
          <NewReservationForm dogs={dogs} onSave={finishAdd} onCancel={() => setAdding(false)} />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function Section({ title, color, items, empty, onRemove }: { title: string; color: string; items: DayItem[]; empty: string; onRemove: (item: DayItem) => void }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}><View style={[styles.dot, { backgroundColor: color }]} /><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.sectionCount}>{items.length}</Text></View>
      {items.length === 0 ? <Text style={styles.emptyText}>{empty}</Text> : items.map((item) => (
        <View key={`${item.kind}-${item.dogId}-${item.recurringScheduleId ?? item.reservationId}`} style={styles.itemRow}>
          <View style={styles.itemTextBlock}>
            <Text style={styles.itemName}>{item.clientName} · {item.dogName}</Text>
            {item.kind === 'recurring-daycare' ? <Text style={styles.itemHint}>Repeats weekly</Text> : null}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.dogName}`} onPress={() => onRemove(item)} hitSlop={8}>
            <Text style={styles.removeText}>✕</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  header: { backgroundColor: colors.forest700, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 26, borderBottomLeftRadius: radii.hero, borderBottomRightRadius: radii.hero },
  eyebrow: { color: colors.gold, fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  title: { color: 'white', fontFamily: 'serif', fontSize: 30, fontWeight: '800' },
  plusButton: { backgroundColor: colors.gold, width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  plusText: { color: colors.forest900, fontSize: 22, fontWeight: '900', lineHeight: 24 },
  daySwitcher: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.paper, borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 10, paddingHorizontal: 16 },
  arrow: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  arrowText: { color: colors.forest700, fontSize: 30, fontWeight: '700', lineHeight: 32 },
  dayLabel: { color: colors.forest900, fontFamily: 'serif', fontWeight: '800', fontSize: 17, textTransform: 'capitalize' },
  body: { flex: 1 },
  list: { padding: 18, paddingBottom: 40 },
  marginTop: { marginTop: 60 },
  errorText: { color: colors.urgency, textAlign: 'center', marginTop: 40, paddingHorizontal: 24 },
  section: { marginBottom: 22 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  sectionTitle: { fontFamily: 'serif', fontSize: 19, fontWeight: '800', color: colors.forest900, flex: 1 },
  sectionCount: { color: colors.muted, fontWeight: '800', fontSize: 13 },
  emptyText: { color: colors.muted, fontSize: 13, marginLeft: 18, marginBottom: 6 },
  itemRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 14, marginBottom: 8, gap: 12 },
  itemTextBlock: { flex: 1 },
  itemName: { color: colors.ink, fontWeight: '800', fontSize: 15 },
  itemHint: { color: colors.muted, fontSize: 11, marginTop: 3 },
  removeText: { color: colors.urgency, fontSize: 15, fontWeight: '800' },
});
