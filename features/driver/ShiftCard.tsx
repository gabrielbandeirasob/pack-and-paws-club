/**
 * Cartão da JORNADA do motorista (clock in / clock out).
 *
 * Pedido do cliente (áudio de 16/09/2026): "quando o driver chegar, ele tem que dar o clock in e
 * depois o clock out". No dia normal ele NÃO aperta nada — a jornada é deduzida dos eventos da
 * rota. Os botões existem para a exceção (esqueceu, imprevisto) e por isso pedem MOTIVO.
 */
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { durationText, shiftLabel, type ShiftState } from '@/features/driver/shift';
import { colors, radii } from '@/features/theme/tokens';

type Props = {
  state: ShiftState;
  /** registros que estão na fila local (sem sinal) e ainda vão subir */
  pendingCount?: number;
  busy?: boolean;
  error?: string | null;
  /**
   * Onde o clock in abre (sede/van cadastrada pelo gestor — migration 034). Nulo = organização sem
   * sede: o cartão fica exatamente como sempre foi, sem nenhuma menção a van.
   */
  gateHint?: string | null;
  /**
   * A trava da van RECUSOU o clock in porque o motorista está fora do raio. Quando vem preenchido,
   * o cartão oferece o registro COMO EXCEÇÃO — foi o que faltava para o dia não terminar sem jornada
   * nenhuma (relato do cliente em 01/10/2026: "não conseguiu dar clock in" e o dia ficou sem
   * registro). A distância entra no motivo gravado, então o gestor VÊ a exceção no relatório de horas.
   */
  foraDaVan?: { distanceKm: number; vanName: string } | null;
  onClockIn: (reason: string) => void;
  onClockOut: (reason: string) => void;
  /** Registro de exceção pedido pelo motorista depois da recusa (grava a distância no motivo). */
  onClockInAnyway?: (reason: string) => void;
};

export function ShiftCard({ state, pendingCount = 0, busy = false, error, gateHint = null, foraDaVan = null, onClockIn, onClockOut, onClockInAnyway }: Props) {
  const [pedindo, setPedindo] = useState<'in' | 'out' | 'in-fora' | null>(null);
  const [motivo, setMotivo] = useState('');

  const abrir = (tipo: 'in' | 'out' | 'in-fora') => {
    setMotivo('');
    setPedindo(tipo);
  };

  const confirmar = () => {
    const texto = motivo.trim();
    if (texto.length < 3) return;
    if (pedindo === 'in') onClockIn(texto);
    else if (pedindo === 'out') onClockOut(texto);
    else if (pedindo === 'in-fora' && onClockInAnyway) onClockInAnyway(texto);
    setPedindo(null);
  };

  const aberta = state.kind === 'open';

  return (
    <View style={styles.card} testID="cartao-jornada">
      <View style={styles.topo}>
        <Text style={styles.eyebrow}>JOURNEY</Text>
        {pendingCount > 0 ? <Text style={styles.pendente}>{pendingCount} to sync</Text> : null}
      </View>
      <Text style={styles.titulo}>{shiftLabel(state)}</Text>
      <Text style={styles.dica}>
        {state.source === 'route'
          ? 'Worked out from your route stops — nothing to press.'
          : state.manualOpen
            ? 'Manual journey (exception): this one was entered by hand.'
            : 'Manual record for today.'}
      </Text>
      {gateHint ? <Text style={styles.gateHint}>{gateHint}</Text> : null}

      <View style={styles.acoes}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={aberta ? 'Clock out' : 'Clock in'}
          disabled={busy}
          onPress={() => abrir(aberta ? 'out' : 'in')}
          style={({ pressed }) => [styles.botao, !aberta && styles.botaoPrincipal, pressed && styles.pressed, busy && styles.desabilitado]}
        >
          <Text style={[styles.botaoTexto, !aberta && styles.botaoTextoPrincipal]}>
            {aberta ? `Clock out · ${durationText(state.minutes)}` : 'Clock in'}
          </Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.erro}>{error}</Text> : null}

      {/* SAÍDA DE EXCEÇÃO: a van é o caminho normal, mas ninguém fica sem jornada. O motivo continua
          obrigatório e o texto gravado leva a distância (o gestor vê a exceção no relatório de horas). */}
      {foraDaVan && onClockInAnyway ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clock in anyway"
          disabled={busy}
          onPress={() => abrir('in-fora')}
          style={({ pressed }) => [styles.botaoExcecao, pressed && styles.pressed, busy && styles.desabilitado]}
        >
          <Text style={styles.botaoExcecaoTexto}>Clock in anyway · outside the van</Text>
        </Pressable>
      ) : null}

      <Modal visible={pedindo !== null} transparent animationType="slide" onRequestClose={() => setPedindo(null)}>
        <View style={styles.fundo}>
          <View style={styles.folha}>
            <Text style={styles.folhaTitulo}>
              {pedindo === 'out' ? 'Clock out manually' : pedindo === 'in-fora' ? 'Clock in outside the van' : 'Clock in manually'}
            </Text>
            <Text style={styles.folhaSub}>
              {pedindo === 'in-fora' && foraDaVan
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
              disabled={motivo.trim().length < 3 || busy}
              onPress={confirmar}
              style={({ pressed }) => [styles.salvar, (motivo.trim().length < 3 || busy) && styles.desabilitado, pressed && styles.pressed]}
            >
              {busy ? <ActivityIndicator color={colors.forest900} /> : <Text style={styles.salvarTexto}>Save record</Text>}
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel manual record" onPress={() => setPedindo(null)} style={styles.cancelar}>
              <Text style={styles.cancelarTexto}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: radii.medium, padding: 14, marginBottom: 12 },
  topo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { color: colors.gold, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  pendente: { color: colors.muted, fontSize: 11, fontWeight: '800' },
  titulo: { color: colors.forest900, fontFamily: 'serif', fontSize: 17, fontWeight: '800', marginTop: 5 },
  dica: { color: colors.muted, fontSize: 12, marginTop: 4, lineHeight: 17 },
  /** Onde o clock in abre (só existe quando a organização cadastrou a sede/van). */
  gateHint: { color: '#7A5B12', backgroundColor: '#FBF0D9', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, fontSize: 12, fontWeight: '800', marginTop: 8, lineHeight: 17, overflow: 'hidden' },
  acoes: { flexDirection: 'row', gap: 8, marginTop: 11 },
  botao: { flex: 1, borderWidth: 1.5, borderColor: colors.forest700, borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  botaoPrincipal: { backgroundColor: colors.forest700, borderColor: colors.forest700 },
  botaoExcecao: { borderWidth: 1.5, borderColor: colors.urgency, borderRadius: 12, paddingVertical: 11, alignItems: 'center', marginTop: 8 },
  botaoExcecaoTexto: { color: colors.urgency, fontWeight: '900', fontSize: 12.5 },
  botaoTexto: { color: colors.forest700, fontWeight: '900', fontSize: 13 },
  botaoTextoPrincipal: { color: 'white' },
  erro: { color: colors.urgency, fontSize: 12, fontWeight: '700', marginTop: 9, lineHeight: 17 },
  fundo: { flex: 1, backgroundColor: 'rgba(23,43,29,0.45)', justifyContent: 'flex-end' },
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
