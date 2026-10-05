/**
 * Rótulo do STATUS da rota no quadro do Dispatch (28/09/2026).
 *
 * Bug do dono na varredura: uma rota **concluída** aparecia escrita como "Draft", porque o código só
 * conhecia `published` — qualquer outro status caía no texto de rascunho. Quem olha o quadro para saber
 * o que já foi feito lia o contrário do que aconteceu (o quadro mostra "✓ Done" e ao lado dizia "Draft").
 *
 * Redesenho do Dispatch (05/10/2026): o status do cartão passou a ser um BADGE compacto colado no nome
 * (`Draft` / `Published` / `Needs update` / `Completed`) e o antigo sufixo ` · Draft` continua existindo
 * para quem já o lê (a Home usa `rotuloDeStatus` para montar o subtítulo).
 */
export type RouteStatus = 'draft' | 'published' | 'completed' | 'cancelled';

const ROTULOS: Record<RouteStatus, string> = {
  draft: ' · Draft',
  published: ' · Published',
  completed: ' · Completed',
  cancelled: ' · Cancelled',
};

/** Sufixo do rótulo (com o " · " na frente) — string vazia quando não há rota. */
export function rotuloDeStatus(status: RouteStatus | null | undefined): string {
  if (!status) return '';
  return ROTULOS[status] ?? ' · Draft';
}

const BADGES: Record<RouteStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** Texto CURTO do badge de status do cartão (sem o " · " da frente). */
export function rotuloDoBadge(status: RouteStatus | null | undefined): string {
  if (!status) return '';
  return BADGES[status] ?? 'Draft';
}

/**
 * AVISO de rota invisível para o motorista (dono, 01/10/2026).
 *
 * O motorista **só lê rota `published`**: uma rota em rascunho com todas as paradas prontas tem a
 * mesma cara, no quadro, de uma rota publicada — e o gestor fica esperando o motorista sair com o
 * carro sem que nada tenha chegado ao celular dele (foi o incidente de 30/09/2026, pelo lado
 * oposto: a rota saiu da tela do motorista sem ninguém perceber). O aviso aparece **na linha de
 * status do próprio cartão**, que é onde o gestor olha.
 *
 * Redesenho (05/10/2026, item 14): a frase longa `Draft — the driver can't see it yet` virou uma
 * linha discreta embaixo do badge `Draft` — o badge já diz o estado, a linha só explica que o
 * motorista ainda não vê.
 *
 * Só o rascunho ganha o aviso: `completed` e `cancelled` também não aparecem para o motorista, mas
 * ali isso é o resultado esperado da ação que o gestor acabou de tomar.
 */
export const AVISO_NAO_VISIVEL = 'Not visible to driver yet';

export function avisoDeRotaInvisivel(status: RouteStatus | null | undefined): string | null {
  return status === 'draft' ? AVISO_NAO_VISIVEL : null;
}

/**
 * REGRA PURA de republicação (dono, 05/10/2026 — item 15 do redesenho).
 *
 * Hoje o `Republish` aparecia SEMPRE numa rota publicada, mesmo quando o dia não tinha mudado nada
 * desde a publicação — o gestor era convidado a republicar por nada (e o número de "changes" não
 * existia). A pergunta certa é: a rota publicada ainda corresponde ao dia? Ela deixa de corresponder
 * quando (a) alguma parada da rota saiu do dia confirmado (reserva cancelada/substituída) OU (b) há
 * cão do dia ainda em UNASSIGNED (reserva nova que entrou depois de a rota ser publicada).
 *
 * Fontes: só o que a tela JÁ tem — `status` da rota, `foraDoDia` (de `paradasForaDoDia`) e
 * `unassigned`. Nada de consulta nova.
 */
export type MudancaNaoPublicada = { foraDoDia: number; unassigned: number };

/** Quantas mudanças o dia tem em relação ao que foi publicado (paradas fora do dia + cães soltos). */
export function mudancasNaoPublicadas(mudanca: MudancaNaoPublicada): number {
  return Math.max(0, mudanca.foraDoDia || 0) + Math.max(0, mudanca.unassigned || 0);
}

/**
 * A rota PUBLICADA precisa ser republicada? 
 *  - draft → não (publicar é o primeiro passo, não é republicar);
 *  - published sem mudança → não (é o defeito que este item corrige);
 *  - published com parada cancelada (fora do dia) → sim;
 *  - published com cão novo ainda em unassigned → sim;
 *  - completed/cancelled → não (a rota saiu de circulação de propósito).
 */
export function precisaRepublicar(status: RouteStatus | null | undefined, mudanca: MudancaNaoPublicada): boolean {
  return status === 'published' && mudancasNaoPublicadas(mudanca) > 0;
}

/** Frase do topo do cartão quando a publicação ficou velha: `1 unpublished change` / `2 unpublished changes`. */
export function avisoDeRepublicacao(status: RouteStatus | null | undefined, mudanca: MudancaNaoPublicada): string | null {
  if (!precisaRepublicar(status, mudanca)) return null;
  const total = mudancasNaoPublicadas(mudanca);
  return `${total} unpublished change${total === 1 ? '' : 's'}`;
}
