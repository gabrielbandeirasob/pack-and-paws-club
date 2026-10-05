/**
 * CLIENTE REST DO GOOGLE CALENDAR — só LEITURA (o espelho saiu em 05/10/2026).
 *
 * O que este arquivo guarda: a tradução do recurso cru da API para o formato que a importação usa
 * (`parseEvent`, com a cor/etiqueta que diz o serviço), a normalização do fim do evento (EXCLUSIVO),
 * a listagem de eventos SEM filtro de marca (o app lê tudo, inclusive o que o escritório digitou à
 * mão), a lista de calendários da conta e as cores/etiquetas do calendário escolhido.
 *
 * O que ele NÃO guarda mais: `createEvent`/`updateEvent`/`deleteEvent`/`toEventBody`/`listEvents` e o
 * planejador do espelho — removidos a pedido do dono ("quero que o aplicativo apenas importe"). A
 * trava que impede a volta deles é `__tests__/sem-escrita-no-google.test.ts`.
 */
import {
  CALENDAR_API,
  fimExclusivoDoEvento,
  getCalendarLabels,
  listAllEvents,
  listCalendars,
  parseEvent,
  type CalendarFetch,
} from '@/features/integrations/google/calendarApi';

const range = { timeMin: '2026-09-01T00:00:00Z', timeMax: '2026-12-31T00:00:00Z' };

/** Calendário secundário do escritório ("bot venda") — o id do Google tem `@` (vira `%40` na URL). */
const CALENDARIO_ESCOLHIDO = 'bot-venda@group.calendar.google.com';

/** Google falso em memória: responde o que o cliente de leitura pede. */
function fakeGoogle(seed: Record<string, unknown>[] = []) {
  const urls: string[] = [];
  const doFetch: CalendarFetch = async (url, init) => {
    urls.push(`${init.method} ${url}`);
    return { ok: true, status: 200, json: async () => ({ items: seed }) };
  };
  return { doFetch, urls };
}

