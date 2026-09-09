import { useState } from 'react';
import { ActivityIndicator, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radii } from '@/features/theme/tokens';

type Props = {
  initialEmail?: string;
  onSignIn: (email: string, password: string) => Promise<void>;
};

export function LoginForm({ initialEmail = '', onSignIn }: Props) {
  const [email, setEmail] = useState(initialEmail.trim());
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      setError('Enter your email and password.');
      return;
    }
    setLoading(true);
    setError(null);
    Keyboard.dismiss();
    try {
      await onSignIn(normalizedEmail, password);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}>
        <View style={styles.brand}>
          <Image source={require('../../assets/images/pack-paws-logo.jpg')} style={styles.logo} />
          <Text style={styles.eyebrow}>PACK & PAWS CLUB</Text>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Sign in to manage today&apos;s care and routes.</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.label}>Email</Text>
          <TextInput accessibilityLabel="Email" autoCapitalize="none" autoComplete="email" keyboardType="email-address" returnKeyType="next" value={email} onChangeText={setEmail} style={styles.input} />
          <Text style={styles.label}>Password</Text>
          <TextInput accessibilityLabel="Password" autoCapitalize="none" autoComplete="current-password" secureTextEntry returnKeyType="done" onSubmitEditing={submit} value={password} onChangeText={setPassword} style={styles.input} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Sign in" disabled={loading} onPress={submit} style={({ pressed }) => [styles.button, pressed && styles.pressed, loading && styles.disabled]}>
            {loading ? <ActivityIndicator color={colors.forest900} /> : <Text style={styles.buttonText}>Sign in</Text>}
          </Pressable>
          <Text style={styles.help}>Access is limited to invited Pack & Paws team members.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', backgroundColor: colors.cream, padding: 22 },
  brand: { alignItems: 'center', marginBottom: 24 },
  logo: { width: 82, height: 82, borderRadius: 23, borderWidth: 1, borderColor: colors.gold, marginBottom: 18 },
  eyebrow: { color: colors.gold, fontSize: 11, fontWeight: '900', letterSpacing: 1.7 },
  title: { fontFamily: 'serif', color: colors.forest900, fontSize: 34, fontWeight: '800', marginTop: 10 },
  subtitle: { color: colors.muted, fontSize: 14, textAlign: 'center', marginTop: 7 },
  card: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: radii.large, padding: 20 },
  label: { color: colors.ink, fontSize: 12, fontWeight: '800', marginBottom: 7, marginTop: 9 },
  input: { backgroundColor: '#F4F2EA', borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, color: colors.ink, fontSize: 15 },
  error: { color: colors.urgency, fontSize: 12, fontWeight: '700', marginTop: 12 },
  button: { backgroundColor: colors.gold, borderRadius: 14, padding: 15, alignItems: 'center', marginTop: 18 },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.6 },
  buttonText: { color: colors.forest900, fontWeight: '900', fontSize: 15 },
  help: { color: colors.muted, fontSize: 11, textAlign: 'center', lineHeight: 16, marginTop: 14 },
});
