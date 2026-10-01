/**
 * ATRIBUIÇÃO EM LOTE PARCIAL — a mensagem que o gestor lê quando parte dos cães não entrou.
 *
 * Pedido/melhoria do dono (01/10/2026): na atribuição de irmãos de casa, **um erro no meio
 * interrompia o resto** — o primeiro cão entrava, o segundo falhava e os demais simplesmente não eram
 * tentados, sem o gestor saber quais ficaram de fora. Agora o lote continua e o app diz, em uma
 * frase, quantos cães entraram e **quais** ficaram pendentes.
 *
 * Módulo puro: a frase é montada aqui (testável) e o erro só é levantado com ela.
 */
import { plural } from '@/lib/plural';

export type FalhaParcial = {
  dogId: string;
  dogName: string;
  /** Motivo cru da recusa (o mesmo texto que a tela já mostra para erro de escrita). */
  motivo: string;
};

/**
 * Frase do resultado parcial. Ex.:
 *  - `1 dog could not be saved: Ollie — permission denied. 2 dogs were saved; try that one again.`
 *  - `2 dogs could not be saved: Luna, Bella — permission denied. Nothing was saved.`
 */
export function avisoDeFalhaParcial(falhas: FalhaParcial[], salvos: number): string {
  if (falhas.length === 0) return '';
  const nomes = falhas.map((falha) => falha.dogName).join(', ');
  const motivo = falhas[0].motivo;
  const motivoExtra = falhas.length > 1 && new Set(falhas.map((f) => f.motivo)).size > 1
    ? ' (first reason shown)'
    : '';
  const entraram = salvos === 0
    ? 'Nothing was saved.'
    : `${plural(salvos, 'dog was', 'dogs were')} saved; try ${falhas.length === 1 ? 'that one' : 'those'} again.`;
  return `${plural(falhas.length, 'dog', 'dogs')} could not be saved: ${nomes} — ${motivo}${motivoExtra}. ${entraram}`;
}
