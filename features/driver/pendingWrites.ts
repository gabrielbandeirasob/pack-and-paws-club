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

export type FlushResult = {
  /** o que continua na fila (falha de rede: tenta de novo depois) */
  remaining: PendingWrite[];
  /** quantos subiram agora */
  sent: number;
  /** quantos foram RECUSADOS de vez e saíram da fila (recusa definitiva) */
  dropped: number;
};

/**
 * Erro de RECUSA DEFINITIVA: o servidor já recusou este registro e tentar de novo nunca vai
 * funcionar (ex.: já existe uma jornada aberta no banco). É a ÚNICA situação em que a entrada
 * pode sair da fila, e quem envia precisa marcar o erro assim de propósito.
 */
export class RefusedWriteError extends Error {}

/** O servidor recusou de vez (constraint, RLS, duplicata): repetir não ajuda. */
const RECUSA_DEFINITIVA =
  /violates .*constraint|constraint .*violat|new row violates|row-level security|duplicate key|driver_shifts_uma_aberta|permission denied|not authorized|invalid input syntax/i;

/**
 * A falha é uma RECUSA definitiva (nada a fazer além de tirar da fila) ou algo que pode melhorar
 * depois (sem rede, organização ainda não disponível, sessão)? Só a recusa definitiva descarta.
 */
export function isDefinitiveWriteRefusal(reason: unknown): boolean {
  const mensagem =
    reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : String(reason ?? '');
  return reason instanceof RefusedWriteError || RECUSA_DEFINITIVA.test(mensagem);
}

/**
 * Tenta enviar a fila em ordem.
 *
 * - Falha de REDE: PARA a fila e tenta tudo de novo depois, na mesma ordem;
 * - Recusa DEFINITIVA (`isDefinitiveWriteRefusal`): o item sai da fila e a sincronização segue;
 * - Qualquer outra falha (a organização ainda não está disponível, sessão, banco fora do ar): a
 *   entrada FICA no aparelho e a fila para aqui.
 *
 * 🪤 ACHADO DA VISTORIA (02/10/2026): antes, TODO erro que não fosse de rede descartava o item em
 * silêncio — e como `organizationId` só existia com rota publicada, um clock in feito num dia sem
 * rota ("Organization not found for this account.") era APAGADO da fila sem o motorista saber. O dia
 * de trabalho sumia do relatório de horas. Agora só a recusa definida no banco descarta.
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
      if (isDefinitiveWriteRefusal(reason)) {
        dropped += 1;
        continue;
      }
      // Não é recusa definitiva: NADA é apagado — o registro continua no aparelho.
      return { remaining: queue.slice(indice), sent, dropped };
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
