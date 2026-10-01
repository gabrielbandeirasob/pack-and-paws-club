/**
 * PARADAS DE UMA ROTA, com os marcos de tempo — carga usada pela tela `route-stops` (o gestor clica
 * no motorista em "Today's routes" e abre a lista dos pick-ups).
 *
 * Fica FORA da tela de propósito: a consulta e o mapeamento são testáveis sem render, e a tela só
 * desenha. Os marcos (`arrived_at`/`picked_up_at`/`completed_at`/`skipped_at`) são carimbados no
 * SERVIDOR desde a migration 024 — aqui só se lê.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

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
