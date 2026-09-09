import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { DriverInviteForm } from '@/features/drivers/DriverInviteForm';
import { colors, radii } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';

type DriverRow = { user_id: string; profiles: { full_name: string | null } | null };

export default function DriversScreen() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: memberships } = await supabase.from('organization_members').select('organization_id').eq('user_id', user.id).eq('role', 'manager').limit(1);
    const orgId = (memberships as { organization_id: string }[] | null)?.[0]?.organization_id ?? null;
    setOrganizationId(orgId);
    if (!orgId) { setDrivers([]); setLoading(false); return; }
    const { data } = await supabase.from('organization_members').select('user_id, profiles(full_name)').eq('organization_id', orgId).eq('role', 'driver').eq('status', 'active').order('user_id');
    setDrivers((data as unknown as DriverRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const invite = async (name: string, email: string) => {
    const { data, error } = await supabase.functions.invoke('add-driver', { body: { name, email } });
    if (error) throw new Error(error.message);
    return { temporaryPassword: (data as { temporary_password: string }).temporary_password };
  };

  const finishInvite = async () => {
    setInviting(false);
    await load();
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} hitSlop={8} style={styles.backButton}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Drivers</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Invite driver" onPress={() => setInviting(true)} style={styles.plusButton}>
          <Text style={styles.plusText}>＋</Text>
        </Pressable>
      </View>
      {loading ? <ActivityIndicator style={styles.center} color={colors.gold} size="large" /> : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {drivers.length === 0 ? <Text style={styles.empty}>No drivers yet. Invite your first driver.</Text> : null}
          {drivers.map((driver) => (
            <View key={driver.user_id} style={styles.card}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{(driver.profiles?.full_name ?? 'D')[0]}</Text></View>
              <View style={styles.info}><Text style={styles.name}>{driver.profiles?.full_name ?? 'Driver'}</Text><Text style={styles.role}>Driver</Text></View>
            </View>
          ))}
        </ScrollView>
      )}
      <Modal visible={inviting} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setInviting(false)}>
        <SafeAreaView style={styles.screen}>
          <View style={styles.modalTop}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setInviting(false)} style={styles.backButton}>
              <Text style={styles.closeText}>✕ Close</Text>
            </Pressable>
          </View>
          <DriverInviteForm onInvite={invite} onDone={finishInvite} />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  header: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.forest700, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, gap: 8 },
  backButton: { paddingVertical: 4, paddingRight: 6 },
  backText: { color: colors.gold, fontSize: 32, fontWeight: '700', lineHeight: 34 },
  title: { color: 'white', fontFamily: 'serif', fontSize: 24, fontWeight: '800', flex: 1 },
  plusButton: { backgroundColor: colors.gold, width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  plusText: { color: colors.forest900, fontSize: 20, fontWeight: '900', lineHeight: 22 },
  center: { marginTop: 70 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 60, paddingHorizontal: 30 },
  list: { padding: 16, paddingBottom: 30 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 13, marginBottom: 9 },
  avatar: { width: 42, height: 42, borderRadius: 13, backgroundColor: colors.sage, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.forest700, fontWeight: '900', fontSize: 18 },
  info: { flex: 1 },
  name: { color: colors.ink, fontWeight: '800', fontSize: 15 },
  role: { color: colors.muted, fontSize: 12, marginTop: 2 },
  modalTop: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 6 },
  closeText: { color: colors.forest700, fontWeight: '800' },
});
