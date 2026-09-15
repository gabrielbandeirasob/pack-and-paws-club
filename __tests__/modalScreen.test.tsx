import { render } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ModalScreen } from '@/features/ui/ModalScreen';

/**
 * Regressão do bug "✕ Close não funciona" na tela da equipe.
 *
 * O <SafeAreaView> nativo devolve inset ZERO dentro de um <Modal> (janela separada no iOS), o que
 * deixava o botão desenhado embaixo da barra de status — e o toque nessa faixa não chega no app.
 * O ModalScreen existe para aplicar o recuo a partir do contexto, e estes testes travam isso:
 *  - com provedor: aplica o recuo do topo;
 *  - sem provedor: não lança e cai em zero (é o caso dos testes de tela);
 *  - o estilo recebido por fora continua valendo.
 */
describe('ModalScreen', () => {
  it('aplica o recuo do topo vindo do SafeAreaProvider', async () => {
    const tela = await render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 59, left: 0, right: 0, bottom: 34 } }}>
        <ModalScreen testID="conteudo">
          <Text>conteúdo</Text>
        </ModalScreen>
      </SafeAreaProvider>,
    );
    const estilo = StyleSheet.flatten(tela.getByTestId('conteudo').props.style);
    expect(estilo.paddingTop).toBe(59);
    expect(estilo.flex).toBe(1);
  });

  it('não lança sem provedor (testes de tela) e mantém o conteúdo visível', async () => {
    const tela = await render(
      <ModalScreen testID="conteudo">
        <Text>conteúdo</Text>
      </ModalScreen>,
    );
    const estilo = StyleSheet.flatten(tela.getByTestId('conteudo').props.style);
    expect(estilo.paddingTop).toBe(0);
    expect(tela.getByText('conteúdo')).toBeTruthy();
  });

  it('respeita o estilo passado por fora', async () => {
    const tela = await render(
      <ModalScreen testID="conteudo" style={{ backgroundColor: 'papayawhip' }}>
        <Text>conteúdo</Text>
      </ModalScreen>,
    );
    const estilo = StyleSheet.flatten(tela.getByTestId('conteudo').props.style);
    expect(estilo.backgroundColor).toBe('papayawhip');
  });
});
