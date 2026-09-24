import {
  CALENDAR_API,
  createEvent,
  deleteEvent,
  EVENT_LABEL_VERSION_PARAM,
  fimExclusivoDoEvento,
  getCalendarLabels,
  listAllEvents,
  listCalendars,
  listEvents,
  parseEvent,
  toEventBody,
  updateEvent,
  type CalendarFetch,
} from '@/features/integrations/google/calendarApi';
import { describeSummary, runCalendarSync } from '@/features/integrations/google/sync';
import type { LocalReservation } from '@/features/integrations/google/calendarSync';

type Stored = { id: string; body: Record<string, unknown> };

/** Google falso em memoria: responde as mesmas rotas que o cliente usa. */
function fakeGoogle(seed: Stored[] = [], failures: string[] = []) {
  const events = [...seed];
  let counter = seed.length;
  const calls: string[] = [];

  const doFetch: CalendarFetch = async (url, init) => {
    calls.push(`${init.method} ${url.split('/events')[1] ?? '/events'}`);
    const markerHit = failures.some((marker) => url.includes(marker) || (init.body ?? '').includes(marker));
    if (markerHit) {
      return { ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) };
    }
    const base = '/events/';
    if (init.method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ items: events.map((event) => ({ ...event.body, id: event.id })) }) };
    }
    if (init.method === 'POST') {
      const body = JSON.parse(init.body ?? '{}') as Record<string, unknown>;
      counter += 1;
      const id = `g-${counter}`;
      events.push({ id, body });
      return { ok: true, status: 200, json: async () => ({ id }) };
    }
    const id = url.slice(url.indexOf(base) + base.length).split('?')[0];
    const index = events.findIndex((event) => event.id === id);
    if (init.method === 'PATCH') {
      events[index] = { id, body: JSON.parse(init.body ?? '{}') as Record<string, unknown> };
      return { ok: true, status: 200, json: async () => ({ id }) };
    }
    events.splice(index, 1);
    return { ok: true, status: 204, json: async () => ({}) };
  };

  return { doFetch, events, calls };
}

const range = { timeMin: '2026-09-01T00:00:00Z', timeMax: '2026-12-31T00:00:00Z' };

/** Calendário secundário do escritório ("bot venda") — o id do Google tem `@` (vira `%40` na URL). */
const CALENDARIO_ESCOLHIDO = 'bot-venda@group.calendar.google.com';
const CAMINHO_ESCOLHIDO = '/calendars/bot-venda%40group.calendar.google.com/events';

const reserva: LocalReservation = {
  id: 'res-1',
  dogName: 'Filo',
  clientName: 'Raphael',
  serviceType: 'daycare',
  startDate: '2026-09-10',
};

