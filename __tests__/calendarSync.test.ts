import { eventFor, eventsEqual, planCalendarSync, type LocalReservation, type RemoteEvent } from '@/features/integrations/google/calendarSync';

const daycare: LocalReservation = {
  id: 'res-1',
  dogName: 'Filo',
  clientName: 'Raphael',
  serviceType: 'daycare',
  startDate: '2026-09-10',
};

const boarding: LocalReservation = {
  id: 'res-2',
  dogName: 'Bolt',
  clientName: 'Rogerio',
  serviceType: 'boarding',
  startDate: '2026-09-05',
  endDate: '2026-09-10',
};

function remoteFrom(reservation: LocalReservation, overrides: Partial<RemoteEvent> = {}): RemoteEvent {
  const event = eventFor(reservation);
  return {
    id: `g-${reservation.id}`,
    appKey: reservation.id,
    summary: event.summary,
    startDate: event.start.date,
    endDate: event.end.date,
    // O que o Google devolve inclui a COR do evento — e é ela que o espelho compara.
    colorId: event.colorId ?? null,
    recurrence: event.recurrence ?? null,
    ...overrides,
  };
}

describe('planCalendarSync', () => {
  it('cria eventos para reservas que ainda nao existem no Google', () => {
    const actions = planCalendarSync([daycare], []);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: 'create', reservationId: 'res-1' });
  });

  it('nao faz nada quando o Google ja esta igual (idempotente)', () => {
    expect(planCalendarSync([daycare, boarding], [remoteFrom(daycare), remoteFrom(boarding)])).toEqual([]);
  });

  it('atualiza quando o resumo ou as datas mudam', () => {
    const actions = planCalendarSync([daycare], [remoteFrom(daycare, { summary: 'Daycare · Filo (antigo)' })]);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: 'update', eventId: 'g-res-1' });
  });

  it('apaga evento nosso que nao tem mais reserva (mas ignora evento sem appKey)', () => {
    const actions = planCalendarSync([], [remoteFrom(daycare), { id: 'pessoal', appKey: null, summary: 'Dentista', startDate: '2026-09-10', endDate: '2026-09-11' }]);
    expect(actions).toEqual([{ type: 'delete', eventId: 'g-res-1' }]);
  });

  it('embute a chave de idempotencia no evento enviado', () => {
    const event = eventFor(daycare);
    expect(event.extendedProperties?.private.appKey).toBe('res-1');
    // Marca fixa: sem ela o filtro da listagem não tem como reconhecer os nossos eventos.
    expect(event.extendedProperties?.private.packpawsMirror).toBe('v1');
    expect(event.start.date).toBe('2026-09-10');
    expect(event.end.date).toBe('2026-09-11');
  });

  it('pinta o evento com a cor do serviço (verde boarding, azul daycare)', () => {
    expect(eventFor(daycare).colorId).toBe('7'); // Peacock
    expect(eventFor(boarding).colorId).toBe('2'); // Sage
  });

  it('evento do espelho SEM cor (criado antes desta regra) é atualizado para ganhar a cor', () => {
    const semCor = remoteFrom(daycare, { colorId: null });
    const actions = planCalendarSync([daycare], [semCor]);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: 'update', eventId: 'g-res-1' });
  });

  it('cor trocada (serviço mudou) também é atualização', () => {
    const comCorErrada = remoteFrom(daycare, { colorId: '2' });
    expect(eventsEqual(eventFor(daycare), comCorErrada)).toBe(false);
  });

  it('respeita a recorrencia semanal e o fim exclusivo no boarding', () => {
    const recurring: LocalReservation = { ...daycare, id: 'res-3', weekdays: [1, 3, 5] };
    const event = eventFor(recurring);
    expect(event.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR']);
    expect(eventFor(boarding).end.date).toBe('2026-09-11');
  });

  it('e deterministico independente da ordem das reservas', () => {
    const a = planCalendarSync([daycare, boarding], []);
    const b = planCalendarSync([boarding, daycare], []);
    expect(a.map((action) => action.type + ':' + JSON.stringify(action).length)).toEqual(
      b.map((action) => action.type + ':' + JSON.stringify(action).length),
    );
  });

  it('compara eventos com e sem recorrencia', () => {
    const desired = eventFor({ ...daycare, weekdays: [2] });
    expect(eventsEqual(desired, remoteFrom(daycare, { recurrence: null }))).toBe(false);
    expect(eventsEqual(eventFor(daycare), remoteFrom(daycare, { recurrence: null }))).toBe(true);
  });
});

