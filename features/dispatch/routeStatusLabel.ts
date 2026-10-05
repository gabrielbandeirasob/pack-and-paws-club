/**
 * Rótulo do STATUS da rota no quadro do Dispatch (28/09/2026).
 *
 * Bug do dono na varredura: uma rota **concluída** aparecia escrita como "Draft", porque o código só
 * conhecia `published` — qualquer outro status caía no texto de rascunho. Quem olha o quadro para saber
 * o que já foi feito lia o contrário do que aconteceu (o quadro mostra "✓ Done" e ao lado dizia "Draft").
 *
 * Redesenho do Dispatch (05/10/2026): o status do cartão passou a ser um BADGE compacto colado no nome
 * (`Draft` / `Published` / `Completed` / `Cancelled`) e o antigo sufixo ` · Draft` continua existindo
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

/*
 * `Needs update` / `Republish changes` foram REMOVIDOS (dono, 05/10/2026), com a regra pura
 * `precisaRepublicar` / `avisoDeRepublicacao` / `mudancasNaoPublicadas`.
 *
 * Motivo (medido no banco): `route_versions` — o snapshot que `publish_route` grava — NUNCA é lido
 * por ninguém no app; o motorista lê `route_stops` AO VIVO (`app/(tabs)/driver.tsx`, filtrando só
 * `status='published'`). Republicar não muda nada para ele, então o badge nunca "limpava" (parada
 * cancelada não sai da rota ao publicar — quem remove é `Remove from route`) e cada republish subia
 * a `lock_version`, fazendo a pressa seguinte ser recusada como `stale_route` (alarme falso).
 * Ficou o que é real: `Publish route` (o portão rascunho→publicado) e o aviso `⚠ N booking changed`.
 */
