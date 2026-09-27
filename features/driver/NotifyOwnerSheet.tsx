/**
 * Escolha do mensageiro para avisar o tutor, com o texto JÁ PRONTO.
 *
 * Nada sai daqui: o app abre o mensageiro do aparelho do motorista com a mensagem escrita e ele
 * aperta enviar (decisão do cliente: "sem ser pelo Twilio, sem ser um disparo").
 *
 * AJUSTE DA OPERAÇÃO (áudio de 25/09/2026): "remover a opção de WhatsApp, a gente sempre usa
 * Messenger aqui". A lista oferecida ficou com UM mensageiro só (SMS) — e, com um só, escolher não
 * é escolha: `messengerChoiceNeeded()` diz que o app deve ir DIRETO para o mensageiro, sem abrir
 * esta folha. A folha continua existindo (e testada) para o dia em que houver mais de um.
 */
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { messengerLink, recipientsFor, type Messenger } from '@/features/driver/etaMessage';
import { colors, radii } from '@/features/theme/tokens';

/** Mensageiros que o app OFERECE na interface (WhatsApp saiu a pedido do cliente). */
export const OFFERED_MESSENGERS: Messenger[] = ['sms'];

/** Com um mensageiro só não há escolha a fazer: o app abre o mensageiro direto. */
export function messengerChoiceNeeded(messengers: Messenger[] = OFFERED_MESSENGERS): boolean {
  return messengers.length > 1;
}

/** Mensageiro usado no envio direto (sem folha de escolha). */
export function defaultMessenger(messengers: Messenger[] = OFFERED_MESSENGERS): Messenger {
  return messengers[0] ?? 'sms';
}

/** Rótulo do mensageiro (o mesmo texto que o motorista lê na folha). */
function messengerLabel(messenger: Messenger): string {
  return messenger === 'whatsapp' ? 'WhatsApp' : 'Messages (SMS)';
}

type Props = {
  visible: boolean;
  /**
   * Telefones que recebem (o do cadastro e o do SEGUNDO dono, quando houver). A mensagem sai em UMA
   * conversa com os dois — pedido do dono (27/09/2026): "não de forma separada, mas num grupo".
   */
  phones: Array<string | null>;
  /** texto que vai preenchido no mensageiro */
  message: string;
  /** mensageiros oferecidos (default: os da interface — hoje só SMS) */
  messengers?: Messenger[];
  onChoose: (messenger: Messenger) => void;
  onClose: () => void;
};

export function NotifyOwnerSheet({ visible, phones, message, messengers = OFFERED_MESSENGERS, onChoose, onClose }: Props) {
  const destinatarios = recipientsFor(...phones);
  const opcoes = messengers.map((chave) => ({
    chave,
    rotulo: messengerLabel(chave),
    icone: chave === 'whatsapp' ? '🟢' : '💬',
  }));

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.fundo}>
        <View style={styles.folha}>
          <Text style={styles.titulo}>Notify the owner</Text>
          <Text style={styles.sub}>
            {destinatarios.length === 0
              ? 'Client without a phone number'
              : destinatarios.length > 1
                ? `${phones.filter(Boolean).join(' + ')} · one group message, sent from your own number`
                : `${phones.find(Boolean)} · you send it from your own number`}
          </Text>

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
export function linkForChoice(
  messenger: Messenger,
  phones: Array<string | null> | string | null,
  message: string,
): string | null {
  return messengerLink(messenger, phones, message);
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
