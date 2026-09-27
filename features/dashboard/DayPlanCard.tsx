/**
 * PLANO DO DIA — os dois campos que o gestor escreve ANTES do dia acontecer: onde é a caminhada e
 * qual é a ideia da foto.
 *
 * Pedido da operação (26/09/2026): "na dashboard principal, também o administrador tem que ter, no
 * final do dia, dois locais que ele consiga digitar: um vai ser IDEIA DA FOTO DO DIA e o outro vai
 * ser LOCAL DA CAMINHADA".
 *
 * NOME CORRIGIDO em 27/09/2026 (áudio do dono): o cartão se chamava "End of the day" e o dono
 * recusou o nome — "a foto, o jeito que vai ser tirada a foto e o local é decidido no dia ANTERIOR
 * com base no clima e tudo mais. Então, ele não é o End of the Day... eu quero que o administrador
 * seja capaz de arrastar pro lado e dia por dia... acessar o próximo dia e digitar o local e como
 * vai ser a foto". Os campos NÃO mudaram (continuam por dia, em `daily_plans`); o que mudou é o
 * enquadramento: é o plano do dia, escrito antes — navegando para amanhã pelo cabeçalho.
 *
 * Decisão de 26/09 mantida: "foto do dia" é TEXTO (a ideia/legenda do dia). Anexar arquivo no fim do
 * dia não foi pedido e o app não guarda binário; se o cliente quiser a foto de verdade, é um passo
 * novo (upload), combinado depois.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radii } from '@/features/theme/tokens';
import { PLANO_TEXTO_MAX } from './dayOperation';

type Props = {
  walkLocation: string | null;
  photoIdea: string | null;
  busy?: boolean;
  /** Mensagem do último salvamento ("Saved") — some sozinha na tela. */
  saved?: string | null;
  onSave: (values: { walkLocation: string; photoIdea: string }) => void;
};

export function DayPlanCard({ walkLocation, photoIdea, busy = false, saved = null, onSave }: Props) {
  const [local, setLocal] = useState(walkLocation ?? '');
  const [foto, setFoto] = useState(photoIdea ?? '');

  // O que veio do banco manda quando a tela recarrega (outro gestor pode ter salvo, ou o gestor
  // acabou de arrastar para outro dia).
  useEffect(() => setLocal(walkLocation ?? ''), [walkLocation]);
  useEffect(() => setFoto(photoIdea ?? ''), [photoIdea]);

  const mudou = (walkLocation ?? '') !== local || (photoIdea ?? '') !== foto;

  return (
    <View style={styles.cartao}>
      <Text style={styles.titulo}>Day plan</Text>
      <Text style={styles.sub}>Photo and walk location — decided the day before.</Text>

      <Text style={styles.rotulo}>Walk location</Text>
      <TextInput
        accessibilityLabel="Walk location of the day"
        placeholder="Where the walk will be…"
        placeholderTextColor={colors.muted}
        value={local}
        onChangeText={setLocal}
        maxLength={PLANO_TEXTO_MAX}
        style={styles.entrada}
      />

      <Text style={styles.rotulo}>Photo of the day — idea</Text>
      <TextInput
        accessibilityLabel="Photo of the day idea"
        placeholder="What the photo is about…"
        placeholderTextColor={colors.muted}
        value={foto}
        onChangeText={setFoto}
        maxLength={PLANO_TEXTO_MAX}
        multiline
        style={[styles.entrada, styles.entradaAlta]}
      />

      <View style={styles.rodape}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: busy || !mudou }}
          disabled={busy || !mudou}
          accessibilityLabel="Save the day plan"
          onPress={() => onSave({ walkLocation: local, photoIdea: foto })}
          style={[styles.salvar, (busy || !mudou) && styles.salvarOff]}
        >
          <Text style={styles.salvarTexto}>{busy ? 'Saving…' : 'Save'}</Text>
        </Pressable>
        {saved ? <Text style={styles.ok}>{saved}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cartao: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: radii.large, padding: 16, marginHorizontal: 18, marginTop: 12 },
  titulo: { fontFamily: 'serif', fontWeight: '800', fontSize: 16, color: colors.ink },
  sub: { color: colors.muted, fontSize: 11.5, marginTop: 3, marginBottom: 10 },
  rotulo: { color: colors.muted, fontSize: 10.5, fontWeight: '700', marginBottom: 5, letterSpacing: 0.3 },
  entrada: { borderWidth: 1, borderColor: colors.line, borderRadius: radii.small, paddingHorizontal: 11, paddingVertical: 10, color: colors.ink, fontSize: 13, backgroundColor: colors.cream, marginBottom: 11 },
  entradaAlta: { minHeight: 62, textAlignVertical: 'top' },
  rodape: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  salvar: { backgroundColor: colors.forest700, borderRadius: radii.small, paddingHorizontal: 20, paddingVertical: 11 },
  salvarOff: { opacity: 0.45 },
  salvarTexto: { color: 'white', fontWeight: '800', fontSize: 13 },
  ok: { color: colors.success, fontSize: 11.5, fontWeight: '700' },
});
