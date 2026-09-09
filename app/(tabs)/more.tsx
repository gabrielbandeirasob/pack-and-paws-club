import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { colors, radii } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';

export default function MoreScreen() {
  const { session } = useAuth();
  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>PACK & PAWS CLUB</Text>
        <Text style={styles.title}>More</Text>
      </View>
      <View style={styles.list}>
        <Pressable accessibilityRole="button" accessibilityLabel="Drivers" onPress={() => router.push('/drivers')} style={styles.row}>
          <View><Text style={styles.rowTitle}>Drivers</Text><Text style={styles.rowHint}>Invite and manage delivery drivers</Text></View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
        <View style={styles.accountBox}>
          <Text style={styles.rowHint}>Signed in as</Text>
          <Text style={styles.accountEmail}>{session?.user.email}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={signOut} style={styles.signOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  header: { backgroundColor: colors.forest700, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 26, borderBottomLeftRadius: radii.hero, borderBottomRightRadius: radii.hero },
  eyebrow: { color: colors.gold, fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: 'white', fontFamily: 'serif', fontSize: 30, fontWeight: '800', marginTop: 6 },
  list: { padding: 18 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 15, marginBottom: 10 },
  rowTitle: { color: colors.ink, fontWeight: '800', fontSize: 15 },
  rowHint: { color: colors.muted, fontSize: 12, marginTop: 3 },
  chevron: { color: colors.muted, fontSize: 24, fontWeight: '700' },
  accountBox: { backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 15, marginBottom: 14 },
  accountEmail: { color: colors.ink, fontWeight: '800', fontSize: 14, marginTop: 2 },
  signOut: { backgroundColor: '#FBEAE6', borderRadius: radii.medium, padding: 15, alignItems: 'center' },
  signOutText: { color: colors.urgency, fontWeight: '900', fontSize: 14 },
});
