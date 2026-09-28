/**
 * Rótulo do STATUS da rota no quadro do Dispatch (28/09/2026).
 *
 * Bug do dono na varredura: uma rota **concluída** aparecia escrita como "Draft", porque o código só
 * conhecia `published` — qualquer outro status caía no texto de rascunho. Quem olha o quadro para saber
 * o que já foi feito lia o contrário do que aconteceu (o quadro mostra "✓ Done" e ao lado dizia "Draft").
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
