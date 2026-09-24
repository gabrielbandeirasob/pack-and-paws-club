/**
 * Executor da importacao (Google -> app): a parte que fala com a API do Google e com o banco.
 *
 * O que estes testes travam (regra do dono, 24/09/2026):
 *  - a listagem da importacao NAO pode ter o filtro `privateExtendedProperty` (era ele que escondia
 *    tudo o que o cliente digita no calendario);
 *  - o SERVICO vai para o banco a partir da COR do evento (verde = boarding, azul = daycare) — o
 *    titulo nao participa mais dessa decisao;
 *  - evento de cao FORA do cadastro NAO escreve nada no banco (nem cliente, nem cao, nem reserva):
 *    volta como pendencia para a tela;
 *  - evento SEM cor (ou com cor fora do mapa) tambem nao escreve nada: pendencia "cor nao reconhecida";
 *  - evento VERMELHO cancela a reserva do dia (ou pula o dia de uma serie);
 *  - nada com data anterior a janela e escrito (a janela da importacao comeca em hoje);
 *  - falha de um item NAO derruba os outros (o resumo conta o que falhou).
 */
import { runCalendarImport, hasImportChanges } from '@/features/integrations/google/importService';
import type { ImportPorts } from '@/features/integrations/google/importService';
import type { CalendarFetch } from '@/features/integrations/google/calendarApi';
import { describeImportFailure, type BookingForImport } from '@/features/integrations/google/importPlan';

const JANELA = { timeMin: '2026-09-24T00:00:00Z', timeMax: '2027-03-23T00:00:00Z' };
/** Janela em datas da importacao: comeca HOJE (nada do passado). */
const DESDE_HOJE = { from: '2026-09-24', to: '2027-03-23' };

const VERDE = '2';
const AZUL = '7';
const VERMELHO = '11';

function resposta(itens: unknown[]) {
  return { ok: true, status: 200, json: async () => ({ items: itens }) };
}

/** Portas de mentira: registram cada escrita na ordem em que foram pedidas. */
function portas(registro: string[] = [], extras: Partial<ImportPorts> = {}): ImportPorts {
  return {
    createBooking: async (entrada) => {
      registro.push(`reserva:${entrada.eventId}:${entrada.dogId}:${String(entrada.parsed.serviceType)}`);
    },
    updateBooking: async (entrada) => {
      registro.push(`atualiza:${entrada.bookingId}`);
    },
    cancelBooking: async (entrada) => {
      registro.push(`cancela:${entrada.bookingId}`);
    },
    skipRecurringDay: async (entrada) => {
      registro.push(`pula:${entrada.scheduleId}:${entrada.date}`);
    },
    ...extras,
  };
}

const CAES = [
  { id: 'dog-bella', name: 'Bella', clientName: 'Leigh Ann' },
  { id: 'dog-pietro', name: 'Pietro', clientName: 'Carlos' },
];

