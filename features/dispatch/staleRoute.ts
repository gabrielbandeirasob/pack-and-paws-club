/**
 * Escrita concorrente nas rotas: quando dois gestores mexem na mesma rota, o banco recusa
 * a escrita de quem esta com dados velhos (erro `stale_route`) em vez de sobrescrever em
 * silencio (era o que fazia a ordem das paradas "voltar sozinha").
 *
 * O banco manda o erro como `stale_route` (codigo P0001). Aqui ficam as funcoes puras que
 * reconhecem esse caso e escrevem a mensagem que o gestor entende.
 */

/**
 * Redesenho/polimento (dono, 05/10/2026): a copy ficou explícita — o gestor lê o que aconteceu e o que
 * fazer. O botão (`Reload`) usa o verde escuro do app (modal próprio, ver `DispatchBoard`).
 */
export const STALE_ROUTE_MESSAGE = 'This route was updated elsewhere. Reload to see the latest version.';

export const STALE_ROUTE_TITLE = 'Route changed on another device';

/**
 * O banco recusou gravar numa rota CANCELADA (trigger da migração 202610040054).
 *
 * O caminho normal nunca passa por aqui: o app REATIVA a rota cancelada do dia antes de atribuir
 * (`reativarRotaCancelada`, dono 04/10/2026 — *"tentei fazer o dispatch e não iam para o driver"*). Esta
 * mensagem cobre a CORRIDA: o outro gestor cancela a rota entre a leitura e a escrita — e o gestor
 * precisa saber que a rota está cancelada, não ler um `P0001` cru.
 */
export const ROUTE_CANCELLED_MESSAGE = 'This route was cancelled. Assign the dogs again to reactivate it.';

function textoDoErro(erro: unknown): string {
  if (erro == null) return '';
  if (typeof erro === 'string') return erro;
  if (erro instanceof Error) return erro.message;
  if (typeof erro === 'object') {
    const obj = erro as { message?: unknown; details?: unknown; hint?: unknown };
    return [obj.message, obj.details, obj.hint].filter((v) => typeof v === 'string').join(' ');
  }
  return String(erro);
}

/** O erro veio de escrita concorrente (rota mudou em outro aparelho)? */
export function isStaleRouteError(erro: unknown): boolean {
  return /stale_route/i.test(textoDoErro(erro));
}

/** A escrita bateu numa rota CANCELADA (recusa do banco)? */
export function isRouteCancelledError(erro: unknown): boolean {
  return /route cancelled/i.test(textoDoErro(erro));
}

/** Mensagem para mostrar ao gestor: a de concorrencia quando for o caso, senao a original. */
export function routeErrorMessage(erro: unknown): string {
  if (isStaleRouteError(erro)) return STALE_ROUTE_MESSAGE;
  if (isRouteCancelledError(erro)) return ROUTE_CANCELLED_MESSAGE;
  const texto = textoDoErro(erro).trim();
  return texto || 'Unable to save.';
}

/** Versao a enviar na escrita: a que o aparelho leu (ou null = nao trava, app antigo). */
export function expectedVersion(versoes: Record<string, number>, routeId: string): number | null {
  const versao = versoes[routeId];
  return typeof versao === 'number' && Number.isFinite(versao) ? versao : null;
}
