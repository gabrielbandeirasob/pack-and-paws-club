import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii } from '@/features/theme/tokens';

type Props = {
  pendingStops: number;
  busy: boolean;
  hasLocation: boolean;
  onOptimize: () => Promise<void> | void;
};

/** Ação do motorista para recalcular as coletas a partir do GPS do aparelho. */
export function DriverRouteOptimizerCard({ pendingStops, busy, hasLocation, onOptimize }: Props) {
  const disabled = busy || pendingStops < 2;
  return (
    <View style={styles.card}>
      <View style={styles.copy}>
        <Text style={styles.eyebrow}>SMART ROUTE</Text>
        <Text style={styles.title}>Start from where you are</Text>
        <Text style={styles.body}>
          Optimize {pendingStops} pending pickup{pendingStops === 1 ? '' : 's'} from your live location.
        </Text>
        {!hasLocation ? <Text style={styles.gps}>GPS will be requested when you tap.</Text> : null}
      </View>
      <Pressable
        accessibilityLabel="Optimize route from my location"
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => void onOptimize()}
        style={({ pressed }) => [styles.button, disabled && styles.buttonDisabled, pressed && !disabled && styles.buttonPressed]}
      >
        {busy ? <ActivityIndicator color={colors.forest900} /> : <Text style={styles.buttonText}>Optimize from here</Text>}
        {busy ? <Text style={styles.buttonText}>Optimizing…</Text> : null}
      </Pressable>
      {pendingStops < 2 ? <Text style={styles.done}>The remaining route is already set.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.paper,
    borderRadius: radii.medium,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    marginBottom: 12,
  },
  copy: { marginBottom: 12 },
  eyebrow: { color: colors.gold, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  title: { color: colors.forest900, fontFamily: 'serif', fontSize: 18, fontWeight: '800', marginTop: 3 },
  body: { color: colors.ink, fontSize: 12, lineHeight: 18, marginTop: 4 },
  gps: { color: '#8A6D1F', fontSize: 11, fontWeight: '800', marginTop: 5 },
  button: { backgroundColor: colors.gold, borderRadius: 12, minHeight: 45, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: colors.forest900, fontSize: 13, fontWeight: '900' },
  done: { color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: 8 },
});
