import { parseEvent, toEventBody, type CalendarFetch } from '@/features/integrations/google/calendarApi';
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
    const id = url.slice(url.indexOf(base) + base.length);
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

  it('lê evento do Google no formato do planejador', () => {
    expect(
      parseEvent({
        id: 'g-9',
        summary: 'Boarding · Bolt',
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
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO'],
    });
  });

  it('aceita evento dateTime e mantém appKey nulo quando não é nosso', () => {
    const parsed = parseEvent({ id: 'x', summary: 'Dentista', start: { dateTime: '2026-09-10T09:00:00-03:00' }, end: { dateTime: '2026-09-10T10:00:00-03:00' } });
    expect(parsed.appKey).toBeNull();
    expect(parsed.startDate).toBe('2026-09-10');
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
    expect(describeSummary(second)).toBe('Nada a sincronizar — já está igual');
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
    expect(describeSummary(summary)).toContain('com erro');
  });
});
