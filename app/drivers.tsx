import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { DriverInviteForm } from '@/features/drivers/DriverInviteForm';
import { fullNameOrFallback, isActiveStatus, memberStatusFromActive, memberStatusLabel } from '@/features/drivers/driversService';
import { colors, radii } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';

type DriverRow = { user_id: string; status: string; profiles: { full_name: string | null } | null };

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
    const { data } = await supabase.from('organization_members').select('user_id, status, profiles(full_name)').eq('organization_id', orgId).eq('role', 'driver').order('status');
    setDrivers((data as unknown as DriverRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const [editing, setEditing] = useState<DriverRow | null>(null);
  const [editName, setEditName] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const openDriver = (driver: DriverRow) => {
    setEditing(driver);
    setEditName(driver.profiles?.full_name ?? '');
    setEditActive(isActiveStatus(driver.status));
  };

  const saveDriver = async () => {
    if (!editing || !organizationId) return;
    const name = editName.trim();
    if (name.length === 0) { Alert.alert('Name required', 'Give the driver a name.'); return; }
    setSaving(true);
    const { error: profileError } = await supabase.from('profiles').update({ full_name: name }).eq('id', editing.user_id);
    const { error: memberError } = await supabase
      .from('organization_members')
      .update({ status: memberStatusFromActive(editActive) })
      .eq('organization_id', organizationId)
      .eq('user_id', editing.user_id);
    setSaving(false);
    if (profileError || memberError) { Alert.alert('Could not save', (profileError ?? memberError)?.message ?? 'Unknown error'); return; }
    setEditing(null);
    await load();
  };

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
        <ScrollView automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never" contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {drivers.length === 0 ? <Text style={styles.empty}>No drivers yet. Invite your first driver.</Text> : null}
          {drivers.map((driver) => (
            <Pressable key={driver.user_id} accessibilityRole="button" accessibilityLabel={`Edit ${fullNameOrFallback(driver.profiles?.full_name)}`} onPress={() => openDriver(driver)} style={({ pressed }) => [styles.card, pressed && styles.pressedCard]}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{(driver.profiles?.full_name ?? 'D')[0]}</Text></View>
              <View style={styles.info}>
                <Text style={styles.name}>{fullNameOrFallback(driver.profiles?.full_name)}</Text>
                <Text style={[styles.role, driver.status !== 'active' && styles.roleOff]}>{memberStatusLabel(driver.status)}</Text>
              </View>
              <Text style={styles.chev}>Edit ›</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      <Modal visible={editing !== null} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setEditing(null)}>
        <SafeAreaView style={styles.screen} edges={['top']}>
          <View style={styles.modalTop}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setEditing(null)} style={styles.backButton}>
              <Text style={styles.closeText}>✕ Close</Text>
            </Pressable>
          </View>
          <Text style={styles.modalTitle}>Edit driver</Text>
          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput accessibilityLabel="Driver name" value={editName} onChangeText={setEditName} autoCapitalize="words" placeholderTextColor={colors.muted} style={styles.input} />
          <View style={styles.switchRow}>
            <View style={styles.switchTextBlock}>
              <Text style={styles.switchLabel}>Active</Text>
              <Text style={styles.switchHint}>A disabled driver keeps the history but can no longer be assigned to routes.</Text>
            </View>
            <Switch value={editActive} onValueChange={setEditActive} />
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Save driver" disabled={saving} onPress={() => void saveDriver()} style={({ pressed }) => [styles.saveButton, pressed && styles.pressedCard, saving && styles.disabled]}>
            <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save driver'}</Text>
          </Pressable>
        </SafeAreaView>
      </Modal>

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
  pressedCard: { opacity: 0.7 },
  roleOff: { color: colors.urgency, fontWeight: '700' },
  chev: { color: colors.gold, fontWeight: '800', fontSize: 12 },
  modalTitle: { fontFamily: 'serif', fontSize: 24, fontWeight: '800', color: colors.forest900, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14 },
  fieldLabel: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.4, marginHorizontal: 20, marginBottom: 5 },
  input: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11, color: colors.ink, fontSize: 15, marginHorizontal: 20 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginHorizontal: 20, gap: 14 },
  switchTextBlock: { flex: 1 },
  switchLabel: { color: colors.ink, fontWeight: '800', fontSize: 15 },
  switchHint: { color: colors.muted, fontSize: 12, marginTop: 3, lineHeight: 17 },
  saveButton: { backgroundColor: colors.gold, borderRadius: 14, padding: 15, alignItems: 'center', marginTop: 22, marginHorizontal: 20 },
  saveText: { color: colors.forest900, fontWeight: '900', fontSize: 15 },
  disabled: { opacity: 0.6 },
});
