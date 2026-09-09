import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

import { colors, radii } from '@/features/theme/tokens';
import type { TimeFieldProps } from '@/features/dispatch/TimeField';
import { parseTime, toHHMM } from '@/features/dispatch/timeFormat';

/** Native implementation: expands an iOS-style time spinner (5-minute steps). */
export function TimeField({ label, accessibilityLabel, value, onChange, testID }: TimeFieldProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={() => setExpanded((current) => !current)} style={styles.field}>
        <Text style={[styles.value, !value && styles.placeholder]}>{value ?? 'Select time…'}</Text>
        <Text style={styles.expandIcon}>{expanded ? '▴' : '▾'}</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.pickerBox}>
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
          <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={() => setExpanded(false)} style={styles.doneButton}>
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.ink, fontWeight: '800', fontSize: 11, marginTop: 12, marginBottom: 6 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F4F2EA',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  value: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  placeholder: { color: colors.muted, fontWeight: '400' },
  expandIcon: { color: colors.muted, fontSize: 14, fontWeight: '800' },
  pickerBox: { backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 8, marginTop: 8 },
  doneButton: { backgroundColor: colors.gold, borderRadius: 12, padding: 10, alignItems: 'center', marginTop: 6 },
  doneText: { color: colors.forest900, fontWeight: '900', fontSize: 14 },
});
