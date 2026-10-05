/**
 * FOLHA DO MOTIVO (clock in / clock out manual).
 *
 * O clock in/out manual é EXCEÇÃO (`manualOpen`) e por isso exige motivo — é o que o gestor lê
 * depois no relatório de horas. A folha era markup dentro do `ShiftCard`; saiu para cá quando o
 * estado PRÉ-CLOCK-IN ganhou um cartão próprio (`StartStateCard`), para os dois usarem a MESMA
 * folha (mesmos rótulos de acessibilidade, mesmas testIDs) em vez de duas cópias que divergem.
 *
 * Regra de teclado (reclamação do dono, 01/10/2026: *"quando vai colocar clock in manual o teclado
 * ocupa a tela e não consigo [ver] o que estou digitando"*): a folha sobe com o teclado
 * (`KeyboardAvoidingView`, comportamento por plataforma) e ROLA quando o conteúdo não couber
 * (tela pequena / fonte grande do sistema).
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radii } from '@/features/theme/tokens';

export type ManualReasonKind = 'in' | 'out' | 'in-fora';

type Props = {
  visible: boolean;
  kind: ManualReasonKind;
  /** Quando o registro é a exceção "fora da van", a folha explica o que vai no motivo. */
  foraDaVan?: { distanceKm: number; vanName: string } | null;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
};

export function ManualReasonSheet({ visible, kind, foraDaVan = null, busy = false, onConfirm, onClose }: Props) {
  const [motivo, setMotivo] = useState('');

  // Cada abertura começa limpa (o motivo antigo nunca vaza para a próxima exceção).
  useEffect(() => {
    if (visible) setMotivo('');
  }, [visible, kind]);

  const pronto = motivo.trim().length >= 3;

  const confirmar = () => {
    if (!pronto) return;
    onConfirm(motivo.trim());
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        testID="manual-clock-avoiding"
        style={styles.fundo}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          testID="manual-clock-rolagem"
          style={styles.rolagem}
          contentContainerStyle={styles.rolagemConteudo}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          <View style={styles.folha}>
            <Text style={styles.folhaTitulo}>
              {kind === 'out' ? 'Clock out manually' : kind === 'in-fora' ? 'Clock in outside the van' : 'Clock in manually'}
            </Text>
            <Text style={styles.folhaSub}>
              {kind === 'in-fora' && foraDaVan
                ? `This is recorded as an exception: your start carries the distance from "${foraDaVan.vanName}", and the manager sees it in the driver hours.`
                : 'Only when the automatic record does not cover it (you forgot, or something came up). The manager sees this was entered by hand.'}
            </Text>
            <TextInput
              accessibilityLabel="Reason for the manual record"
              placeholder="Reason (e.g. forgot to press, van broke down)"
              placeholderTextColor={colors.muted}
              value={motivo}
              onChangeText={setMotivo}
              style={styles.campo}
              autoCapitalize="sentences"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save manual record"
              disabled={!pronto || busy}
              onPress={confirmar}
              style={({ pressed }) => [styles.salvar, (!pronto || busy) && styles.desabilitado, pressed && styles.pressed]}
            >
              {busy ? <ActivityIndicator color={colors.forest900} /> : <Text style={styles.salvarTexto}>Save record</Text>}
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel manual record" onPress={onClose} style={styles.cancelar}>
              <Text style={styles.cancelarTexto}>Cancel</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fundo: { flex: 1, backgroundColor: 'rgba(23,43,29,0.45)', justifyContent: 'flex-end' },
  /** A folha rola quando o teclado sobe (tela pequena / fonte grande): o campo nunca fica escondido. */
  rolagem: { flexGrow: 0 },
  rolagemConteudo: { flexGrow: 1, justifyContent: 'flex-end' },
  folha: { backgroundColor: colors.paper, borderTopLeftRadius: radii.hero, borderTopRightRadius: radii.hero, padding: 20, paddingBottom: 30 },
  folhaTitulo: { fontSize: 18, fontWeight: '800', color: colors.ink },
  folhaSub: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 6 },
  campo: { backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11, color: colors.ink, fontSize: 15, marginTop: 12 },
  salvar: { backgroundColor: colors.gold, borderRadius: 14, padding: 14, alignItems: 'center', marginTop: 12 },
  salvarTexto: { color: colors.forest900, fontWeight: '900', fontSize: 15 },
  cancelar: { alignItems: 'center', paddingVertical: 12 },
  cancelarTexto: { color: colors.muted, fontWeight: '800' },
  pressed: { opacity: 0.85 },
  desabilitado: { opacity: 0.5 },
});
