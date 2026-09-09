import { Text, TextInput, View, StyleSheet } from 'react-native';

import { colors } from '@/features/theme/tokens';

export type TimeFieldProps = {
  label: string;
  accessibilityLabel: string;
  value: string | null;
  onChange: (hhmm: string) => void;
  testID?: string;
};

/** Web-safe base implementation: manual HH:MM input. The native build uses a time spinner. */
export function TimeField({ label, accessibilityLabel, value, onChange, testID }: TimeFieldProps) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        keyboardType="numbers-and-punctuation"
        placeholder="HH:MM"
        value={value ?? ''}
        onChangeText={(text) => onChange(text.replace(/[^0-9:]/g, ''))}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.ink, fontWeight: '800', fontSize: 11, marginTop: 12, marginBottom: 6 },
  input: {
    backgroundColor: '#F4F2EA',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: colors.ink,
    fontSize: 15,
  },
});
