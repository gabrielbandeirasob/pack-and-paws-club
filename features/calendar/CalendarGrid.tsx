import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii } from '@/features/theme/tokens';
import type { DayCounts, MonthCell } from '@/features/calendar/gridMath';

export const CALENDAR_WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const DAYCARE_DOT = '#C7A75C';
export const BOARDING_DOT = '#4E8D5C';

type Props = {
  rows: MonthCell[][];
  counts: Record<string, DayCounts>;
  selectedDate: string | null;
  onSelectDate: (isoDate: string) => void;
};

function cellCountLabel(cell: string, counts: Record<string, DayCounts>): string {
  const day = counts[cell];
  if (!day || (day.daycare === 0 && day.boarding === 0)) return 'no care';
  const parts: string[] = [];
  if (day.daycare > 0) parts.push(`${day.daycare} daycare`);
  if (day.boarding > 0) parts.push(`${day.boarding} boarding`);
  return parts.join(' · ');
}

export function CalendarGrid({ rows, counts, selectedDate, onSelectDate }: Props) {
  return (
    <View>
      <View style={styles.weekRow} accessibilityRole="none">
        {CALENDAR_WEEKDAY_LABELS.map((label) => (
          <View key={label} style={styles.weekCell}>
            <Text style={styles.weekLabel}>{label}</Text>
          </View>
        ))}
      </View>
      {rows.map((week, weekIndex) => (
        <View key={weekIndex} style={styles.weekRow}>
          {week.map((cell, dayIndex) => {
            if (!cell) return <View key={`${weekIndex}-${dayIndex}`} style={styles.dayCell} />;
            const day = Number(cell.slice(-2));
            const summary = counts[cell];
            const selected = cell === selectedDate;
            return (
              <Pressable
                key={cell}
                accessibilityRole="button"
                accessibilityLabel={`Select ${cell} · ${cellCountLabel(cell, counts)}`}
                onPress={() => onSelectDate(cell)}
                style={[styles.dayCell, selected && styles.dayCellSelected]}
              >
                <View style={[styles.dayNumber, selected && styles.dayNumberSelected]}>
                  <Text style={[styles.dayNumberText, selected && styles.dayNumberTextSelected]}>{day}</Text>
                </View>
                <View style={styles.dotsRow}>
                  {(summary?.daycare ?? 0) > 0 ? <View style={[styles.dot, { backgroundColor: DAYCARE_DOT }]} /> : <View style={styles.dotPlaceholder} />}
                  {(summary?.boarding ?? 0) > 0 ? <View style={[styles.dot, { backgroundColor: BOARDING_DOT }]} /> : <View style={styles.dotPlaceholder} />}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  weekRow: { flexDirection: 'row' },
  weekCell: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  weekLabel: { color: colors.muted, fontWeight: '800', fontSize: 11, textTransform: 'uppercase' },
  dayCell: {
    flex: 1,
    aspectRatio: 1,
    margin: 2,
    borderRadius: radii.small,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    backgroundColor: colors.paper,
  },
  dayCellSelected: { borderColor: colors.gold, backgroundColor: '#F4EDDC' },
  dayNumber: { minWidth: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dayNumberSelected: { backgroundColor: colors.forest700 },
  dayNumberText: { color: colors.ink, fontWeight: '800', fontSize: 13 },
  dayNumberTextSelected: { color: 'white' },
  dotsRow: { flexDirection: 'row', gap: 3 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotPlaceholder: { width: 6, height: 6 },
});
