import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radii } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';

type Props = {
  buildAtual: number | null;
  buildMinima: number | null;
  conferindo: boolean;
  onRechecar: () => void;
};

/**
 * TELA DE ATUALIZAÇÃO OBRIGATÓRIA (pedido do dono, 16/10/2026).
 *
 * O app não entra enquanto o aparelho estiver numa build anterior à publicada: o escritório e os
 * motoristas precisam ver a MESMA coisa, e build velha já rendeu relato de defeito que não existia mais.
 * O caminho de saída é o TestFlight (o OTA está desligado), então a tela ENSINA o passo — não adianta
 * dizer só "atualize".
 *
 * Texto em inglês: quem lê é o escritório, nos EUA.
 */
export function AtualizacaoObrigatoria({ buildAtual, buildMinima, conferindo, onRechecar }: Props) {
  const sair = () => {
    void supabase.auth.signOut();
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.conteudo}>
        <View style={styles.card} testID="atualizacao-obrigatoria">
          <Text style={styles.eyebrow}>PACK &amp; PAWS CLUB</Text>
          <Text style={styles.title}>Update the app to continue</Text>
          <Text style={styles.body}>
            Everyone has to be on the newest version so the office and the drivers see the same thing.
            {buildAtual ? ` This phone is on build ${buildAtual}` : ''}
            {buildMinima ? `, and the app now needs build ${buildMinima} or newer.` : '.'}
          </Text>

          <Text style={styles.passosTitulo}>How to update (1 minute)</Text>
          <Text style={styles.passo}>1. Open TestFlight on this phone.</Text>
          <Text style={styles.passo}>2. Tap Pack &amp; Paws Club.</Text>
          <Text style={styles.passo}>3. Pull the list down and tap Update.</Text>
          <Text style={styles.dica}>
            Tip: inside TestFlight, turn Automatic Updates on — then this screen won&apos;t stop you again.
          </Text>

          <Pressable accessibilityRole="button" onPress={onRechecar} style={styles.principal}>
            {conferindo ? (
              <ActivityIndicator color={colors.forest900} />
            ) : (
              <Text style={styles.principalTexto}>Check again</Text>
            )}
          </Pressable>

          <Pressable accessibilityRole="button" onPress={sair} style={styles.fantasma}>
            <Text style={styles.fantasmaTexto}>Sign out</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.forest700 },
  conteudo: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 22 },
  card: { width: '100%', maxWidth: 460, backgroundColor: colors.paper, borderRadius: radii.medium, padding: 22 },
  eyebrow: { color: colors.forest700, fontWeight: '800', fontSize: 11, letterSpacing: 1.2 },
  title: { color: colors.ink, fontFamily: 'serif', fontWeight: '800', fontSize: 24, marginTop: 8 },
  body: { color: colors.muted, fontSize: 14, marginTop: 10, lineHeight: 20 },
  passosTitulo: { color: colors.forest900, fontWeight: '800', fontSize: 13, marginTop: 18, letterSpacing: 0.4 },
  passo: { color: colors.ink, fontSize: 14, marginTop: 8, lineHeight: 19 },
  dica: { color: colors.muted, fontSize: 12, marginTop: 12, lineHeight: 17, fontStyle: 'italic' },
  principal: { marginTop: 20, backgroundColor: colors.gold, borderRadius: radii.medium, paddingVertical: 13, alignItems: 'center' },
  principalTexto: { color: colors.forest900, fontWeight: '900', fontSize: 15 },
  fantasma: { marginTop: 10, paddingVertical: 12, alignItems: 'center' },
  fantasmaTexto: { color: colors.forest700, fontWeight: '800', fontSize: 14 },
});