describe('cliente do Google Calendar (leitura)', () => {
  it('lê evento do Google no formato do planejador (com a cor do serviço)', () => {
    const parsed = parseEvent({
      id: 'g-1',
      summary: 'Pietro',
      start: { date: '2026-09-10' },
      end: { date: '2026-09-11' },
      colorId: '2',
    });
    expect(parsed).toEqual({
      id: 'g-1',
      appKey: null,
      summary: 'Pietro',
      startDate: '2026-09-10',
      endDate: '2026-09-11',
      colorId: '2',
      eventLabelId: null,
      recurrence: null,
    });
  });

  it('lê a ETIQUETA do evento (paleta nova): o "Cobalto" do cliente chega como colorId nulo', () => {
    const parsed = parseEvent({
      id: 'g-2',
      summary: 'Kona',
      start: { date: '2026-09-10' },
      end: { date: '2026-09-11' },
      eventLabelId: '42617328-8756-4291-8273-192837465647',
    });
    expect(parsed.colorId).toBeNull();
    expect(parsed.eventLabelId).toBe('42617328-8756-4291-8273-192837465647');
  });

  it('evento sem cor chega com colorId nulo (a importação não chuta serviço)', () => {
    const parsed = parseEvent({ id: 'g-3', summary: 'Zara', start: { date: '2026-09-10' }, end: { date: '2026-09-11' } });
    expect(parsed.colorId).toBeNull();
  });

  it('aceita evento com hora e mantém appKey nulo quando não é nosso', () => {
    const parsed = parseEvent({
      id: 'g-4',
      summary: 'Bella',
      start: { dateTime: '2026-09-10T13:00:00-03:00' },
      end: { dateTime: '2026-09-10T14:00:00-03:00' },
    });
    expect(parsed.appKey).toBeNull();
    expect(parsed.startDate).toBe('2026-09-10');
    expect(parsed.endDate).toBe('2026-09-11');
  });

  it('reconhece evento criado pelo APP (legado do espelho) pela marca `appKey`', () => {
    // Eventos do espelho continuam no calendário do cliente: o `appKey` é o que a importação usa para
    // NÃO tratá-los como agendamento do escritório (`if (evento.appKey) continue`).
    const parsed = parseEvent({
      id: 'g-5',
      summary: 'Filó',
      start: { date: '2026-09-10' },
      end: { date: '2026-09-11' },
      extendedProperties: { private: { appKey: 'res:abc', packpawsMirror: 'v1' } },
    });
    expect(parsed.appKey).toBe('res:abc');
  });

  it('fim de evento com hora é normalizado para o formato EXCLUSIVO (e o de dia inteiro já vem assim)', () => {
    expect(fimExclusivoDoEvento({ dateTime: '2026-09-10T17:00:00-03:00' })).toBe('2026-09-11');
    // Meia-noite exata: o evento não ocupa minuto nenhum do dia seguinte -> já é exclusivo.
    expect(fimExclusivoDoEvento({ dateTime: '2026-09-11T00:00:00-03:00' })).toBe('2026-09-11');
    expect(fimExclusivoDoEvento({ dateTime: '2026-09-12T12:00:00-03:00' })).toBe('2026-09-13');
    expect(fimExclusivoDoEvento({ date: '2026-09-11' })).toBe('2026-09-11');
    expect(fimExclusivoDoEvento(undefined)).toBe('');
    expect(fimExclusivoDoEvento({})).toBe('');
  });

  it('lista TODOS os eventos da janela, sem filtro de marca, no calendário escolhido', async () => {
    const google = fakeGoogle([{ id: 'g-1', summary: 'Filo' }]);
    await listAllEvents('token', range, google.doFetch, CALENDARIO_ESCOLHIDO);

    const url = google.urls[0];
    expect(url.startsWith('GET ')).toBe(true);
    // Calendário com `@`: codificado na URL (senão o caminho quebra).
    expect(url).toContain(`${CALENDAR_API}/calendars/bot-venda%40group.calendar.google.com/events`);
    expect(url).toContain('singleEvents=false');
    expect(url).toContain(encodeURIComponent(range.timeMin));
    // SEM filtro de propriedade: é isso que traz o que o escritório digitou à mão no calendário.
    expect(url).not.toContain('privateExtendedProperty');
    // E sem o parâmetro de ESCRITA de etiqueta (a descoberta oficial não o aceita em leitura).
    expect(url).not.toContain('eventLabelVersion');
  });

  it('lista os calendários da conta (o seletor de calendário)', async () => {
    const urls: string[] = [];
    const doFetch: CalendarFetch = async (url, init) => {
      urls.push(`${init.method} ${url}`);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            { id: 'raphael@packandpawsclub.com', summary: 'Raphael', primary: true, accessRole: 'owner' },
            { id: 'bot-venda@group.calendar.google.com', summary: 'bot venda', accessRole: 'writer' },
            { summary: 'Sem id nenhum' },
          ],
        }),
      };
    };
    const lista = await listCalendars('t', doFetch);

    expect(urls[0]).toContain(`${CALENDAR_API}/users/me/calendarList`);
    // Sem id não dá para usar: fica de fora.
    expect(lista).toEqual([
      { id: 'raphael@packandpawsclub.com', summary: 'Raphael', primary: true, accessRole: 'owner' },
      { id: 'bot-venda@group.calendar.google.com', summary: 'bot venda', primary: false, accessRole: 'writer' },
    ]);
  });

  it('lê as cores do calendário (etiquetas da paleta nova) do calendário escolhido', async () => {
    const urls: string[] = [];
    const doFetch: CalendarFetch = async (url) => {
      urls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          kind: 'calendar#calendar',
          id: CALENDARIO_ESCOLHIDO,
          labelProperties: { eventLabels: [{ id: 'lab-azul', name: 'Cobalto', backgroundColor: '#4A86E8' }] },
        }),
      };
    };
    const etiquetas = await getCalendarLabels('t', doFetch, CALENDARIO_ESCOLHIDO);

    // Calendars.get: `/calendars/{id}` (e não `/events`) — é essa chamada que exige o escopo
    // `calendar.calendars.readonly`.
    expect(urls[0]).toContain(`${CALENDAR_API}/calendars/bot-venda%40group.calendar.google.com`);
    expect(urls[0]).not.toContain('/events');
    expect(etiquetas).toEqual([{ id: 'lab-azul', name: 'Cobalto', backgroundColor: '#4A86E8' }]);
  });

  it('token sem o escopo de cores: a falha da leitura de etiquetas é explícita (HTTP 403)', async () => {
    const doFetch: CalendarFetch = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: 'Request had insufficient authentication scopes.' } }),
    });
    await expect(getCalendarLabels('t', doFetch)).rejects.toThrow(/ler as cores do calendário falhou \(HTTP 403\)/);
  });
});
