import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radii } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';

export default function DriverProfileScreen() {
  const { session } = useAuth();
  const [fullName, setFullName] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!session?.user) return;
      const { data } = await supabase.from('profiles').select('full_name').eq('id', session.user.id).maybeSingle();
      setFullName((data as { full_name: string | null } | null)?.full_name ?? null);
    };
    load();
  }, [session?.user?.id]);

  const signOut = async () => { await supabase.auth.signOut(); };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>PACK & PAWS CLUB · DRIVER</Text>
        <Text style={styles.title}>Profile</Text>
      </View>
      <View style={styles.body}>
        {fullName === null ? <ActivityIndicator style={styles.center} color={colors.gold} size="large" /> : (
          <View style={styles.list}>
            <View style={styles.card}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{(fullName ?? 'D')[0]}</Text></View>
              <View style={styles.info}><Text style={styles.name}>{fullName}</Text><Text style={styles.email}>{session?.user.email}</Text><Text style={styles.role}>Driver</Text></View>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={signOut} style={styles.signOut}>
              <Text style={styles.signOutText}>Sign out</Text>
            </Pressable>
          </View>
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
  list: { padding: 16 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 16 },
  avatar: { width: 54, height: 54, borderRadius: 16, backgroundColor: colors.sage, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.forest700, fontWeight: '900', fontSize: 24 },
  info: { flex: 1 },
  name: { color: colors.ink, fontWeight: '900', fontSize: 17 },
  email: { color: colors.muted, fontSize: 13, marginTop: 3 },
  role: { color: colors.forest700, fontSize: 12, fontWeight: '800', marginTop: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  signOut: { backgroundColor: '#FBEAE6', borderRadius: radii.medium, padding: 15, alignItems: 'center', marginTop: 18 },
  signOutText: { color: colors.urgency, fontWeight: '900', fontSize: 14 },
});
