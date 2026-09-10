/**
 * Histórico de rotas (manager): o que foi executado, por quem e o que ficou pendente.
 * Antes não havia nenhuma forma de conferir o que aconteceu nas rotas anteriores.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { routeStatusStyle, stopSummaryLabel, summarizeStops, type HistoryStop } from '@/features/dispatch/history';
import { colors, radii } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';

type RouteRow = {
  id: string;
  route_date: string;
  status: string;
  driver_id: string;
  route_stops: HistoryStop[] | null;
};

const TONES: Record<string, { bg: string; fg: string }> = {
  green: { bg: '#E5F1E6', fg: '#2F6B3C' },
  gold: { bg: '#FBF3DE', fg: '#8A6D1F' },
  red: { bg: '#FBEDED', fg: colors.urgency },
  muted: { bg: colors.sage, fg: colors.forest700 },
};

export default function RouteHistoryScreen() {
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [driverNames, setDriverNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: memberships } = await supabase.from('organization_members').select('organization_id').eq('user_id', user.id).eq('status', 'active').limit(1);
    const organizationId = (memberships as { organization_id: string }[] | null)?.[0]?.organization_id ?? null;
    if (!organizationId) { setRoutes([]); setLoading(false); return; }

    const [{ data: routeRows, error: routeError }, { data: members }] = await Promise.all([
      supabase
        .from('routes')
        .select('id, route_date, status, driver_id, route_stops(status)')
        .eq('organization_id', organizationId)
        .order('route_date', { ascending: false })
        .limit(60),
      supabase.from('organization_members').select('user_id, profiles(full_name)').eq('organization_id', organizationId).eq('role', 'driver'),
    ]);
    if (routeError) { setError(routeError.message); setLoading(false); return; }

    const names: Record<string, string> = {};
    for (const member of (members as unknown as { user_id: string; profiles: { full_name: string | null } | null }[] | null) ?? []) {
      names[member.user_id] = member.profiles?.full_name?.trim() || 'Driver';
    }
    setDriverNames(names);
    setRoutes((routeRows as unknown as RouteRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} hitSlop={8} style={styles.back}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Route history</Text>
      </View>
      {loading ? (
        <ActivityIndicator style={styles.center} color={colors.gold} size="large" />
      ) : (
        <ScrollView automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never" contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {routes.length === 0 && !error ? <Text style={styles.empty}>No routes yet. Publish a route in Dispatch and it will show up here.</Text> : null}
          {routes.map((route) => {
            const status = routeStatusStyle(route.status);
            const tone = TONES[status.tone];
            const summary = summarizeStops(route.route_stops ?? []);
            return (
              <View key={route.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <Text style={styles.date}>{route.route_date}</Text>
                  <Text style={[styles.badge, { backgroundColor: tone.bg, color: tone.fg }]}>{status.label}</Text>
                </View>
                <Text style={styles.driver}>{driverNames[route.driver_id] ?? 'Driver'}</Text>
                <Text style={styles.stops}>{stopSummaryLabel(summary)}</Text>
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.forest700 },
  header: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.forest700, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 22, gap: 12 },
  back: { paddingRight: 6 },
  backText: { color: 'white', fontSize: 30, fontWeight: '700', lineHeight: 32 },
  title: { color: 'white', fontFamily: 'serif', fontSize: 26, fontWeight: '800' },
  center: { marginTop: 60 },
  list: { padding: 18, paddingBottom: 60, backgroundColor: colors.cream, minHeight: '100%' },
  card: { backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  date: { color: colors.forest900, fontFamily: 'serif', fontSize: 16, fontWeight: '800' },
  badge: { fontSize: 11, fontWeight: '900', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
  driver: { color: colors.ink, fontWeight: '700', fontSize: 13, marginTop: 6 },
  stops: { color: colors.muted, fontSize: 12, marginTop: 3 },
  empty: { color: colors.muted, fontSize: 13, textAlign: 'center', marginTop: 40, lineHeight: 19 },
  error: { color: colors.urgency, fontSize: 13, fontWeight: '700', marginBottom: 12 },
});
