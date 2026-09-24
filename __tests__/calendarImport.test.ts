/**
 * IMPORTACAO do Google Calendar para o app — pedido do dono (23/09/2026): "as datas que estao
 * marcadas no calendario do cliente fossem para o aplicativo".
 *
 * O que estes testes travam (é onde mora o risco):
 *  - o formato do titulo que o proprio app escreve tem de VOLTAR igual (round-trip);
 *  - todo evento do calendario dedicado entra, mesmo sem palavra de servico/operacao;
 *  - nome de cao desconhecido/ambíguo NAO cria cadastro: vai para revisao;
 *  - reserva que nasceu no Google muda quando o evento muda e e cancelada quando o evento some —
 *    mas so dentro da janela consultada;
 *  - nada de duplicar reserva que ja existe no app.
 */
import { buildGoogleEvent } from '@/features/calendar/googleEvents';
import { parseBookingEvent, parseBookingTitle, parseRecurrence, looksLikeBooking, looksLikeTransport, parseTransportTitle, planCalendarImport, kindOf, describeImport } from '@/features/integrations/google/importPlan';
import type { RemoteEvent } from '@/features/integrations/google/calendarSync';

const JANELA = { from: '2026-09-01', to: '2026-12-31' };

function evento(parcial: Partial<RemoteEvent> & { id: string }): RemoteEvent {
  return { summary: '', startDate: '2026-09-25', endDate: '2026-09-26', appKey: null, recurrence: null, ...parcial };
}

describe('leitura do titulo', () => {
  it('reconhece o formato que o proprio app escreve', () => {
    expect(parseBookingTitle('Boarding · Bella (Leigh Ann)')).toEqual({
      serviceType: 'boarding',
      dogName: 'Bella',
      clientName: 'Leigh Ann',
    });
  });

  it('aceita o que o escritorio digita à mão', () => {
    expect(parseBookingTitle('Boarding - Bella')).toEqual({ serviceType: 'boarding', dogName: 'Bella', clientName: null });
    expect(parseBookingTitle('Bella daycare')).toEqual({ serviceType: 'daycare', dogName: 'Bella', clientName: null });
    expect(parseBookingTitle('creche: Mowgli')).toEqual({ serviceType: 'daycare', dogName: 'Mowgli', clientName: null });
  });

  it('mantém o parser de formato estrito separado do fallback do calendário dedicado', () => {
    expect(looksLikeBooking('Dentist 3pm')).toBe(false);
    expect(looksLikeBooking('Almoço com o Carlos')).toBe(false);
    expect(parseBookingTitle('Dentist 3pm')).toBeNull();
    expect(looksLikeBooking('Boarding · Bella')).toBe(true);
  });

  it('não aceita título sem nome de cão', () => {
    expect(parseBookingTitle('Boarding ·')).toBeNull();
  });
});

/**
 * "Pick filó" (print do dono, 23/09/2026, evento com HORA das 11h às 12h).
 *
 * Antes: sem palavra de serviço no título, o evento era descartado como compromisso pessoal — o dono
 * sincronizou e o app não trouxe a data. Agora título de operação (pick/drop/van) entra, com o cão
 * lido do resto do título. Como o calendário é exclusivo do serviço, qualquer outro título também
 * entra: se não casar com um cão, vai para revisão.
 */
