import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDayLabel, todayLocalISO } from '@/features/calendar/dates';
import { CalendarGrid } from '@/features/calendar/CalendarGrid';
import { addMonthsISO, monthLabel, monthMatrixISO } from '@/features/calendar/gridMath';
import { colors, radii } from '@/features/theme/tokens';

type Props = {
  label: string;
  value: string | null;
  onChange: (isoDate: string) => void;
};

/** Date field that expands an inline month calendar to pick a day. */
export function DateField({ label, value, onChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [monthAnchor, setMonthAnchor] = useState(value || todayLocalISO());

  const openPicker = () => {
    setMonthAnchor(value || todayLocalISO());
    setExpanded((current) => !current);
  };

  const pick = (isoDate: string) => {
    onChange(isoDate);
    setExpanded(false);
  };

  const matrix = monthMatrixISO(monthAnchor);

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={openPicker} style={styles.field}>
        <Text style={[styles.value, !value && styles.placeholder]}>{value ? formatDayLabel(value) : 'Select a date…'}</Text>
        <Text style={styles.expandIcon}>{expanded ? '▴' : '▾'}</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.picker}>
          <View style={styles.pickerHeader}>
            <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => setMonthAnchor((month) => addMonthsISO(month, -1))} style={styles.monthArrow}>
              <Text style={styles.monthArrowText}>‹</Text>
            </Pressable>
            <Text style={styles.monthTitle}>{monthLabel(monthAnchor)}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => setMonthAnchor((month) => addMonthsISO(month, 1))} style={styles.monthArrow}>
              <Text style={styles.monthArrowText}>›</Text>
            </Pressable>
          </View>
          <CalendarGrid rows={matrix.weeks} counts={{}} selectedDate={value} onSelectDate={pick} />
          <Pressable accessibilityRole="button" accessibilityLabel="Close date picker" onPress={() => setExpanded(false)} style={styles.doneButton}>
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.ink, fontWeight: '800', fontSize: 12, marginTop: 16, marginBottom: 7 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F4F2EA',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  value: { color: colors.ink, fontSize: 15, fontWeight: '700', textTransform: 'capitalize' },
  placeholder: { color: colors.muted, fontWeight: '400', textTransform: 'none' },
  expandIcon: { color: colors.muted, fontSize: 14, fontWeight: '800' },
  picker: { backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 10, marginTop: 8 },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, paddingHorizontal: 4 },
  monthArrow: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  monthArrowText: { color: colors.forest700, fontSize: 28, fontWeight: '700', lineHeight: 30 },
  monthTitle: { color: colors.forest900, fontFamily: 'serif', fontWeight: '800', fontSize: 17, textTransform: 'capitalize' },
  doneButton: { backgroundColor: colors.gold, borderRadius: 12, padding: 10, alignItems: 'center', marginTop: 8 },
  doneText: { color: colors.forest900, fontWeight: '900', fontSize: 14 },
});
