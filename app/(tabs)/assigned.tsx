import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { todayLocalISO } from '@/features/calendar/dates';
import { colors, radii } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';

type StopRow = {
  id: string;
  status: string;
  dog: { name: string | null; client: { name: string | null } | null } | null;
};

export default function DriverAssignedScreen() {
  const [stops, setStops] = useState<StopRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data } = await supabase
      .from('routes')
      .select('route_stops(id, status, dog:dogs(name, client:clients(name)))')
      .eq('driver_id', user?.id ?? '')
      .eq('route_date', todayLocalISO())
      .eq('status', 'published');
    const rows = ((data as unknown as { route_stops: StopRow[] }[]) ?? []).flatMap((route) => route.route_stops ?? []);
    setStops(rows);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>PACK & PAWS CLUB · DRIVER</Text>
        <Text style={styles.title}>Assigned today</Text>
      </View>
      <View style={styles.body}>
        {loading ? <ActivityIndicator style={styles.center} color={colors.gold} size="large" /> : stops.length === 0 ? (
          <Text style={styles.empty}>No dogs assigned to you today.</Text>
        ) : (
          <ScrollView automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never" contentContainerStyle={styles.list}>
            {stops.map((stop) => (
              <View key={stop.id} style={styles.card}>
                <Text style={styles.name}>{stop.dog?.client?.name?.trim() || 'Client'} · {stop.dog?.name?.trim() || 'Dog'}</Text>
                <Text style={styles.meta}>{stop.status}</Text>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.forest700 },
  header: { backgroundColor: colors.forest700, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24, borderBottomLeftRadius: radii.hero, borderBottomRightRadius: radii.hero },
  eyebrow: { color: colors.gold, fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: 'white', fontFamily: 'serif', fontSize: 28, fontWeight: '800', marginTop: 6 },
  body: { flex: 1, backgroundColor: colors.cream },
  center: { marginTop: 80 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 90, paddingHorizontal: 30, fontSize: 14 },
  list: { padding: 16 },
  card: { backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 15, marginBottom: 9 },
  name: { color: colors.ink, fontWeight: '800', fontSize: 15 },
  meta: { color: colors.muted, fontSize: 12, marginTop: 3, textTransform: 'capitalize' },
});
