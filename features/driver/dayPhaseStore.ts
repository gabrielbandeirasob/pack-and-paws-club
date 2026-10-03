/**
 * PERSISTÊNCIA DA FASE DO DIA (pick-up × drop-off) — separada das regras puras de propósito.
 *
 * A fase fica no APARELHO, pela rota de busca e por USUÁRIO (a mesma regra de dono das filas: trocar de conta no
 * mesmo aparelho não herda a perna do outro). O I/O é best-effort, no mesmo espírito de `pendingWrites`
 * — se o storage falhar, o motorista continua no que está na tela.
 *
 * Fica FORA de `dayPhase.ts` porque `dayPhase.ts` é importado pela tela (DriverRouteView), e a tela não
 * precisa (nem deve) arrastar o AsyncStorage para dentro do teste de renderização.
 */
import { type DayPhase } from '@/features/driver/dayPhase';
import { chaveDeEscopo, gravarCru, lerCru } from '@/features/driver/scopedStorage';

const FASE_BASE = 'pnp:driver:phase';

/** Escopo estável do dia: ID da busca (mesmo durante a entrega), de UM usuário. */
export function chaveDaFase(rotaId: string, userId: string | null | undefined): string {
  return chaveDeEscopo(`${FASE_BASE}:${rotaId}`, userId);
}

/** Lê a fase gravada. Ausência/erro = `pickup` (o dia começa buscando). */
export async function carregarFase(rotaId: string, userId: string | null | undefined): Promise<DayPhase> {
  const cru = await lerCru(chaveDaFase(rotaId, userId));
  return cru === 'dropoff' ? 'dropoff' : 'pickup';
}

/** Grava a fase. Best-effort: se falhar, o motorista continua no que está na tela. */
export async function gravarFase(rotaId: string, userId: string | null | undefined, fase: DayPhase): Promise<void> {
  await gravarCru(chaveDaFase(rotaId, userId), fase);
}

const BUSCA_BASE = 'pnp:driver:pickups-started';

/**
 * A BUSCA JÁ COMEÇOU? (dono, 03/10/2026 — *"quero que tudo siga pelas etapas: os cachorros do pick up só
 * apareçam depois de dar clock in e apertar pick up"*).
 *
 * É REVELAÇÃO DE TELA, não regra de negócio: antes de o motorista apertar, ele vê só o cartão da jornada —
 * e o botão que revela a lista ("Start pick-ups") só existe com a jornada ABERTA, então o "depois do clock
 * in" já está garantido por ele. Fica gravada no MESMO escopo da fase (rota de busca × usuário) para a lista
 * não voltar a se esconder quando a tela recarrega (foco, tempo real, reabrir o app).
 */
export function chaveDaBuscaIniciada(rotaId: string, userId: string | null | undefined): string {
  return chaveDeEscopo(`${BUSCA_BASE}:${rotaId}`, userId);
}

/** Lê a marca. Ausência/erro = ainda NÃO começou (a tela abre no cartão da jornada). */
export async function carregouABusca(rotaId: string, userId: string | null | undefined): Promise<boolean> {
  return (await lerCru(chaveDaBuscaIniciada(rotaId, userId))) === '1';
}

/** Marca que a busca começou. Best-effort: se o storage falhar, a tela revela nesta sessão do mesmo jeito. */
export async function gravarBuscaIniciada(rotaId: string, userId: string | null | undefined): Promise<void> {
  await gravarCru(chaveDaBuscaIniciada(rotaId, userId), '1');
}
