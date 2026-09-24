/**
 * Executor do espelhamento: le o que esta no Google, planeja pelo modulo puro e aplica.
 * Falha em um evento NAO aborta os outros — o resumo diz o que passou e o que falhou.
 *
 * O calendario vem da organizacao (`calendarId`): sem escolha gravada, o padrao continua sendo o
 * `primary` da conta conectada e nada muda para quem ja usava.
 */
import { planCalendarSync, type LocalReservation } from './calendarSync';
import { createEvent, deleteEvent, listEvents, updateEvent, type CalendarFetch } from './calendarApi';
import { DEFAULT_CALENDAR_ID } from './calendarChoice';

export type SyncSummary = {
  created: number;
  updated: number;
  deleted: number;
  failures: { action: string; eventId?: string; reservationId?: string; error: string }[];
};

export type SyncParams = {
  accessToken: string;
  reservations: LocalReservation[];
  range: { timeMin: string; timeMax: string };
  doFetch: CalendarFetch;
  /** Calendario escolhido pela organizacao (o mesmo da importacao). Padrao: o principal. */
  calendarId?: string;
};

export async function runCalendarSync({
  accessToken,
  reservations,
  range,
  doFetch,
  calendarId = DEFAULT_CALENDAR_ID,
}: SyncParams): Promise<SyncSummary> {
  const remotos = await listEvents(accessToken, range, doFetch, calendarId);
  const actions = planCalendarSync(reservations, remotos);

  const summary: SyncSummary = { created: 0, updated: 0, deleted: 0, failures: [] };

  for (const action of actions) {
    try {
      if (action.type === 'create') {
        await createEvent(accessToken, action.event, doFetch, calendarId);
        summary.created += 1;
      } else if (action.type === 'update') {
        await updateEvent(accessToken, action.eventId, action.event, doFetch, calendarId);
        summary.updated += 1;
      } else {
        await deleteEvent(accessToken, action.eventId, doFetch, calendarId);
        summary.deleted += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.failures.push({
        action: action.type,
        eventId: action.type === 'create' ? undefined : action.eventId,
        reservationId: action.type === 'delete' ? undefined : action.reservationId,
        error: message,
      });
    }
  }

  return summary;
}

export function hasChanges(summary: SyncSummary): boolean {
  return summary.created + summary.updated + summary.deleted > 0;
}

export function describeSummary(summary: SyncSummary): string {
  const parts: string[] = [];
  // Texto em inglês: é o idioma da interface do app (o cliente viu "Nada a sincronizar" no meio de
  // uma tela em inglês — corrigido em 23/09/2026).
  if (summary.created) parts.push(`${summary.created} created`);
  if (summary.updated) parts.push(`${summary.updated} updated`);
  if (summary.deleted) parts.push(`${summary.deleted} removed`);
  if (summary.failures.length) parts.push(`${summary.failures.length} failed`);
  return parts.length ? parts.join(' · ') : 'Nothing to sync — already up to date';
}