describe('título de operação (Pick/Drop) — o caso do print', () => {
  it('le "Pick filó" e cria a reserva do dia (evento com hora, não de dia inteiro)', () => {
    const lido = parseBookingEvent(evento({ id: 'ev-filo', summary: 'Pick filó', startDate: '2026-09-25', endDate: '2026-09-25' }));

    expect(lido).toMatchObject({ serviceType: 'daycare', dogName: 'filó', clientName: null, startDate: '2026-09-25' });
  });

  it('aceita as variações que o escritório escreve', () => {
    expect(looksLikeTransport('Pick filó')).toBe(true);
    expect(parseTransportTitle('Pick up Mowgli')).toEqual({ dogName: 'Mowgli', clientName: null });
    expect(parseTransportTitle('Drop off Bella (Amor)')).toEqual({ dogName: 'Bella', clientName: 'Amor' });
    expect(parseTransportTitle('Van: Thor')).toEqual({ dogName: 'Thor', clientName: null });
  });

  it('importa qualquer título do calendário dedicado, mesmo sem palavra-chave', () => {
    expect(looksLikeTransport('Dentist 3pm')).toBe(false);
    expect(looksLikeTransport('Almoço com o Carlos')).toBe(false);
    expect(parseBookingEvent(evento({ id: 'ev-bella', summary: 'Bella' }))).toMatchObject({
      serviceType: 'daycare',
      dogName: 'Bella',
    });
    expect(parseBookingEvent(evento({ id: 'ev-sem-palavra', summary: 'Filó banho' }))).toMatchObject({
      serviceType: 'daycare',
      dogName: 'Filó banho',
    });
  });

  it('o "Pick filó" entra no plano como reserva do cão Filó', () => {
    const plano = planCalendarImport(
      [evento({ id: 'ev-filo', summary: 'Pick filó', startDate: '2026-09-25', endDate: '2026-09-25' })],
      [{ id: 'dog-filo', name: 'Filó', clientName: 'Amor' }],
      [],
      JANELA,
    );

    expect(plano).toHaveLength(1);
    expect(plano[0]).toMatchObject({ kind: 'create', dogId: 'dog-filo', eventId: 'ev-filo' });
  });

  it('nome que não casa com o cadastro vira CADASTRO NOVO (cliente + cão), não pendência', () => {
    const plano = planCalendarImport(
      [evento({ id: 'ev-x', summary: 'Pick Zeus' })],
      [{ id: 'dog-filo', name: 'Filó', clientName: 'Amor' }],
      [],
      JANELA,
    );

    expect(plano[0]).toMatchObject({ kind: 'create', eventId: 'ev-x', dogId: null, newDog: { name: 'Zeus', clientName: 'Zeus' } });
  });
});

describe('leitura da recorrência', () => {
  it('evento de um dia: o fim do Google é exclusivo', () => {
    expect(parseRecurrence(null, '2026-09-25', '2026-09-26')).toEqual({
      weekdays: [],
      endDate: '2026-09-25',
      skipDates: [],
      openEnded: false,
    });
  });

  it('série de dias da semana com data de fim (UNTIL) e pausas (EXDATE)', () => {
    const resultado = parseRecurrence(
      ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261031', 'EXDATE;VALUE=DATE:20260930'],
      '2026-09-28',
      '2026-09-29',
    );
    expect(resultado.weekdays).toEqual([1, 3]);
    expect(resultado.endDate).toBe('2026-10-31');
    expect(resultado.skipDates).toEqual(['2026-09-30']);
    expect(resultado.openEnded).toBe(false);
  });

  it('série sem data de fim fica aberta', () => {
    const resultado = parseRecurrence(['RRULE:FREQ=WEEKLY;BYDAY=TU,TH'], '2026-09-29', '2026-09-30');
    expect(resultado.weekdays).toEqual([2, 4]);
    expect(resultado.openEnded).toBe(true);
    expect(resultado.endDate).toBe('2026-09-29');
  });
});

describe('ida e volta do formato', () => {
  it('o evento que o app cria volta como a reserva original', () => {
    const reserva = {
      dogName: 'Filó',
      clientName: 'Amor',
      serviceType: 'daycare' as const,
      startDate: '2026-09-28',
      endDate: '2026-10-31',
      weekdays: [1, 3],
      skipDates: ['2026-09-30'],
    };
    const enviado = buildGoogleEvent(reserva);
    const lido = parseBookingEvent(
      evento({ id: 'e1', summary: enviado.summary, startDate: enviado.start.date, endDate: enviado.end.date, recurrence: enviado.recurrence ?? null }),
    );
    expect(lido).toEqual({
      serviceType: 'daycare',
      dogName: 'Filó',
      clientName: 'Amor',
      startDate: '2026-09-28',
      endDate: '2026-10-31',
      weekdays: [1, 3],
      skipDates: ['2026-09-30'],
      openEnded: false,
    });
  });
});

