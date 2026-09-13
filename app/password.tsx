/**
 * Troca de senha por vontade propria (dentro do app, logado).
 *
 * O app so tinha a tela de senha do PRIMEIRO acesso (quando o motorista e convidado com
 * senha provisoria): depois de trocar uma vez, a rota ficava fora do ar e nao havia mais
 * como trocar a senha de dentro do app — nem pelo gestor, nem pelo motorista.
 * Esta tela existe para isso. A tela do primeiro acesso continua sendo a "change-password".
 */
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { ChangePasswordForm } from '@/features/auth/ChangePasswordForm';
import { colors, radii } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';

export default function PasswordScreen() {
  const change = async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password, data: { must_change_password: false } });
    if (error) throw new Error(error.message);
    // Deu certo: volta para onde o usuario estava (More ou Profile).
    if (router.canGoBack()) router.back();
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>PACK & PAWS CLUB</Text>
        <Text style={styles.title}>Change password</Text>
      </View>
      <ChangePasswordForm
        onChangePassword={change}
        eyebrow="YOUR ACCOUNT"
        title="Change your password"
        subtitle="Pick a new password for this account. You stay signed in on this device."
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.forest700 },
  header: { backgroundColor: colors.forest700, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 26, borderBottomLeftRadius: radii.hero, borderBottomRightRadius: radii.hero },
  eyebrow: { color: colors.gold, fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: 'white', fontFamily: 'serif', fontSize: 28, fontWeight: '800', marginTop: 6 },
});
