import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { colors, radii } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { useOrganizationRole } from '@/features/auth/useOrganizationRole';

export default function AccountProfileScreen() {
  const { session } = useAuth();
  const { role } = useOrganizationRole();
  const [fullName, setFullName] = useState<string | null>(null);
  /**
   * O papel é o do VÍNCULO ativo (`organization_members.role`), não um rótulo fixo: até 25/09/2026 a tela
   * escrevia "DRIVER" na mão e o GESTOR via "PACK & PAWS CLUB · DRIVER" no próprio perfil (achado da
   * revisão das contas). Enquanto o papel não chega, o cabeçalho não afirma nada.
   */
  const papel = role === 'manager' ? 'Manager' : role === 'driver' ? 'Driver' : 'Account';
  const [membroDesde, setMembroDesde] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!session?.user) return;
      const { data } = await supabase.from('profiles').select('full_name').eq('id', session.user.id).maybeSingle();
      setFullName((data as { full_name: string | null } | null)?.full_name ?? null);

      // Desde quando a conta existe na organização (o vínculo, não o login): melhoria 4 da revisão das
      // contas — o perfil vira a "carteira de trabalho" da pessoa, não só nome e e-mail.
      const { data: vinculo } = await supabase
        .from('organization_members')
        .select('created_at')
        .eq('user_id', session.user.id)
        .eq('status', 'active')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      const desde = (vinculo as { created_at: string | null } | null)?.created_at ?? null;
      setMembroDesde(desde
        ? new Date(desde).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
        : null);
    };
    load();
  }, [session?.user?.id]);

  const signOut = async () => { await supabase.auth.signOut(); };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>PACK & PAWS CLUB · {papel.toUpperCase()}</Text>
        <Text style={styles.title}>Profile</Text>
      </View>
      <View style={styles.body}>
        {fullName === null ? <ActivityIndicator style={styles.center} color={colors.gold} size="large" /> : (
          <View style={styles.list}>
            <View style={styles.card}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{(fullName ?? 'D')[0]}</Text></View>
              <View style={styles.info}><Text style={styles.name}>{fullName}</Text><Text style={styles.email}>{session?.user.email}</Text><Text style={styles.role}>{papel}</Text>{membroDesde ? <Text style={styles.desde}>Member since {membroDesde}</Text> : null}</View>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Change password" onPress={() => router.push('/password')} style={styles.changePassword}>
              <Text style={styles.changePasswordText}>Change password</Text>
            </Pressable>
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
  desde: { color: colors.muted, fontSize: 11, marginTop: 4 },
  signOut: { backgroundColor: '#FBEAE6', borderRadius: radii.medium, padding: 15, alignItems: 'center', marginTop: 18 },
  changePassword: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: radii.medium, padding: 15, alignItems: 'center', marginTop: 18 },
  changePasswordText: { color: colors.forest700, fontWeight: '900', fontSize: 14 },
  signOutText: { color: colors.urgency, fontWeight: '900', fontSize: 14 },
});
