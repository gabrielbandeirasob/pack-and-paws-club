/**
 * Planejamento do espelhamento (uma via) das reservas do Pack & Paws para o Google Calendar.
 *
 * Modulo puro: recebe as reservas locais e os eventos que ja existem no Google e devolve a
 * lista MINIMA de operacoes (criar / atualizar / apagar). Nada de rede aqui — o executor em
 * `calendarClient` faz as chamadas, e este modulo e coberto por testes.
 *
 * Idempotencia: cada evento carrega `extendedProperties.private.appKey = <id da reserva>`,
 * entao reexecutar o sync nao duplica eventos.
 */
import { buildGoogleEvent, type GoogleEventInput, type ReservationForSync } from '@/features/calendar/googleEvents';

export const APP_KEY_PROPERTY = 'appKey';

/**
 * Marca fixa que TODO evento do espelho carrega, além do appKey.
 *
 * Por que existe: `events.list` só filtra propriedade no formato `nome=valor` — mandar a chave
 * sozinha devolve HTTP 400 "A key or value missing in the extended_properties_match" (erro
 * aconteceu de verdade em 16/09/2026, no primeiro sync do gestor). Como o appKey muda a cada
 * reserva, ele não serve para filtrar a listagem: é esta marca constante que separa os nossos
 * eventos dos eventos do dono do calendário.
 */
export const MIRROR_MARKER_PROPERTY = 'packpawsMirror';
export const MIRROR_MARKER_VALUE = 'v1';

export type LocalReservation = ReservationForSync & { id: string };

export type RemoteEvent = {
  id: string;
  /** Valor de extendedProperties.private.appKey, quando existir. */
  appKey?: string | null;
  summary: string;
  startDate: string;
  endDate: string;
  recurrence?: string[] | null;
};

export type SyncAction =
  | { type: 'create'; reservationId: string; event: GoogleEventInput }
  | { type: 'update'; reservationId: string; eventId: string; event: GoogleEventInput }
  | { type: 'delete'; eventId: string };

export function appKeyOf(reservation: LocalReservation): string {
  return reservation.id;
}

/** Evento do Google pronto para envio, com a chave de idempotencia embutida. */
export function eventFor(reservation: LocalReservation): GoogleEventInput {
  return {
    ...buildGoogleEvent(reservation),
    extendedProperties: {
      private: {
        [APP_KEY_PROPERTY]: appKeyOf(reservation),
        [MIRROR_MARKER_PROPERTY]: MIRROR_MARKER_VALUE,
      },
    },
  };
}

function sameRecurrence(a?: string[] | null, b?: string[] | null): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((rule, index) => rule === right[index]);
}

/** Compara o que esta no Google com o que o app quer publicar. */
export function eventsEqual(desired: GoogleEventInput, remote: RemoteEvent): boolean {
  return (
    desired.summary === remote.summary &&
    desired.start.date === remote.startDate &&
    desired.end.date === remote.endDate &&
    sameRecurrence(desired.recurrence, remote.recurrence)
  );
}

/**
 * Operacoes necessarias. Deterministico: reservas fora de ordem produzem o mesmo plano.
 * Eventos remotos sem `appKey` sao ignorados (podem ser do dono do calendario, nao nossos).
 */
export function planCalendarSync(local: LocalReservation[], remote: RemoteEvent[]): SyncAction[] {
  const byKey = new Map<string, RemoteEvent>();
  for (const event of remote) {
    if (event.appKey) byKey.set(event.appKey, event);
  }

  const actions: SyncAction[] = [];
  const seen = new Set<string>();

  for (const reservation of [...local].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = appKeyOf(reservation);
    seen.add(key);
    const desired = eventFor(reservation);
    const existing = byKey.get(key);
    if (!existing) {
      actions.push({ type: 'create', reservationId: reservation.id, event: desired });
    } else if (!eventsEqual(desired, existing)) {
      actions.push({ type: 'update', reservationId: reservation.id, eventId: existing.id, event: desired });
    }
  }

  for (const event of remote) {
    if (event.appKey && !seen.has(event.appKey)) {
      actions.push({ type: 'delete', eventId: event.id });
    }
  }

  return actions;
}