describe('cliente do Google Calendar', () => {
  it('monta o corpo do evento com propriedades privadas e recorrência', () => {
    const body = toEventBody({
      summary: 'Daycare · Filo (Raphael)',
      start: { date: '2026-09-10' },
      end: { date: '2026-09-11' },
      extendedProperties: { private: { appKey: 'res-1' } },
    });
    expect(body).toEqual({
      summary: 'Daycare · Filo (Raphael)',
      start: { date: '2026-09-10' },
      end: { date: '2026-09-11' },
      extendedProperties: { private: { appKey: 'res-1' } },
    });
  });

  it('lê evento do Google no formato do planejador (com a cor do serviço)', () => {
    expect(
      parseEvent({
        id: 'g-9',
        summary: 'Boarding · Bolt',
        colorId: '2',
        start: { date: '2026-09-05' },
        end: { date: '2026-09-11' },
        recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO'],
        extendedProperties: { private: { appKey: 'res-9' } },
      }),
    ).toEqual({
      id: 'g-9',
      appKey: 'res-9',
      summary: 'Boarding · Bolt',
      startDate: '2026-09-05',
      endDate: '2026-09-11',
      colorId: '2',
      // Evento da paleta antiga: sem etiqueta (o campo entra nulo de propósito, para o planejador
      // saber que a cor veio do `colorId`).
      eventLabelId: null,
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO'],
    });
  });

  it('lê a ETIQUETA do evento (paleta nova): o "Cobalto" do cliente chega como colorId nulo', () => {
    const parsed = parseEvent({
      id: 'g-zara',
      summary: 'zara',
      colorId: undefined, // a paleta nova não manda id fixo
      eventLabelId: '42617328-8756-4291-8273-192837465647',
      start: { date: '2026-09-26' },
      end: { date: '2026-09-27' },
    });
    expect(parsed.colorId).toBeNull();
    expect(parsed.eventLabelId).toBe('42617328-8756-4291-8273-192837465647');
  });

  it('evento sem cor chega com colorId nulo (a importação não chuta serviço)', () => {
    const parsed = parseEvent({ id: 'x', summary: 'Pietro', start: { date: '2026-09-10' }, end: { date: '2026-09-11' } });
    expect(parsed.colorId).toBeNull();
  });

  it('aceita evento dateTime e mantém appKey nulo quando não é nosso', () => {
    const parsed = parseEvent({ id: 'x', summary: 'Dentista', start: { dateTime: '2026-09-10T09:00:00-03:00' }, end: { dateTime: '2026-09-10T10:00:00-03:00' } });
    expect(parsed.appKey).toBeNull();
    expect(parsed.startDate).toBe('2026-09-10');
    // Evento COM HORA: o `end.dateTime` é INCLUSIVO (o dia 10 é o último dia do evento), então o fim
    // em forma EXCLUSIVA — o formato que o planejador da importação espera — é o dia seguinte. Este
    // era o defeito de produção de 24/09/2026: o dia era recuado duas vezes e a reserva nascia com
    // `end_date` anterior ao `start_date` (o banco recusa por `check (end_date >= start_date)`).
    expect(parsed.endDate).toBe('2026-09-11');
  });

  it('fim de evento com hora é normalizado para o formato EXCLUSIVO (e o de dia inteiro já vem assim)', () => {
    // mesmos dia: 10/09 09:00-17:00 -> o dia 10 é do evento, o fim exclusivo é 11/09
    expect(fimExclusivoDoEvento({ dateTime: '2026-09-10T17:00:00-03:00' })).toBe('2026-09-11');
    // meia-noite exata: o evento não ocupa minuto nenhum do dia seguinte -> já é exclusivo
    expect(fimExclusivoDoEvento({ dateTime: '2026-09-11T00:00:00-03:00' })).toBe('2026-09-11');
    // multi-dia com hora: 10/09 10:00 -> 12/09 12:00 -> fim exclusivo 13/09
    expect(fimExclusivoDoEvento({ dateTime: '2026-09-12T12:00:00-03:00' })).toBe('2026-09-13');
    // dia inteiro: o Google já manda o primeiro dia FORA do evento
    expect(fimExclusivoDoEvento({ date: '2026-09-11' })).toBe('2026-09-11');
    // sem fim nenhum: string vazia (a garantia dura do parser impede virar data do passado)
    expect(fimExclusivoDoEvento(undefined)).toBe('');
    expect(fimExclusivoDoEvento({})).toBe('');
  });

  it('filtra a listagem no formato que o Google exige (nome=valor)', async () => {
    const urls: string[] = [];
    const doFetch: CalendarFetch = async (url) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    };
    await listEvents('t', range, doFetch);
    // HTTP 400 "A key or value missing in the extended_properties_match" é o que o gestor recebeu
    // quando o filtro ia só com a chave. Este teste trava o formato exigido pela API (nome%3Dvalor).
    expect(urls[0]).toContain('privateExtendedProperty=packpawsMirror%3Dv1');
  });

  /**
   * A descoberta oficial da Calendar API (revision 20260826) NÃO aceita `eventLabelVersion` em
   * events.list/get: o campo `eventLabelId` já faz parte do recurso retornado. O parâmetro existe só
   * em insert/import/update/patch. Mandá-lo na listagem arrisca HTTP 400 por parâmetro desconhecido.
   */
  it('a listagem NÃO manda o parâmetro de escrita `eventLabelVersion`', async () => {
    const urls: string[] = [];
    const doFetch: CalendarFetch = async (url) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    };
    await listEvents('t', range, doFetch);
    await listAllEvents('t', range, doFetch);

    expect(EVENT_LABEL_VERSION_PARAM).toBe('eventLabelVersion=1');
    for (const url of urls) expect(url).not.toContain('eventLabelVersion');
  });

  it('as escritas do espelho também levam `eventLabelVersion=1`', async () => {
    const chamadas: { method: string; url: string }[] = [];
    const doFetch: CalendarFetch = async (url, init) => {
      chamadas.push({ method: init.method, url });
      return { ok: true, status: 200, json: async () => ({ id: 'g-1' }) };
    };
    const evento = { summary: 'Daycare · Filó (Raphael)', start: { date: '2026-09-10' }, end: { date: '2026-09-11' }, eventLabelId: 'lab-azul' };
    await createEvent('t', evento, doFetch);
    await updateEvent('t', 'g-1', evento, doFetch);

    expect(chamadas.map((item) => item.method)).toEqual(['POST', 'PATCH']);
    for (const chamada of chamadas) expect(chamada.url).toContain('eventLabelVersion=1');
  });

  it('fallback legado grava colorId SEM eventLabelVersion, pois versão 1 ignora colorId', async () => {
    const chamadas: { url: string; body: Record<string, unknown> }[] = [];
    const doFetch: CalendarFetch = async (url, init) => {
      chamadas.push({ url, body: JSON.parse(init.body ?? '{}') as Record<string, unknown> });
      return { ok: true, status: 200, json: async () => ({ id: 'g-legado' }) };
    };
    const legado = { summary: 'Daycare · Filó', start: { date: '2026-09-10' }, end: { date: '2026-09-11' }, colorId: '7' };
    await createEvent('t', legado, doFetch);
    await updateEvent('t', 'g-legado', legado, doFetch);

    for (const chamada of chamadas) {
      expect(chamada.url).not.toContain('eventLabelVersion');
      expect(chamada.body).toMatchObject({ colorId: '7' });
    }
  });

  it('o corpo do evento leva a etiqueta; `null` LIMPA (string vazia) e `undefined` não mexe', () => {
    const base = { summary: 'Daycare · Filó (Raphael)', start: { date: '2026-09-10' }, end: { date: '2026-09-11' } };
    expect(toEventBody({ ...base, eventLabelId: 'lab-azul' }).eventLabelId).toBe('lab-azul');
    // É assim que a API remove a etiqueta de um evento (documentado em `guides/labels`).
    expect(toEventBody({ ...base, eventLabelId: null }).eventLabelId).toBe('');
    expect('eventLabelId' in toEventBody(base)).toBe(false);
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

    // Calendars.get: `/calendars/{id}` (e não `/events`) — e no calendário escolhido, o mesmo dos
    // eventos. É essa chamada que exige o escopo `calendar.calendars.readonly`.
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

describe('runCalendarSync', () => {
  it('cria o evento que ainda não existe e é idempotente na segunda passada', async () => {
    const google = fakeGoogle();
    const first = await runCalendarSync({ accessToken: 't', reservations: [reserva], range, doFetch: google.doFetch });
    expect(first).toMatchObject({ created: 1, updated: 0, deleted: 0 });
    expect(google.events).toHaveLength(1);

    const second = await runCalendarSync({ accessToken: 't', reservations: [reserva], range, doFetch: google.doFetch });
    expect(second).toMatchObject({ created: 0, updated: 0, deleted: 0 });
    expect(google.events).toHaveLength(1);
    expect(describeSummary(second)).toBe('Nothing to sync — already up to date');
  });

  it('grava a marca fixa em todo evento criado (é ela que a listagem filtra)', async () => {
    const google = fakeGoogle();
    await runCalendarSync({ accessToken: 't', reservations: [reserva], range, doFetch: google.doFetch });
    const corpo = google.events[0].body as { extendedProperties?: { private?: Record<string, string> } };
    expect(corpo.extendedProperties?.private).toEqual({ appKey: 'res-1', packpawsMirror: 'v1' });
  });

  it('atualiza quando a reserva muda e apaga quando deixa de existir', async () => {
    const google = fakeGoogle();
    await runCalendarSync({ accessToken: 't', reservations: [reserva], range, doFetch: google.doFetch });

    const alterada = await runCalendarSync({
      accessToken: 't',
      reservations: [{ ...reserva, endDate: '2026-09-12' }],
      range,
      doFetch: google.doFetch,
    });
    expect(alterada).toMatchObject({ updated: 1 });

    const removida = await runCalendarSync({ accessToken: 't', reservations: [], range, doFetch: google.doFetch });
    expect(removida).toMatchObject({ deleted: 1 });
    expect(google.events).toHaveLength(0);
  });

  it('continua mesmo se um evento falhar e reporta o erro', async () => {
    const google = fakeGoogle([], ['res-2']);
    const outra: LocalReservation = { ...reserva, id: 'res-2', dogName: 'Bolt' };
    const summary = await runCalendarSync({ accessToken: 't', reservations: [reserva, outra], range, doFetch: google.doFetch });
    expect(summary.created).toBe(1);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0].error).toContain('criar evento falhou');
    // Texto do resumo no idioma da interface (inglês) — corrigido em 23/09/2026.
    expect(describeSummary(summary)).toContain('failed');
  });

  it('espelha no calendário escolhido pela organização (e no primary sem escolha)', async () => {
    const urls: string[] = [];
    const doFetch: CalendarFetch = async (url) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    };

    await runCalendarSync({ accessToken: 't', reservations: [reserva], range, doFetch });
    expect(urls[0]).toContain('/calendars/primary/events');

    urls.length = 0;
    const resumo = await runCalendarSync({ accessToken: 't', reservations: [reserva], range, doFetch, calendarId: CALENDARIO_ESCOLHIDO });
    expect(resumo.created).toBe(1);
    // Listar (GET) e criar (POST) no MESMO calendário: é isso que faz a importação enxergar o que o
    // espelho escreveu — o que estava quebrado quando o app lia só o `primary`.
    expect(urls).toHaveLength(2);
    for (const url of urls) expect(url).toContain(CAMINHO_ESCOLHIDO);
  });
});

