/**
 * Executor da importacao (Google -> app): a parte que fala com a API do Google e com o banco.
 *
 * O que estes testes travam:
 *  - a listagem da importacao NAO pode ter o filtro `privateExtendedProperty` (era ele que escondia
 *    tudo o que o cliente digita no calendario);
 *  - reserva do cliente vira `create` no banco com o id do evento gravado (anti-duplicata);
 *  - titulo com nome que nao existe no app CADASTRA cliente e cao ANTES de criar a reserva
 *    (pedido do dono, 24/09/2026: "puxe TODOS os agendamentos");
 *  - nada com data anterior a janela e escrito (a janela da importacao comeca em hoje);
 *  - falha de um item NAO derruba os outros (o resumo conta o que falhou);
 *  - item de revisao (titulo sem nome) volta para a tela, nao some.
 *  - evento COM HORA chega na porta com `end_date >= start_date` e, se a reserva falhar depois do
 *    cadastro, o cao (e o cliente) da rodada sao desfeitos em vez de ficarem orfaos (24/09/2026).
 */
import { runCalendarImport, hasImportChanges } from '@/features/integrations/google/importService';
import type { ImportPorts } from '@/features/integrations/google/importService';
import type { CalendarFetch } from '@/features/integrations/google/calendarApi';
import { describeImportFailure } from '@/features/integrations/google/importPlan';

const JANELA = { timeMin: '2026-09-24T00:00:00Z', timeMax: '2027-03-23T00:00:00Z' };
/** Janela em datas da importacao: comeca HOJE (nada do passado). */
const DESDE_HOJE = { from: '2026-09-24', to: '2027-03-23' };

function resposta(itens: unknown[]) {
  return { ok: true, status: 200, json: async () => ({ items: itens }) };
}

