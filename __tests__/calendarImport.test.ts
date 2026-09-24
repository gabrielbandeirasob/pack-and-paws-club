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

  it('nome que não casa com o cadastro vai para revisão (não inventa cão)', () => {
    const plano = planCalendarImport(
      [evento({ id: 'ev-x', summary: 'Pick Zeus' })],
      [{ id: 'dog-filo', name: 'Filó', clientName: 'Amor' }],
      [],
      JANELA,
    );

    expect(plano[0]).toMatchObject({ kind: 'review', eventId: 'ev-x', reason: 'unknown dog' });
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

  it('manda qualquer título sem cão correspondente para revisão', () => {
    const plano = planCalendarImport([evento({ id: 'e-dent', summary: 'Dentist 3pm' })], dogs, [], JANELA);
    expect(plano).toEqual([
      expect.objectContaining({ kind: 'review', eventId: 'e-dent', reason: 'unknown dog' }),
    ]);
  });

  it('cria reserva com título contendo somente o nome do cão', () => {
    const plano = planCalendarImport([evento({ id: 'e-bella', summary: 'Bella' })], dogs, [], JANELA);
    expect(plano[0]).toMatchObject({ kind: 'create', eventId: 'e-bella', dogId: 'dog-bella' });
  });

  it('evento sem título também aparece para revisão em vez de sumir', () => {
    const plano = planCalendarImport([evento({ id: 'e-sem-titulo', summary: '' })], dogs, [], JANELA);
    expect(plano[0]).toMatchObject({ kind: 'review', eventId: 'e-sem-titulo', reason: 'unreadable' });
  });

  it('manda para revisão quando o cão é desconhecido (não cria cadastro fantasma)', () => {
    const plano = planCalendarImport([evento({ id: 'e2', summary: 'Boarding · Rex' })], dogs, [], JANELA);
    expect(plano[0]).toMatchObject({ kind: 'review', reason: 'unknown dog', eventId: 'e2' });
  });

  it('manda para revisão quando dois cães têm o mesmo nome — e desempata pelo tutor', () => {
    const ambiguo = planCalendarImport([evento({ id: 'e3', summary: 'Daycare · Luna' })], dogs, [], JANELA);
    expect(ambiguo[0]).toMatchObject({ kind: 'review', reason: 'ambiguous dog' });

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

describe('resumo para a tela', () => {
  it('descreve o que veio do Google (texto da interface: inglês)', () => {
    expect(describeImport({ created: 2, updated: 1, cancelled: 1, review: 3 })).toBe('2 from Google · 1 updated · 1 cancelled · 3 to review');
    expect(describeImport({ created: 0, updated: 0, cancelled: 0, review: 0 })).toBe('');
  });
});
