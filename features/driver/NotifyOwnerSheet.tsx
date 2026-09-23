/**
 * Escolha do mensageiro para avisar o tutor (SMS ou WhatsApp), com o texto JÁ PRONTO.
 *
 * Nada sai daqui: o app abre o mensageiro do aparelho do motorista com a mensagem escrita e ele
 * aperta enviar (decisão do cliente: "sem ser pelo Twilio, sem ser um disparo").
 */
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { messengerLink, type Messenger } from '@/features/driver/etaMessage';
import { colors, radii } from '@/features/theme/tokens';

type Props = {
  visible: boolean;
  /** telefone do tutor (quem recebe) */
  phone: string | null;
  /** texto que vai preenchido no mensageiro */
  message: string;
  onChoose: (messenger: Messenger) => void;
  onClose: () => void;
};

export function NotifyOwnerSheet({ visible, phone, message, onChoose, onClose }: Props) {
  const opcoes: { chave: Messenger; rotulo: string; icone: string }[] = [
    { chave: 'sms', rotulo: 'Messages (SMS)', icone: '💬' },
    { chave: 'whatsapp', rotulo: 'WhatsApp', icone: '🟢' },
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.fundo}>
        <View style={styles.folha}>
          <Text style={styles.titulo}>Notify the owner</Text>
          <Text style={styles.sub}>{phone ? `${phone} · you send it from your own number` : 'Client without a phone number'}</Text>

          <View style={styles.previa}>
            <Text style={styles.previaTexto}>{message}</Text>
          </View>

          {opcoes.map((opcao) => (
            <Pressable
              key={opcao.chave}
              accessibilityRole="button"
              accessibilityLabel={opcao.rotulo}
              onPress={() => onChoose(opcao.chave)}
              style={({ pressed }) => [styles.opcao, pressed && styles.pressed]}
            >
              <Text style={styles.icone}>{opcao.icone}</Text>
              <Text style={styles.opcaoTexto}>{opcao.rotulo}</Text>
              <Text style={styles.seta}>→</Text>
            </Pressable>
          ))}

          <Text style={styles.aviso}>
            Nothing is sent automatically: the app opens the messenger with this text and you press send. You can edit it before sending.
          </Text>

          <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onClose} style={styles.cancelar}>
            <Text style={styles.cancelarTexto}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** Link do mensageiro escolhido, já com o texto (null quando o telefone não serve). */
export function linkForChoice(messenger: Messenger, phone: string | null, message: string): string | null {
  return messengerLink(messenger, phone, message);
}

const styles = StyleSheet.create({
  fundo: { flex: 1, backgroundColor: 'rgba(23,43,29,0.45)', justifyContent: 'flex-end' },
  folha: { backgroundColor: colors.paper, borderTopLeftRadius: radii.hero, borderTopRightRadius: radii.hero, padding: 20, paddingBottom: 30, gap: 10 },
  titulo: { fontSize: 18, fontWeight: '800', color: colors.ink },
  sub: { color: colors.muted, fontSize: 12, marginBottom: 4 },
  previa: { backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 12 },
  previaTexto: { color: colors.ink, fontSize: 14, lineHeight: 20 },
  opcao: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.line, borderRadius: radii.medium, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: colors.cream },
  icone: { fontSize: 20 },
  opcaoTexto: { flex: 1, fontWeight: '800', color: colors.ink },
  seta: { color: colors.forest700, fontWeight: '800' },
  aviso: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  cancelar: { alignItems: 'center', paddingVertical: 12 },
  cancelarTexto: { color: colors.muted, fontWeight: '800' },
  pressed: { opacity: 0.7 },
});