describe('plano da importação', () => {
  const dogs = [
    { id: 'dog-bella', name: 'Bella', clientName: 'Leigh Ann' },
    { id: 'dog-mowgli', name: 'Mowgli', clientName: 'Maria Silva' },
    { id: 'dog-luna-a', name: 'Luna', clientName: 'Ana' },
    { id: 'dog-luna-b', name: 'Luna', clientName: 'Bruno' },
  ];

  it('cria reserva quando o cão casa com o cadastro', () => {
    const plano = planCalendarImport([evento({ id: 'e1', summary: 'Boarding · Bella (Leigh Ann)', startDate: '2026-10-05', endDate: '2026-10-09' })], dogs, [], JANELA);
    expect(plano).toEqual([
      {
        kind: 'create',
        eventId: 'e1',
        dogId: 'dog-bella',
        parsed: expect.objectContaining({ serviceType: 'boarding', startDate: '2026-10-05', endDate: '2026-10-08' }),
      },
    ]);
  });

  it('não toca no evento que é do espelho do app', () => {
    const plano = planCalendarImport([evento({ id: 'e-nosso', summary: 'Daycare · Bella (Leigh Ann)', appKey: 'res:123' })], dogs, [], JANELA);
    expect(plano).toEqual([]);
  });

  it('título do calendário dedicado sem cão no app também entra, criando o cadastro', () => {
    const plano = planCalendarImport([evento({ id: 'e-dent', summary: 'Dentist 3pm' })], dogs, [], JANELA);
    expect(plano).toEqual([
      expect.objectContaining({ kind: 'create', eventId: 'e-dent', dogId: null, newDog: { name: 'Dentist 3pm', clientName: 'Dentist 3pm' } }),
    ]);
  });

  it('cria reserva com título contendo somente o nome do cão', () => {
    const plano = planCalendarImport([evento({ id: 'e-bella', summary: 'Bella' })], dogs, [], JANELA);
    expect(plano[0]).toMatchObject({ kind: 'create', eventId: 'e-bella', dogId: 'dog-bella' });
  });

  it('evento sem título vai para revisão em vez de sumir — e não cria cadastro sem nome', () => {
    const plano = planCalendarImport([evento({ id: 'e-sem-titulo', summary: '' })], dogs, [], JANELA);
    expect(plano[0]).toMatchObject({ kind: 'review', eventId: 'e-sem-titulo', reason: 'unreadable' });
    expect(plano.some((item) => item.kind === 'create')).toBe(false);
  });

  it('evento com cão desconhecido entra criando cliente e cão com o nome do título', () => {
    const plano = planCalendarImport([evento({ id: 'e2', summary: 'Boarding · Rex' })], dogs, [], JANELA);
    expect(plano[0]).toMatchObject({ kind: 'create', eventId: 'e2', dogId: null, newDog: { name: 'Rex', clientName: 'Rex' } });
  });

  it('dois cães com o mesmo nome: desempata pelo tutor e, sem tutor, cria o cadastro do título', () => {
    const ambiguo = planCalendarImport([evento({ id: 'e3', summary: 'Daycare · Luna' })], dogs, [], JANELA);
    expect(ambiguo[0]).toMatchObject({ kind: 'create', dogId: null, newDog: { name: 'Luna', clientName: 'Luna' } });

    const desempatado = planCalendarImport([evento({ id: 'e4', summary: 'Daycare · Luna (Bruno)' })], dogs, [], JANELA);
    expect(desempatado[0]).toMatchObject({ kind: 'create', dogId: 'dog-luna-b' });
  });

  it('atualiza a reserva que nasceu no Google quando o evento muda de data', () => {
    const ligada = [
      {
        id: 'r1',
        kind: 'reservation' as const,
        dogId: 'dog-bella',
        googleEventId: 'e5',
        source: 'google' as const,
        serviceType: 'boarding' as const,
        startDate: '2026-10-05',
        endDate: '2026-10-08',
        weekdays: null,
        skipDates: null,
        status: 'confirmed',
      },
    ];
    const plano = planCalendarImport([evento({ id: 'e5', summary: 'Boarding · Bella', startDate: '2026-10-07', endDate: '2026-10-09' })], dogs, ligada, JANELA);
    expect(plano).toEqual([
      { kind: 'update', eventId: 'e5', bookingKind: 'reservation', bookingId: 'r1', dogId: 'dog-bella', parsed: expect.objectContaining({ startDate: '2026-10-07', endDate: '2026-10-08' }) },
    ]);
  });

  it('não faz nada quando o evento está igual à reserva ligada', () => {
    const ligada = [
      {
        id: 'r1',
        kind: 'reservation' as const,
        dogId: 'dog-bella',
        googleEventId: 'e5',
        source: 'google' as const,
        serviceType: 'boarding' as const,
        startDate: '2026-10-05',
        endDate: '2026-10-08',
        weekdays: [],
        skipDates: [],
        status: 'confirmed',
      },
    ];
    expect(planCalendarImport([evento({ id: 'e5', summary: 'Boarding · Bella', startDate: '2026-10-05', endDate: '2026-10-09' })], dogs, ligada, JANELA)).toEqual([]);
  });

  it('cancela a reserva do Google quando o evento some dentro da janela', () => {
    const ligada = [
      {
        id: 'r1',
        kind: 'reservation' as const,
        dogId: 'dog-bella',
        googleEventId: 'e5',
        source: 'google' as const,
        serviceType: 'boarding' as const,
        startDate: '2026-10-05',
        endDate: '2026-10-08',
        weekdays: null,
        skipDates: null,
        status: 'confirmed',
      },
    ];
    expect(planCalendarImport([], dogs, ligada, JANELA)).toEqual([{ kind: 'cancel', eventId: 'e5', bookingKind: 'reservation', bookingId: 'r1' }]);
  });

  it('não cancela quando a reserva está fora da janela consultada', () => {
    const ligada = [
      {
        id: 'r1',
        kind: 'reservation' as const,
        dogId: 'dog-bella',
        googleEventId: 'e5',
        source: 'google' as const,
        serviceType: 'boarding' as const,
        startDate: '2027-03-05',
        endDate: '2027-03-08',
        weekdays: null,
        skipDates: null,
        status: 'confirmed',
      },
    ];
    expect(planCalendarImport([], dogs, ligada, { from: '2026-09-01', to: '2026-09-30' })).toEqual([]);
  });

  it('não duplica reserva que já existe no app: manda para revisão', () => {
    const existentes = [
      {
        id: 'r9',
        kind: 'reservation' as const,
        dogId: 'dog-bella',
        googleEventId: null,
        source: 'app' as const,
        serviceType: 'boarding' as const,
        startDate: '2026-10-05',
        endDate: '2026-10-08',
        weekdays: null,
        skipDates: null,
        status: 'confirmed',
      },
    ];
    const plano = planCalendarImport([evento({ id: 'e6', summary: 'Boarding · Bella', startDate: '2026-10-05', endDate: '2026-10-09' })], dogs, existentes, JANELA);
    expect(plano[0]).toMatchObject({ kind: 'review', reason: 'duplicate' });
  });

  it('série de dias da semana é do tipo recurring', () => {
    const plano = planCalendarImport(
      [evento({ id: 'e7', summary: 'Daycare · Mowgli', startDate: '2026-09-28', endDate: '2026-09-29', recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE'] })],
      dogs,
      [],
      JANELA,
    );
    const item = plano[0];
    expect(item).toMatchObject({ kind: 'create', dogId: 'dog-mowgli' });
    if (item.kind !== 'create') throw new Error('esperava um create para a série');
    expect(kindOf(item.parsed)).toBe('recurring');
  });
});

/**
 * Pedido do dono (24/09/2026): "eu preciso que o aplicativo quando clicar para sincronizar puxe TODOS
 * os agendamentos do google calendar do cliente pro cliente".
 *
 * O que estes testes travam:
 *  - título que não casa com o cadastro NÃO fica pendente: o app cadastra cão + cliente com o nome do
 *    título (um nome = cão, cliente com o mesmo nome; dois nomes = cão e tutor);
 *  - título vazio (ou só espaços) é o único que não vira cadastro: vai para a revisão;
 *  - idempotência: o vínculo é por EVENTO, então o segundo Sync (e o cão renomeado) não cria nada;
 *  - janela começando HOJE: nada com data anterior é criado, alterado ou cancelado.
 */
describe('cadastro automático do que veio do Google (24/09/2026)', () => {
  const HOJE = '2026-09-24';
  const DA_JANELA = { from: HOJE, to: '2027-03-23' };
  const dogs = [{ id: 'dog-bella', name: 'Bella', clientName: 'Leigh Ann', clientId: 'cli-leigh' }];

  it('título com um nome só: o nome é o cão e o cliente nasce com o mesmo nome', () => {
    const plano = planCalendarImport([evento({ id: 'e-kona', summary: 'Kona', startDate: '2026-09-30', endDate: '2026-10-01' })], dogs, [], DA_JANELA);

    expect(plano).toEqual([
      {
        kind: 'create',
        eventId: 'e-kona',
        dogId: null,
        newDog: { name: 'Kona', clientName: 'Kona' },
        parsed: expect.objectContaining({ dogName: 'Kona', clientName: null, startDate: '2026-09-30' }),
      },
    ]);
  });

  it('título com dois nomes ("Leigh Ann · Kona") usa os dois: cão e tutor', () => {
    const plano = planCalendarImport([evento({ id: 'e-1', summary: 'Leigh Ann · Kona' })], dogs, [], DA_JANELA);
    expect(plano[0]).toMatchObject({ kind: 'create', dogId: null, newDog: { name: 'Kona', clientName: 'Leigh Ann' } });
  });

  it('título com travessão ("Kona — Leigh Ann") lê o cão antes do tutor', () => {
    const plano = planCalendarImport([evento({ id: 'e-2', summary: 'Kona — Leigh Ann' })], dogs, [], DA_JANELA);
    expect(plano[0]).toMatchObject({ kind: 'create', dogId: null, newDog: { name: 'Kona', clientName: 'Leigh Ann' } });
  });

  it('tutor que já tem cão no app: o cão novo entra NO cliente que existe (não duplica cliente)', () => {
    const plano = planCalendarImport([evento({ id: 'e-3', summary: 'Zeus (Leigh Ann)' })], dogs, [], DA_JANELA);
    expect(plano[0]).toMatchObject({ kind: 'create', dogId: null, newDog: { name: 'Zeus', clientName: 'Leigh Ann', clientId: 'cli-leigh' } });
  });

  it('título genérico com texto vira o nome do cadastro (decisão: trazer todos)', () => {
    const plano = planCalendarImport([evento({ id: 'e-groom', summary: 'Grooming' })], dogs, [], DA_JANELA);
    expect(plano[0]).toMatchObject({ kind: 'create', dogId: null, newDog: { name: 'Grooming', clientName: 'Grooming' } });
  });

  it('título vazio ou só espaços não cadastra nada: vai para a revisão com o motivo', () => {
    const plano = planCalendarImport([evento({ id: 'e-vazio', summary: '   ' })], dogs, [], DA_JANELA);

    expect(plano).toEqual([expect.objectContaining({ kind: 'review', eventId: 'e-vazio', title: '   ', reason: 'unreadable' })]);
    expect(plano.some((item) => item.kind === 'create')).toBe(false);
  });

  it('idempotência: evento já ligado no segundo Sync não cria nada, mesmo com o cão renomeado', () => {
    const ligada = [
      {
        id: 'r-google',
        kind: 'reservation' as const,
        dogId: 'dog-novo',
        googleEventId: 'e-kona',
        source: 'google' as const,
        serviceType: 'daycare' as const,
        startDate: '2026-09-30',
        endDate: '2026-09-30',
        weekdays: null,
        skipDates: null,
        status: 'confirmed',
      },
    ];
    // O cadastro que o primeiro Sync criou já está no app — com o cão RENOMEADO pelo gestor.
    const cadastro = [{ id: 'dog-novo', name: 'Kona (renomeada)', clientName: 'Kona', clientId: 'cli-kona' }];

    const plano = planCalendarImport(
      [evento({ id: 'e-kona', summary: 'Kona', startDate: '2026-09-30', endDate: '2026-10-01' })],
      cadastro,
      ligada,
      DA_JANELA,
    );

    expect(plano).toEqual([]);
  });

  it('evento ligado cujo título passou a nomear outro cão do cadastro: a reserva muda de cão', () => {
    const cadastro = [
      { id: 'dog-bella', name: 'Bella', clientName: 'Leigh Ann', clientId: 'cli-leigh' },
      { id: 'dog-mowgli', name: 'Mowgli', clientName: 'Maria Silva', clientId: 'cli-maria' },
    ];
    const ligada = [
      {
        id: 'r-google',
        kind: 'reservation' as const,
        dogId: 'dog-bella',
        googleEventId: 'e-trocou',
        source: 'google' as const,
        serviceType: 'daycare' as const,
        startDate: '2026-09-30',
        endDate: '2026-09-30',
        weekdays: null,
        skipDates: null,
        status: 'confirmed',
      },
    ];

    const plano = planCalendarImport([evento({ id: 'e-trocou', summary: 'Mowgli', startDate: '2026-09-30', endDate: '2026-10-01' })], cadastro, ligada, DA_JANELA);

    expect(plano).toEqual([expect.objectContaining({ kind: 'update', bookingId: 'r-google', dogId: 'dog-mowgli' })]);
  });

  it('idempotência: sem vínculo, o cão já cadastrado é usado em vez de cadastrar de novo', () => {
    const cadastro = [{ id: 'dog-kona', name: 'Kona', clientName: 'Kona', clientId: 'cli-kona' }];
    const plano = planCalendarImport([evento({ id: 'e-kona', summary: 'Kona' })], cadastro, [], DA_JANELA);
    expect(plano).toEqual([
      expect.objectContaining({ kind: 'create', eventId: 'e-kona', dogId: 'dog-kona' }),
    ]);
  });

  it('nada com data anterior a hoje é criado, alterado nem cancelado', () => {
    const ontem = '2026-09-23';
    const eventos = [
      evento({ id: 'e-ontem', summary: 'Kona', startDate: ontem, endDate: ontem }),
      evento({ id: 'e-hoje', summary: 'Kona', startDate: HOJE, endDate: HOJE }),
    ];
    // Reserva de ONTEM vinda do Google cujo evento sumiu da consulta: não pode ser cancelada.
    const reservaDeOntem = [
      {
        id: 'r-ontem',
        kind: 'reservation' as const,
        dogId: 'dog-bella',
        googleEventId: 'e-sumiu-ontem',
        source: 'google' as const,
        serviceType: 'daycare' as const,
        startDate: ontem,
        endDate: ontem,
        weekdays: null,
        skipDates: null,
        status: 'confirmed',
      },
    ];

    const plano = planCalendarImport(eventos, [], reservaDeOntem, DA_JANELA);

    expect(plano).toEqual([expect.objectContaining({ kind: 'create', eventId: 'e-hoje' })]);
  });

  it('evento ligado que mudou para uma data passada não é atualizado', () => {
    const ligada = [
      {
        id: 'r1',
        kind: 'reservation' as const,
        dogId: 'dog-bella',
        googleEventId: 'e-volta',
        source: 'google' as const,
        serviceType: 'daycare' as const,
        startDate: '2026-10-01',
        endDate: '2026-10-01',
        weekdays: null,
        skipDates: null,
        status: 'confirmed',
      },
    ];
    const plano = planCalendarImport([evento({ id: 'e-volta', summary: 'Bella', startDate: '2026-09-10', endDate: '2026-09-10' })], dogs, ligada, DA_JANELA);
    expect(plano).toEqual([]);
  });
});

describe('resumo para a tela', () => {
  it('descreve o que veio do Google (texto da interface: inglês)', () => {
    expect(describeImport({ created: 2, updated: 1, cancelled: 1, review: 3 })).toBe('2 from Google · 1 updated · 1 cancelled · 3 to review');
    expect(describeImport({ created: 0, updated: 0, cancelled: 0, review: 0 })).toBe('');
  });
});
