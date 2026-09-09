import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radii } from '@/features/theme/tokens';
import type { NewClientInput } from '@/features/clients/types';

type Props = {
  initial: NewClientInput;
  onSave: (payload: { client: NewClientInput; dogs: string[] }) => Promise<void>;
  onCancel: () => void;
};

export function AddClientReview({ initial, onSave, onCancel }: Props) {
  const [dogName, setDogName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const addressLine = [initial.address_line_1, initial.city].filter(Boolean).join(' · ');
  const submit = async () => {
    if (!dogName.trim()) {
      setError('Enter the dog name to add this client.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({ client: initial, dogs: [dogName.trim()] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save the client.');
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>ADD FROM CONTACTS</Text>
        <Text style={styles.title}>Review client</Text>
        <View style={styles.card}>
          <Text style={styles.clientName}>{initial.name}</Text>
          <Text style={styles.muted}>{initial.phone || 'No phone number'}</Text>
          {addressLine ? <Text style={styles.muted}>{addressLine}</Text> : null}
          {initial.pickup_access_instructions ? (
            <View style={styles.instructions}>
              <Text style={styles.instructionsLabel}>PICKUP / ACCESS INSTRUCTIONS</Text>
              <Text style={styles.instructionsText}>{initial.pickup_access_instructions}</Text>
            </View>
          ) : null}
          <Text style={styles.label}>Dog name</Text>
          <TextInput accessibilityLabel="Dog name" autoCapitalize="words" returnKeyType="done" value={dogName} onChangeText={setDogName} style={styles.input} placeholder="e.g. Bob" />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Add as client" disabled={saving} onPress={submit} style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
            {saving ? <ActivityIndicator color={colors.forest900} /> : <Text style={styles.primaryText}>Add as client</Text>}
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel" disabled={saving} onPress={onCancel} style={styles.cancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: 22, backgroundColor: colors.cream, flexGrow: 1 },
  eyebrow: { color: colors.gold, fontSize: 11, fontWeight: '900', letterSpacing: 1.5, marginTop: 12 },
  title: { fontFamily: 'serif', fontSize: 30, fontWeight: '800', color: colors.forest900, marginTop: 8, marginBottom: 18 },
  card: { backgroundColor: colors.paper, borderRadius: radii.large, borderWidth: 1, borderColor: colors.line, padding: 20 },
  clientName: { fontFamily: 'serif', fontSize: 22, fontWeight: '800', color: colors.forest900 },
  muted: { color: colors.muted, fontSize: 13, marginTop: 4 },
  instructions: { backgroundColor: '#FBF6E8', borderRadius: 12, borderWidth: 1, borderColor: '#EADFB8', padding: 12, marginTop: 14 },
  instructionsLabel: { color: '#8A6D1F', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  instructionsText: { color: colors.ink, fontSize: 13, lineHeight: 19, marginTop: 4 },
  label: { color: colors.ink, fontWeight: '800', fontSize: 12, marginTop: 18, marginBottom: 7 },
  input: { backgroundColor: '#F4F2EA', borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, color: colors.ink, fontSize: 15 },
  error: { color: colors.urgency, fontSize: 12, fontWeight: '700', marginTop: 12 },
  primary: { backgroundColor: colors.gold, borderRadius: 14, padding: 15, alignItems: 'center', marginTop: 18 },
  pressed: { opacity: 0.85 },
  primaryText: { color: colors.forest900, fontWeight: '900', fontSize: 15 },
  cancel: { alignItems: 'center', padding: 12, marginTop: 6 },
  cancelText: { color: colors.muted, fontWeight: '800' },
});
