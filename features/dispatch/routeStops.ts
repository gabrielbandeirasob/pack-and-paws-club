/**
 * PARADAS DE UMA ROTA, com os marcos de tempo — carga usada pela tela `route-stops` (o gestor clica
 * no motorista em "Today's routes" e abre a lista dos pick-ups).
 *
 * Fica FORA da tela de propósito: a consulta e o mapeamento são testáveis sem render, e a tela só
 * desenha. Os marcos (`arrived_at`/`picked_up_at`/`completed_at`/`skipped_at`) são carimbados no
 * SERVIDOR desde a migration 024 — aqui só se lê.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { LOCATION_COLUMNS, locationsFromRows, type OrganizationLocation } from '@/features/organization/locations';

export type ParadaDaRota = {
  id: string;
  sequence: number;
  dropoffSequence: number | null;
  status: string;
  clientName: string;
  dogName: string;
  address: string | null;
  arrivedAt: string | null;
  pickedUpAt: string | null;
  completedAt: string | null;
  skippedAt: string | null;
  /** Marco de ENTREGA (migration 202610010041): a tarde da rota, que a busca concluída não registra. */
  deliveredAt: string | null;
  exactTime: string | null;
  windowEnd: string | null;
};

/** Linha crua do PostgREST (embed de `route_stops` dentro de `routes`). */
export type ParadaDaLinha = {
  id: string;
  sequence: number | null;
  dropoff_sequence?: number | null;
  status?: string | null;
  arrived_at?: string | null;
  picked_up_at?: string | null;
  completed_at?: string | null;
  skipped_at?: string | null;
  delivered_at?: string | null;
  exact_time?: string | null;
  window_end?: string | null;
  dog?: { name?: string | null; client?: { name?: string | null; address_line_1?: string | null; city?: string | null } | null } | null;
};

/** Endereço de uma linha: `3111 La selva, San Mateo` (sem vírgula solta quando falta um pedaço). */
export function enderecoDaParada(dog: ParadaDaLinha['dog']): string | null {
  const rua = dog?.client?.address_line_1?.trim();
  const cidade = dog?.client?.city?.trim();
  if (rua && cidade) return `${rua}, ${cidade}`;
  return rua || cidade || null;
}

export function mapearParada(linha: ParadaDaLinha): ParadaDaRota {
  return {
    id: linha.id,
    sequence: linha.sequence ?? 0,
    dropoffSequence: linha.dropoff_sequence ?? null,
    status: linha.status ?? 'pending',
    clientName: linha.dog?.client?.name?.trim() || 'Client',
    dogName: linha.dog?.name?.trim() || 'Dog',
    address: enderecoDaParada(linha.dog),
    arrivedAt: linha.arrived_at ?? null,
    pickedUpAt: linha.picked_up_at ?? null,
    completedAt: linha.completed_at ?? null,
    skippedAt: linha.skipped_at ?? null,
    deliveredAt: linha.delivered_at ?? null,
    exactTime: linha.exact_time ?? null,
    windowEnd: linha.window_end ?? null,
  };
}

/** Ordem de leitura da lista: a ordem da BUSCA (a mesma numeração que o Dispatch mostra). */
export function ordenarParadas(paradas: ParadaDaRota[]): ParadaDaRota[] {
  return [...paradas].sort((a, b) => a.sequence - b.sequence);
}

/**
 * Ordem da ENTREGA (a tarde), a mesma que o motorista passa a ver depois de "Start drop-offs".
 *
 * 🪤 CLIENTE (02/10/2026): *"Onde eu vejo os drop off? Não tá aparecendo. Os pick up estavam."* A tela do
 * gestor (`app/route-stops.tsx`) tinha SÓ a lista de pick-ups. Parada sem `dropoff_sequence` (o gestor
 * ainda não ordenou a tarde) vai para o fim, na ordem da busca — nunca desaparece da lista.
 */
export function ordenarParaEntrega(paradas: ParadaDaRota[]): ParadaDaRota[] {
  return [...paradas].sort((a, b) => {
    if (a.dropoffSequence == null) return b.dropoffSequence == null ? a.sequence - b.sequence : 1;
    if (b.dropoffSequence == null) return -1;
    return a.dropoffSequence - b.dropoffSequence || a.sequence - b.sequence;
  });
}

/**
 * Lê a rota e devolve as paradas já mapeadas e ordenadas.
 * `null` = a rota não existe / não está visível para quem pediu (RLS).
 */
export async function carregarParadasDaRota(
  client: SupabaseClient,
  routeId: string,
): Promise<ParadaDaRota[] | null> {
  const { data, error } = await client
    .from('routes')
    .select(
      'id, route_stops(id, sequence, dropoff_sequence, status, exact_time, window_end, arrived_at, picked_up_at, completed_at, skipped_at, delivered_at, dog:dogs(name, client:clients(name, address_line_1, city)))',
    )
    .eq('id', routeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const linhas = ((data as { route_stops?: ParadaDaLinha[] | null }).route_stops ?? []) as ParadaDaLinha[];
  return ordenarParadas(linhas.map(mapearParada));
}

/** As duas sedes que fecham o dia: onde a BUSCA termina (o yard) e onde o dia acaba (a van). */
export type FimDaRota = { start: OrganizationLocation | null; end: OrganizationLocation | null };

/**
 * Carrega o FIM da rota para a lista do gestor — pedido do CLIENTE (02/10/2026): *"as rota de pick up não
 * tão acabando no yard"*. Best-effort de propósito: qualquer falha devolve os dois nulos e a lista fica
 * como era (sem o cartão do fim) — acompanhar as paradas não pode depender disto.
 */
export async function carregarFimDaRota(client: SupabaseClient, routeId: string): Promise<FimDaRota> {
  const vazio: FimDaRota = { start: null, end: null };
  try {
    const { data, error } = await client
      .from('routes')
      .select('start_location_id, end_location_id')
      .eq('id', routeId)
      .maybeSingle();
    if (error || !data) return vazio;
    const rota = data as { start_location_id?: string | null; end_location_id?: string | null };
    const ids = [rota.start_location_id, rota.end_location_id].filter((id): id is string => Boolean(id));
    const { data: locais } = await client
      .from('organization_locations')
      .select(LOCATION_COLUMNS)
      .in('id', ids.length > 0 ? ids : ['']);
    const porId = new Map(locationsFromRows(locais).map((local) => [local.id, local]));
    return {
      start: rota.start_location_id ? porId.get(rota.start_location_id) ?? null : null,
      end: rota.end_location_id ? porId.get(rota.end_location_id) ?? null : null,
    };
  } catch {
    return vazio;
  }
}
