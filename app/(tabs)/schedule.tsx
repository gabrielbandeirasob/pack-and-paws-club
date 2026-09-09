import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radii } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';

type RouteRow = { id: string; route_date: string; status: string; route_stops: { id: string }[] };

export default function DriverScheduleScreen() {
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data } = await supabase
      .from('routes')
      .select('id, route_date, status, route_stops(id)')
      .eq('driver_id', user?.id ?? '')
      .order('route_date', { ascending: false });
    setRoutes((data as unknown as RouteRow[]) ?? []);
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
        <Text style={styles.title}>Schedule</Text>
      </View>
      <View style={styles.body}>
        {loading ? <ActivityIndicator style={styles.center} color={colors.gold} size="large" /> : routes.length === 0 ? (
          <Text style={styles.empty}>No routes published to you yet.</Text>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {routes.map((route) => (
              <View key={route.id} style={styles.card}>
                <Text style={styles.date}>{route.route_date}</Text>
                <Text style={styles.meta}>{route.route_stops.length} stops · {route.status}</Text>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  header: { backgroundColor: colors.forest700, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24, borderBottomLeftRadius: radii.hero, borderBottomRightRadius: radii.hero },
  eyebrow: { color: colors.gold, fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: 'white', fontFamily: 'serif', fontSize: 28, fontWeight: '800', marginTop: 6 },
  body: { flex: 1 },
  center: { marginTop: 80 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 90, paddingHorizontal: 30, fontSize: 14 },
  list: { padding: 16 },
  card: { backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 15, marginBottom: 9 },
  date: { color: colors.ink, fontFamily: 'serif', fontWeight: '800', fontSize: 16, textTransform: 'capitalize' },
  meta: { color: colors.muted, fontSize: 12, marginTop: 4 },
});
