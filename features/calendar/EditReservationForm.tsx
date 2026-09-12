/**
 * Formulario de EDICAO de reserva (antes so existia criar e apagar —
 * mudar a data ou o servico exigia apagar e recriar, perdendo o historico).
 */
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { DateField } from '@/features/calendar/DateField';
import { endDateForService, type ReservationFormValues } from '@/features/calendar/reservationsService';
import { colors, radii } from '@/features/theme/tokens';

type Props = {
  dogLabel: string;
  initial: ReservationFormValues;
  saving?: boolean;
  error?: string | null;
  onSave: (values: ReservationFormValues) => void;
  onCancel: () => void;
};

export function EditReservationForm({ dogLabel, initial, saving, error, onSave, onCancel }: Props) {
  const [serviceType, setServiceType] = useState(initial.service_type);
  const [startDate, setStartDate] = useState(initial.start_date);
  const [endDate, setEndDate] = useState(initial.end_date);
  const [transport, setTransport] = useState(initial.transport_required);
  const [notes, setNotes] = useState(initial.notes ?? '');
  const [status, setStatus] = useState(initial.status);

  const pickService = (next: string) => {
    setServiceType(next);
    setEndDate((current) => endDateForService(next, startDate, current));
  };

  const pickStart = (isoDate: string) => {
    setStartDate(isoDate);
    setEndDate((current) => endDateForService(serviceType, isoDate, current));
  };

  const cancelled = status === 'cancelled';

  return (
    // Mesmo motivo do EditClientForm: sem isto o teclado cobre o campo de observacoes.
    <KeyboardAvoidingView testID="teclado-form" style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never">
      <Text style={styles.dog}>{dogLabel}</Text>
      {cancelled ? <Text style={styles.cancelledBanner}>This reservation is cancelled. Change the date or reactivate it below.</Text> : null}

      <Text style={styles.section}>Service</Text>
      <View style={styles.toggleRow}>
        {(['daycare', 'boarding'] as const).map((option) => (
          <Pressable key={option} accessibilityRole="button" accessibilityLabel={option === 'daycare' ? 'Daycare' : 'Boarding'} onPress={() => pickService(option)} style={[styles.toggle, serviceType === option && styles.toggleOn]}>
            <Text style={[styles.toggleText, serviceType === option && styles.toggleTextOn]}>{option === 'daycare' ? 'Daycare' : 'Boarding'}</Text>
          </Pressable>
        ))}
      </View>

      <DateField label="Start date" value={startDate} onChange={pickStart} />
      {serviceType === 'boarding' ? <DateField label="End date" value={endDate} onChange={setEndDate} /> : null}

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Transport required</Text>
        <Switch value={transport} onValueChange={setTransport} />
      </View>

      <Text style={styles.section}>Notes</Text>
      <TextInput
        accessibilityLabel="Reservation notes"
        value={notes}
        onChangeText={setNotes}
        placeholder="Anything the driver should know…"
        placeholderTextColor={colors.muted}
        multiline
        style={styles.input}
      />

      <Pressable accessibilityRole="button" accessibilityLabel={cancelled ? 'Reactivate reservation' : 'Cancel reservation'} onPress={() => setStatus(cancelled ? 'confirmed' : 'cancelled')} style={[styles.statusButton, cancelled && styles.statusButtonOn]}>
        <Text style={[styles.statusText, cancelled && styles.statusTextOn]}>{cancelled ? '↺ Reactivate reservation' : '✕ Cancel reservation'}</Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Save reservation" disabled={saving} onPress={() => onSave({ service_type: serviceType, start_date: startDate, end_date: endDate, transport_required: transport, status, notes })} style={({ pressed }) => [styles.save, pressed && styles.pressed, saving && styles.disabled]}>
        <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save reservation'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to calendar" onPress={onCancel} style={styles.cancel}>
        <Text style={styles.cancelText}>Back to calendar</Text>
      </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.cream },
  body: { padding: 18, paddingBottom: 60 },
  dog: { fontFamily: 'serif', fontSize: 20, fontWeight: '800', color: colors.forest900 },
  cancelledBanner: { marginTop: 10, backgroundColor: '#FBEDED', borderWidth: 1, borderColor: '#E8BFBF', borderRadius: 12, padding: 11, color: colors.urgency, fontSize: 12, fontWeight: '700', lineHeight: 18 },
  section: { fontFamily: 'serif', fontSize: 15, fontWeight: '800', color: colors.forest900, marginTop: 18, marginBottom: 6 },
  toggleRow: { flexDirection: 'row', gap: 10 },
  toggle: { flex: 1, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  toggleOn: { backgroundColor: colors.forest700, borderColor: colors.forest700 },
  toggleText: { color: colors.forest700, fontWeight: '800', fontSize: 14 },
  toggleTextOn: { color: 'white' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 },
  switchLabel: { color: colors.ink, fontWeight: '700', fontSize: 14 },
  input: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11, color: colors.ink, fontSize: 15, minHeight: 76, textAlignVertical: 'top' },
  statusButton: { marginTop: 20, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 13, alignItems: 'center' },
  statusButtonOn: { borderColor: '#4E8D5C', backgroundColor: '#EEF6EE' },
  statusText: { color: colors.urgency, fontWeight: '800', fontSize: 13 },
  statusTextOn: { color: '#2F6B3C' },
  error: { color: colors.urgency, fontSize: 13, fontWeight: '700', marginTop: 14, lineHeight: 19 },
  save: { backgroundColor: colors.gold, borderRadius: 14, padding: 15, alignItems: 'center', marginTop: 18 },
  saveText: { color: colors.forest900, fontWeight: '900', fontSize: 15 },
  cancel: { padding: 14, alignItems: 'center' },
  cancelText: { color: colors.muted, fontWeight: '800' },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.6 },
});
