/**
 * Cliente REST do Google Calendar (v3) — chamadas puras, sem estado.
 * Tudo aqui recebe o access token e devolve dados/erros tratados; o fluxo OAuth fica no hook
 * `useCalendarConnection` e a persistência do token no secure store.
 *
 * Qual calendário: TODA chamada de evento recebe o `calendarId` da organização (o gestor escolhe —
 * ver `calendarChoice.ts`). O padrão continua sendo o `primary` da conta conectada, que era o
 * comportamento antigo: sem escolha gravada nada muda. O motivo de ser parâmetro, e não um segundo
 * caminho paralelo, é que as DUAS vias (espelho e importação) têm de ler/escrever no MESMO
 * calendário — foi um calendário secundário ("bot venda") que fez a importação parecer quebrada.
 */
import type { GoogleEventInput } from '@/features/calendar/googleEvents';
import { DEFAULT_CALENDAR_ID, interpretarCalendarios, normalizarCalendarId, type GoogleCalendarEntry } from './calendarChoice';
import { APP_KEY_PROPERTY, MIRROR_MARKER_PROPERTY, MIRROR_MARKER_VALUE, type RemoteEvent } from './calendarSync';

export const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

const GOOGLE_EVENT_ID_FIELD = 'googleEventId';

type GoogleEventResource = {
  id: string;
  summary?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  recurrence?: string[];
  extendedProperties?: { private?: Record<string, string> };
};

/** Resposta da API → formato do planejador. Eventos que nao sao nossos ficam com appKey null. */
export function parseEvent(resource: GoogleEventResource): RemoteEvent {
  return {
    id: resource.id,
    appKey: resource.extendedProperties?.private?.[APP_KEY_PROPERTY] ?? null,
    summary: resource.summary ?? '',
    startDate: resource.start?.date ?? (resource.start?.dateTime ?? '').slice(0, 10),
    endDate: resource.end?.date ?? (resource.end?.dateTime ?? '').slice(0, 10),
    recurrence: resource.recurrence ?? null,
  };
}

export function toEventBody(event: GoogleEventInput): Record<string, unknown> {
  const body: Record<string, unknown> = { summary: event.summary, start: event.start, end: event.end };
  if (event.description) body.description = event.description;
  if (event.recurrence) body.recurrence = event.recurrence;
  if (event.extendedProperties) body.extendedProperties = event.extendedProperties;
  return body;
}

export type CalendarFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
}

export class CalendarApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'CalendarApiError';
    this.status = status;
  }
}