/** Portas de mentira: registram cada escrita na ordem em que foram pedidas. */
function portas(registro: string[] = [], extras: Partial<ImportPorts> = {}): ImportPorts {
  return {
    createClient: async ({ name }) => {
      registro.push(`cliente:${name}`);
      return { clientId: `cliente-de-${name}` };
    },
    createDog: async ({ clientId, name }) => {
      registro.push(`cao:${name}:${clientId}`);
      return { dogId: `cao-de-${name}` };
    },
    createBooking: async (entrada) => {
      registro.push(`reserva:${entrada.eventId}:${entrada.dogId}`);
    },
    updateBooking: async (entrada) => {
      registro.push(`atualiza:${entrada.bookingId}`);
    },
    cancelBooking: async (entrada) => {
      registro.push(`cancela:${entrada.bookingId}`);
    },
    ...extras,
  };
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
        // título livre do calendário dedicado também entra (cão desconhecido = cadastro novo)
        { id: 'e-dentista', summary: 'Dentist 3pm', start: { date: '2026-10-02' }, end: { date: '2026-10-03' } },
      ]);
    };
    const registro: string[] = [];
    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: DESDE_HOJE,
      dogs: [{ id: 'dog-bella', name: 'Bella', clientName: 'Leigh Ann' }],
      reservations: [],
      doFetch,
      ports: portas(registro),
    });

    expect(urls[0]).toContain('/calendars/primary/events');
    expect(urls[0]).not.toContain('privateExtendedProperty');
    expect(resumo).toMatchObject({ created: 2, updated: 0, cancelled: 0 });
    expect(resumo.review).toEqual([]);
    expect(registro).toEqual([
      'reserva:e-cliente:dog-bella',
      'cliente:Dentist 3pm',
      'cao:Dentist 3pm:cliente-de-Dentist 3pm',
      'reserva:e-dentista:cao-de-Dentist 3pm',
    ]);
  });

  it('o evento do calendário dedicado sem cão no app cadastra cliente e cão antes da reserva', async () => {
    const doFetch: CalendarFetch = async () =>
      resposta([{ id: 'e-kona', summary: 'Leigh Ann · Kona', start: { date: '2026-10-05' }, end: { date: '2026-10-06' } }]);
    const registro: string[] = [];
    const reservas: Record<string, unknown>[] = [];
    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: DESDE_HOJE,
      dogs: [{ id: 'dog-bella', name: 'Bella', clientName: 'Leigh Ann' }],
      reservations: [],
      doFetch,
      ports: portas(registro, {
        createBooking: async (entrada) => {
          reservas.push(entrada as unknown as Record<string, unknown>);
        },
      }),
    });

    expect(registro).toEqual(['cliente:Leigh Ann', 'cao:Kona:cliente-de-Leigh Ann']);
    expect(reservas[0]).toMatchObject({
      eventId: 'e-kona',
      dogId: 'cao-de-Kona',
      kind: 'reservation',
      parsed: expect.objectContaining({ dogName: 'Kona', clientName: 'Leigh Ann', serviceType: 'daycare', startDate: '2026-10-05' }),
    });
    expect(resumo.created).toBe(1);
  });

  it('nada com data anterior a hoje é escrito pela importação', async () => {
    const doFetch: CalendarFetch = async () =>
      resposta([
        { id: 'e-ontem', summary: 'Kona', start: { date: '2026-09-23' }, end: { date: '2026-09-24' } },
        // evento do passado sem título também não vira pendência
        { id: 'e-ontem-sem-titulo', summary: '', start: { date: '2026-09-20' }, end: { date: '2026-09-21' } },
      ]);
    const registro: string[] = [];
    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: DESDE_HOJE,
      dogs: [],
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
        { id: 'e-serie', summary: 'Daycare · Bella', start: { date: '2026-09-28' }, end: { date: '2026-09-29' }, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE'] },
      ]);
    const criadas: { kind: string }[] = [];
    await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: DESDE_HOJE,
      dogs: [{ id: 'dog-bella', name: 'Bella' }],
      reservations: [],
      doFetch,
      ports: portas([], {
        createBooking: async (entrada) => {
          criadas.push({ kind: entrada.kind });
        },
      }),
    });
    expect(criadas).toEqual([{ kind: 'recurring' }]);
  });

  it('cancela a reserva do Google quando o evento sumiu (data futura dentro da janela)', async () => {
    const doFetch: CalendarFetch = async () => resposta([]);
    const canceladas: string[] = [];
    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: DESDE_HOJE,
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
      ports: portas([], {
        cancelBooking: async (entrada) => {
          canceladas.push(entrada.bookingId);
        },
      }),
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
      window: DESDE_HOJE,
      dogs: [
        { id: 'dog-bella', name: 'Bella' },
        { id: 'dog-mowgli', name: 'Mowgli' },
      ],
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

  it('falha ao cadastrar o cão novo aparece no resumo e não cria reserva para ele', async () => {
    const doFetch: CalendarFetch = async () =>
      resposta([{ id: 'e-kona', summary: 'Kona', start: { date: '2026-10-05' }, end: { date: '2026-10-06' } }]);
    const registro: string[] = [];
    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: DESDE_HOJE,
      dogs: [],
      reservations: [],
      doFetch,
      ports: portas(registro, {
        createClient: async () => {
          throw new Error('RLS negou o cliente');
        },
      }),
    });

    expect(registro).toEqual([]);
    expect(resumo.created).toBe(0);
    expect(resumo.failures).toEqual([{ eventId: 'e-kona', reservationId: undefined, error: 'RLS negou o cliente' }]);
  });

  it('evento COM HORA chega na porta com end_date >= start_date (o defeito de produção)', async () => {
    // Evento do escritório no calendário "bot venda": 25/09, 1:00-2:00pm (print do gestor, 24/09/2026).
    const doFetch: CalendarFetch = async () =>
      resposta([
        { id: 'e-pietro', summary: 'dog pietro', start: { dateTime: '2026-09-25T13:00:00-07:00' }, end: { dateTime: '2026-09-25T14:00:00-07:00' } },
      ]);
    const criadas: { start_date: string; end_date: string }[] = [];
    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: DESDE_HOJE,
      dogs: [{ id: 'dog-pietro', name: 'dog pietro' }],
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

  it('reserva que falha depois do cão criado desfaz o cadastro da rodada (nada de cão órfão)', async () => {
    const doFetch: CalendarFetch = async () =>
      resposta([
        { id: 'e-pietro', summary: 'dog pietro', start: { dateTime: '2026-09-25T13:00:00-07:00' }, end: { dateTime: '2026-09-25T14:00:00-07:00' } },
      ]);
    const registro: string[] = [];
    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: DESDE_HOJE,
      dogs: [],
      reservations: [],
      doFetch,
      ports: portas(registro, {
        createClient: async () => ({ clientId: 'cli-novo', criadoAgora: true }),
        createDog: async () => ({ dogId: 'dog-novo', criadoAgora: true }),
        createBooking: async () => {
          // A mensagem real do Postgres, como o supabase-js entrega (prova em banco: sqlstate 23514).
          throw new Error('new row for relation "reservations" violates check constraint "reservations_check"');
        },
        removeDog: async ({ dogId }) => {
          registro.push(`removeu-cao:${dogId}`);
        },
        removeClientIfEmpty: async ({ clientId }) => {
          registro.push(`removeu-cliente-vazio:${clientId}`);
        },
      }),
    });

    // A ordem importa: primeiro o cão, depois o cliente que ficou sem cão nenhum.
    expect(registro).toEqual(['removeu-cao:dog-novo', 'removeu-cliente-vazio:cli-novo']);
    expect(resumo.created).toBe(0);
    expect(resumo.failures).toHaveLength(1);
    // E a tela ganha o MOTIVO da primeira falha, não só a contagem (o gestor ficou sem saber o que houve).
    expect(describeImportFailure(resumo.failures)).toBe('1 item(s) from Google could not be saved. First: end_date before start_date');
  });

  it('cão que já existia no cadastro NÃO é apagado por causa de uma falha da reserva', async () => {
    const doFetch: CalendarFetch = async () => resposta([{ id: 'e-kona', summary: 'Leigh Ann · Kona', start: { date: '2026-10-05' }, end: { date: '2026-10-06' } }]);
    const registro: string[] = [];
    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: DESDE_HOJE,
      dogs: [],
      reservations: [],
      doFetch,
      ports: portas(registro, {
        createClient: async () => ({ clientId: 'cli-existente', criadoAgora: false }),
        createDog: async () => ({ dogId: 'dog-existente', criadoAgora: false }),
        createBooking: async () => {
          throw new Error('RLS negou a reserva');
        },
        removeDog: async ({ dogId }) => {
          registro.push(`removeu-cao:${dogId}`);
        },
        removeClientIfEmpty: async ({ clientId }) => {
          registro.push(`removeu-cliente-vazio:${clientId}`);
        },
      }),
    });

    expect(registro).toEqual([]);
    expect(resumo.failures).toEqual([{ eventId: 'e-kona', reservationId: undefined, error: 'RLS negou a reserva' }]);
  });

  it('item de revisao (titulo sem nome) volta para a tela', async () => {
    const doFetch: CalendarFetch = async () =>
      resposta([{ id: 'e3', summary: '', start: { date: '2026-10-05' }, end: { date: '2026-10-06' } }]);
    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: DESDE_HOJE,
      dogs: [{ id: 'dog-bella', name: 'Bella' }],
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
      return resposta([{ id: 'e-bot', summary: 'Dog Pietro', start: { date: '2026-10-05' }, end: { date: '2026-10-06' } }]);
    };
    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: DESDE_HOJE,
      dogs: [],
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
});
