/**
 * Leitura/escrita da jornada e do aviso de ETA (a parte que fala com o Supabase).
 *
 * As REGRAS (deduzir jornada, montar resumo, texto da mensagem) moram nos módulos puros
 * shift.ts e etaMessage.ts — aqui só há acesso a dados e as escritas no banco.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { ManualShift, StopMilestones } from '@/features/driver/shift';
import type { EtaPhase } from '@/features/driver/etaMessage';

/** As colunas de marco da parada que a jornada deduzida precisa. */
export const STOP_MILESTONE_COLUMNS =
  'id, sequence, status, arrived_at, picked_up_at, completed_at, skipped_at, status_updated_at, eta_notice_at, eta_notice_kind';

export type ShiftRow = {
  id: string;
  started_at: string;
  ended_at: string | null;
  start_reason: string;
  end_reason: string | null;
  route_id: string | null;
};

export function stopFromRow(row: Record<string, unknown>): StopMilestones {
  return {
    id: String(row.id),
    sequence: Number(row.sequence ?? 0),
    status: String(row.status ?? 'pending'),
    arrivedAt: (row.arrived_at as string | null) ?? null,
    pickedUpAt: (row.picked_up_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
    skippedAt: (row.skipped_at as string | null) ?? null,
  };
}

export function shiftFromRow(row: ShiftRow): ManualShift {
  return {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    startReason: row.start_reason,
    endReason: row.end_reason,
  };
}

/** Jornadas manuais do motorista no dia (o app só precisa das de hoje). */
export async function loadDriverShifts(
  client: SupabaseClient,
  params: { driverId: string; dayStart: string; dayEnd: string },
): Promise<ManualShift[]> {
  const { data, error } = await client
    .from('driver_shifts')
    .select('id, started_at, ended_at, start_reason, end_reason, route_id')
    .eq('driver_id', params.driverId)
    .gte('started_at', params.dayStart)
    .lt('started_at', params.dayEnd)
    .order('started_at', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as ShiftRow[]).map(shiftFromRow);
}

export type StartShiftResult = { mode: 'created' | 'already-open'; shiftId: string | null };

/**
 * Abre a jornada MANUAL (exceção). Se já existir uma aberta, o banco recusa pela constraint
 * única — e aqui isso NÃO é erro para o usuário: significa que ele já está em jornada.
 */
export async function startManualShift(
  client: SupabaseClient,
  params: { organizationId: string; driverId: string; routeId: string | null; reason: string; startedAt?: string },
): Promise<StartShiftResult> {
  const { data, error } = await client
    .from('driver_shifts')
    .insert({
      organization_id: params.organizationId,
      driver_id: params.driverId,
      route_id: params.routeId,
      start_reason: params.reason,
      ...(params.startedAt ? { started_at: params.startedAt } : {}),
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') return { mode: 'already-open', shiftId: null };
    throw new Error(error.message);
  }
  return { mode: 'created', shiftId: (data as { id: string } | null)?.id ?? null };
}

/** Fecha a jornada manual aberta. */
export async function endManualShift(
  client: SupabaseClient,
  params: { shiftId: string; reason: string; endedAt?: string },
): Promise<void> {
  const { error } = await client
    .from('driver_shifts')
    .update({ ended_at: params.endedAt ?? new Date().toISOString(), end_reason: params.reason })
    .eq('id', params.shiftId);
  if (error) throw new Error(error.message);
}

/**
 * Grava uma jornada JÁ FECHADA de uma vez (entrada + saída + motivos).
 *
 * É o caminho de dois casos: (a) o motorista fecha no fim do dia uma jornada que tinha sido
 * deduzida dos eventos da rota; (b) registro feito sem sinal, que subiu depois pela fila local.
 * `started_at`/`ended_at` vão explícitos porque são o horário em que o fato aconteceu.
 */
export async function createClosedShift(
  client: SupabaseClient,
  params: {
    organizationId: string;
    driverId: string;
    routeId: string | null;
    startedAt: string;
    endedAt: string;
    startReason: string;
    endReason: string | null;
  },
): Promise<void> {
  const { error } = await client.from('driver_shifts').insert({
    organization_id: params.organizationId,
    driver_id: params.driverId,
    route_id: params.routeId,
    started_at: params.startedAt,
    ended_at: params.endedAt,
    start_reason: params.startReason,
    end_reason: params.endReason,
  });
  if (error) throw new Error(error.message);
}

/**
 * Registra no histórico da parada que o motorista avisou o tutor (hora do SERVIDOR + fase).
 * Roda pela RPC `mark_eta_notice`, que respeita o RLS do motorista.
 */
export async function markEtaNotice(client: SupabaseClient, stopId: string, phase: EtaPhase): Promise<string> {
  const { data, error } = await client.rpc('mark_eta_notice', { p_stop: stopId, p_kind: phase });
  if (error) throw new Error(error.message);
  return typeof data === 'string' ? data : new Date().toISOString();
}

/* ------------------------------------------------------------------ *
 * RESUMO DO GESTOR: rotas + paradas + jornadas de um período
 * ------------------------------------------------------------------ */

export type ManagerRouteRow = {
  id: string;
  route_date: string;
  driver_id: string | null;
  profile?: { full_name?: string | null } | null;
  route_stops: Record<string, unknown>[] | null;
};

export type ManagerShiftRow = ShiftRow & { driver_id: string };

/**
 * Nome de cada motorista da organização (id → nome).
 *
 * Necessário porque `driver_shifts.driver_id` aponta para `auth.users` (não dá para embutir
 * `profiles` direto no select) e um motorista que só teve jornada manual — sem rota — precisa
 * aparecer com nome na tela do gestor, não como "Driver".
 */
export async function loadDriverNames(client: SupabaseClient, organizationId: string): Promise<Record<string, string>> {
  const { data, error } = await client
    .from('organization_members')
    .select('user_id, role, profile:profiles(full_name)')
    .eq('organization_id', organizationId)
    .eq('role', 'driver');
  if (error) return {};
  const linhas = (data ?? []) as unknown as { user_id: string; profile?: { full_name?: string | null } | null }[];
  return Object.fromEntries(linhas.map((linha) => [linha.user_id, linha.profile?.full_name?.trim() || 'Driver']));
}

/** Rotas do período com as paradas (marcos) e o nome do motorista. */
export async function loadOrganizationRoutes(
  client: SupabaseClient,
  params: { organizationId: string; from: string; to: string },
): Promise<ManagerRouteRow[]> {
  const { data, error } = await client
    .from('routes')
    .select(`id, route_date, driver_id, profile:profiles(full_name), route_stops(${STOP_MILESTONE_COLUMNS})`)
    .eq('organization_id', params.organizationId)
    .gte('route_date', params.from)
    .lte('route_date', params.to)
    .order('route_date', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ManagerRouteRow[];
}

/** Jornadas manuais do período (todos os motoristas da organização). */
export async function loadOrganizationShifts(
  client: SupabaseClient,
  params: { organizationId: string; from: string; to: string },
): Promise<ManagerShiftRow[]> {
  const { data, error } = await client
    .from('driver_shifts')
    .select('id, driver_id, started_at, ended_at, start_reason, end_reason, route_id')
    .eq('organization_id', params.organizationId)
    .gte('started_at', params.from)
    .lt('started_at', params.to)
    .order('started_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ManagerShiftRow[];
}
