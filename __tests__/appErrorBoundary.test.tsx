import { Component, type ReactNode } from 'react';
import { Text } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

/**
 * `AppErrorBoundary` — a tela de recuperação da marca (substitui a ErrorBoundary crua do expo-router).
 * Módulo sem cobertura até aqui.
 *
 * O app a publica como `export { AppErrorBoundary as ErrorBoundary }` em `app/_layout.tsx`, que é o
 * contrato do expo-router: o FRAMEWORK captura o erro do render e entrega `error` + `retry` por
 * props; este componente é a TELA que aparece no lugar da tela branca / pilha crua.
 *
 * O único I/O é o `reportError`, falsificado aqui.
 */

const mockReportError = jest.fn();

jest.mock('@/features/errors/errorReporter', () => ({
  reportError: (...a: unknown[]) => mockReportError(...a),
}));

import { AppErrorBoundary } from '@/features/errors/AppErrorBoundary';

beforeEach(() => {
  jest.clearAllMocks();
  mockReportError.mockResolvedValue(true);
});

describe('AppErrorBoundary', () => {
  it('mostra a tela da marca (não tela branca) e registra o erro', async () => {
    const erro = new Error('boom no render');
    const tela = await render(<AppErrorBoundary error={erro} retry={jest.fn()} />);

    expect(tela.getByText('PACK & PAWS CLUB')).toBeTruthy();
    expect(tela.getByText('Something went wrong')).toBeTruthy();
    expect(tela.getByText(/reported automatically/i)).toBeTruthy();
    expect(tela.getByLabelText('Try again')).toBeTruthy();

    expect(mockReportError).toHaveBeenCalledWith(erro, { origem: 'boundary' });
    // Confirma na tela que o envio terminou (o "Report sent ✓").
    await waitFor(() => expect(tela.getByText('Report sent ✓')).toBeTruthy());
  });

  it('quando o envio NÃO dá certo, não mente que foi enviado', async () => {
    mockReportError.mockResolvedValue(false);
    const tela = await render(<AppErrorBoundary error={new Error('x')} retry={jest.fn()} />);

    await waitFor(() => expect(mockReportError).toHaveBeenCalled());
    expect(tela.queryByText('Report sent ✓')).toBeNull();
  });

  it('o botão "Try again" chama o retry que o expo-router passa', async () => {
    const retry = jest.fn().mockResolvedValue(undefined);
    const tela = await render(<AppErrorBoundary error={new Error('x')} retry={retry} />);

    await fireEvent.press(tela.getByLabelText('Try again'));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  /**
   * Fim a fim do contrato: um filho que LANÇA no render cai na tela de recuperação (e não na tela
   * branca), e o "Try again" RE-RENDERIZA o filho com sucesso.
   *
   * O `Catcher` local reproduz o papel do expo-router (que é quem captura o erro e injeta
   * `error`/`retry`): a checagem vive no framework, a TELA é o `AppErrorBoundary`.
   */
  it('filho que lança mostra a recuperação e o retry re-renderiza o filho', async () => {
    const erroSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    let mockDeveFalhar = true;

    function Explode() {
      if (mockDeveFalhar) throw new Error('render falhou');
      return <Text>Recovered content</Text>;
    }

    class Catcher extends Component<{ children: ReactNode }, { error: Error | null }> {
      state = { error: null as Error | null };
      static getDerivedStateFromError(error: Error) {
        return { error };
      }
      render() {
        if (this.state.error) {
          return (
            <AppErrorBoundary
              error={this.state.error}
              retry={async () => {
                mockDeveFalhar = false;
                this.setState({ error: null });
              }}
            />
          );
        }
        return this.props.children;
      }
    }

    try {
      const tela = await render(
        <Catcher>
          <Explode />
        </Catcher>,
      );

      // Em vez de tela branca / erro cru, a tela da marca aparece.
      expect(tela.getByText('Something went wrong')).toBeTruthy();

      await fireEvent.press(tela.getByLabelText('Try again'));

      await waitFor(() => expect(tela.getByText('Recovered content')).toBeTruthy());
      expect(tela.queryByText('Something went wrong')).toBeNull();
    } finally {
      erroSpy.mockRestore();
    }
  });
});
