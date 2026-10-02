/**
 * RETOMADA DA FILA COM O APP ABERTO (auditoria de desempenho, 02/10/2026).
 *
 * O QUE ESTES TESTES TRAVAM (o custo que estava sendo pago sem motivo):
 *  - só há tentativa com PENDÊNCIA REAL (`pendingSync > 0`) — dia limpo não faz requisição;
 *  - com o app em SEGUNDO PLANO o timer pode acordar, mas NADA é chamado (era a requisição a cada
 *    30 s durante todo o expediente com o celular no bolso);
 *  - ao VOLTAR ao foco a tentativa é imediata (o motorista não espera o relógio);
 *  - sair da tela limpa o timer (nenhuma chamada depois do unmount).
 */
import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { PENDING_RETRY_MS, deveTentarDeNovo, usePendingSyncRetry } from '@/features/driver/usePendingSyncRetry';

describe('deveTentarDeNovo (decisão pura)', () => {
  it('só tenta com pendência real E app em primeiro plano', () => {
    expect(deveTentarDeNovo(1, 'active')).toBe(true);
    expect(deveTentarDeNovo(3, 'active')).toBe(true);
    // Sem pendência: nada a subir.
    expect(deveTentarDeNovo(0, 'active')).toBe(false);
    // Segundo plano: o app não deve bater no servidor.
    expect(deveTentarDeNovo(1, 'background')).toBe(false);
    expect(deveTentarDeNovo(1, 'inactive')).toBe(false);
    // Estado ainda desconhecido (boot) não conta como ativo: conservador, não dispara.
    expect(deveTentarDeNovo(1, null)).toBe(false);
  });
});

describe('usePendingSyncRetry', () => {
  const ouvintes: Array<(estado: string) => void> = [];
  const remover = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    ouvintes.length = 0;
    remover.mockClear();
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_tipo: string, handler: (estado: string) => void) => {
      ouvintes.push(handler);
      return { remove: remover };
    }) as never);
  });

  afterEach(() => {
    // `clearAllTimers` derruba o intervalo que um teste deixou montado — sem isso ele dispara no
    // meio do teste seguinte (o `AppState` é um mock reaproveitado).
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('com pendência e app ABERTO, tenta a cada 30 s', async () => {
    (AppState as unknown as { currentState: string }).currentState = 'active';
    const retry = jest.fn();
    await renderHook(() => usePendingSyncRetry(2, retry));

    await act(async () => {
      jest.advanceTimersByTime(PENDING_RETRY_MS);
    });
    expect(retry).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(PENDING_RETRY_MS);
    });
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it('sem pendência NÃO liga timer nem observer (dia limpo não faz requisição)', async () => {
    (AppState as unknown as { currentState: string }).currentState = 'active';
    const retry = jest.fn();
    await renderHook(() => usePendingSyncRetry(0, retry));

    await act(async () => {
      jest.advanceTimersByTime(PENDING_RETRY_MS * 5);
    });
    expect(retry).not.toHaveBeenCalled();
    expect(AppState.addEventListener).not.toHaveBeenCalled();
  });

  it('com app em SEGUNDO PLANO não chama, mesmo com pendência (a economia de bateria/dados)', async () => {
    (AppState as unknown as { currentState: string }).currentState = 'background';
    const retry = jest.fn();
    await renderHook(() => usePendingSyncRetry(1, retry));

    await act(async () => {
      jest.advanceTimersByTime(PENDING_RETRY_MS * 10);
    });
    expect(retry).not.toHaveBeenCalled();
  });

  it('ao VOLTAR ao foco tenta na hora (sem esperar os 30 s)', async () => {
    (AppState as unknown as { currentState: string }).currentState = 'background';
    const retry = jest.fn();
    await renderHook(() => usePendingSyncRetry(1, retry));

    await act(async () => {
      jest.advanceTimersByTime(PENDING_RETRY_MS);
    });
    expect(retry).not.toHaveBeenCalled();

    expect(ouvintes).toHaveLength(1);
    await act(async () => {
      ouvintes.forEach((handler) => handler('active'));
    });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('sair da tela limpa o timer e o observer (nada dispara depois)', async () => {
    (AppState as unknown as { currentState: string }).currentState = 'active';
    const retry = jest.fn();
    const { unmount } = await renderHook(() => usePendingSyncRetry(1, retry));
    await act(async () => {
      unmount();
    });

    await act(async () => {
      jest.advanceTimersByTime(PENDING_RETRY_MS * 3);
    });
    expect(retry).not.toHaveBeenCalled();
    expect(remover).toHaveBeenCalledTimes(1);
  });
});
