import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { todayLocalISO } from '@/features/calendar/dates';
import { sortStopsBySequence, stopLabel, stopStatusLabel } from '@/features/driver/routeLabels';
import { colors, radii } from '@/features/theme/tokens';
import { plural } from '@/lib/plural';
import { supabase } from '@/lib/supabase';

type StopRow = {
  id: string;
  sequence: number | null;
  status: string;
  dog: { name: string | null; client: { name: string | null; address_line_1: string | null; city: string | null } | null } | null;
};

export default function DriverAssignedScreen() {
  const [stops, setStops] = useState<StopRow[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data } = await supabase
      .from('routes')
      .select('route_stops(id, sequence, status, dog:dogs(name, client:clients(name, address_line_1, city)))')
      .eq('driver_id', user?.id ?? '')
      .eq('route_date', todayLocalISO())
      .eq('status', 'published');
    const rows = ((data as unknown as { route_stops: StopRow[] }[]) ?? []).flatMap((route) => route.route_stops ?? []);
    // a ordem da rota e' a sequencia, nao a ordem que o banco devolveu
    setStops(sortStopsBySequence(rows));
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const feitas = stops.filter((stop) => stop.status === 'completed').length;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>PACK & PAWS CLUB · DRIVER</Text>
        <Text style={styles.title}>Assigned today</Text>
        {!loading && stops.length > 0 ? (
          <Text style={styles.subtitle}>
            {plural(stops.length, 'dog', 'dogs')}
            {feitas > 0 ? ` · ${feitas} done` : ''}
          </Text>
        ) : null}
      </View>
      <View style={styles.body}>
        {loading ? (
          <ActivityIndicator style={styles.center} color={colors.gold} size="large" />
        ) : stops.length === 0 ? (
          <Text style={styles.empty}>No dogs assigned to you today.</Text>
        ) : (
          <ScrollView automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never" contentContainerStyle={styles.list}>
            {stops.map((stop, indice) => {
              const endereco = [stop.dog?.client?.address_line_1, stop.dog?.client?.city].filter(Boolean).join(' · ');
              return (
                <Pressable
                  key={stop.id}
                  accessibilityLabel={`Open route for ${stopLabel(stop.dog?.client?.name, stop.dog?.name)}`}
                  style={styles.card}
                  onPress={() => router.push('/(tabs)/driver' as never)}
                >
                  <View style={styles.cardTop}>
                    <Text style={styles.name}>
                      {indice + 1}. {stopLabel(stop.dog?.client?.name, stop.dog?.name)}
                    </Text>
                    <View style={[styles.chip, stop.status === 'completed' ? styles.chipDone : styles.chipPending]}>
                      <Text style={styles.chipText}>{stopStatusLabel(stop.status)}</Text>
                    </View>
                  </View>
                  {endereco ? <Text style={styles.address}>{endereco}</Text> : null}
                </Pressable>
              );
            })}
            <Text style={styles.hint}>Tap a dog to open today&apos;s route with navigation.</Text>
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
  subtitle: { color: colors.gold, fontSize: 12, marginTop: 6, fontWeight: '700' },
  body: { flex: 1, backgroundColor: colors.cream },
  center: { marginTop: 80 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 90, paddingHorizontal: 30, fontSize: 14 },
  list: { padding: 16, paddingBottom: 40 },
  card: { backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 15, marginBottom: 9 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { color: colors.ink, fontWeight: '800', fontSize: 15, flexShrink: 1, paddingRight: 8 },
  address: { color: colors.muted, fontSize: 12, marginTop: 5 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipDone: { backgroundColor: colors.forest700 },
  chipPending: { backgroundColor: colors.gold },
  chipText: { color: 'white', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  hint: { color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: 10 },
});
