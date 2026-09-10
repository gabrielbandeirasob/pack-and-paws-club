/**
 * Tela de edicao de reserva (aberta ao tocar na reserva no calendario).
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { EditReservationForm } from '@/features/calendar/EditReservationForm';
import { reservationUpdatePayload, type ReservationFormValues } from '@/features/calendar/reservationsService';
import { colors } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';

type LoadedRow = {
  service_type: string;
  start_date: string;
  end_date: string;
  transport_required: boolean;
  status: string;
  notes: string | null;
  dog: { name: string; client: { name: string } | null } | null;
};

export default function ReservationEditScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [initial, setInitial] = useState<ReservationFormValues | null>(null);
  const [dogLabel, setDogLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) { setError('Reservation not found.'); setLoading(false); return; }
    setLoading(true);
    const { data, error: loadError } = await supabase
      .from('reservations')
      .select('service_type, start_date, end_date, transport_required, status, notes, dog:dogs(name, client:clients(name))')
      .eq('id', id)
      .single();
    if (loadError || !data) {
      setError(loadError?.message ?? 'Reservation not found.');
      setLoading(false);
      return;
    }
    const row = data as unknown as LoadedRow;
    setInitial({
      service_type: row.service_type,
      start_date: row.start_date,
      end_date: row.end_date,
      transport_required: row.transport_required,
      status: row.status,
      notes: row.notes,
    });
    setDogLabel([row.dog?.client?.name, row.dog?.name].filter(Boolean).join(' · '));
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const save = async (values: ReservationFormValues) => {
    setSaving(true);
    setError(null);
    try {
      const payload = reservationUpdatePayload(values);
      const { error: updateError } = await supabase.from('reservations').update(payload).eq('id', id);
      if (updateError) throw new Error(updateError.message);
      router.back();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the reservation.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Text style={styles.title}>Edit reservation</Text>
      {loading ? (
        <ActivityIndicator style={styles.center} color={colors.gold} size="large" />
      ) : initial ? (
        <EditReservationForm dogLabel={dogLabel} initial={initial} saving={saving} error={error} onSave={(values) => { void save(values); }} onCancel={() => router.back()} />
      ) : (
        <Text style={styles.error}>{error ?? 'Reservation not found.'}</Text>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.forest700 },
  title: { color: 'white', fontFamily: 'serif', fontSize: 26, fontWeight: '800', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  center: { marginTop: 60 },
  error: { color: '#FFD9D9', fontSize: 14, fontWeight: '700', padding: 20, lineHeight: 20 },
});
