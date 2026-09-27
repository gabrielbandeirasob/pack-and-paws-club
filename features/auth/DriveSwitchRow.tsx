/**
 * INTERRUPTOR "Drive today" — gestor ↔ motorista (áudio do dono, 27/09/2026):
 *
 * "todo administrador consegue ser, se ele quiser ou tiver necessidade de ser um driver, e na conta do
 * administrador ele consegue ter tipo um switch on and off que muda entre a dashboard do
 * administrador para a dashboard do driver, tipo o alarme do iPhone… porque o administrador também
 * faz os pick-ups e drop-off, então para o administrador não tem que ficar deslogando e logando".
 *
 * O que ele faz: troca a VISÃO (as abas) e leva para a tela do novo papel. O vínculo no banco não
 * muda, a sessão não é refeita e quem é motorista não vê este interruptor.
 */
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';

import { useOrganizationRole } from '@/features/auth/useOrganizationRole';
import { colors, radii } from '@/features/theme/tokens';

export function DriveSwitchRow() {
  const { view, canSwitchView, setView } = useOrganizationRole();

  // Motorista não troca de visão: o interruptor é do gestor (mão única, regra do módulo puro).
  if (!canSwitchView) return null;

  const dirigindo = view === 'driver';

  return (
    <View style={styles.row}>
      <View style={styles.texts}>
        <Text style={styles.title}>Drive today</Text>
        <Text style={styles.hint}>
          {dirigindo
            ? 'You are seeing the driver app. Turn off to go back to the office view.'
            : 'Turn on to see the driver app with your own route — no need to sign out.'}
        </Text>
      </View>
      <Switch
        accessibilityLabel="Drive today"
        value={dirigindo}
        onValueChange={(ligado) => {
          setView(ligado ? 'driver' : 'manager');
          router.replace(ligado ? '/(tabs)/driver' : '/(tabs)/index');
        }}
        trackColor={{ false: colors.line, true: colors.forest700 }}
        thumbColor={colors.paper}
      />
    </View>
  );
}

/** Linha do gestor que já dirige: leva direto para a visão de motorista (atalho do "More"). */
export function DriveSwitchShortcut() {
  const { canSwitchView, setView } = useOrganizationRole();
  if (!canSwitchView) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open the driver view"
      onPress={() => {
        setView('driver');
        router.replace('/(tabs)/driver');
      }}
      style={styles.row}
    >
      <View style={styles.texts}>
        <Text style={styles.title}>Driver view</Text>
        <Text style={styles.hint}>Open the driver app with your own route (you can come back here).</Text>
      </View>
      <Text style={styles.arrow}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 16, marginTop: 14 },
  texts: { flex: 1 },
  title: { color: colors.ink, fontWeight: '900', fontSize: 15 },
  hint: { color: colors.muted, fontSize: 11.5, lineHeight: 16, marginTop: 4 },
  arrow: { color: colors.forest700, fontWeight: '900', fontSize: 20 },
});
