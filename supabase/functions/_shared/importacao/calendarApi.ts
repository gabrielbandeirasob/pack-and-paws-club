// GERADO por scripts/gera-importacao-compartilhada.mjs — NÃO EDITE ESTE ARQUIVO.
// Edite o original no app (features/...) e rode o gerador: o teste importacao-compartilhada falha
// se esta cópia ficar desatualizada.
/**
 * Cliente REST do Google Calendar (v3) — chamadas puras, **SOMENTE LEITURA**.
 *
 * Decisão do dono (05/10/2026): *"quero que o aplicativo apenas importe do cliente… quero remover essa
 * capacidade dele de criar ou mudar o calendário do cliente"*. Este arquivo tinha as funções de
 * escrita (`createEvent`, `updateEvent`, `deleteEvent`) do espelho — elas foram REMOVIDAS junto com o
 * espelho, e o escopo OAuth caiu para `calendar.events.readonly` (ver `config.ts`). Não existe mais,
 * em lugar nenhum do app, requisição que crie, altere ou apague evento no calendário do cliente; o
 * teste `__tests__/sem-escrita-no-google.test.ts` varre o código e falha se alguém reintroduzir uma.
 *
 * Tudo aqui recebe o access token e devolve dados/erros tratados; o fluxo OAuth fica no hook
 * `useCalendarConnection` e a persistência do token no secure store.
 *
 * Qual calendário: TODA chamada recebe o `calendarId` da organização (o gestor escolhe — ver
 * `calendarChoice.ts`). O padrão é o `primary` da conta conectada.
 */
import { interpretarEtiquetas, type EventLabel } from './googleColors.ts';
import { addDaysISO } from './dates.ts';
import { DEFAULT_CALENDAR_ID, interpretarCalendarios, normalizarCalendarId, type GoogleCalendarEntry } from './calendarChoice.ts';
import { APP_KEY_PROPERTY, type RemoteEvent } from './eventMarkers.ts';

export const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

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

/** Resposta da API → formato do planejador. `appKey` presente = evento criado pelo app (legado). */
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
 * 07/10/2026: `primary` muda ao trocar de conta; não é uma origem estável para cancelar reservas.
 * Usa o MESMO token da leitura dos eventos, nunca a identidade antiga em cache no aparelho.
 * Sem resposta, a origem fica desconhecida e a importação preserva reservas por ausência.
 */
export async function calendarIdDaOrigem(accessToken: string, doFetch: CalendarFetch, calendarId: string): Promise<string | null> {
  const id = normalizarCalendarId(calendarId);
  if (id !== DEFAULT_CALENDAR_ID) return id;
  try {
    const response = await doFetch(`${CALENDAR_API}/calendars/primary`, { method: 'GET', headers: authHeaders(accessToken) });
    const payload = await handle<{ id?: unknown }>(response, 'identificar o calendário principal');
    return typeof payload?.id === 'string' && payload.id.trim() && payload.id !== DEFAULT_CALENDAR_ID ? payload.id : null;
  } catch {
    return null;
  }
}

/**
 * Etiquetas de cor do calendário (`labelProperties.eventLabels`) — a paleta NOVA do Google.
 *
 * Escopo: `GET /calendars/{id}` (Calendars.get) NÃO aceita `calendar.events` nem
 * `calendar.calendarlist.readonly` — exige um dos `calendar.calendars.readonly`, `calendar.calendars`,
 * `calendar.readonly`, `calendar` (ver `config.ts`, que passou a pedir `calendar.calendars.readonly`).
 * Token gravado ANTES daquele pedido falha aqui com HTTP 403 "insufficient authentication scopes": o
 * cartão explica que é preciso reconectar, e a importação continua lendo a paleta antiga pelo
 * `colorId`.
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

/**
 * TODOS os eventos da janela — inclusive os que o escritório digitou à mão no Google Calendar.
 *
 * É a ÚNICA listagem de eventos do app (a listagem filtrada pela marca do espelho foi removida junto
 * com o espelho, 05/10/2026): quem separa "nosso" de "do cliente" é a importação, pelo campo `appKey`
 * (`if (evento.appKey) continue` em `importPlan`).
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
