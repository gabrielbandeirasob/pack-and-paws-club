import { Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

import { colors, radii } from '@/features/theme/tokens';
import type { TimePickerProps } from '@/features/dispatch/timeFormat';
import { parseTime, toHHMM } from '@/features/dispatch/timeFormat';

/** Native implementation: iOS-style time spinner (5-minute steps). */
export function TimePicker({ testID, value, onChange, onDone }: TimePickerProps) {
  return (
    <View style={styles.box}>
      <DateTimePicker
        testID={testID}
        value={parseTime(value)}
        mode="time"
        display="spinner"
        minuteInterval={5}
        onChange={(_event: unknown, date?: Date) => {
          if (date) onChange(toHHMM(date));
        }}
      />
      <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={onDone} style={styles.doneButton}>
        <Text style={styles.doneText}>Done</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 8, marginTop: 8 },
  doneButton: { backgroundColor: colors.gold, borderRadius: 12, padding: 10, alignItems: 'center', marginTop: 6 },
  doneText: { color: colors.forest900, fontWeight: '900', fontSize: 14 },
});
