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

/**
 * AVISO de rota invisível para o motorista (dono, 01/10/2026).
 *
 * O motorista **só lê rota `published`**: uma rota em rascunho com todas as paradas prontas tem a
 * mesma cara, no quadro, de uma rota publicada — e o gestor fica esperando o motorista sair com o
 * carro sem que nada tenha chegado ao celular dele (foi o incidente de 30/09/2026, pelo lado
 * oposto: a rota saiu da tela do motorista sem ninguém perceber). O aviso aparece **na linha de
 * status do próprio cartão**, que é onde o gestor olha.
 *
 * Só o rascunho ganha o aviso: `completed` e `cancelled` também não aparecem para o motorista, mas
 * ali isso é o resultado esperado da ação que o gestor acabou de tomar.
 */
export function avisoDeRotaInvisivel(status: RouteStatus | null | undefined): string | null {
  return status === 'draft' ? "Draft — the driver can't see it yet" : null;
}
