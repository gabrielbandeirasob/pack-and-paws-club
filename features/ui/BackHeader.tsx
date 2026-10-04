import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useRouter } from 'expo-router';

import { colors, radii } from '@/features/theme/tokens';

/**
 * CABEÇALHO PADRÃO COM O BOTÃO DE VOLTAR (pedido do cliente, 04/10/2026).
 *
 * O cliente reclamou de que **faltavam botões para voltar** no app. A auditoria das telas empilhadas
 * (04/10/2026) mostrou que o problema não era um botão quebrado, era a AUSÊNCIA dele: `app/_layout.tsx`
 * esconde o cabeçalho nativo em todas as telas (`screenOptions={{ headerShown: false }}`) e cada tela
 * desenhava — ou não desenhava — o seu próprio. O resultado era três comportamentos diferentes na mesma
 * jornada: `‹ Back` (day-progress, day-summary, route-stops), um `‹` solto sem palavra (drivers,
 * route-history) e **nenhum caminho de saída** (Activity, Driver hours, Edit client, Edit reservation,
 * Change password, Van & yard, Weekly summary).
 *
 * Aqui mora o único lugar que desenha esse voltar. Regras que ele garante:
 *
 * 1. **Sempre tem para onde voltar.** `router.back()` só funciona quando existe histórico; quem abre a
 *    tela por link direto (ou depois de um `replace`) ficava preso — nesse caso o botão vai para
 *    `fallback` (as abas, por padrão). Era o caso real de "não tem como voltar dessa tela".
 * 2. **Alvo de toque de iOS**: `minHeight: 44` + `hitSlop` — o botão antigo era só um texto de 13 px.
 * 3. **Mesmo rótulo para o leitor de tela**: `accessibilityLabel="Go back"` em TODAS as telas (o cliente
 *    americano usa VoiceOver) e a MESMA palavra visível: `‹ Back`.
 * 4. `dark` é a faixa verde do topo (padrão do app) e `light` é a tela de fundo claro (creme).
 */
type Props = {
  title: string;
  /** Linha pequena em cima do título (ex.: "PACK & PAWS CLUB"). */
  eyebrow?: string;
  subtitle?: string;
  /** `dark` = faixa verde do topo (padrão). `light` = sobre o fundo claro da tela. */
  tone?: 'dark' | 'light';
  /** Para onde ir quando NÃO há histórico (abertura direta/link). Padrão: as abas. */
  fallback?: string;
  /** Conteúdo opcional à direita do título (ex.: o "＋" da tela Team). */
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function BackHeader({
  title,
  eyebrow,
  subtitle,
  tone = 'dark',
  fallback = '/(tabs)',
  right,
  style,
  testID,
}: Props) {
  const router = useRouter();

  const voltar = useCallback(() => {
    /**
     * `canGoBack()` é o que separa "tem histórico" de "abriram esta tela direto". Sem ele, `back()`
     * numa tela sem histórico não faz nada e o motorista/gestor fica sem saída — que é exatamente a
     * queixa. O `try` protege versões do expo-router sem esse método: aí o fallback vale sempre.
     */
    try {
      if (router.canGoBack()) {
        router.back();
        return;
      }
    } catch {
      // Sem `canGoBack` confiável: cai no fallback (nunca deixa sem saída).
    }
    router.replace(fallback as never);
  }, [router, fallback]);

  const claro = tone === 'light';

  return (
    <View style={[claro ? styles.topoClaro : styles.topo, style]} testID={testID}>
      <View style={styles.linhaTitulo}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={voltar}
          hitSlop={12}
          style={styles.voltarArea}
        >
          <Text style={[styles.voltarTexto, claro && styles.voltarTextoClaro]}>‹ Back</Text>
        </Pressable>
        {right ? <View style={styles.direita}>{right}</View> : null}
      </View>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={[styles.titulo, claro && styles.tituloClaro]}>{title}</Text>
      {subtitle ? <Text style={[styles.sub, claro && styles.subClaro]}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  topo: {
    backgroundColor: colors.forest700,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 22,
    borderBottomLeftRadius: radii.hero,
    borderBottomRightRadius: radii.hero,
  },
  topoClaro: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14 },
  linhaTitulo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  voltarArea: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingRight: 12 },
  voltarTexto: { color: '#D7E1D4', fontWeight: '800', fontSize: 14 },
  voltarTextoClaro: { color: colors.forest700 },
  direita: { minHeight: 44, justifyContent: 'center' },
  eyebrow: { color: colors.gold, fontSize: 10, fontWeight: '900', letterSpacing: 1.3, marginTop: 2 },
  titulo: { color: 'white', fontFamily: 'serif', fontSize: 26, fontWeight: '800', marginTop: 8 },
  tituloClaro: { color: colors.ink, marginTop: 10 },
  sub: { color: '#D7E1D4', fontSize: 12, marginTop: 4, letterSpacing: 0.6 },
  subClaro: { color: colors.muted, letterSpacing: 0 },
});
