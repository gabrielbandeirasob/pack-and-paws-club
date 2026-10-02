/**
 * RETOMADA DA FILA DO MOTORISTA — "tenta subir de novo a cada 30 s, mas só com o app ABERTO".
 *
 * MEDICAO/CUSTO (auditoria de desempenho, 02/10/2026): o motorista rodava um `setInterval` de 30 s na
 * tela do dia, com a tela ligada durante TODO o expediente (~8 h). São ~960 requisições `load(true)`
 * por dia — cada uma refaz a consulta de rota, van, jornada e fila. Com o app no bolso (tela apagada)
 * o aparelho continuava batendo no servidor, gastando bateria e dados do motorista sem motivo.
 *
 * O que muda (e por quê):
 *  * a tentativa continua condicionada a PENDÊNCIA REAL (`pendingSync > 0`) — dia limpo não faz
 *    requisição nenhuma (comportamento que já existia; fica travado no teste);
 *  * em SEGUNDO PLANO (`background`/`inactive`) a tentativa é pulada: o timer pode até acordar, mas
 *    `deveTentarDeNovo` recusa;
 *  * ao VOLTAR ao foco (`active`) a tentativa é IMEDIATA: o motorista não espera os 30 s do relógio
 *    para ver a fila subir.
 *
 * Pura/testável de propósito: `deveTentarDeNovo` decide sem React nem rede; o hook só liga o relógio
 * e o listener do `AppState`.
 */
import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/** Intervalo entre tentativas, com o app em primeiro plano (mantém o valor antigo da tela). */
export const PENDING_RETRY_MS = 30_000;

/**
 * A tentativa só acontece com pendência REAL e app em PRIMEIRO PLANO.
 * `null` (o `AppState` ainda não sabe o estado, comum no boot) NÃO conta como ativo: sem saber, não
 * dispara — a volta ao foco (ou o relógio com o app ativo) recupera a próxima tentativa.
 */
export function deveTentarDeNovo(pendingSync: number, appState: AppStateStatus | null): boolean {
  return pendingSync > 0 && appState === 'active';
}

/**
 * Enquanto houver passo pendente, chama `retry` a cada `intervaloMs` — mas só com o app em primeiro
 * plano — e chama também na hora em que o app volta ao foco. Sem pendência não liga nada.
 */
export function usePendingSyncRetry(pendingSync: number, retry: () => void, intervaloMs: number = PENDING_RETRY_MS): void {
  useEffect(() => {
    if (pendingSync <= 0) return undefined;
    const tentar = () => {
      if (deveTentarDeNovo(pendingSync, AppState.currentState)) retry();
    };
    const timer = setInterval(tentar, intervaloMs);
    // Volta ao foco: tenta já, sem esperar o relógio. Em background o evento só transiciona para
    // 'background'/'inactive' (recusado por `deveTentarDeNovo`), então nada é chamado ali.
    const assinatura = AppState.addEventListener('change', (estado) => {
      if (deveTentarDeNovo(pendingSync, estado)) retry();
    });
    return () => {
      clearInterval(timer);
      assinatura.remove();
    };
  }, [pendingSync, retry, intervaloMs]);
}
