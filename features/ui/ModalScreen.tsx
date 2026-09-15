import { useContext } from 'react';
import { View, type ViewProps } from 'react-native';

import { SafeAreaInsetsContext, initialWindowMetrics } from 'react-native-safe-area-context';

import { colors } from '@/features/theme/tokens';

/**
 * Conteúdo de um <Modal> com recuo correto no topo.
 *
 * Por que não usar <SafeAreaView> aqui dentro: na react-native-safe-area-context 5.x ele é um
 * componente NATIVO que calcula o inset pela janela em que está. Um <Modal> do React Native é
 * uma janela separada no iOS e, nela, o cálculo volta ZERO — o conteúdo fica desenhado embaixo
 * da barra de status (relógio/notch) e o toque nessa faixa não chega no app: foi assim que o
 * botão "✕ Close" parou de funcionar.
 *
 * Aqui lemos o inset do CONTEXTO (o mesmo SafeAreaProvider que já posiciona as telas normais) e
 * aplicamos como padding — sempre uma única vez, sem risco de contar o recuo em dobro.
 *
 * Sem provedor (ex.: teste unitário), caímos nas métricas iniciais da janela e, em último caso,
 * em zero: nunca lança exceção nem derruba a tela por causa disso.
 */
export function ModalScreen({ style, children, ...props }: ViewProps) {
  const doContexto = useContext(SafeAreaInsetsContext);
  const topo = doContexto?.top ?? initialWindowMetrics?.insets.top ?? 0;
  return (
    <View {...props} style={[{ flex: 1, backgroundColor: colors.cream, paddingTop: topo }, style]}>
      {children}
    </View>
  );
}