/**
 * ETIQUETAS no espelho (bug 56): verde/azul continuam sendo o contrato, mas quando o calendário já
 * tem uma etiqueta daquele tom o evento sai com ela — é assim que o escritório vê o mesmo padrão de
 * cor que usa à mão. Sem etiqueta (ou quando não deu para lê-las) o espelho cai no `colorId` legado e
 * NÃO quebra.
 */
describe('espelho e as etiquetas de cor do calendário', () => {
  const ETIQUETAS = [
    { id: 'lab-azul', name: 'Cobalto', backgroundColor: '#4A86E8' },
    { id: 'lab-verde', name: 'Verde', backgroundColor: '#33b679' },
    { id: 'lab-amarela', name: 'Amarelo', backgroundColor: '#ffd666' },
  ];

  it('usa a etiqueta do tom do serviço (azul = daycare, verde = boarding) e mantém o colorId', () => {
    const manha = eventFor(daycare, { labels: ETIQUETAS });
    const noite = eventFor(boarding, { labels: ETIQUETAS });

    expect(manha.eventLabelId).toBe('lab-azul');
    expect(noite.eventLabelId).toBe('lab-verde');
    // O `colorId` legado vai junto: é o que um cliente antigo do calendário entende.
    expect(manha.colorId).toBe('7');
    expect(noite.colorId).toBe('2');
  });

  it('sem etiqueta do serviço no calendário, o evento sai só com o colorId (não pode quebrar o espelho)', () => {
    const semCor = eventFor(daycare, { labels: [{ id: 'x', name: 'Amarelo', backgroundColor: '#ffd666' }] });
    expect(semCor.eventLabelId).toBeUndefined();
    expect(semCor.colorId).toBe('7');
    // Sem etiquetas lidas (token sem o escopo novo) nada muda em relação ao que já funcionava.
    expect(eventFor(daycare, { labels: [] }).eventLabelId).toBeUndefined();
    expect(eventFor(daycare).eventLabelId).toBeUndefined();
  });

  it('o espelho ADOTA a etiqueta no primeiro Sync e depois fica idempotente', () => {
    const remoto = remoteFrom(daycare, { colorId: '7' }); // evento criado antes desta correção
    expect(eventsEqual(eventFor(daycare, { labels: ETIQUETAS }), remoto)).toBe(false);
    expect(eventsEqual(eventFor(daycare, { labels: ETIQUETAS }), remoteFrom(daycare, { colorId: '7', eventLabelId: 'lab-azul' }))).toBe(true);
  });

  it('sem etiqueta a cobrar, o que está no Google não vira atualização por causa da etiqueta', () => {
    // Evento pintado à mão com etiqueta e reserva nossa: `undefined` = "não mexe" (não brigamos com
    // quem pinta o calendário).
    const remoto = remoteFrom(daycare, { eventLabelId: 'lab-azul' });
    expect(eventsEqual(eventFor(daycare), remoto)).toBe(true);
  });

  it('o plano manda a etiqueta do serviço no evento criado', () => {
    const acoes = planCalendarSync([daycare], [], { labels: ETIQUETAS });
    expect(acoes).toHaveLength(1);
    if (acoes[0].type !== 'create') throw new Error('esperava create');
    expect(acoes[0].event.eventLabelId).toBe('lab-azul');
  });
});
