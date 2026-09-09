import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { todayLocalISO } from '@/features/calendar/dates';
import { DriverRouteView, type DriverAction, type DriverStop } from '@/features/driver/DriverRouteView';
import { colors, radii } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';

type StopRow = {
  id: string;
  sequence: number;
  status: DriverStop['status'];
  dog: { id: string; name: string; client: { name: string; address_line_1: string | null; city: string | null; client_instructions: { pickup_access_instructions: string | null } | null } };
};

export default function DriverTodayScreen() {
  const [stops, setStops] = useState<DriverStop[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: routes } = await supabase
      .from('routes')
      .select('id, published_at, route_stops(id, sequence, status, dog:dogs(id, name, client:clients(name, address_line_1, city, client_instructions(pickup_access_instructions))))')
      .eq('driver_id', user?.id ?? '')
      .eq('route_date', todayLocalISO())
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(1);
    const route = (routes as unknown as { id: string; published_at: string | null; route_stops: StopRow[] }[] | null)?.[0];
    if (!route) {
      setStops([]);
      setPublishedAt(null);
      setLoading(false);
      return;
    }
    setPublishedAt(route.published_at);
    setStops(((route.route_stops ?? []) as StopRow[]).map((stop) => ({
      id: stop.id,
      sequence: stop.sequence,
      status: stop.status,
      clientName: stop.dog.client.name,
      dogName: stop.dog.name,
      address: stop.dog.client.address_line_1,
      city: stop.dog.client.city,
      instructions: stop.dog.client.client_instructions?.pickup_access_instructions ?? null,
    })));
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const act = async (stopId: string, action: DriverAction) => {
    setMessage(null);
    if (action === 'navigate') {
      const stop = stops.find((candidate) => candidate.id === stopId);
      const query = [stop?.address, stop?.city, stop?.clientName].filter(Boolean).join(', ');
      if (!query) { setMessage('This stop has no address to navigate to.'); return; }
      await Linking.openURL(`https://maps.apple.com/?q=${encodeURIComponent(query)}`);
      return;
    }
    const statusMap: Partial<Record<DriverAction, DriverStop['status']>> = {
      arrived: 'arrived', picked_up: 'picked_up', completed: 'completed', problem: 'skipped',
    };
    const status = statusMap[action];
    if (!status) return;
    const { error } = await supabase.from('route_stops').update({ status }).eq('id', stopId);
    if (error) { setMessage(error.message); return; }
    await load();
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>PACK & PAWS CLUB · DRIVER</Text>
        <Text style={styles.title}>Today&apos;s Route</Text>
        {publishedAt ? <Text style={styles.date}>{todayLocalISO()}</Text> : null}
      </View>
      <View style={styles.body}>
        {loading ? <ActivityIndicator style={styles.center} color={colors.gold} size="large" /> : stops.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🚚</Text>
            <Text style={styles.emptyTitle}>No published route today</Text>
            <Text style={styles.emptyText}>When the manager publishes your route, it will appear here with every stop and instruction.</Text>
          </View>
        ) : (
          <DriverRouteView stops={stops} onAction={act} />
        )}
        {message ? (
          <Pressable accessibilityRole="button" onPress={() => setMessage(null)} style={styles.message}>
            <Text style={styles.messageText}>{message}</Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  header: { backgroundColor: colors.forest700, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24, borderBottomLeftRadius: radii.hero, borderBottomRightRadius: radii.hero },
  eyebrow: { color: colors.gold, fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: 'white', fontFamily: 'serif', fontSize: 28, fontWeight: '800', marginTop: 6 },
  date: { color: '#D7E1D4', fontSize: 12, marginTop: 4 },
  body: { flex: 1 },
  center: { marginTop: 80 },
  empty: { alignItems: 'center', paddingHorizontal: 34, marginTop: 90 },
  emptyEmoji: { fontSize: 44 },
  emptyTitle: { fontFamily: 'serif', fontSize: 20, fontWeight: '800', color: colors.forest900, marginTop: 12 },
  emptyText: { color: colors.muted, textAlign: 'center', fontSize: 13, lineHeight: 20, marginTop: 8 },
  message: { position: 'absolute', left: 18, right: 18, bottom: 24, backgroundColor: colors.urgency, borderRadius: 12, padding: 12 },
  messageText: { color: 'white', fontWeight: '800', textAlign: 'center', fontSize: 13 },
});
