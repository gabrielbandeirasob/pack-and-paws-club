/**
 * IMPORTACAO do Google Calendar para o app — REGRA NOVA do dono (24/09/2026).
 *
 * O que estes testes travam (a regra INVERTE o cadastro automatico dos builds 52-54):
 *  - o titulo do evento traz SO o nome do cao (tolerando o formato antigo na leitura do NOME);
 *  - o SERVICO vem da COR do evento: verde (2/10) = boarding, azul (7/9) = daycare;
 *  - VERMELHO (11) = cancelamento: cancela a reserva daquele cao NAQUELE dia; numa serie, pula o dia;
 *  - cao fora do cadastro NAO e importado e NAO e cadastrado: vai para a lista "not registered";
 *  - sem cor (ou cor fora do mapa, ex.: amarelo = 5) NAO se chuta servico: lista "color not recognized";
 *  - vínculo por EVENTO, janela comecando HOJE, nada de duplicar reserva existente.
 */
import { buildGoogleEvent } from '@/features/calendar/googleEvents';
import {
  describeImport,
  dogNameFromTitle,
  kindOf,
  parseBookingEvent,
  parseRecurrence,
  planCalendarImport,
  type BookingForImport,
  type DogForImport,
} from '@/features/integrations/google/importPlan';
import { meaningOfColor } from '@/features/calendar/googleColors';
import type { RemoteEvent } from '@/features/integrations/google/calendarSync';

const JANELA = { from: '2026-09-01', to: '2026-12-31' };
const DA_JANELA = { from: '2026-09-24', to: '2027-03-23' };

/** Ids da paleta fixa do Google (ver `googleColors`). */
const VERDE = '2'; // Sage  -> boarding
const VERDE2 = '10'; // Basil -> boarding
const AZUL = '7'; // Peacock  -> daycare
const AZUL2 = '9'; // Blueberry -> daycare
const VERMELHO = '11'; // Tomato -> cancelamento
const AMARELO = '5'; // Banana  -> fora do mapa (o dono citou amarelo e corrigiu para azul)

function evento(parcial: Partial<RemoteEvent> & { id: string }): RemoteEvent {
  return { summary: '', startDate: '2026-09-25', endDate: '2026-09-26', appKey: null, colorId: AZUL, recurrence: null, ...parcial };
}

const CAES: DogForImport[] = [
  { id: 'dog-bella', name: 'Bella', clientName: 'Leigh Ann' },
  { id: 'dog-mowgli', name: 'Mowgli', clientName: 'Maria Silva' },
  { id: 'dog-luna-a', name: 'Luna', clientName: 'Ana' },
  { id: 'dog-luna-b', name: 'Luna', clientName: 'Bruno' },
  { id: 'dog-pietro', name: 'Pietro', clientName: 'Carlos' },
];

function reservaExistente(over: Partial<BookingForImport> = {}): BookingForImport {
  return {
    id: 'r-bella',
    kind: 'reservation',
    dogId: 'dog-bella',
    googleEventId: null,
    source: 'app',
    serviceType: 'boarding',
    startDate: '2026-10-05',
    endDate: '2026-10-08',
    weekdays: null,
    skipDates: null,
    status: 'confirmed',
    ...over,
  };
}