describe('runCalendarImport', () => {
  it('lista sem o filtro do espelho e cria a reserva com o serviço da COR', async () => {
    const urls: string[] = [];
    const doFetch: CalendarFetch = async (url) => {
      urls.push(url);
      return resposta([
        // verde = boarding
        { id: 'e-verde', summary: 'Pietro', colorId: VERDE, start: { date: '2026-10-05' }, end: { date: '2026-10-07' } },
        // azul = daycare
        { id: 'e-azul', summary: 'Bella', colorId: AZUL, start: { date: '2026-10-06' }, end: { date: '2026-10-07' } },
        // evento do espelho do app (não se importa)
        { id: 'e-nosso', summary: 'Bella', colorId: AZUL, start: { date: '2026-10-01' }, end: { date: '2026-10-02' }, extendedProperties: { private: { appKey: 'res:1', packpawsMirror: 'v1' } } },
      ]);
    };
    const registro: string[] = [];
    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: DESDE_HOJE,
      dogs: CAES,
      reservations: [],
      doFetch,
      ports: portas(registro),
    });

    expect(urls[0]).toContain('/calendars/primary/events');
    expect(urls[0]).not.toContain('privateExtendedProperty');
    expect(resumo).toMatchObject({ created: 2, updated: 0, cancelled: 0 });
    expect(resumo.review).toEqual([]);
    // A ordem é a dos ids dos eventos (determinística): 'e-azul' antes de 'e-verde'.
    expect(registro).toEqual([
      'reserva:e-azul:dog-bella:daycare',
      'reserva:e-verde:dog-pietro:boarding',
    ]);
  });

  it('cão FORA do cadastro não escreve NADA no banco e volta como pendência', async () => {
    const doFetch: CalendarFetch = async () =>
      resposta([{ id: 'e-rex', summary: 'Rex', colorId: VERDE, start: { date: '2026-10-05' }, end: { date: '2026-10-06' } }]);
    const registro: string[] = [];
    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: DESDE_HOJE,
      dogs: CAES,
      reservations: [],
      doFetch,
      ports: portas(registro),
    });

    // A regra nova revoga o cadastro automático: nenhuma escrita, nem cliente, nem cão, nem reserva.
    expect(registro).toEqual([]);
    expect(resumo.created).toBe(0);
    expect(resumo.review).toEqual([
      expect.objectContaining({ eventId: 'e-rex', title: 'Rex', reason: 'unknown dog' }),
    ]);
  });

  it('evento SEM cor não escreve nada e volta com o motivo "color not recognized"', async () => {
    const doFetch: CalendarFetch = async () =>
      resposta([{ id: 'e-sem-cor', summary: 'Bella', start: { date: '2026-10-05' }, end: { date: '2026-10-06' } }]);
    const registro: string[] = [];
    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: DESDE_HOJE,
      dogs: CAES,
      reservations: [],
      doFetch,
      ports: portas(registro),
    });

    expect(registro).toEqual([]);
    expect(resumo.review).toEqual([expect.objectContaining({ eventId: 'e-sem-cor', reason: 'unrecognized color' })]);
  });

  it('evento VERMELHO cancela a reserva daquele cão naquele dia', async () => {
    const doFetch: CalendarFetch = async () =>
      resposta([{ id: 'e-red', summary: 'Bella', colorId: VERMELHO, start: { date: '2026-10-05' }, end: { date: '2026-10-06' } }]);
    const canceladas: string[] = [];
    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: DESDE_HOJE,
      dogs: CAES,
      reservations: [
        {
          id: 'r-bella',
          kind: 'reservation',
          dogId: 'dog-bella',
          googleEventId: null,
          source: 'app',
          serviceType: 'daycare',
          startDate: '2026-10-05',
          endDate: '2026-10-05',
          weekdays: null,
          skipDates: null,
          status: 'confirmed',
        },
      ],
      doFetch,
      ports: portas([], {
        cancelBooking: async ({ bookingId }) => {
          canceladas.push(bookingId);
        },
      }),
    });

    expect(canceladas).toEqual(['r-bella']);
    expect(resumo.cancelled).toBe(1);
  });

  it('evento VERMELHO num dia de SÉRIE pula só aquele dia', async () => {
    const doFetch: CalendarFetch = async () =>
      resposta([{ id: 'e-red', summary: 'Bella', colorId: VERMELHO, start: { date: '2026-09-30' }, end: { date: '2026-10-01' } }]);
    const pulados: string[] = [];
    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: DESDE_HOJE,
      dogs: CAES,
      reservations: [
        {
          id: 'serie-bella',
          kind: 'recurring',
          dogId: 'dog-bella',
          googleEventId: null,
          source: 'app',
          serviceType: 'daycare',
          startDate: '2026-09-01',
          endDate: null,
          weekdays: [1, 3],
          skipDates: [],
          status: 'active',
        },
      ],
      doFetch,
      ports: portas([], {
        skipRecurringDay: async ({ scheduleId, date }) => {
          pulados.push(`${scheduleId}:${date}`);
        },
      }),
    });

    expect(pulados).toEqual(['serie-bella:2026-09-30']);
    expect(resumo).toMatchObject({ created: 0, cancelled: 1 });
  });

  it('nada com data anterior a hoje é escrito pela importação', async () => {
    const doFetch: CalendarFetch = async () =>
      resposta([
        { id: 'e-ontem', summary: 'Pietro', colorId: VERDE, start: { date: '2026-09-23' }, end: { date: '2026-09-24' } },
        // evento do passado sem título também não vira pendência
        { id: 'e-ontem-sem-titulo', summary: '', colorId: VERDE, start: { date: '2026-09-20' }, end: { date: '2026-09-21' } },
      ]);
    const registro: string[] = [];
    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: DESDE_HOJE,
      dogs: CAES,
      // reserva de ontem vinda do Google cujo evento sumiu: não pode ser cancelada
      reservations: [
        {
          id: 'r-ontem',
          kind: 'reservation',
          dogId: 'dog-bella',
          googleEventId: 'e-sumiu-ontem',
          source: 'google',
          serviceType: 'daycare',
          startDate: '2026-09-23',
          endDate: '2026-09-23',
          weekdays: [],
          skipDates: [],
          status: 'confirmed',
        },
      ],
      doFetch,
      ports: portas(registro),
    });

    expect(registro).toEqual([]);
    expect(resumo).toMatchObject({ created: 0, updated: 0, cancelled: 0 });
    expect(resumo.review).toEqual([]);
  });

  it('série recorrente do cliente vira create do tipo recurring', async () => {
    const doFetch: CalendarFetch = async () =>
      resposta([
        { id: 'e-serie', summary: 'Bella', colorId: AZUL, start: { date: '2026-09-28' }, end: { date: '2026-09-29' }, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE'] },
      ]);
    const criadas: { kind: string; servico: string | null }[] = [];
    await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: DESDE_HOJE,
      dogs: CAES,
      reservations: [],
      doFetch,
      ports: portas([], {
        createBooking: async (entrada) => {
          criadas.push({ kind: entrada.kind, servico: entrada.parsed.serviceType });
        },
      }),
    });
    expect(criadas).toEqual([{ kind: 'recurring', servico: 'daycare' }]);
  });

  it('cancela a reserva do Google quando o evento sumiu (data futura dentro da janela)', async () => {
    const doFetch: CalendarFetch = async () => resposta([]);
    const canceladas: string[] = [];
    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: DESDE_HOJE,
      dogs: CAES,
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
      ports: portas([], {
        cancelBooking: async ({ bookingId }) => {
          canceladas.push(bookingId);
        },
      }),
    });
    expect(canceladas).toEqual(['r1']);
    expect(resumo.cancelled).toBe(1);
  });

  it('falha de um item nao derruba os outros e aparece no resumo', async () => {
    const doFetch: CalendarFetch = async () =>
      resposta([
        { id: 'e1', summary: 'Bella', colorId: VERDE, start: { date: '2026-10-05' }, end: { date: '2026-10-06' } },
        { id: 'e2', summary: 'Pietro', colorId: AZUL, start: { date: '2026-10-06' }, end: { date: '2026-10-07' } },
      ]);
    const criadas: string[] = [];
    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: DESDE_HOJE,
      dogs: CAES,
      reservations: [],
      doFetch,
      ports: portas([], {
        createBooking: async (entrada) => {
          if (entrada.eventId === 'e1') throw new Error('RLS negou');
          criadas.push(entrada.eventId);
        },
      }),
    });
    expect(criadas).toEqual(['e2']);
    expect(resumo.created).toBe(1);
    expect(resumo.failures).toEqual([{ eventId: 'e1', reservationId: undefined, error: 'RLS negou' }]);
  });

  it('falha ao cancelar aparece no resumo com o id do agendamento', async () => {
    const doFetch: CalendarFetch = async () => resposta([]);
    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: DESDE_HOJE,
      dogs: CAES,
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
      ports: portas([], {
        cancelBooking: async () => {
          throw new Error('new row for relation "reservations" violates check constraint "reservations_check"');
        },
      }),
    });

    expect(resumo.failures).toEqual([{ eventId: 'e-sumiu', reservationId: 'r1', error: expect.stringContaining('reservations_check') }]);
    // E a tela ganha o MOTIVO da primeira falha, não só a contagem.
    expect(describeImportFailure(resumo.failures)).toBe('1 item(s) from Google could not be saved. First: end_date before start_date');
  });

  it('evento COM HORA chega na porta com end_date >= start_date (o defeito de produção)', async () => {
    // Evento do escritório no calendário "bot venda": 25/09, 1:00-2:00pm (print do gestor, 24/09/2026).
    const doFetch: CalendarFetch = async () =>
      resposta([
        { id: 'e-pietro', summary: 'Pietro', colorId: AZUL, start: { dateTime: '2026-09-25T13:00:00-07:00' }, end: { dateTime: '2026-09-25T14:00:00-07:00' } },
      ]);
    const criadas: { start_date: string; end_date: string }[] = [];
    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: DESDE_HOJE,
      dogs: CAES,
      reservations: [],
      doFetch,
      ports: portas([], {
        createBooking: async ({ parsed }) => {
          criadas.push({ start_date: parsed.startDate, end_date: parsed.endDate });
        },
      }),
    });

    expect(criadas).toEqual([{ start_date: '2026-09-25', end_date: '2026-09-25' }]);
    expect(resumo.created).toBe(1);
    expect(resumo.failures).toEqual([]);
  });

  it('item de revisao (titulo sem nome) volta para a tela', async () => {
    const doFetch: CalendarFetch = async () =>
      resposta([{ id: 'e3', summary: '', colorId: VERDE, start: { date: '2026-10-05' }, end: { date: '2026-10-06' } }]);
    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: DESDE_HOJE,
      dogs: CAES,
      reservations: [],
      doFetch,
      ports: portas([]),
    });
    expect(resumo.review).toEqual([
      { eventId: 'e3', title: '', date: '2026-10-05', reason: 'unreadable', parsed: expect.objectContaining({ dogName: '(no title)' }) },
    ]);
    expect(hasImportChanges(resumo)).toBe(true);
  });

  it('a importação lê o calendário escolhido pela organização (o "bot venda")', async () => {
    const urls: string[] = [];
    const doFetch: CalendarFetch = async (url) => {
      urls.push(url);
      return resposta([{ id: 'e-bot', summary: 'Pietro', colorId: VERDE, start: { date: '2026-10-05' }, end: { date: '2026-10-06' } }]);
    };
    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: DESDE_HOJE,
      dogs: CAES,
      reservations: [],
      doFetch,
      ports: portas([]),
      calendarId: 'bot-venda@group.calendar.google.com',
    });

    // Sem o calendário escolhido, o app lia só o `primary` da conta e nenhum agendamento do
    // escritório aparecia — era exatamente o sintoma do print do cliente.
    expect(urls[0]).toContain('/calendars/bot-venda%40group.calendar.google.com/events');
    expect(urls[0]).not.toContain('/calendars/primary/');
    expect(resumo.created).toBe(1);
  });

  it('a importação não cria cliente nem cão: nenhuma porta de cadastro existe mais', () => {
    // Guarda de regressão barata: se alguém reintroduzir `createClient`/`createDog` no contrato das
    // portas, este teste (e a ausência delas no tipo) acusa.
    const contrato = portas([]);
    expect(Object.keys(contrato).sort()).toEqual(['cancelBooking', 'createBooking', 'skipRecurringDay', 'updateBooking']);
  });

  it('reserva do Google que sumiu e já estava cancelada não é cancelada de novo', async () => {
    const doFetch: CalendarFetch = async () => resposta([]);
    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: DESDE_HOJE,
      dogs: CAES,
      reservations: [
        {
          id: 'r-morto',
          kind: 'reservation' as const,
          dogId: 'dog-bella' as string,
          googleEventId: 'e-sumiu',
          source: 'google' as const,
          serviceType: 'daycare' as const,
          startDate: '2026-10-05',
          endDate: '2026-10-05',
          weekdays: null,
          skipDates: null,
          status: 'cancelled',
        } satisfies BookingForImport,
      ],
      doFetch,
      ports: portas([]),
    });

    expect(resumo.cancelled).toBe(0);
  });
});
