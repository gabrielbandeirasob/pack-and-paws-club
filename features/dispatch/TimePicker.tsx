import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radii } from '@/features/theme/tokens';
import type { TimePickerProps } from '@/features/dispatch/timeFormat';

export type { TimePickerProps } from '@/features/dispatch/timeFormat';

/** Web-safe base: manual HH:MM input + Done. The native build uses a time spinner. */
export function TimePicker({ testID, value, onChange, onDone }: TimePickerProps) {
  return (
    <View style={styles.box}>
      <TextInput
        testID={testID}
        accessibilityLabel="Time value"
        keyboardType="numbers-and-punctuation"
        placeholder="HH:MM"
        value={value ?? ''}
        onChangeText={(text) => onChange(text.replace(/[^0-9:]/g, ''))}
        style={styles.input}
      />
      <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={onDone} style={styles.doneButton}>
        <Text style={styles.doneText}>Done</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 10, marginTop: 8 },
  input: { backgroundColor: '#F4F2EA', borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, color: colors.ink, fontSize: 15 },
  doneButton: { backgroundColor: colors.gold, borderRadius: 12, padding: 10, alignItems: 'center', marginTop: 10 },
  doneText: { color: colors.forest900, fontWeight: '900', fontSize: 14 },
});