async function handle<T>(response: Awaited<ReturnType<CalendarFetch>>, action: string): Promise<T> {
  if (!response.ok) {
    let detail = '';
    try {
      const payload = (await response.json()) as { error?: { message?: string } };
      detail = payload?.error?.message ?? '';
    } catch {
      detail = '';
    }
    throw new CalendarApiError(`${action} falhou (HTTP ${response.status})${detail ? `: ${detail}` : ''}`, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * Caminho do calendário na URL. O id do Google (`...@group.calendar.google.com`) tem `@` e `#`:
 * sem codificar, o `@` passa mas o `#` corta a URL no meio.
 */
function calendarPath(calendarId?: string | null): string {
  return encodeURIComponent(normalizarCalendarId(calendarId));
}

/**
 * Calendários da conta conectada (nome, se é o principal e o papel de acesso).
 *
 * Exige um escopo que `calendar.events` NÃO dá (`calendarList.list` recusa com "insufficient
 * authentication scopes"): por isso o app pede `calendar.calendarlist.readonly` junto. Token antigo
 * (conectado antes dessa mudança) falha aqui com HTTP 403 — a tela traduz isso em "reconecte".
 */
export async function listCalendars(accessToken: string, doFetch: CalendarFetch): Promise<GoogleCalendarEntry[]> {
  const url = `${CALENDAR_API}/users/me/calendarList?maxResults=250&showHidden=true`;
  const response = await doFetch(url, { method: 'GET', headers: authHeaders(accessToken) });
  const payload = await handle<unknown>(response, 'listar calendários');
  return interpretarCalendarios(payload);
}

/** Eventos do calendario entre duas datas (a janela que o app espelha). */
export async function listEvents(
  accessToken: string,
  range: { timeMin: string; timeMax: string },
  doFetch: CalendarFetch,
  calendarId: string = DEFAULT_CALENDAR_ID,
): Promise<RemoteEvent[]> {
  const url =
    `${CALENDAR_API}/calendars/${calendarPath(calendarId)}/events` +
    `?singleEvents=false&maxResults=2500&showDeleted=false` +
    `&timeMin=${encodeURIComponent(range.timeMin)}&timeMax=${encodeURIComponent(range.timeMax)}` +
    // O Google exige `nome=valor` (a chave sozinha devolve HTTP 400): por isso a marca fixa.
    `&privateExtendedProperty=${encodeURIComponent(`${MIRROR_MARKER_PROPERTY}=${MIRROR_MARKER_VALUE}`)}`;
  const response = await doFetch(url, { method: 'GET', headers: authHeaders(accessToken) });
  const payload = await handle<{ items?: GoogleEventResource[] }>(response, 'listar eventos');
  return (payload.items ?? []).map(parseEvent);
}

/**
 * TODOS os eventos da janela — inclusive os que o escritório digitou à mão no Google Calendar.
 *
 * Por que existe separado de `listEvents`: aquela filtra pela marca do app
 * (`privateExtendedProperty=packpawsMirror=v1`), ou seja, só enxerga o nosso espelho. Para trazer
 * para o app as datas marcadas direto no Google (pedido do dono, 23/09/2026) é preciso listar sem
 * esse filtro. Quem separa "nosso" de "do cliente" é a importação, pelo campo `appKey`.
 *
 * `singleEvents=false` mantém as séries como UM evento (com RRULE), que é o formato que o app
 * entende; expandir a série viraria dezenas de eventos soltos.
 */
export async function listAllEvents(
  accessToken: string,
  range: { timeMin: string; timeMax: string },
  doFetch: CalendarFetch,
  calendarId: string = DEFAULT_CALENDAR_ID,
): Promise<RemoteEvent[]> {
  const url =
    `${CALENDAR_API}/calendars/${calendarPath(calendarId)}/events` +
    `?singleEvents=false&maxResults=2500&showDeleted=false` +
    `&timeMin=${encodeURIComponent(range.timeMin)}&timeMax=${encodeURIComponent(range.timeMax)}`;
  const response = await doFetch(url, { method: 'GET', headers: authHeaders(accessToken) });
  const payload = await handle<{ items?: GoogleEventResource[] }>(response, 'listar todos os eventos');
  return (payload.items ?? []).map(parseEvent);
}

export async function createEvent(
  accessToken: string,
  event: GoogleEventInput,
  doFetch: CalendarFetch,
  calendarId: string = DEFAULT_CALENDAR_ID,
): Promise<string> {
  const response = await doFetch(`${CALENDAR_API}/calendars/${calendarPath(calendarId)}/events`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify(toEventBody(event)),
  });
  const created = await handle<{ id: string }>(response, 'criar evento');
  return created.id;
}

export async function updateEvent(
  accessToken: string,
  eventId: string,
  event: GoogleEventInput,
  doFetch: CalendarFetch,
  calendarId: string = DEFAULT_CALENDAR_ID,
): Promise<void> {
  const response = await doFetch(
    `${CALENDAR_API}/calendars/${calendarPath(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      headers: authHeaders(accessToken),
      body: JSON.stringify(toEventBody(event)),
    },
  );
  await handle<unknown>(response, 'atualizar evento');
}

export async function deleteEvent(
  accessToken: string,
  eventId: string,
  doFetch: CalendarFetch,
  calendarId: string = DEFAULT_CALENDAR_ID,
): Promise<void> {
  const response = await doFetch(
    `${CALENDAR_API}/calendars/${calendarPath(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'DELETE',
      headers: authHeaders(accessToken),
    },
  );
  await handle<unknown>(response, 'apagar evento');
}

export { GOOGLE_EVENT_ID_FIELD };
