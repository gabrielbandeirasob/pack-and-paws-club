/**
 * TOTAL PACK — a folha que abre ao tocar no indicador.
 *
 * Pedido da operação (26/09/2026): "o Total Pack vai ser um botão clicável: você clica, ele vai
 * puxar todos os cachorros que estão no calendário, e o administrador vai ter como clicar num X
 * para deletar aquele cachorro no dia (…) e você consegue assinar lá esse cachorro para um dos
 * drivers, para um dos funcionários, para a CAMINHADA — não na rota".
 *
 * Duas ações por cão:
 *  - o **X** tira/põe o cão no pack do dia (nunca apaga reserva, evento do Google ou rota);
 *  - o **caminhante** é escolhido entre os membros ativos da organização e é independente de quem
 *    pega o cão na rota (é o pedido literal do áudio).
 */
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radii } from '@/features/theme/tokens';
import type { PackRow } from './dayOperation';

type Membro = { id: string; name: string };

type Props = {
  visible: boolean;
  dayLabel: string;
  rows: PackRow[];
  members: Membro[];
  busy?: boolean;
  /** Quantos estão no pack (o mesmo número do indicador). */
  onToggle: (dogId: string, inPack: boolean) => void;
  onSetWalker: (dogId: string, walkerId: string | null) => void;
  onClose: () => void;
};

export function PackSheet({ visible, dayLabel, rows, members, busy = false, onToggle, onSetWalker, onClose }: Props) {
  const noPack = rows.filter((linha) => linha.inPack).length;
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.fundo}>
        <View style={styles.folha} testID="total-pack-sheet">
          <Text style={styles.titulo}>Total Pack</Text>
          <Text style={styles.sub}>{`${dayLabel} · ${noPack} of ${rows.length} going to the walk`}</Text>

          {rows.length === 0 ? (
            <Text style={styles.vazio}>No dogs scheduled for this day.</Text>
          ) : (
            <ScrollView style={styles.lista} showsVerticalScrollIndicator={false}>
              {rows.map((linha) => (
                <View key={linha.dogId} style={[styles.cartao, !linha.inPack && styles.cartaoFora]}>
                  <View style={styles.linhaTopo}>
                    <View style={styles.quem}>
                      <Text style={[styles.cao, !linha.inPack && styles.textoFraco]}>{linha.dogName}</Text>
                      <Text style={styles.tutor}>
                        {linha.clientName} · {linha.serviceType === 'boarding' ? 'Boarding' : 'Daycare'}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ disabled: busy }}
                      disabled={busy}
                      accessibilityLabel={linha.inPack ? `Remove ${linha.dogName} from the pack` : `Put ${linha.dogName} back in the pack`}
                      onPress={() => onToggle(linha.dogId, !linha.inPack)}
                      style={[styles.x, !linha.inPack && styles.xVoltar]}
                    >
                      <Text style={[styles.xTexto, !linha.inPack && styles.xTextoVoltar]}>{linha.inPack ? '✕' : '↺'}</Text>
                    </Pressable>
                  </View>

                  {linha.inPack ? (
                    <View style={styles.pilha}>
                      <Text style={styles.rotuloCaminhante}>{`Walking with: ${membrosRotulo(members, linha.walkerId)}`}</Text>
                      <View style={styles.chips}>
                        {[{ id: null as string | null, name: 'Unassigned' }, ...members].map((membro) => {
                          const escolhido = (linha.walkerId ?? null) === membro.id;
                          return (
                            <Pressable
                              key={membro.id ?? 'ninguem'}
                              accessibilityRole="button"
                              accessibilityState={{ selected: escolhido, disabled: busy }}
                              disabled={busy}
                              accessibilityLabel={`Walker for ${linha.dogName}: ${membro.name}`}
                              onPress={() => onSetWalker(linha.dogId, membro.id)}
                              style={[styles.chip, escolhido && styles.chipOn]}
                            >
                              <Text style={[styles.chipTexto, escolhido && styles.chipTextoOn]}>{membro.name}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  ) : (
                    <Text style={styles.foraTexto}>Not going to the walk today.</Text>
                  )}
                </View>
              ))}
            </ScrollView>
          )}

          <Pressable accessibilityRole="button" accessibilityLabel="Close the pack list" onPress={onClose} style={styles.fechar}>
            <Text style={styles.fecharTexto}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function membrosRotulo(members: Membro[], walkerId: string | null): string {
  if (!walkerId) return 'Unassigned';
  return members.find((membro) => membro.id === walkerId)?.name ?? 'Unassigned';
}

const styles = StyleSheet.create({
  fundo: { flex: 1, backgroundColor: 'rgba(23,43,29,.45)', justifyContent: 'flex-end' },
  folha: { backgroundColor: colors.paper, borderTopLeftRadius: radii.hero, borderTopRightRadius: radii.hero, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 26, maxHeight: '86%' },
  titulo: { fontFamily: 'serif', fontWeight: '800', fontSize: 20, color: colors.ink },
  sub: { color: colors.muted, fontSize: 12, marginTop: 3 },
  vazio: { color: colors.muted, fontSize: 13, marginTop: 18, marginBottom: 6 },
  lista: { marginTop: 14 },
  cartao: { borderWidth: 1, borderColor: colors.line, borderRadius: radii.medium, padding: 13, marginBottom: 10, backgroundColor: colors.paper },
  cartaoFora: { backgroundColor: colors.cream, borderColor: colors.line },
  linhaTopo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  quem: { flex: 1, paddingRight: 10 },
  cao: { fontWeight: '800', color: colors.ink, fontSize: 15 },
  textoFraco: { color: colors.muted, textDecorationLine: 'line-through' },
  tutor: { color: colors.muted, fontSize: 11, marginTop: 2 },
  x: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: '#E8BFBF', backgroundColor: '#FBEDED', alignItems: 'center', justifyContent: 'center' },
  xVoltar: { borderColor: colors.line, backgroundColor: colors.sage },
  xTexto: { color: colors.urgency, fontWeight: '900', fontSize: 15 },
  xTextoVoltar: { color: colors.forest700 },
  pilha: { marginTop: 11 },
  rotuloCaminhante: { color: colors.muted, fontSize: 11, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 7, backgroundColor: colors.paper },
  chipOn: { backgroundColor: colors.forest700, borderColor: colors.forest700 },
  chipTexto: { color: colors.ink, fontSize: 11, fontWeight: '700' },
  chipTextoOn: { color: 'white' },
  foraTexto: { color: colors.muted, fontSize: 11, marginTop: 8 },
  fechar: { marginTop: 6, backgroundColor: colors.forest700, borderRadius: radii.medium, paddingVertical: 14, alignItems: 'center' },
  fecharTexto: { color: 'white', fontWeight: '800', fontSize: 14 },
});
