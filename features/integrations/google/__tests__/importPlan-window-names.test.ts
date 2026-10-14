import { parseEvent } from '../calendarApi';
import { planCalendarImport, type DogForImport, type BookingForImport } from '../importPlan';
import type { RemoteEvent } from '../eventMarkers';

const window = { from: '2026-10-14', to: '2026-10-20' };
const dogs: DogForImport[] = [
  { id: 'skippy', name: 'Skippy', clientId: 'emilly' },
  { id: 'sylvie', name: 'Sylvie', clientId: 'jez' },
  { id: 'agnes', name: 'Agnes', clientId: 'jez' },
  { id: 'honey', name: 'Honey Bea' },
];
const event = (summary: string, extra: Partial<RemoteEvent> = {}): RemoteEvent => ({
  id: 'event', summary, startDate: window.from, endDate: '2026-10-15', colorId: '7', ...extra,
});
const master = parseEvent({ id: 'bs7j30jloek1lph03vsk6ku0t0', summary: 'Skippy',
  start: { dateTime: '2026-10-09T15:30:00-07:00' }, end: { dateTime: '2026-10-09T16:30:00-07:00' },
  recurrence: ['RRULE:FREQ=DAILY;UNTIL=20261017T065959Z'], colorId: '10' });
const movement = parseEvent({ id: 'edited', recurringEventId: master.id, summary: 'Skippy 🏠',
  start: { date: '2026-10-16' }, end: { date: '2026-10-17' }, colorId: '10' });
const occurrences = [12, 13, 14, 15].map((day): RemoteEvent => ({ ...master, id: `occurrence-${day}`,
  recurringEventId: master.id, recurrence: null, recurrenceUntilDate: undefined,
  startDate: `2026-10-${day}`, endDate: `2026-10-${day + 1}` }));
const skippyEvents = [master, ...occurrences, movement];
const labels = [{ id: 'movement', name: 'Avocado', backgroundColor: '#c0ca33' }];
const plan = (events: RemoteEvent[], registry = dogs, existing: BookingForImport[] = []) =>
  planCalendarImport(events, registry, existing, window, { calendarId: 'office', labels });

describe('importação: master antigo e nomes conservadores', () => {
  it('1: Skippy cria estadia dentro da janela e mantém uma única instância de movimento', () => {
    const result = plan(skippyEvents);
    const created = result.filter((item) => item.kind === 'create');
    expect(created).toHaveLength(2);
    expect(created.find((item) => item.eventId === master.id)?.parsed).toMatchObject({
      startDate: window.from, endDate: '2026-10-16', weekdays: [], skipDates: [], movementDay: false, transportRequired: true, serviceType: 'boarding',
    });
    expect(created.find((item) => item.eventId === movement.id)?.parsed).toMatchObject({
      startDate: '2026-10-16', movementDay: true, weekdays: [], serviceType: 'boarding',
    });
    expect(created.every((item) => item.parsed.startDate >= window.from && item.parsed.skipDates.every((date) => date >= window.from))).toBe(true);
    // O movimento é uma linha de um dia; a estadia inclui esse mesmo dia no intervalo.
    expect(created.filter((item) => item.parsed.weekdays.length === 0 && item.parsed.startDate === '2026-10-16')).toHaveLength(1);
    const existing: BookingForImport[] = created.map((item) => ({ id: item.eventId, dogId: item.dogId,
      googleEventId: item.eventId, googleCalendarId: 'office', source: 'google',
      kind: item.parsed.weekdays.length ? 'recurring' : 'reservation',
      serviceType: item.parsed.serviceType!, startDate: item.parsed.startDate, endDate: item.parsed.endDate,
      weekdays: item.parsed.weekdays, skipDates: item.parsed.skipDates, movementDay: item.parsed.movementDay,
      status: item.parsed.weekdays.length ? 'active' : 'confirmed' }));
    expect(plan(skippyEvents, dogs, existing)).toEqual([]);
  });
  it('2: série terminada antes da janela permanece ignorada', () => {
    expect(plan([{ ...master, recurrence: ['RRULE:FREQ=DAILY;UNTIL=20261010T065959Z'], recurrenceUntilDate: '2026-10-09' }])).toEqual([]);
  });
  it('3: Silvye/Agnes importa ambas e registra Sylvie em revisão', () => {
    const result = plan([event('Silvye/Agnes')]);
    expect(result.filter((item) => item.kind === 'create').map((item) => item.dogId).sort()).toEqual(['agnes', 'sylvie']);
    expect(result.filter((item) => item.kind === 'review')).toEqual([expect.objectContaining({ reason: 'nome aproximado: "Silvye" -> Sylvie' })]);
    expect(dogs[1].name).toBe('Sylvie');
  });
  it('4: Honey importa Honey Bea única e registra revisão', () => {
    expect(plan([event('Honey')])).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'create', dogId: 'honey' }),
      expect.objectContaining({ kind: 'review', reason: 'nome aproximado: "Honey" -> Honey Bea' }),
    ]));
  });
  it('5: dois Sam exatos continuam ambiguous dog sem criação', () => {
    expect(plan([event('Sam')], [{ id: '1', name: 'Sam' }, { id: '2', name: 'Sam' }])).toEqual([
      expect.objectContaining({ kind: 'review', reason: 'ambiguous dog' }),
    ]);
  });
  it('6: nome inexistente sem candidato continua unknown dog', () => {
    expect(plan([event('Xylophonic')])).toEqual([expect.objectContaining({ kind: 'review', reason: 'unknown dog' })]);
  });
  it('aproximação ambígua não escolhe candidato', () => {
    expect(plan([event('Honey')], [...dogs, { id: 'other', name: 'Honey Bee' }])).toEqual([
      expect.objectContaining({ kind: 'review', reason: 'ambiguous dog' }),
    ]);
  });
  it('irmã exata desempata aproximação por casa independentemente da ordem', () => {
    const registry = [...dogs, { id: 'other', name: 'Silvie', clientId: 'other' }];
    for (const title of ['Silvye/Agnes', 'Agnes/Silvye']) {
      expect(plan([event(title)], registry).filter((item) => item.kind === 'create').map((item) => item.dogId).sort()).toEqual(['agnes', 'sylvie']);
    }
  });
  it('reimportar título aproximado não cancela a cadela já vinculada', () => {
    const existing: BookingForImport = { id: 's', dogId: 'sylvie', googleEventId: 'event', googleCalendarId: 'office',
      source: 'google', kind: 'reservation', serviceType: 'daycare', startDate: window.from, endDate: window.from, status: 'confirmed' };
    const result = plan([event('Silvye/Agnes')], dogs, [existing]);
    expect(result.filter((item) => item.kind === 'cancel')).toEqual([]);
    expect(result.filter((item) => item.kind === 'create').map((item) => item.dogId)).toEqual(['agnes']);
  });
});

