import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radii } from '@/features/theme/tokens';

export type TimeGridPickerProps = {
  testID?: string;
  value: string | null;
  onChange: (hhmm: string) => void;
  onDone: () => void;
  stepMinutes?: number;
};

const pad = (value: number) => String(value).padStart(2, '0');

/** Generates 'HH:MM' options from 00:00 to 23:45 (default 15-minute steps). */
export function generateTimes(stepMinutes = 15): string[] {
  const times: string[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += stepMinutes) {
    times.push(`${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`);
  }
  return times;
}

/** Scrollable grid of selectable times — plain React Native, renders everywhere. */
export function TimeGridPicker({ testID, value, onChange, onDone, stepMinutes = 15 }: TimeGridPickerProps) {
  const times = generateTimes(stepMinutes);
  return (
    <View style={styles.box} testID={testID}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
        {times.map((time) => {
          const active = time === value;
          return (
            <Pressable
              key={time}
              accessibilityRole="button"
              accessibilityLabel={time}
              onPress={() => onChange(time)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{time}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={onDone} style={styles.doneButton}>
        <Text style={styles.doneText}>Done</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 10, marginTop: 8 },
  scroll: { maxHeight: 190 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 2 },
  chip: { backgroundColor: '#F4F2EA', borderWidth: 1, borderColor: colors.line, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8, minWidth: 70, alignItems: 'center' },
  chipActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.ink, fontWeight: '800', fontSize: 13, fontVariant: ['tabular-nums'] },
  chipTextActive: { color: colors.forest900 },
  doneButton: { backgroundColor: colors.gold, borderRadius: 12, padding: 10, alignItems: 'center', marginTop: 8 },
  doneText: { color: colors.forest900, fontWeight: '900', fontSize: 14 },
});
