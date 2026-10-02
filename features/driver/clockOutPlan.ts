/**
 * PLANO DO CLOCK OUT — decide QUAL jornada o clock out fecha.
 *
 * 🪤 ACHADO DA VISTORIA (02/10/2026): o clock out procurava a jornada aberta SÓ nas jornadas do
 * banco (`shifts`). A jornada que o motorista abriu SEM SINAL mora na fila local
 * (`pendingWrites`), não no banco — então o clock out não a via, criava uma SEGUNDA jornada
 * fechada, e a entrada da fila, quando o sinal voltava, subia como jornada ABERTA e ficava órfã
 * para sempre (o relatório de horas nunca fechava aquele dia).
 *
 * A regra: se existe uma jornada aberta na FILA, o clock out atualiza ESSA MESMA entrada (com a
 * saída) em vez de criar outra. Se existe uma aberta no BANCO, fecha ela e limpa a duplicata da
 * fila. Se não existe nenhuma, aí sim nasce uma jornada fechada nova (deduzida dos eventos).
 *
 * Módulo puro (sem rede): o `driver.tsx` lê o plano e executa.
 */
import { enqueuePending, pendingOpenShift, type PendingWrite } from '@/features/driver/pendingWrites';
import type { ManualShift } from '@/features/driver/shift';

export type ClockOutPlan = {
  /** Jornada aberta no BANCO que será fechada (`endManualShift`); null = não há. */
  abertaNoBanco: { id: string } | null;
  /** Início da jornada (da fila, do banco ou da dedução dos eventos). */
  startedAt: string;
  /** Motivo de entrada gravado junto (da fila/banco) — o gestor vê que foi exceção. */
  startReason: string;
  /** Fila local DEPOIS do plano: nunca com uma jornada ABERTA duplicando outra. */
  queue: PendingWrite[];
  /** true = o fechamento fica SÓ no aparelho (a jornada nunca chegou ao banco). */
  fechaNaFila: boolean;
};

export function planClockOut(entrada: {
  /** Jornadas manuais de hoje vindas do BANCO. */
  shifts: ManualShift[];
  /** Fila local de escritas ainda não subidas. */
  queue: PendingWrite[];
  /** Início da jornada deduzida dos eventos da rota (fallback). */
  journeyStartedAt: string | null;
  /** Agora (ISO) — a hora da saída. */
  now: string;
  /** Motivo da saída digitado pelo motorista. */
  endReason: string | null;
  /** Rota atual (entra no registro que ficar na fila). */
  routeId?: string | null;
}): ClockOutPlan {
  const { shifts, queue, journeyStartedAt, now, endReason, routeId = null } = entrada;
  const abertaNoBanco = shifts.find((registro) => registro.endedAt === null) ?? null;
  const filaAberta = pendingOpenShift(queue);

  const startedAt = abertaNoBanco?.startedAt ?? filaAberta?.startedAt ?? journeyStartedAt ?? now;
  const startReason = abertaNoBanco?.startReason ?? filaAberta?.startReason ?? 'Journey closed manually';

  if (abertaNoBanco) {
    // A jornada já está no banco: a fila não pode guardar a MESMA jornada aberta (viraria uma
    // segunda aberta quando subisse). Remove a entrada redundante.
    const fila = filaAberta ? queue.filter((entry) => entry.kind !== 'shift') : queue;
    return { abertaNoBanco: { id: abertaNoBanco.id }, startedAt, startReason, queue: fila, fechaNaFila: false };
  }

  if (filaAberta) {
    // A jornada abriu sem sinal: fecha a MESMA entrada da fila (entrada + saída numa linha só).
    const fila = enqueuePending(queue, {
      kind: 'shift',
      startedAt,
      endedAt: now,
      startReason,
      endReason,
      routeId: filaAberta.routeId ?? routeId,
      queuedAt: now,
    });
    return { abertaNoBanco: null, startedAt, startReason, queue: fila, fechaNaFila: true };
  }

  return { abertaNoBanco: null, startedAt, startReason, queue, fechaNaFila: false };
}
