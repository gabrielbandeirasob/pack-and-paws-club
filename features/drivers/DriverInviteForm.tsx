import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radii } from '@/features/theme/tokens';

type Props = {
  onInvite: (name: string, email: string) => Promise<{ temporaryPassword: string }>;
  onDone: () => void;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function DriverInviteForm({ onInvite, onDone }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  const submit = async () => {
    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedName || !EMAIL_PATTERN.test(normalizedEmail)) {
      setError('Enter the driver name and a valid email.');
      return;
    }
    setInviting(true);
    setError(null);
    try {
      const result = await onInvite(normalizedName, normalizedEmail);
      setTemporaryPassword(result.temporaryPassword);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to invite the driver.');
    } finally {
      setInviting(false);
    }
  };

  if (temporaryPassword !== null) {
    return (
      <View style={styles.container}>
        <Text style={styles.eyebrow}>DRIVER INVITED</Text>
        <Text style={styles.title}>Share the access</Text>
        <Text style={styles.subtitle}>The driver signs in with this email and the temporary password below. They will choose their own password on first login.</Text>
        <View style={styles.card}>
          <Text style={styles.credentialLabel}>Email</Text>
          <Text style={styles.credentialValue}>{email}</Text>
          <Text style={styles.credentialLabel}>Temporary password</Text>
          <View style={styles.passwordBox}><Text style={styles.passwordText}>{temporaryPassword}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={onDone} style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
            <Text style={styles.primaryText}>Done</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>NEW DRIVER</Text>
        <Text style={styles.title}>Invite a driver</Text>
        <Text style={styles.subtitle}>The driver will access only the routes published to them.</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Name</Text>
          <TextInput accessibilityLabel="Name" autoCapitalize="words" value={name} onChangeText={setName} style={styles.input} />
          <Text style={styles.label}>Email</Text>
          <TextInput accessibilityLabel="Email" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} style={styles.input} placeholder="driver@example.com" />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Invite driver" disabled={inviting} onPress={submit} style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
            {inviting ? <ActivityIndicator color={colors.forest900} /> : <Text style={styles.primaryText}>Invite driver</Text>}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: 22, backgroundColor: colors.cream, flexGrow: 1, justifyContent: 'center' },
  eyebrow: { color: colors.gold, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
  title: { fontFamily: 'serif', fontSize: 30, fontWeight: '800', color: colors.forest900, marginTop: 8 },
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 8, marginBottom: 20 },
  card: { backgroundColor: colors.paper, borderRadius: radii.large, borderWidth: 1, borderColor: colors.line, padding: 20 },
  label: { color: colors.ink, fontWeight: '800', fontSize: 12, marginTop: 12, marginBottom: 7 },
  input: { backgroundColor: '#F4F2EA', borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, color: colors.ink, fontSize: 15 },
  error: { color: colors.urgency, fontSize: 12, fontWeight: '700', marginTop: 12 },
  primary: { backgroundColor: colors.gold, borderRadius: 14, padding: 15, alignItems: 'center', marginTop: 18 },
  pressed: { opacity: 0.85 },
  primaryText: { color: colors.forest900, fontWeight: '900', fontSize: 15 },
  credentialLabel: { color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: 14, marginBottom: 5 },
  credentialValue: { color: colors.ink, fontWeight: '800', fontSize: 15 },
  passwordBox: { backgroundColor: '#FBF6E8', borderWidth: 1, borderColor: '#EADFB8', borderRadius: 10, padding: 12 },
  passwordText: { color: colors.forest900, fontFamily: 'monospace', fontWeight: '800', fontSize: 15 },
});
