import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { router } from 'expo-router';

import { colors, radii } from '@/features/theme/tokens';
import { appVersionLabel, supportMailUrl } from '@/features/common/support';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';

export default function MoreScreen() {
  const { session } = useAuth();
  const version = appVersionLabel({
    version: Constants.expoConfig?.version,
    build: Constants.expoConfig?.ios?.buildNumber,
  });
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
        <Pressable accessibilityRole="button" accessibilityLabel="Team" onPress={() => router.push('/drivers')} style={styles.row}>
          <View><Text style={styles.rowTitle}>Team</Text><Text style={styles.rowHint}>Invite drivers and managers, and remove whoever left</Text></View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Route history" onPress={() => router.push('/route-history')} style={styles.row}>
          <View><Text style={styles.rowTitle}>Route history</Text><Text style={styles.rowHint}>Past routes, what was done and what was missed</Text></View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Change password" onPress={() => router.push('/password')} style={styles.row}>
          <View><Text style={styles.rowTitle}>Change password</Text><Text style={styles.rowHint}>Set a new password for your account</Text></View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Help and support"
          onPress={() => void Linking.openURL(supportMailUrl({ version: Constants.expoConfig?.version, build: Constants.expoConfig?.ios?.buildNumber, platform: Platform.OS, email: session?.user.email }))}
          style={styles.row}
        >
          <View><Text style={styles.rowTitle}>Help & support</Text><Text style={styles.rowHint}>Send us a message — the app version and your account go along</Text></View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
        <View style={styles.accountBox}>
          <Text style={styles.rowHint}>Signed in as</Text>
          <Text style={styles.accountEmail}>{session?.user.email}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={signOut} style={styles.signOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
        <Text style={styles.version}>Pack & Paws Club · version {version}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.forest700 },
  header: { backgroundColor: colors.forest700, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 26, borderBottomLeftRadius: radii.hero, borderBottomRightRadius: radii.hero },
  eyebrow: { color: colors.gold, fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: 'white', fontFamily: 'serif', fontSize: 30, fontWeight: '800', marginTop: 6 },
  list: { flex: 1, padding: 18, backgroundColor: colors.cream },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 15, marginBottom: 10 },
  rowTitle: { color: colors.ink, fontWeight: '800', fontSize: 15 },
  rowHint: { color: colors.muted, fontSize: 12, marginTop: 3 },
  chevron: { color: colors.muted, fontSize: 24, fontWeight: '700' },
  accountBox: { backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 15, marginBottom: 14 },
  accountEmail: { color: colors.ink, fontWeight: '800', fontSize: 14, marginTop: 2 },
  signOut: { backgroundColor: '#FBEAE6', borderRadius: radii.medium, padding: 15, alignItems: 'center' },
  signOutText: { color: colors.urgency, fontWeight: '900', fontSize: 14 },
  version: { color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: 16 },
});
