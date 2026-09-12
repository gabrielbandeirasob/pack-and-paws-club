import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DateField } from '@/features/calendar/DateField';
import type { DogRef } from '@/features/calendar/dayMath';
import { DogPicker } from '@/features/calendar/DogPicker';
import { colors, radii } from '@/features/theme/tokens';

export type NewReservationPayload = {
  dogId: string;
  serviceType: 'daycare' | 'boarding';
  startDate: string;
  endDate: string;
  weekdays?: number[];
  transportRequired: boolean;
};

type Props = {
  dogs: DogRef[];
  onSave: (payload: NewReservationPayload) => Promise<void>;
  onCancel: () => void;
};

const WEEKDAYS = [
  { label: 'Sun', value: 0 },
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
];

export function NewReservationForm({ dogs, onSave, onCancel }: Props) {
  const [serviceType, setServiceType] = useState<'daycare' | 'boarding'>('daycare');
  const [dog, setDog] = useState<DogRef | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [repeatWeekly, setRepeatWeekly] = useState(false);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [transportRequired, setTransportRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggleWeekday = (value: number) => {
    setWeekdays((current) => (current.includes(value) ? current.filter((day) => day !== value) : [...current, value].sort()));
  };

  const submit = async () => {
    if (!dog || !startDate || (serviceType === 'boarding' && !endDate) || (repeatWeekly && weekdays.length === 0)) {
      setError('Choose a dog and a valid date.');
      return;
    }
    const effectiveEnd = serviceType === 'boarding' ? endDate : startDate;
    if (serviceType === 'boarding' && endDate < startDate) {
      setError('End date must be on or after the start date.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        dogId: dog.id,
        serviceType,
        startDate,
        endDate: effectiveEnd,
        transportRequired,
        ...(repeatWeekly ? { weekdays } : {}),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save the reservation.');
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>NEW RESERVATION</Text>
        <Text style={styles.title}>Schedule care</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Service</Text>
          <View style={styles.segmented}>
            <Pressable accessibilityRole="button" accessibilityLabel="Daycare" onPress={() => setServiceType('daycare')} style={[styles.segment, serviceType === 'daycare' && styles.segmentActive]}>
              <Text style={[styles.segmentText, serviceType === 'daycare' && styles.segmentTextActive]}>Daycare</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Boarding" onPress={() => setServiceType('boarding')} style={[styles.segment, serviceType === 'boarding' && styles.segmentActive]}>
              <Text style={[styles.segmentText, serviceType === 'boarding' && styles.segmentTextActive]}>Boarding</Text>
            </Pressable>
          </View>

          <Text style={styles.label}>Dog</Text>
          <DogPicker
            dogs={dogs}
            selected={dog}
            onSelect={setDog}
            hint={dogs.length > 6 ? 'Tap to search by dog or client.' : undefined}
          />

          <DateField label="Start date" value={startDate} onChange={setStartDate} />

          {serviceType === 'boarding' ? (
            <DateField label="End date" value={endDate} onChange={setEndDate} />
          ) : (
            <Pressable accessibilityRole="button" accessibilityLabel="Repeat weekly" onPress={() => setRepeatWeekly((current) => !current)} style={styles.repeatRow}>
              <Text style={styles.repeatLabel}>Repeat weekly</Text>
              <View style={[styles.checkbox, repeatWeekly && styles.checkboxOn]}>{repeatWeekly ? <Text style={styles.checkMark}>✓</Text> : null}</View>
            </Pressable>
          )}

          {serviceType === 'daycare' && repeatWeekly ? (
            <View style={styles.weekRow}>
              {WEEKDAYS.map((day) => (
                <Pressable key={day.value} accessibilityRole="button" accessibilityLabel={day.label} onPress={() => toggleWeekday(day.value)} style={[styles.dayPill, weekdays.includes(day.value) && styles.dayPillActive]}>
                  <Text style={[styles.dayPillText, weekdays.includes(day.value) && styles.dayPillTextActive]}>{day.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <Pressable accessibilityRole="button" accessibilityLabel="Transport required" onPress={() => setTransportRequired((current) => !current)} style={styles.repeatRow}>
            <View style={styles.transportTextBlock}>
              <Text style={styles.repeatLabel}>Transport required</Text>
              <Text style={styles.transportHint}>Pickup or drop-off on this reservation</Text>
            </View>
            <View style={[styles.checkbox, transportRequired && styles.checkboxOn]}>{transportRequired ? <Text style={styles.checkMark}>✓</Text> : null}</View>
          </Pressable>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Save reservation" disabled={saving} onPress={submit} style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
            {saving ? <ActivityIndicator color={colors.forest900} /> : <Text style={styles.primaryText}>Save reservation</Text>}
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel" disabled={saving} onPress={onCancel} style={styles.cancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 22, backgroundColor: colors.cream, flexGrow: 1 },
  eyebrow: { color: colors.gold, fontSize: 11, fontWeight: '900', letterSpacing: 1.5, marginTop: 12 },
  title: { fontFamily: 'serif', fontSize: 30, fontWeight: '800', color: colors.forest900, marginTop: 8, marginBottom: 18 },
  card: { backgroundColor: colors.paper, borderRadius: radii.large, borderWidth: 1, borderColor: colors.line, padding: 20 },
  label: { color: colors.ink, fontWeight: '800', fontSize: 12, marginTop: 16, marginBottom: 7 },
  segmented: { flexDirection: 'row', backgroundColor: '#EDE9DC', borderRadius: 12, padding: 4 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 9 },
  segmentActive: { backgroundColor: colors.forest700 },
  segmentText: { color: colors.muted, fontWeight: '800', fontSize: 13 },
  segmentTextActive: { color: 'white' },
  selectValue: { backgroundColor: '#F4F2EA', borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, color: colors.ink },
  dogList: { marginTop: 8, gap: 6 },
  dogOption: { borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#F4F2EA' },
  dogOptionActive: { backgroundColor: colors.sage, borderColor: colors.forest500 },
  dogOptionText: { color: colors.ink, fontWeight: '700', fontSize: 13 },
  dogOptionTextActive: { color: colors.forest900 },
  repeatRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  repeatLabel: { color: colors.ink, fontWeight: '800', fontSize: 13 },
  transportTextBlock: { flex: 1, marginRight: 12 },
  transportHint: { color: colors.muted, fontSize: 11, marginTop: 2 },
  checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F4F2EA' },
  checkboxOn: { backgroundColor: colors.forest700, borderColor: colors.forest700 },
  checkMark: { color: 'white', fontWeight: '900', fontSize: 13 },
  weekRow: { flexDirection: 'row', gap: 5, marginTop: 10, flexWrap: 'wrap' },
  dayPill: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 9, borderWidth: 1, borderColor: colors.line, backgroundColor: '#F4F2EA' },
  dayPillActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  dayPillText: { color: colors.muted, fontWeight: '800', fontSize: 11 },
  dayPillTextActive: { color: colors.forest900 },
  error: { color: colors.urgency, fontSize: 12, fontWeight: '700', marginTop: 12 },
  primary: { backgroundColor: colors.gold, borderRadius: 14, padding: 15, alignItems: 'center', marginTop: 18 },
  pressed: { opacity: 0.85 },
  primaryText: { color: colors.forest900, fontWeight: '900', fontSize: 15 },
  cancel: { alignItems: 'center', padding: 12, marginTop: 6 },
  cancelText: { color: colors.muted, fontWeight: '800' },
});
