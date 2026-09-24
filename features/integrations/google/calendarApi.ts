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
import { interpretarEtiquetas, type EventLabel } from '@/features/calendar/googleColors';
import { addDaysISO } from '@/features/calendar/dates';
import { DEFAULT_CALENDAR_ID, interpretarCalendarios, normalizarCalendarId, type GoogleCalendarEntry } from './calendarChoice';
import { APP_KEY_PROPERTY, MIRROR_MARKER_PROPERTY, MIRROR_MARKER_VALUE, type RemoteEvent } from './calendarSync';

export const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

/**
 * `eventLabelVersion=1` — parâmetro das operações de ESCRITA com etiqueta.
 *
 * Bug 56 (produção, build 55): o Google trocou/ampliou o esquema de cor em junho/2026 (24 cores
 * padrão + até 200 personalizadas por calendário, via `labelProperties.eventLabels`; o evento passou
 * a ter `eventLabelId`). Sem este parâmetro a API assume a versão 0 na ESCRITA e processa `colorId`.
 * A descoberta oficial da API (revision 20260826) não aceita este parâmetro em `events.list/get`:
 * nessas leituras `eventLabelId` já faz parte do recurso Event devolvido.
 *
 * Doc: https://developers.google.com/workspace/calendar/api/guides/labels
 */
export const EVENT_LABEL_VERSION_PARAM = 'eventLabelVersion=1';

const GOOGLE_EVENT_ID_FIELD = 'googleEventId';

type GoogleEventResource = {
  id: string;
  summary?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  /** Cor do evento na paleta antiga (1..11) — só aparece em evento pintado antes das etiquetas. */
  colorId?: string;
  /** Etiqueta de cor do evento (paleta NOVA). */
  eventLabelId?: string;
  recurrence?: string[];
  extendedProperties?: { private?: Record<string, string> };
};

/**
 * Fim do evento em forma EXCLUSIVA — o formato que o planejador da importação espera
 * (ver `RemoteEvent.endDate`), igual ao que o Google usa no evento de dia inteiro.
 *
 * Por que normalizar aqui, e não lá na frente: `end.date` (dia inteiro) já vem EXCLUSIVO — um evento
 * de 25/09 manda `end.date = 26/09` —, enquanto `end.dateTime` (evento COM HORA) é INCLUSIVO: um
 * evento de 25/09 das 13h às 14h manda `end.dateTime = 25/09T14:00`, e 25/09 é o último dia do
 * evento. Os dois casos chegavam iguais no parser de recorrência e ele recuava um dia em ambos: num
 * evento com hora o fim INCLUSIVO recuava para o dia ANTERIOR ao do começo. Foi o defeito de
 * produção de 24/09/2026 ("1 item(s) from Google could not be saved"): a reserva do "dog pietro"
 * nascia com `end_date = 24/09` e `start_date = 25/09` e o banco recusava por
 * `check (end_date >= start_date)` (migração 202609090002).
 *
 * Meia-noite exata (25/09 22:00 → 26/09 00:00): o evento não ocupa minuto NENHUM do dia 26, então
 * esse fim já é exclusivo — não se soma o dia.
 *
 * Quem não tem data nenhuma devolve string vazia; a garantia dura do parser
 * (`fimNaoAntesDoInicio`, em `importPlan`) impede que isso vire data anterior ao começo.
 */
export function fimExclusivoDoEvento(end?: { date?: string; dateTime?: string } | null): string {
  if (!end) return '';
  if (end.date) return end.date;
  const dateTime = end.dateTime ?? '';
  const dia = dateTime.slice(0, 10);
  if (!dia) return '';
  const hora = dateTime.slice(11, 16);
  // `00:00` = já exclusivo; qualquer outro horário cobre o próprio dia -> o fim exclusivo é o seguinte.
  return hora === '00:00' ? dia : addDaysISO(dia, 1);
}

/** Resposta da API → formato do planejador. Eventos que nao sao nossos ficam com appKey null. */
export function parseEvent(resource: GoogleEventResource): RemoteEvent {
  return {
    id: resource.id,
    appKey: resource.extendedProperties?.private?.[APP_KEY_PROPERTY] ?? null,
    summary: resource.summary ?? '',
    startDate: resource.start?.date ?? (resource.start?.dateTime ?? '').slice(0, 10),
    endDate: fimExclusivoDoEvento(resource.end),
    // A cor acompanha o evento: é ela que diz o serviço na importação (não o título).
    colorId: resource.colorId ?? null,
    // Paleta NOVA: a etiqueta já faz parte do recurso Event devolvido pela leitura.
    eventLabelId: resource.eventLabelId ?? null,
    recurrence: resource.recurrence ?? null,
  };
}

export function toEventBody(event: GoogleEventInput): Record<string, unknown> {
  const body: Record<string, unknown> = { summary: event.summary, start: event.start, end: event.end };
  if (event.description) body.description = event.description;
  if (event.recurrence) body.recurrence = event.recurrence;
  // `colorId` vai no corpo mesmo quando o evento é atualizado por PATCH: é assim que um evento antigo
  // (sem cor) ganha a cor do serviço no próximo Sync.
  if (event.colorId) body.colorId = event.colorId;
  // Etiqueta: `null` = limpar (a API remove com string vazia); `undefined` = não mexe no que está lá.
  if (event.eventLabelId !== undefined) body.eventLabelId = event.eventLabelId ?? '';
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

/**
 * Etiquetas de cor do calendário (`labelProperties.eventLabels`) — a paleta NOVA do Google.
 *
 * Escopo: `GET /calendars/{id}` (Calendars.get) NÃO aceita `calendar.events` nem
 * `calendar.calendarlist.readonly` — exige um dos `calendar.calendars.readonly`, `calendar.calendars`,
 * `calendar.readonly`, `calendar` (ver `config.ts`, que passou a pedir `calendar.calendars.readonly`).
 * Token gravado ANTES desta mudança falha aqui com HTTP 403 "insufficient authentication scopes": o
 * cartão explica que é preciso reconectar, e a importação continua lendo a paleta antiga pelo
 * `colorId` (o espelho não quebra).
 *
 * Doc: https://developers.google.com/workspace/calendar/api/v3/reference/calendars/get
 */
export async function getCalendarLabels(
  accessToken: string,
  doFetch: CalendarFetch,
  calendarId: string = DEFAULT_CALENDAR_ID,
): Promise<EventLabel[]> {
  const response = await doFetch(`${CALENDAR_API}/calendars/${calendarPath(calendarId)}`, {
    method: 'GET',
    headers: authHeaders(accessToken),
  });
  const payload = await handle<unknown>(response, 'ler as cores do calendário');
  return interpretarEtiquetas(payload);
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
  // Versão 1 só quando há etiqueta. Sem etiqueta, omitir é obrigatório para a API processar o
  // `colorId` legado (com versão 1 o Google ignora colorId).
  const sufixo = event.eventLabelId !== undefined ? `?${EVENT_LABEL_VERSION_PARAM}` : '';
  const response = await doFetch(
    `${CALENDAR_API}/calendars/${calendarPath(calendarId)}/events${sufixo}`,
    {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(toEventBody(event)),
    },
  );
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
  const sufixo = event.eventLabelId !== undefined ? `?${EVENT_LABEL_VERSION_PARAM}` : '';
  const response = await doFetch(
    `${CALENDAR_API}/calendars/${calendarPath(calendarId)}/events/${encodeURIComponent(eventId)}${sufixo}`,
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
