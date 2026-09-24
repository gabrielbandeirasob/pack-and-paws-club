/**
 * Executor da importacao (Google -> app): a parte que fala com a API do Google e com o banco.
 *
 * O que estes testes travam:
 *  - a listagem da importacao NAO pode ter o filtro `privateExtendedProperty` (era ele que escondia
 *    tudo o que o cliente digita no calendario);
 *  - reserva do cliente vira `create` no banco com o id do evento gravado (anti-duplicata);
 *  - falha de um item NAO derruba os outros (o resumo conta o que falhou);
 *  - item de revisao volta para a tela, nao some.
 */
import { runCalendarImport, hasImportChanges } from '@/features/integrations/google/importService';
import type { CalendarFetch } from '@/features/integrations/google/calendarApi';

const JANELA = { timeMin: '2026-09-01T00:00:00Z', timeMax: '2026-12-31T00:00:00Z' };

function resposta(itens: unknown[]) {
  return { ok: true, status: 200, json: async () => ({ items: itens }) };
}

describe('runCalendarImport', () => {
  it('lista sem o filtro do espelho e cria reserva para o evento do cliente', async () => {
    const urls: string[] = [];
    const doFetch: CalendarFetch = async (url) => {
      urls.push(url);
      return resposta([
        // evento do cliente (sem marca do app)
        { id: 'e-cliente', summary: 'Boarding · Bella', start: { date: '2026-10-05' }, end: { date: '2026-10-09' } },
        // evento do espelho do app (não se importa)
        { id: 'e-nosso', summary: 'Daycare · Bella', start: { date: '2026-10-01' }, end: { date: '2026-10-02' }, extendedProperties: { private: { appKey: 'res:1', packpawsMirror: 'v1' } } },
        // qualquer evento do calendário dedicado deve entrar (irá para revisão se o cão não casar)
        { id: 'e-dentista', summary: 'Dentist 3pm', start: { date: '2026-10-02' }, end: { date: '2026-10-03' } },
      ]);
    };
    const criadas: unknown[] = [];
    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: { from: '2026-09-01', to: '2026-12-31' },
      dogs: [{ id: 'dog-bella', name: 'Bella', clientName: 'Leigh Ann' }],
      reservations: [],
      doFetch,
      ports: {
        createBooking: async (entrada) => {
          criadas.push(entrada);
        },
        updateBooking: async () => undefined,
        cancelBooking: async () => undefined,
      },
    });

    expect(urls[0]).toContain('/calendars/primary/events');
    expect(urls[0]).not.toContain('privateExtendedProperty');
    expect(resumo).toMatchObject({ created: 1, updated: 0, cancelled: 0 });
    expect(resumo.review).toEqual([
      expect.objectContaining({
        eventId: 'e-dentista',
        title: 'Dentist 3pm',
        reason: 'unknown dog',
        parsed: expect.objectContaining({ dogName: 'Dentist 3pm', serviceType: 'daycare' }),
      }),
    ]);
    expect(criadas).toEqual([
      {
        eventId: 'e-cliente',
        dogId: 'dog-bella',
        kind: 'reservation',
        parsed: expect.objectContaining({ serviceType: 'boarding', startDate: '2026-10-05', endDate: '2026-10-08' }),
      },
    ]);
  });

  it('série recorrente do cliente vira create do tipo recurring', async () => {
    const doFetch: CalendarFetch = async () =>
      resposta([
        { id: 'e-serie', summary: 'Daycare · Bella', start: { date: '2026-09-28' }, end: { date: '2026-09-29' }, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE'] },
      ]);
    const criadas: { kind: string }[] = [];
    await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: { from: '2026-09-01', to: '2026-12-31' },
      dogs: [{ id: 'dog-bella', name: 'Bella' }],
      reservations: [],
      doFetch,
      ports: {
        createBooking: async (entrada) => {
          criadas.push({ kind: entrada.kind });
        },
        updateBooking: async () => undefined,
        cancelBooking: async () => undefined,
      },
    });
    expect(criadas).toEqual([{ kind: 'recurring' }]);
  });

  it('cancela a reserva do Google quando o evento sumiu', async () => {
    const doFetch: CalendarFetch = async () => resposta([]);
    const canceladas: string[] = [];
    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: { from: '2026-09-01', to: '2026-12-31' },
      dogs: [{ id: 'dog-bella', name: 'Bella' }],
      reservations: [
        {
          id: 'r1',
          kind: 'reservation',
          dogId: 'dog-bella',
          googleEventId: 'e-sumiu',
          source: 'google',
          serviceType: 'boarding',
          startDate: '2026-10-05',
          endDate: '2026-10-08',
          weekdays: [],
          skipDates: [],
          status: 'confirmed',
        },
      ],
      doFetch,
      ports: {
        createBooking: async () => undefined,
        updateBooking: async () => undefined,
        cancelBooking: async (entrada) => {
          canceladas.push(entrada.bookingId);
        },
      },
    });
    expect(canceladas).toEqual(['r1']);
    expect(resumo.cancelled).toBe(1);
  });

  it('falha de um item nao derruba os outros e aparece no resumo', async () => {
    const doFetch: CalendarFetch = async () =>
      resposta([
        { id: 'e1', summary: 'Boarding · Bella', start: { date: '2026-10-05' }, end: { date: '2026-10-06' } },
        { id: 'e2', summary: 'Boarding · Mowgli', start: { date: '2026-10-06' }, end: { date: '2026-10-07' } },
      ]);
    const criadas: string[] = [];
    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: { from: '2026-09-01', to: '2026-12-31' },
      dogs: [
        { id: 'dog-bella', name: 'Bella' },
        { id: 'dog-mowgli', name: 'Mowgli' },
      ],
      reservations: [],
      doFetch,
      ports: {
        createBooking: async (entrada) => {
          if (entrada.eventId === 'e1') throw new Error('RLS negou');
          criadas.push(entrada.eventId);
        },
        updateBooking: async () => undefined,
        cancelBooking: async () => undefined,
      },
    });
    expect(criadas).toEqual(['e2']);
    expect(resumo.created).toBe(1);
    expect(resumo.failures).toEqual([{ eventId: 'e1', reservationId: undefined, error: 'RLS negou' }]);
  });

  it('item de revisao volta para a tela', async () => {
    const doFetch: CalendarFetch = async () =>
      resposta([{ id: 'e3', summary: 'Boarding · Rex', start: { date: '2026-10-05' }, end: { date: '2026-10-06' } }]);
    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: { from: '2026-09-01', to: '2026-12-31' },
      dogs: [{ id: 'dog-bella', name: 'Bella' }],
      reservations: [],
      doFetch,
      ports: { createBooking: async () => undefined, updateBooking: async () => undefined, cancelBooking: async () => undefined },
    });
    expect(resumo.review).toEqual([
      { eventId: 'e3', title: 'Boarding · Rex', date: '2026-10-05', reason: 'unknown dog', parsed: expect.objectContaining({ dogName: 'Rex' }) },
    ]);
    expect(hasImportChanges(resumo)).toBe(true);
  });
});