describe('a COR do evento é o serviço (e o título é só o nome do cão)', () => {
  it('traduz os ids da paleta: verde = boarding, azul = daycare, vermelho = cancelar', () => {
    expect(meaningOfColor(VERDE)).toEqual({ kind: 'service', serviceType: 'boarding' });
    expect(meaningOfColor(VERDE2)).toEqual({ kind: 'service', serviceType: 'boarding' });
    expect(meaningOfColor(AZUL)).toEqual({ kind: 'service', serviceType: 'daycare' });
    expect(meaningOfColor(AZUL2)).toEqual({ kind: 'service', serviceType: 'daycare' });
    expect(meaningOfColor(VERMELHO)).toEqual({ kind: 'cancel' });
  });

  it('NÃO adivinha serviço: sem cor e cores fora do mapa (amarelo/banana) devolvem null', () => {
    expect(meaningOfColor(null)).toBeNull();
    expect(meaningOfColor(undefined)).toBeNull();
    expect(meaningOfColor('')).toBeNull();
    expect(meaningOfColor(AMARELO)).toBeNull();
    // Lavanda, uva, flamingo, tangerina e grafite também ficam de fora.
    for (const id of ['1', '3', '4', '6', '8']) expect(meaningOfColor(id)).toBeNull();
  });

  it('lê o nome do cão de um título com apenas o nome', () => {
    expect(dogNameFromTitle('Pietro')).toBe('Pietro');
    expect(dogNameFromTitle('  Bella  ')).toBe('Bella');
  });

  it('continua lendo o NOME nos títulos do formato antigo (palavra de serviço, pick, tutor)', () => {
    expect(dogNameFromTitle('Daycare · Bella (Leigh Ann)')).toBe('Bella');
    expect(dogNameFromTitle('Boarding - Luna')).toBe('Luna');
    expect(dogNameFromTitle('creche: Mowgli')).toBe('Mowgli');
    expect(dogNameFromTitle('Pick filó')).toBe('filó');
    expect(dogNameFromTitle('Drop off Bella (Amor)')).toBe('Bella');
    // Dois nomes: ponto médio/barra -> o cão é o último; travessão -> o cão é o primeiro.
    expect(dogNameFromTitle('Leigh Ann · Kona')).toBe('Kona');
    expect(dogNameFromTitle('Kona — Leigh Ann')).toBe('Kona');
  });

  it('título sem nome nenhum não vira cão', () => {
    expect(dogNameFromTitle('')).toBeNull();
    expect(dogNameFromTitle('   ')).toBeNull();
    expect(dogNameFromTitle('Daycare')).toBeNull();
    expect(dogNameFromTitle('Pick up')).toBeNull();
  });

  it('o serviço do agendamento sai da cor, NUNCA do título', () => {
    // Título com a palavra "Boarding" e cor AZUL: quem manda é a cor.
    const azulComPalavra = parseBookingEvent(evento({ id: 'e1', summary: 'Boarding · Bella', colorId: AZUL }));
    expect(azulComPalavra).toMatchObject({ serviceType: 'daycare', cancels: false, dogName: 'Bella' });

    // Título só com o nome e cor VERDE: boarding.
    const verdeSemPalavra = parseBookingEvent(evento({ id: 'e2', summary: 'Bella', colorId: VERDE }));
    expect(verdeSemPalavra).toMatchObject({ serviceType: 'boarding', cancels: false, dogName: 'Bella' });

    // Vermelho: não é serviço, é cancelamento.
    const vermelho = parseBookingEvent(evento({ id: 'e3', summary: 'Bella', colorId: VERMELHO }));
    expect(vermelho).toMatchObject({ serviceType: null, cancels: true, dogName: 'Bella' });

    // Sem cor: serviço indefinido (não se chuta).
    const semCor = parseBookingEvent(evento({ id: 'e4', summary: 'Bella', colorId: null }));
    expect(semCor).toMatchObject({ serviceType: null, cancels: false });
  });

  it('título sem nome não é lido (vai para a pendência "unreadable")', () => {
    expect(parseBookingEvent(evento({ id: 'e5', summary: '   ' }))).toBeNull();
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
  it('o evento que o app cria volta como o agendamento original (serviço pela cor)', () => {
    const reserva = {
      dogName: 'Filó',
      clientName: 'Amor',
      serviceType: 'boarding' as const,
      startDate: '2026-09-28',
      endDate: '2026-10-31',
      weekdays: [1, 3],
      skipDates: ['2026-09-30'],
    };
    const enviado = buildGoogleEvent(reserva);
    // O espelho PINTou o evento com a cor do serviço — é isso que faz a volta ler boarding.
    expect(enviado.colorId).toBe(VERDE);
    const lido = parseBookingEvent(
      evento({
        id: 'e1',
        summary: enviado.summary,
        startDate: enviado.start.date,
        endDate: enviado.end.date,
        colorId: enviado.colorId ?? null,
        recurrence: enviado.recurrence ?? null,
      }),
    );
    expect(lido).toEqual({
      serviceType: 'boarding',
      cancels: false,
      dogName: 'Filó',
      startDate: '2026-09-28',
      endDate: '2026-10-31',
      weekdays: [1, 3],
      skipDates: ['2026-09-30'],
      openEnded: false,
    });
  });
});

describe('plano da importação — o que entra', () => {
  it('cão cadastrado + cor verde = reserva de BOARDING', () => {
    const plano = planCalendarImport([evento({ id: 'e1', summary: 'Pietro', colorId: VERDE, startDate: '2026-10-05', endDate: '2026-10-09' })], CAES, [], JANELA);

    expect(plano).toEqual([
      {
        kind: 'create',
        eventId: 'e1',
        dogId: 'dog-pietro',
        parsed: expect.objectContaining({ serviceType: 'boarding', cancels: false, startDate: '2026-10-05', endDate: '2026-10-08' }),
      },
    ]);
  });

  it('cão cadastrado + cor azul = reserva de DAYCARE (mesmo com a palavra "Boarding" no título)', () => {
    const plano = planCalendarImport([evento({ id: 'e2', summary: 'Boarding · Pietro', colorId: AZUL2 })], CAES, [], JANELA);

    expect(plano[0]).toMatchObject({ kind: 'create', dogId: 'dog-pietro' });
    if (plano[0].kind !== 'create') throw new Error('esperava create');
    expect(plano[0].parsed.serviceType).toBe('daycare');
  });

  it('casa o nome tolerando caixa e acento (Filó = filo = FILO)', () => {
    const cadastro: DogForImport[] = [{ id: 'dog-filo', name: 'Filó' }];
    const plano = planCalendarImport([evento({ id: 'e3', summary: 'filo', colorId: AZUL })], cadastro, [], JANELA);
    expect(plano[0]).toMatchObject({ kind: 'create', dogId: 'dog-filo' });
  });

  it('não toca no evento que é do espelho do app', () => {
    const plano = planCalendarImport([evento({ id: 'e-nosso', summary: 'Pietro', appKey: 'res:123' })], CAES, [], JANELA);
    expect(plano).toEqual([]);
  });

  it('série de dias da semana (RRULE) é do tipo recurring', () => {
    const plano = planCalendarImport(
      [evento({ id: 'e7', summary: 'Mowgli', colorId: AZUL, startDate: '2026-09-28', endDate: '2026-09-29', recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE'] })],
      CAES,
      [],
      JANELA,
    );
    const item = plano[0];
    expect(item).toMatchObject({ kind: 'create', dogId: 'dog-mowgli' });
    if (item.kind !== 'create') throw new Error('esperava um create para a série');
    expect(kindOf(item.parsed)).toBe('recurring');
  });

  it('atualiza a reserva que nasceu no Google quando o evento muda de data OU de cor', () => {
    const ligada = [reservaExistente({ id: 'r1', dogId: 'dog-bella', googleEventId: 'e5', source: 'google', serviceType: 'daycare', startDate: '2026-10-05', endDate: '2026-10-08' })];
    // Mudou de dia e ficou verde: o serviço do app passa a boarding.
    const plano = planCalendarImport([evento({ id: 'e5', summary: 'Bella', colorId: VERDE, startDate: '2026-10-07', endDate: '2026-10-09' })], CAES, ligada, JANELA);
    expect(plano).toEqual([
      { kind: 'update', eventId: 'e5', bookingKind: 'reservation', bookingId: 'r1', dogId: 'dog-bella', parsed: expect.objectContaining({ serviceType: 'boarding', startDate: '2026-10-07', endDate: '2026-10-08' }) },
    ]);
  });

  it('não faz nada quando o evento está igual à reserva ligada', () => {
    const ligada = [reservaExistente({ id: 'r1', googleEventId: 'e5', source: 'google', serviceType: 'boarding', startDate: '2026-10-05', endDate: '2026-10-08' })];
    const plano = planCalendarImport([evento({ id: 'e5', summary: 'Bella', colorId: VERDE, startDate: '2026-10-05', endDate: '2026-10-09' })], CAES, ligada, JANELA);
    expect(plano).toEqual([]);
  });

  it('não duplica reserva que já existe no app: manda para revisão', () => {
    const plano = planCalendarImport([evento({ id: 'e6', summary: 'Bella', colorId: VERDE, startDate: '2026-10-05', endDate: '2026-10-09' })], CAES, [reservaExistente()], JANELA);
    expect(plano[0]).toMatchObject({ kind: 'review', reason: 'duplicate' });
  });

  it('cancela a reserva do Google quando o evento some dentro da janela', () => {
    const ligada = [reservaExistente({ id: 'r1', googleEventId: 'e5', source: 'google' })];
    expect(planCalendarImport([], CAES, ligada, JANELA)).toEqual([{ kind: 'cancel', eventId: 'e5', bookingKind: 'reservation', bookingId: 'r1' }]);
  });

  it('não cancela quando a reserva está fora da janela consultada', () => {
    const ligada = [reservaExistente({ id: 'r1', googleEventId: 'e5', source: 'google', startDate: '2027-03-05', endDate: '2027-03-08' })];
    expect(planCalendarImport([], CAES, ligada, { from: '2026-09-01', to: '2026-09-30' })).toEqual([]);
  });
});

describe('plano da importação — cão que NÃO está no cadastro (não se cria ninguém)', () => {
  it('nome desconhecido NÃO é importado e aparece na lista "not registered"', () => {
    const plano = planCalendarImport([evento({ id: 'e-rex', summary: 'Rex', colorId: VERDE })], CAES, [], JANELA);

    expect(plano).toEqual([
      expect.objectContaining({ kind: 'review', eventId: 'e-rex', title: 'Rex', reason: 'unknown dog' }),
    ]);
    // O serviço continua conhecido (a cor é verde): o gestor pode cadastrar o cão e sincronizar.
    expect(plano[0]).toMatchObject({ parsed: expect.objectContaining({ serviceType: 'boarding', dogName: 'Rex' }) });
    // NADA de criar cadastro: este é o ponto que a regra nova revoga.
    expect(plano.some((item) => item.kind === 'create')).toBe(false);
  });

  it('nome repetido em dois cães vai para a lista, com o motivo — o app não escolhe no chute', () => {
    const plano = planCalendarImport([evento({ id: 'e3', summary: 'Luna', colorId: AZUL })], CAES, [], JANELA);
    expect(plano[0]).toMatchObject({ kind: 'review', reason: 'ambiguous dog' });
  });

  it('título SEM nome vai para a revisão (unreadable) em vez de sumir', () => {
    const plano = planCalendarImport([evento({ id: 'e-sem-titulo', summary: '' })], CAES, [], JANELA);
    expect(plano[0]).toMatchObject({ kind: 'review', eventId: 'e-sem-titulo', reason: 'unreadable' });
    expect(plano.some((item) => item.kind === 'create')).toBe(false);
  });
});

describe('plano da importação — cor não reconhecida', () => {
  it('evento SEM cor não entra e cai na lista "color not recognized"', () => {
    const plano = planCalendarImport([evento({ id: 'e-sem-cor', summary: 'Pietro', colorId: null })], CAES, [], JANELA);

    expect(plano).toEqual([
      expect.objectContaining({ kind: 'review', eventId: 'e-sem-cor', reason: 'unrecognized color' }),
    ]);
    expect(plano.some((item) => item.kind === 'create')).toBe(false);
  });

  it('cor fora do mapa (amarelo/banana) também não é importada — o dono corrigiu amarelo para azul', () => {
    const plano = planCalendarImport([evento({ id: 'e-amarelo', summary: 'Bella', colorId: AMARELO })], CAES, [], JANELA);
    expect(plano[0]).toMatchObject({ kind: 'review', reason: 'unrecognized color' });
  });
});

describe('plano da importação — evento VERMELHO cancela o dia daquele cão', () => {
  it('cancela a reserva avulsa daquele cão que cobre o dia', () => {
    const existentes = [reservaExistente({ id: 'r-cobre', dogId: 'dog-pietro', serviceType: 'daycare', startDate: '2026-10-05', endDate: '2026-10-08' })];
    const plano = planCalendarImport([evento({ id: 'e-red', summary: 'Pietro', colorId: VERMELHO, startDate: '2026-10-06', endDate: '2026-10-07' })], CAES, existentes, JANELA);

    expect(plano).toEqual([{ kind: 'cancel', eventId: 'e-red', bookingKind: 'reservation', bookingId: 'r-cobre' }]);
  });

  it('num dia de SÉRIE, pula só o dia (nunca desativa a escala inteira)', () => {
    const serie: BookingForImport = reservaExistente({
      id: 'serie-pietro',
      kind: 'recurring',
      dogId: 'dog-pietro',
      serviceType: 'daycare',
      startDate: '2026-09-01',
      endDate: null,
      weekdays: [1, 3], // segunda e quarta
      skipDates: [],
      status: 'active',
    });
    // 2026-09-30 é uma QUARTA.
    const plano = planCalendarImport([evento({ id: 'e-qua', summary: 'Pietro', colorId: VERMELHO, startDate: '2026-09-30', endDate: '2026-10-01' })], CAES, [serie], JANELA);

    expect(plano).toEqual([{ kind: 'skip', eventId: 'e-qua', scheduleId: 'serie-pietro', date: '2026-09-30' }]);
  });

  it('dia de série JÁ pulado não gera trabalho de novo (idempotente)', () => {
    const serie: BookingForImport = reservaExistente({
      id: 'serie-pietro',
      kind: 'recurring',
      dogId: 'dog-pietro',
      serviceType: 'daycare',
      startDate: '2026-09-01',
      endDate: null,
      weekdays: [3],
      skipDates: ['2026-09-30'],
      status: 'active',
    });
    const plano = planCalendarImport([evento({ id: 'e-qua', summary: 'Pietro', colorId: VERMELHO, startDate: '2026-09-30', endDate: '2026-10-01' })], CAES, [serie], JANELA);
    expect(plano).toEqual([]);
  });

  it('sem nada para cancelar naquele dia, o plano fica vazio (vermelho em dia sem agendamento)', () => {
    const existentes = [reservaExistente({ id: 'r-outro-dia', dogId: 'dog-pietro', serviceType: 'daycare', startDate: '2026-11-02', endDate: '2026-11-03' })];
    const plano = planCalendarImport([evento({ id: 'e-red', summary: 'Pietro', colorId: VERMELHO, startDate: '2026-10-06', endDate: '2026-10-07' })], CAES, existentes, JANELA);
    expect(plano).toEqual([]);
  });

  it('vermelho de cão FORA do cadastro aparece na lista (não há reserva para cancelar)', () => {
    const plano = planCalendarImport([evento({ id: 'e-red', summary: 'Rex', colorId: VERMELHO })], CAES, [], JANELA);
    expect(plano[0]).toMatchObject({ kind: 'review', reason: 'unknown dog' });
  });

  it('vermelho sobre o evento que já está ligado cancela AQUELE agendamento', () => {
    const ligada = [reservaExistente({ id: 'r-link', googleEventId: 'e-red', source: 'google', dogId: 'dog-pietro', serviceType: 'daycare' })];
    const plano = planCalendarImport([evento({ id: 'e-red', summary: 'Pietro', colorId: VERMELHO, startDate: '2026-10-06', endDate: '2026-10-07' })], CAES, ligada, JANELA);
    expect(plano).toEqual([{ kind: 'cancel', eventId: 'e-red', bookingKind: 'reservation', bookingId: 'r-link' }]);
  });

  it('vermelho sobre evento de SÉRIE pula o dia em vez de desativar a escala inteira', () => {
    const serie: BookingForImport = reservaExistente({
      id: 'serie-kona',
      kind: 'recurring',
      dogId: 'dog-pietro',
      googleEventId: 'e-serie',
      source: 'google',
      serviceType: 'daycare',
      startDate: '2026-09-01',
      endDate: null,
      weekdays: [1, 3],
      skipDates: [],
      status: 'active',
    });
    const plano = planCalendarImport([evento({ id: 'e-serie', summary: 'Pietro', colorId: VERMELHO, startDate: '2026-09-30', endDate: '2026-10-01' })], CAES, [serie], JANELA);

    expect(plano).toEqual([{ kind: 'skip', eventId: 'e-serie', scheduleId: 'serie-kona', date: '2026-09-30' }]);
    // Nada de `cancel` sobre a série: desativar a escala por causa de um dia apagaria o agendamento.
    expect(plano.some((item) => item.kind === 'cancel')).toBe(false);
  });
});

describe('janela da importação: nada do passado', () => {
  it('evento de ontem não cria, não altera e não cancela — e nem vira pendência', () => {
    const ontem = '2026-09-23';
    const eventos = [
      evento({ id: 'e-ontem', summary: 'Pietro', colorId: VERDE, startDate: ontem, endDate: ontem }),
      evento({ id: 'e-ontem-sem-titulo', summary: '', colorId: VERDE, startDate: ontem, endDate: ontem }),
      evento({ id: 'e-hoje', summary: 'Pietro', colorId: VERDE, startDate: '2026-09-24', endDate: '2026-09-24' }),
    ];
    const reservaDeOntem = [
      reservaExistente({ id: 'r-ontem', kind: 'reservation', dogId: 'dog-bella', googleEventId: 'e-sumiu-ontem', source: 'google', startDate: ontem, endDate: ontem }),
    ];

    const plano = planCalendarImport(eventos, CAES, reservaDeOntem, DA_JANELA);

    expect(plano).toEqual([expect.objectContaining({ kind: 'create', eventId: 'e-hoje' })]);
  });
});

describe('resumo para a tela', () => {
  it('descreve o que veio do Google (texto da interface: inglês)', () => {
    expect(describeImport({ created: 2, updated: 1, cancelled: 1, review: 3 })).toBe('2 from Google · 1 updated · 1 cancelled · 3 to review');
    expect(describeImport({ created: 0, updated: 0, cancelled: 0, review: 0 })).toBe('');
  });
});