/**
 * O calendário escolhido pela organização ("bot venda") entra em TODAS as chamadas das duas vias.
 * O id do Google tem `@`: na URL precisa ir codificado (`%40`).
 */
describe('calendário escolhido pela organização', () => {
  const evento = { summary: 'Daycare · Filó (Raphael)', start: { date: '2026-09-10' }, end: { date: '2026-09-11' } };

  function gravador() {
    const chamadas: { method: string; url: string }[] = [];
    const doFetch: CalendarFetch = async (url, init) => {
      chamadas.push({ method: init.method, url });
      if (init.method === 'DELETE') return { ok: true, status: 204, json: async () => ({}) };
      if (init.method === 'GET') return { ok: true, status: 200, json: async () => ({ items: [] }) };
      return { ok: true, status: 200, json: async () => ({ id: 'g-1' }) };
    };
    return { chamadas, doFetch };
  }

  it('lista os calendários da conta com nome, principal e papel de acesso', async () => {
    const urls: string[] = [];
    const doFetch: CalendarFetch = async (url) => {
      urls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          kind: 'calendar#calendarList',
          items: [
            { id: 'raphael@packandpawsclub.com', summary: 'raphael@packandpawsclub.com', primary: true, accessRole: 'owner' },
            { id: CALENDARIO_ESCOLHIDO, summary: 'bot venda', accessRole: 'writer' },
            { id: 'feriados@group.calendar.google.com', summary: 'Feriados', accessRole: 'reader' },
          ],
        }),
      };
    };

    const lista = await listCalendars('t', doFetch);
    expect(urls[0]).toContain('/users/me/calendarList');
    expect(lista.map((item) => [item.summary, item.primary, item.accessRole])).toEqual([
      ['raphael@packandpawsclub.com', true, 'owner'],
      ['bot venda', false, 'writer'],
      ['Feriados', false, 'reader'],
    ]);
  });

  it('o espelho escreve no calendário escolhido (criar, atualizar e apagar)', async () => {
    const google = gravador();
    await createEvent('t', evento, google.doFetch, CALENDARIO_ESCOLHIDO);
    await updateEvent('t', 'g-1', evento, google.doFetch, CALENDARIO_ESCOLHIDO);
    await deleteEvent('t', 'g-1', google.doFetch, CALENDARIO_ESCOLHIDO);

    expect(google.chamadas.map((chamada) => chamada.method)).toEqual(['POST', 'PATCH', 'DELETE']);
    for (const chamada of google.chamadas) expect(chamada.url).toContain(CAMINHO_ESCOLHIDO);
  });

  it('a importação lê o calendário escolhido (e nenhuma via sobra no primary)', async () => {
    const doEspelho = gravador();
    const doImportacao = gravador();
    await listEvents('t', range, doEspelho.doFetch, CALENDARIO_ESCOLHIDO);
    await listAllEvents('t', range, doImportacao.doFetch, CALENDARIO_ESCOLHIDO);

    expect(doEspelho.chamadas[0].url).toContain(CAMINHO_ESCOLHIDO);
    expect(doImportacao.chamadas[0].url).toContain(CAMINHO_ESCOLHIDO);
    expect(doImportacao.chamadas[0].url).not.toContain('/calendars/primary/');
    // O filtro do espelho continua só na listagem do espelho.
    expect(doEspelho.chamadas[0].url).toContain('privateExtendedProperty=packpawsMirror%3Dv1');
    expect(doImportacao.chamadas[0].url).not.toContain('privateExtendedProperty');
  });

  it('sem escolha gravada, tudo continua no calendário principal', async () => {
    const google = gravador();
    await listEvents('t', range, google.doFetch);
    await listAllEvents('t', range, google.doFetch);
    await createEvent('t', evento, google.doFetch);
    await updateEvent('t', 'g-1', evento, google.doFetch);
    await deleteEvent('t', 'g-1', google.doFetch);

    expect(google.chamadas).toHaveLength(5);
    for (const chamada of google.chamadas) expect(chamada.url).toContain('/calendars/primary/events');
  });
});