it('master antigo atualiza a série e preserva reserva vinculada anterior à janela', () => {
  const existing: BookingForImport = { id: 'old', kind: 'recurring', dogId: 'skippy', googleEventId: master.id,
    googleCalendarId: 'office', source: 'google', serviceType: 'daycare', startDate: '2026-10-09',
    endDate: '2026-10-16', weekdays: [0, 1, 2, 3, 4, 5, 6], status: 'active' };
  expect(plan([{ ...master, colorId: '7' }], dogs, [existing])).toEqual([expect.objectContaining({ kind: 'update', bookingId: 'old',
    parsed: expect.objectContaining({ startDate: window.from, endDate: '2026-10-16', weekdays: [3, 4, 5] }) })]);
  expect(plan([master], dogs, [{ ...existing, kind: 'reservation', status: 'confirmed' }])).toEqual([]);
});

it('instância vermelha recorta a estadia e não cria reserva no dia cancelado', () => {
  const red = { ...movement, colorId: '11', eventLabelId: null };
  const result = plan([master, red]);
  const created = result.filter((item) => item.kind === 'create');
  expect(created).toHaveLength(1);
  expect(created[0].eventId).toBe(master.id);
  expect(created[0].parsed).toMatchObject({ startDate: window.from, endDate: '2026-10-15', weekdays: [], movementDay: false });
});

it('master AZUL antigo continua série daycare recortada e idempotente', () => {
  const blue = { ...master, colorId: '7' };
  const result = plan([blue]);
  expect(result).toEqual([expect.objectContaining({ kind: 'create', eventId: master.id,
    parsed: expect.objectContaining({ serviceType: 'daycare', startDate: window.from,
      endDate: '2026-10-16', weekdays: [3, 4, 5] }) })]);
  const existing: BookingForImport = { id: 'blue-series', kind: 'recurring', dogId: 'skippy',
    googleEventId: blue.id, googleCalendarId: 'office', source: 'google', serviceType: 'daycare',
    startDate: window.from, endDate: '2026-10-16', weekdays: [3, 4, 5], status: 'active' };
  expect(plan([blue], dogs, [existing])).toEqual([]);
});

it('exato tem prioridade sobre aproximado mesmo quando só o aproximado é da casa', () => {
  const registry = [{ id: 'exact', name: 'Sam', clientId: 'outside' },
    { id: 'near', name: 'Sam Junior', clientId: 'home' },
    { id: 'sibling', name: 'Ollie', clientId: 'home' }];
  const result = plan([event('Sam/Ollie')], registry);
  expect(result.filter((item) => item.kind === 'review')).toEqual([]);
  expect(result.filter((item) => item.kind === 'create').map((item) => item.dogId).sort()).toEqual(['exact', 'sibling']);
});

