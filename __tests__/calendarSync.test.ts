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
