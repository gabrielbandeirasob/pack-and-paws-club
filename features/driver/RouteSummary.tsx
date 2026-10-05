import { StyleSheet, Text, View } from 'react-native';
import type { DriverStop } from './DriverRouteView';
import { paradaDaFaseConcluida, type DayPhase } from './dayPhase';
import { agruparEmTarefas } from './tasks';
import { colors } from '@/features/theme/tokens';

/**
 * PROGRESSO COMPACTO — uma linha só (dono: nada de devotar altura a uma barra vazia).
 * `2 stops · Pick-ups   0/2 ────────────`
 * Mantém o `testID="route-summary"` e o `accessibilityRole="progressbar"` (os testes de
 * acessibilidade usam).
 */
export function RouteSummary({ stops, fase }: { stops: DriverStop[]; fase: DayPhase }) {
  const tasks = agruparEmTarefas(stops);
  const done = tasks.filter(task => task.stops.every(stop => paradaDaFaseConcluida(stop, fase))).length;
  if (!tasks.length) return null;
  return <View testID="route-summary" style={styles.card}>
    <View style={styles.row}>
      <Text style={styles.label}>{tasks.length} stops · {fase === 'pickup' ? 'Pick-ups' : 'Drop-offs'}</Text>
      <Text style={styles.caption}>{done}/{tasks.length}</Text>
      <View accessible accessibilityRole="progressbar" accessibilityLabel="Route progress"
        accessibilityValue={{ min: 0, max: tasks.length, now: done }} style={styles.track}>
        <View style={[styles.fill, { width: `${done / tasks.length * 100}%` }]} />
      </View>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  card: { paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { color: colors.forest900, fontWeight: '700', fontSize: 13 },
  caption: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  track: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.sage, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.forest700 },
});
