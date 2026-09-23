/**
 * Fila local de escritas do motorista que não subiram (sem sinal).
 *
 * Por que existe (critério de aceite da especificação 1.1): "sem sinal, o app guarda o registro
 * localmente e sincroniza depois, sem perder nem duplicar". A fila guarda DUAS coisas:
 *  - a JORNADA manual completa (entrada, saída e motivos) numa linha só — nada de meio registro;
 *  - o AVISO DE ETA já enviado pelo mensageiro, que só falta registrar no histórico da parada.
 *
 * Duplicar é impossível por construção: a jornada é inserida com `started_at` explícito e o banco
 * tem índice único de jornada aberta; o aviso é idempotente (regravar a mesma hora/fase não muda
 * nada de relevante).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { isNetworkError } from '@/features/driver/offlineStore';

export type PendingShift = {
  kind: 'shift';
  startedAt: string;
  endedAt: string | null;
  startReason: string;
  endReason: string | null;
  routeId: string | null;
  queuedAt: string;
};

export type PendingEtaNotice = {
  kind: 'eta_notice';
  stopId: string;
  phase: 'pickup' | 'dropoff';
  queuedAt: string;
};

export type PendingWrite = PendingShift | PendingEtaNotice;

const KEY = 'pnp:driver:pending-writes';

function chave(entry: PendingWrite): string {
  if (entry.kind === 'shift') return 'shift';
  return `eta:${entry.stopId}`;
}

/** Fila nova com o registro mais novo no fim, sem repetir o mesmo assunto (jornada / parada). */
export function enqueuePending(queue: PendingWrite[], entry: PendingWrite): PendingWrite[] {
  const alvo = chave(entry);
  return [...queue.filter((existente) => chave(existente) !== alvo), entry];
}

/** A jornada ainda aberta na fila (existe entrada sem saída). */
export function pendingOpenShift(queue: PendingWrite[]): PendingShift | null {
  const jornada = queue.find((entry): entry is PendingShift => entry.kind === 'shift');
  return jornada && jornada.endedAt === null ? jornada : null;
}

/** Quantos avisos de ETA estão esperando registro. */
export function pendingNoticeCount(queue: PendingWrite[]): number {
  return queue.filter((entry) => entry.kind === 'eta_notice').length;
}

export type FlushResult = {
  /** o que continua na fila (falha de rede: tenta de novo depois) */
  remaining: PendingWrite[];
  /** quantos subiram agora */
  sent: number;
  /** quantos falharam de vez (erro que não é de rede: não segura a fila) */
  dropped: number;
};

/**
 * Tenta enviar a fila em ordem. Falha de rede PARA a fila (o resto tenta depois, na mesma ordem);
 * erro que não é de rede descarta o item — não pode travar a sincronização para sempre.
 */
export async function flushPendingWrites(
  queue: PendingWrite[],
  enviar: (entry: PendingWrite) => Promise<void>,
): Promise<FlushResult> {
  let sent = 0;
  let dropped = 0;
  for (let indice = 0; indice < queue.length; indice += 1) {
    const entry = queue[indice];
    try {
      await enviar(entry);
      sent += 1;
    } catch (reason) {
      if (isNetworkError(reason)) {
        return { remaining: queue.slice(indice), sent, dropped };
      }
      dropped += 1;
    }
  }
  return { remaining: [], sent, dropped };
}

export async function loadPendingWrites(): Promise<PendingWrite[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingWrite[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => entry && (entry.kind === 'shift' || entry.kind === 'eta_notice'));
  } catch {
    return [];
  }
}

export async function savePendingWrites(queue: PendingWrite[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    // melhor esforço: sem storage não há fila
  }
}
