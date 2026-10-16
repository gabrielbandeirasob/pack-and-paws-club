/**
 * PORTÃO DE VERSÃO — a regra pura (pedido do dono, 16/10/2026).
 *
 * "Quero que o app do cliente só funcione com a versão mais recente": o escritório testou build velha e
 * reportou como se o recurso novo não existisse, e o app vai por TestFlight (não existe auto-update nosso,
 * o OTA está desligado — `EXUpdatesEnabled = False`).
 *
 * A tabela `app_releases` guarda a build MÍNIMA; a publicação sobe esse número quando a build nova já está
 * liberada para os testadores. Estas três decisões são de propósito:
 * - **sem informação NÃO bloqueia** (tabela vazia, leitura falhou, ou a build nativa não existe — web e
 *   desenvolvimento): travar o motorista na rua porque o servidor não respondeu é pior que a build velha;
 * - **igual não bloqueia** (a build mínima é a que ele tem);
 * - **maior bloqueia** (a build dele é anterior à exigida).
 */
export type DecisaoDeVersao = 'ok' | 'atualizar' | 'sem-informacao';

/** A build do aparelho é anterior à mínima exigida? */
export function decidirVersao(
  buildAtual: number | null | undefined,
  buildMinima: number | null | undefined,
): DecisaoDeVersao {
  const atual = Number(buildAtual);
  const minima = Number(buildMinima);
  const temAtual = Number.isFinite(atual) && atual > 0;
  const temMinima = Number.isFinite(minima) && minima > 0;
  if (!temAtual || !temMinima) return 'sem-informacao';
  return atual < minima ? 'atualizar' : 'ok';
}
