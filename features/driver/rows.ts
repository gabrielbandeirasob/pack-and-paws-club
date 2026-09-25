import type { DriverStop } from '@/features/driver/DriverRouteView';

/**
 * Shape of a route_stops row as returned by PostgREST with the driver embed.
 * dogs/clients come back null when row-level security does not grant access,
 * so every nested value must be treated as optional (see migration 013).
 */
export type DriverStopRow = {
  id: string;
  sequence: number;
  status: DriverStop['status'];
  /** Parada agrupada por cliente (migration 029): mesmo cliente na mesma rota = mesma parada. */
  stop_group_id?: string | null;
  window_start?: string | null;
  window_end: string | null;
  exact_time: string | null;
  priority?: 'normal' | 'priority';
  pickup_proof_path?: string | null;
  dropoff_proof_path?: string | null;
  /** marcos carimbados no SERVIDOR (migration 024): a jornada do motorista é deduzida daqui */
  arrived_at?: string | null;
  picked_up_at?: string | null;
  completed_at?: string | null;
  skipped_at?: string | null;
  status_updated_at?: string | null;
  /** aviso de ETA já registrado nesta parada (hora do servidor) */
  eta_notice_at?: string | null;
  eta_notice_kind?: string | null;
  dog:
    | {
        id: string;
        name: string | null;
        behavior_notes: string | null;
        medical_notes: string | null;
        /** Foto do cão (bucket público dog-photos, migration 023) — é como o motorista reconhece o cão na porta. */
        photo_url?: string | null;
        client:
          | {
              name: string | null;
              address_line_1: string | null;
              city: string | null;
              phone?: string | null;
              latitude: number | null;
              longitude: number | null;
              client_instructions: { pickup_access_instructions: string | null } | null;
            }
          | null;
      }
    | null;
};

export type DriverRouteRow = {
  id: string;
  organization_id: string;
  lock_version: number;
  published_at: string | null;
  /** Sede escolhida pelo gestor para ESTA rota (migration 034). Nulo = vale a sede padrão da organização. */
  start_location_id?: string | null;
  end_location_id?: string | null;
  /** Configuração da creche (migration 020) - decide se a foto do comprovante é obrigatória. */
  organization: { proof_pickup_required: boolean; proof_dropoff_required: boolean } | null;
  route_stops: DriverStopRow[];
};

const UNKNOWN_DOG = 'Dog';
const UNKNOWN_CLIENT = 'Client';

/** Maps a database row to the driver stop model without ever throwing on missing embeds. */
export function rowToStop(row: DriverStopRow): DriverStop {
  const dog = row.dog ?? null;
  const client = dog?.client ?? null;
  return {
    id: row.id,
    dogId: dog?.id ?? null,
    groupId: row.stop_group_id ?? null,
    sequence: row.sequence,
    status: row.status,
    clientName: client?.name?.trim() || UNKNOWN_CLIENT,
    dogName: dog?.name?.trim() || UNKNOWN_DOG,
    address: client?.address_line_1 ?? null,
    city: client?.city ?? null,
    instructions: client?.client_instructions?.pickup_access_instructions ?? null,
    behaviorNotes: dog?.behavior_notes ?? null,
    medicalNotes: dog?.medical_notes ?? null,
    dogPhotoUrl: dog?.photo_url ?? null,
    clientPhone: client?.phone ?? null,
    etaNoticeAt: row.eta_notice_at ?? null,
    arrivedAt: row.arrived_at ?? null,
    pickedUpAt: row.picked_up_at ?? null,
    completedAt: row.completed_at ?? null,
    skippedAt: row.skipped_at ?? null,
    latitude: client?.latitude ?? null,
    longitude: client?.longitude ?? null,
    windowStart: row.window_start ? row.window_start.slice(0, 5) : null,
    windowEnd: row.window_end ? row.window_end.slice(0, 5) : null,
    exactTime: row.exact_time ? row.exact_time.slice(0, 5) : null,
    priority: row.priority ?? 'normal',
  };
}
