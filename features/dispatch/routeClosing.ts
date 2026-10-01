/**
 * Fechar (status `completed`) ou despublicar (volta para `draft`) uma rota TIRA ela da tela do
 * motorista: ele só lê rota com `status = 'published'`. Se ainda houver parada pendente, o gestor
 * tem de LER, em palavras, quantas paradas ainda não terminaram e QUAIS cães ficam sem a rota —
 * e confirmar. Cancelou = nada muda.
 *
 * Decisão do dono (01/10/2026), depois do incidente de produção de 30/09/2026: o gestor publicou a
 * rota às 19:57:10 e 1 segundo depois ela virou `completed`, com as TRÊS paradas ainda `pending` —
 * o motorista ficou sem a rota do dia, sem aviso nenhum. Para ação que TIRA algo da tela, o app diz
 * o que vai sair e pede o ok.
 *
 * Módulo puro: a tela só monta o alerta com o que sai daqui, então o texto é testável sem UI.
 */

/** As duas ações que escondem a rota do motorista. */
export type FechamentoDeRota = 'complete' | 'unpublish';

/** O que o aviso precisa saber de uma parada: nome do cão e status. */
export type ParadaDeRota = { dogName: string; status: string };

/**
 * Paradas que ainda não terminaram: tudo que NÃO é `completed` nem `skipped`.
 * `skipped` conta como resolvida (o motorista marcou "problem") — mesma definição que o
 * `optimize` da tela já usa para separar o que falta do que já fechou.
 */
export function paradasPendentes<T extends ParadaDeRota>(stops: T[]): T[] {
  return stops.filter((parada) => parada.status !== 'completed' && parada.status !== 'skipped');
}

export type AvisoDeFechamento = { title: string; message: string; confirmLabel: string };

/**
 * Texto do alerta. O gestor lê em inglês (a tela dele é em inglês):
 *  - quantas paradas ainda estão pendentes e o nome dos cães — `3 stops still pending: Rex, Nina, Bob`;
 *  - o efeito da ação — `The driver will no longer see this route on his phone.`
 */
export function avisoDeFechamento(acao: FechamentoDeRota, pendentes: ParadaDeRota[]): AvisoDeFechamento {
  const quantas = pendentes.length;
  const nomes = pendentes.map((parada) => parada.dogName).join(', ');
  const paradas = quantas === 1 ? '1 stop still pending' : `${quantas} stops still pending`;
  return {
    title: acao === 'complete' ? 'Close this route?' : 'Unpublish this route?',
    message: `${paradas}: ${nomes}\n\nThe driver will no longer see this route on his phone.`,
    confirmLabel: acao === 'complete' ? 'Close route' : 'Unpublish',
  };
}