it('dois candidatos exatos na casa do irmão continuam ambíguos', () => {
  const registry = [{ id: 'sam1', name: 'Sam', clientId: 'home' },
    { id: 'sam2', name: 'Sam', clientId: 'home' },
    { id: 'sibling', name: 'Ollie', clientId: 'home' }];
  const result = plan([event('Sam/Ollie')], registry);
  expect(result.filter((item) => item.kind === 'review')).toEqual([
    expect.objectContaining({ reason: 'ambiguous dog' }),
  ]);
  expect(result.filter((item) => item.kind === 'create').map((item) => item.dogId)).toEqual(['sibling']);
});

const persisted = (result: ReturnType<typeof plan>): BookingForImport[] => result.flatMap((item) => item.kind === 'create' ? [{
  id: item.eventId, dogId: item.dogId, googleEventId: item.eventId, googleCalendarId: 'office', source: 'google' as const,
  kind: 'reservation' as const, serviceType: item.parsed.serviceType!, startDate: item.parsed.startDate,
  endDate: item.parsed.endDate, movementDay: item.parsed.movementDay, status: 'confirmed' as const,
}] : []);

it('preserva o filho existente, cria só estadia e reimporta sem alterações', () => {
  const existing = persisted(plan([movement]));
  const result = plan(skippyEvents, dogs, existing);
  expect(result).toEqual([expect.objectContaining({ kind: 'create', eventId: master.id,
    parsed: expect.objectContaining({ startDate: '2026-10-14', endDate: '2026-10-16', movementDay: false, transportRequired: true, weekdays: [] }) })]);
  expect(plan(skippyEvents, dogs, [...existing, ...persisted(result)])).toEqual([]);
});

it('vermelho corta dois grupos e permanece idempotente', () => {
  const red = event('Skippy', { id: 'red', colorId: '11', startDate: '2026-10-15', endDate: '2026-10-16', recurringEventId: master.id });
  const result = plan([master, red]);
  expect(result.filter((r) => r.kind === 'create').map((r) => [r.parsed.startDate, r.parsed.endDate, r.parsed.movementDay])).toEqual([
    ['2026-10-14', '2026-10-14', false], ['2026-10-16', '2026-10-16', false],
  ]);
  expect(plan([master, red], dogs, persisted(result))).toEqual([]);
});

it('só o filho de movimento na janela cria uma única reserva', () => {
  const result = planCalendarImport(skippyEvents, dogs, [], { from: '2026-10-16', to: window.to }, { labels, calendarId: 'office' });
  expect(result).toEqual([expect.objectContaining({ kind: 'create', eventId: movement.id,
    parsed: expect.objectContaining({ startDate: '2026-10-16', endDate: '2026-10-16', movementDay: true, weekdays: [] }) })]);
});

it('EXDATE quebra a estadia e filho movido não ressuscita a data original', () => {
  const excluded = { ...master, recurrence: [...master.recurrence!, 'EXDATE;VALUE=DATE:20261015'] };
  expect(plan([excluded]).filter((r) => r.kind === 'create').map((r) => [r.parsed.startDate, r.parsed.endDate])).toEqual([
    ['2026-10-14', '2026-10-14'], ['2026-10-16', '2026-10-16'],
  ]);
  const moved = { ...movement, originalStartDate: '2026-10-15', startDate: '2026-10-18', endDate: '2026-10-19' };
  const result = plan([master, moved]);
  expect(result.filter((r) => r.kind === 'create').map((r) => r.parsed).every((p) => !(p.startDate <= '2026-10-15' && p.endDate >= '2026-10-15'))).toBe(true);
});

it('não cria estadias sobrepostas de dois masters nem sobre uma reserva existente', () => {
  const other = { ...master, id: 'other-master' };
  const result = plan([master, other]);
  expect(result.filter((r) => r.kind === 'create')).toHaveLength(1);
  expect(result.filter((r) => r.kind === 'review')).toHaveLength(1);
  const existing = persisted(plan([other]));
  expect(plan([master, other], dogs, existing).filter((r) => r.kind === 'create')).toEqual([]);
});

it('vermelho novo recorta uma estadia existente sem cancelar o grupo vizinho', () => {
  const existing = persisted(plan([master]));
  const red = event('Skippy', { id: 'red', colorId: '11', startDate: '2026-10-15', endDate: '2026-10-16', recurringEventId: master.id });
  const result = plan([master, red], dogs, existing);
  expect(result.filter((r) => r.kind === 'cancel')).toEqual([]);
  expect(result.filter((r) => r.kind === 'update')).toEqual([expect.objectContaining({
    parsed: expect.objectContaining({ startDate: '2026-10-14', endDate: '2026-10-14' }),
  })]);
  expect(result.filter((r) => r.kind === 'create')).toHaveLength(1);
});
