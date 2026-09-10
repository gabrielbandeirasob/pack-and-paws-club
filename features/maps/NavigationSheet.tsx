/**
 * Escolha do app de mapa (Google ou Apple) quando o motorista ainda não tem preferência.
 * O app não navega: ele abre o app escolhido já apontando para a parada.
 */
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { colors, radii } from '@/features/theme/tokens';
import { labelFor, NAV_APPS, navigationUrlFor, type NavApp } from './navigation';
import type { NavTarget } from './links';

type Props = {
  visible: boolean;
  target: NavTarget | null;
  onClose: () => void;
  onChoose: (app: NavApp, remember: boolean) => void;
};

export function NavigationSheet({ visible, target, onClose, onChoose }: Props) {
  const [remember, setRemember] = useState(true);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Abrir navegação em…</Text>
          <Text style={styles.subtitle}>{target?.address ?? 'Parada selecionada'}</Text>

          {NAV_APPS.map((app) => (
            <Pressable
              key={app}
              accessibilityRole="button"
              accessibilityLabel={`Abrir no ${labelFor(app)}`}
              onPress={() => onChoose(app, remember)}
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}
            >
              <Text style={styles.optionIcon}>{app === 'google' ? '📍' : '🧭'}</Text>
              <Text style={styles.optionText}>{labelFor(app)}</Text>
              <Text style={styles.optionHint}>→</Text>
            </Pressable>
          ))}

          <View style={styles.rememberRow}>
            <Switch value={remember} onValueChange={setRemember} trackColor={{ true: colors.forest700 }} />
            <Text style={styles.rememberText}>Lembrar minha escolha</Text>
          </View>

          <Pressable accessibilityRole="button" accessibilityLabel="Cancelar" onPress={onClose} style={styles.cancel}>
            <Text style={styles.cancelText}>Cancelar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(23,43,29,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radii.hero,
    borderTopRightRadius: radii.hero,
    padding: 20,
    paddingBottom: 34,
    gap: 10,
  },
  title: { fontSize: 18, fontWeight: '800', color: colors.ink },
  subtitle: { color: colors.muted, marginBottom: 6 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.medium,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: colors.cream,
  },
  optionIcon: { fontSize: 20 },
  optionText: { flex: 1, fontWeight: '800', color: colors.ink },
  optionHint: { color: colors.forest700, fontWeight: '800' },
  rememberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  rememberText: { color: colors.ink },
  cancel: { alignItems: 'center', paddingVertical: 12 },
  cancelText: { color: colors.muted, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});
