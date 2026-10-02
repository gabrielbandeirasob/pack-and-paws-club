/**
 * ESCOPO DA FILA DA JORNADA POR USUÁRIO — a jornada do motorista não "some" ao trocar de conta.
 *
 * A regra geral (chave por usuário + migração de leitura do que estava no aparelho) mora em
 * `scopedStorage.ts`; aqui é a ESPECIALIZAÇÃO para a fila de escritas do motorista
 * (`pendingWrites.ts`): chave base `pnp:driver:pending-writes` e o marcador de dono. Ver o 🪤 em
 * `scopedStorage.ts` para o defeito relatado pelo dono (jornada que sumia ao alternar motorista ↔
 * administrador). Ainda NÃO está ligado a `pendingWrites.ts`/`driver.tsx`; ver
 * `/opt/data/tmp/fix-jornada-regras.md` para a costura.
 */
import {
  chaveDeEscopo,
  decidirAdocao,
  gravarCru,
  lerCru,
} from '@/features/driver/scopedStorage';
import type { PendingWrite } from '@/features/driver/pendingWrites';

/** Chave ANTIGA, global e sem dono (o que a build publicada usa hoje). */
export const PENDING_WRITES_LEGACY_KEY = 'pnp:driver:pending-writes';

/** Marcador de quem já reivindicou a fila antiga (para ela não ser herdada por um 2º usuário). */
export const PENDING_WRITES_OWNER_KEY = 'pnp:driver:pending-writes:owner';

/** Chave da fila de UM usuário. */
export function pendingWritesKey(userId: string | null | undefined): string {
  return chaveDeEscopo(PENDING_WRITES_LEGACY_KEY, userId);
}

export type AdocaoDaFila = {
  /** A fila que ESTE usuário deve ler (a dele, a antiga adotada, ou vazia). */
  queue: PendingWrite[];
  /** true = adotou agora a fila antiga (sem dono) → gravar em `pendingWritesKey(userId)`. */
  adotouLegado: boolean;
  /** true = a fila antiga pertence a OUTRO usuário: não adotar e NÃO apagar. */
  legadoDeOutro: boolean;
};

/**
 * DECISÃO PURA da leitura (delegada a `decidirAdocao`), com o formato de fila do motorista:
 *  - já existe a chave DESTE usuário (mesmo vazia) → é ela que vale (nada de re-adotar);
 *  - não existe a dele e existe fila antiga SEM dono (ou marcada com ELE) → adota a antiga;
 *  - a antiga está marcada com OUTRO usuário → devolve vazia e não encosta na antiga (isolamento).
 */
export function decidirAdocaoDaFila(entrada: {
  userId: string;
  filaDoUsuario: PendingWrite[] | null;
  filaLegada: PendingWrite[] | null;
  donoDoLegado: string | null;
}): AdocaoDaFila {
  const decisao = decidirAdocao({
    chaveDoUsuarioExiste: entrada.filaDoUsuario !== null,
    legadoExiste: (entrada.filaLegada ?? []).length > 0,
    donoDoLegado: entrada.donoDoLegado,
    userId: entrada.userId,
  });
  if (decisao.deOutro) return { queue: [], adotouLegado: false, legadoDeOutro: true };
  if (decisao.adotar) return { queue: entrada.filaLegada ?? [], adotouLegado: true, legadoDeOutro: false };
  return { queue: entrada.filaDoUsuario ?? [], adotouLegado: false, legadoDeOutro: false };
}

/** Saneia a fila lida de uma chave: `null` = chave ausente; senão só jornada/aviso válidos. */
function sanear(raw: string | null): PendingWrite[] | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as PendingWrite[]).filter((entry) => entry && (entry.kind === 'shift' || entry.kind === 'eta_notice'));
  } catch {
    return null;
  }
}

/** Lê a fila DESTE usuário, migrando a fila antiga sem dono — uma vez, para um dono só. */
export async function carregarFilaDoUsuario(userId: string): Promise<PendingWrite[]> {
  const [rawUsuario, rawLegado, donoDoLegado] = await Promise.all([
    lerCru(pendingWritesKey(userId)),
    lerCru(PENDING_WRITES_LEGACY_KEY),
    lerCru(PENDING_WRITES_OWNER_KEY),
  ]);

  const decisao = decidirAdocaoDaFila({
    userId,
    filaDoUsuario: sanear(rawUsuario),
    filaLegada: sanear(rawLegado),
    donoDoLegado,
  });

  if (decisao.adotouLegado) {
    await gravarFilaDoUsuario(userId, decisao.queue);
    // A chave antiga fica MARCADA com o dono (não é apagada: é rede de segurança de quem reabrir com
    // a build antiga) — e assim um 2º usuário nunca a herda nem a apaga.
    await gravarCru(PENDING_WRITES_OWNER_KEY, userId);
  }
  return decisao.queue;
}

/** Grava a fila DESTE usuário (nunca na chave global sem dono). */
export async function gravarFilaDoUsuario(userId: string, queue: PendingWrite[]): Promise<void> {
  await gravarCru(pendingWritesKey(userId), JSON.stringify(queue));
}
