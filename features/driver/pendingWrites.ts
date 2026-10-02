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
import { carregarFilaDoUsuario, pendingWritesKey } from '@/features/driver/pendingWritesScope';

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

/**
 * ESCOPO ATUAL DA FILA = usuário logado.
 *
 * 🪤 ACHADO DA VISTORIA (02/10/2026): a fila usava UMA chave GLOBAL e SEM DONO. Como o dono alterna
 * entre a conta de MOTORISTA e a de ADMINISTRADOR no mesmo aparelho, a jornada aberta de um usuário era
 * lida/subida pela conta seguinte — recusada pela RLS e DESCARTADA em silêncio, ou gravada com o
 * `driver_id` errado. A jornada "sumia" (relato do dono, 02/10/2026).
 *
 * Agora a chave é POR USUÁRIO (`pendingWritesScope.ts`) e a fila antiga sem dono é ADOTADA uma vez por
 * quem abrir primeiro (migração de leitura: nada se perde). Sem usuário (bootstrap/web) cai na chave
 * legada — nada muda para quem chama sem sessão.
 */
let escopoDaFila: string | null = null;

/** Define de QUEM é a fila daqui pra frente (a tela chama quando a sessão é conhecida). */
export function definirEscopoDaFila(userId: string | null | undefined): void {
  const id = (userId ?? '').trim();
  escopoDaFila = id.length > 0 ? id : null;
}

function chaveDaFila(): string {
  return pendingWritesKey(escopoDaFila);
}

/**
 * Abre a fila DO USUÁRIO: define o escopo e migra (uma vez) a fila antiga sem dono; devolve a fila
 * dele. É o que a tela chama logo depois de resolver a sessão, ANTES de ler/gravar qualquer coisa.
 */
export async function abrirFilaDoUsuario(userId: string): Promise<PendingWrite[]> {
  definirEscopoDaFila(userId);
  return carregarFilaDoUsuario(userId);
}

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
    const raw = await AsyncStorage.getItem(chaveDaFila());
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
    await AsyncStorage.setItem(chaveDaFila(), JSON.stringify(queue));
  } catch {
    // melhor esforço: sem storage não há fila
  }
}

/** Identidade estável de um registro (assunto + instante em que ENTROU na fila). */
export function chaveDoPendente(entry: PendingWrite): string {
  return `${chave(entry)}@${entry.queuedAt}`;
}

/**
 * SERIALIZADOR DO CICLO LER-MUDAR-GRAVAR.
 *
 * 🪤 ACHADO (02/10/2026): `loadPendingWrites()` → mudar → `savePendingWrites()` corria em DOIS
 * caminhos ao mesmo tempo (a subida da fila e o enfileiramento do `act`/clock in). Intercalados, o
 * `savePendingWrites(remaining)` da subida GRAVAVA POR CIMA do registro recém-enfileirado — o
 * motorista via "salvo no aparelho" e o passo sumia. Este é o único ponto de escrita: cada mudança
 * entra na VEZ da anterior (fila de promessas do módulo), então nunca há dois ciclos intercalados.
 *
 * `mudanca` recebe a fila MAIS NOVA (lida dentro da vez) e devolve a fila nova; o retorno é a fila
 * já gravada. Uma falha REJEITA o retorno de quem chamou, mas NÃO trava a vez dos próximos
 * (`vezDaFila = proxima.catch(...)`).
 */
let vezDaFila: Promise<unknown> = Promise.resolve();

export function mudarFila(
  mudanca: (fila: PendingWrite[]) => PendingWrite[] | Promise<PendingWrite[]>,
): Promise<PendingWrite[]> {
  const proxima = vezDaFila.then(async () => {
    const fila = await loadPendingWrites();
    const nova = await mudanca(fila);
    await savePendingWrites(nova);
    return nova;
  });
  vezDaFila = proxima.catch(() => undefined);
  return proxima;
}

/**
 * Só para a subida da fila: da fila VIVA tira os registros do RETRATO que realmente saíram (subiram
 * ou foram recusados de vez), casando chave + `queuedAt`. Qualquer registro enfileirado DURANTE o
 * envio permanece — nada de gravar "remaining" por cima da fila viva.
 */
export function semPendentesSaidos(
  atual: PendingWrite[],
  retrato: PendingWrite[],
  remaining: PendingWrite[],
): PendingWrite[] {
  const saidos = new Set(retrato.slice(0, retrato.length - remaining.length).map(chaveDoPendente));
  return atual.filter((entrada) => !saidos.has(chaveDoPendente(entrada)));
}
