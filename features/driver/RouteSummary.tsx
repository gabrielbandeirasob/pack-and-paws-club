import { StyleSheet, Text, View } from 'react-native';
import type { DriverStop } from './DriverRouteView';
import { paradaDaFaseConcluida, type DayPhase } from './dayPhase';
import { agruparEmTarefas } from './tasks';
import { colors } from '@/features/theme/tokens';

/** Conta endereços agrupados; um grupo só fecha quando todos os cães foram resolvidos. */
export function RouteSummary({ stops, fase }: { stops: DriverStop[]; fase: DayPhase }) {
  const tasks = agruparEmTarefas(stops);
  const done = tasks.filter(task => task.stops.every(stop => paradaDaFaseConcluida(stop, fase))).length;
  if (!tasks.length) return null;
  return <View testID="route-summary" style={styles.card}>
    <View style={styles.row}>
      <Text style={styles.label}>{tasks.length} Stops · {fase === 'pickup' ? 'Pick-ups' : 'Drop-offs'}</Text>
      <Text style={styles.caption}>{done} of {tasks.length} completed</Text>
    </View>
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Route progress"
      accessibilityValue={{ min: 0, max: tasks.length, now: done }} style={styles.track}>
      <View style={[styles.fill, { width: `${done / tasks.length * 100}%` }]} />
    </View>
  </View>;
}
const styles = StyleSheet.create({
  card: { paddingVertical: 16, gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  label: { color: colors.forest900, fontWeight: '700', fontSize: 14 },
  caption: { color: colors.muted, fontSize: 12 },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.sage, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.forest700 },
});
