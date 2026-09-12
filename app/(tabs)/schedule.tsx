import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatDayLabel, todayLocalISO } from '@/features/calendar/dates';
import { groupRoutesByPeriod, routeStatusLabel } from '@/features/driver/routeLabels';
import { colors, radii } from '@/features/theme/tokens';
import { plural } from '@/lib/plural';
import { supabase } from '@/lib/supabase';

type RouteRow = { id: string; route_date: string; status: string; route_stops: { id: string }[] };

function Section({ titulo, rotas, onOpen }: { titulo: string; rotas: RouteRow[]; onOpen: (id: string) => void }) {
  if (rotas.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{titulo}</Text>
      {rotas.map((rota) => (
        <Pressable
          key={rota.id}
          accessibilityLabel={`Open route ${formatDayLabel(rota.route_date)}`}
          style={styles.card}
          onPress={() => onOpen(rota.id)}
        >
          <View style={styles.cardTop}>
            <Text style={styles.date}>{formatDayLabel(rota.route_date)}</Text>
            <View style={[styles.chip, rota.status === 'published' ? styles.chipLive : styles.chipIdle]}>
              <Text style={styles.chipText}>{routeStatusLabel(rota.status)}</Text>
            </View>
          </View>
          <Text style={styles.meta}>{plural(rota.route_stops.length, 'stop', 'stops')}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function DriverScheduleScreen() {
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

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

  const hoje = todayLocalISO();
  const grupos = groupRoutesByPeriod(routes, hoje);
  const abertas = routes.filter((rota) => rota.status === 'published').length;

  const abrirRota = useCallback(
    (id: string) => router.push({ pathname: '/(tabs)/driver', params: { routeId: id } } as never),
    [router],
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>PACK & PAWS CLUB · DRIVER</Text>
        <Text style={styles.title}>Schedule</Text>
        {!loading && routes.length > 0 ? (
          <Text style={styles.subtitle}>
            {plural(routes.length, 'route', 'routes')}
            {abertas > 0 ? ` · ${abertas} published` : ''}
          </Text>
        ) : null}
      </View>
      <View style={styles.body}>
        {loading ? (
          <ActivityIndicator style={styles.center} color={colors.gold} size="large" />
        ) : routes.length === 0 ? (
          <Text style={styles.empty}>No routes published to you yet.</Text>
        ) : (
          <ScrollView automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never" contentContainerStyle={styles.list}>
            <Section titulo="Today" rotas={grupos.today} onOpen={abrirRota} />
            <Section titulo="Upcoming" rotas={grupos.upcoming} onOpen={abrirRota} />
            <Section titulo="Past" rotas={grupos.past} onOpen={abrirRota} />
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
  section: { marginBottom: 18 },
  sectionTitle: { color: colors.forest700, fontSize: 12, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  card: { backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 15, marginBottom: 9 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  date: { color: colors.ink, fontFamily: 'serif', fontWeight: '800', fontSize: 16 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipLive: { backgroundColor: colors.forest700 },
  chipIdle: { backgroundColor: colors.line },
  chipText: { color: 'white', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  meta: { color: colors.muted, fontSize: 12, marginTop: 6 },
});
