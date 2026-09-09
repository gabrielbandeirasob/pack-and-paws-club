import { useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radii } from '@/features/theme/tokens';

type Props = { onChangePassword: (password: string) => Promise<void> };

export function ChangePasswordForm({ onChangePassword }: Props) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    if (password.length < 12 || password !== confirmation) {
      setError('Use at least 12 characters and enter the same password twice.');
      return;
    }
    setLoading(true);
    setError(null);
    Keyboard.dismiss();
    try {
      await onChangePassword(password);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update password.');
    } finally {
      setLoading(false);
    }
  };
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}>
        <View style={styles.heading}>
          <Text style={styles.eyebrow}>SECURE YOUR ACCOUNT</Text>
          <Text style={styles.title}>Choose a new password</Text>
          <Text style={styles.subtitle}>Your password must be replaced before accessing client information.</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.label}>New password</Text>
          <TextInput accessibilityLabel="New password" secureTextEntry autoCapitalize="none" returnKeyType="next" value={password} onChangeText={setPassword} style={styles.input} />
          <Text style={styles.label}>Confirm new password</Text>
          <TextInput accessibilityLabel="Confirm new password" secureTextEntry autoCapitalize="none" returnKeyType="done" onSubmitEditing={submit} value={confirmation} onChangeText={setConfirmation} style={styles.input} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Save new password" disabled={loading} onPress={submit} style={styles.button}>
            {loading ? <ActivityIndicator color={colors.forest900} /> : <Text style={styles.buttonText}>Save new password</Text>}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', backgroundColor: colors.cream, padding: 22 },
  heading: { alignItems: 'center', marginBottom: 24 },
  eyebrow: { color: colors.gold, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
  title: { fontFamily: 'serif', fontSize: 32, fontWeight: '800', color: colors.forest900, marginTop: 10, textAlign: 'center' },
  subtitle: { color: colors.muted, lineHeight: 21, marginTop: 8, textAlign: 'center' },
  card: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: radii.large, padding: 20 },
  label: { color: colors.ink, fontWeight: '800', fontSize: 12, marginTop: 9, marginBottom: 7 },
  input: { backgroundColor: '#F4F2EA', borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, color: colors.ink },
  error: { color: colors.urgency, fontSize: 12, fontWeight: '700', marginTop: 12 },
  button: { backgroundColor: colors.gold, borderRadius: 14, padding: 15, alignItems: 'center', marginTop: 18 },
  buttonText: { color: colors.forest900, fontWeight: '900' },
});
