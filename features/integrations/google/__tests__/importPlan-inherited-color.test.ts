import { planCalendarImport, type BookingForImport } from '../importPlan';
import type { RemoteEvent } from '../eventMarkers';

const window = { from: '2026-10-14', to: '2026-10-20' };
const dogs = [{ id: 'skippy', name: 'Skippy' }];
const master: RemoteEvent = {
  id: 'series', summary: 'Skippy', colorId: '10',
  startDate: window.from, endDate: '2026-10-15',
  recurrence: ['RRULE:FREQ=DAILY;UNTIL=20261016'],
};
const child: RemoteEvent = {
  id: 'home', summary: 'Skippy 🏠', recurringEventId: master.id,
  startDate: '2026-10-16', endDate: '2026-10-17',
  colorId: null, eventLabelId: 'unavailable-label',
};
const plan = (events: RemoteEvent[], existing: BookingForImport[] = [], labels = [] as { id: string; name: string; backgroundColor: string }[]) =>
  planCalendarImport(events, dogs, existing, window, { calendarId: 'office', labels });
const persisted = (result: ReturnType<typeof plan>): BookingForImport[] => result.flatMap((item) => item.kind === 'create' ? [{
  id: item.eventId, dogId: item.dogId, googleEventId: item.eventId, googleCalendarId: 'office', source: 'google' as const,
  kind: item.parsed.weekdays.length ? 'recurring' as const : 'reservation' as const,
  serviceType: item.parsed.serviceType!, startDate: item.parsed.startDate, endDate: item.parsed.endDate,
  weekdays: item.parsed.weekdays, skipDates: item.parsed.skipDates, movementDay: item.parsed.movementDay,
  status: item.parsed.weekdays.length ? 'active' as const : 'confirmed' as const,
}] : []);

it.each(['unavailable-label', null])('filho com casa herda verde com etiqueta %s e mantém um dia de movimento', (eventLabelId) => {
  const events = [{ ...child, eventLabelId }, master]; // master depois do filho também funciona
  const before = JSON.stringify(events);
  const result = plan(events);
  expect(result.filter((r) => r.kind === 'review')).toEqual([]);
  expect(result.filter((r) => r.kind === 'create' && r.eventId === child.id)).toEqual([
    expect.objectContaining({ parsed: expect.objectContaining({ serviceType: 'boarding', movementDay: true,
      startDate: child.startDate, endDate: child.startDate, weekdays: [],
      color: expect.objectContaining({ colorId: '10', meaning: { kind: 'service', serviceType: 'boarding' } }),
    }) }),
  ]);
  expect(JSON.stringify(events)).toBe(before);
  expect(plan(events, persisted(result))).toEqual([]);
});

it('filho herda azul e reimporta sem alterações', () => {
  const events = [{ ...master, colorId: '7' }, child];
  const result = plan(events);
  expect(result.filter((r) => r.kind === 'review')).toEqual([]);
  expect(result).toContainEqual(expect.objectContaining({ kind: 'create', eventId: child.id,
    parsed: expect.objectContaining({ serviceType: 'daycare', startDate: child.startDate, endDate: child.startDate }) }));
  expect(plan(events, persisted(result))).toEqual([]);
});

it('vermelho próprio cancela o dia e recorta a série verde', () => {
  const existing = persisted(plan([master, child]));
  const result = plan([master, { ...child, colorId: '11', eventLabelId: null }], existing);
  expect(result).toContainEqual(expect.objectContaining({ kind: 'cancel', bookingId: child.id }));
  expect(result.filter((r) => r.kind === 'create')).toEqual([]);
  expect(result).toContainEqual(expect.objectContaining({ kind: 'update', bookingId: master.id,
    parsed: expect.objectContaining({ endDate: '2026-10-15' }) }));
});

it('sem master, filho com etiqueta ILEGÍVEL permanece pendente', () => {
  expect(plan([{ ...child, eventLabelId: 'unavailable-label' }])).toEqual([
    expect.objectContaining({ kind: 'review', reason: 'unrecognized color' }),
  ]);
});

it('sem master, filho SEM cor e SEM etiqueta mantém o padrão de hoje (daycare)', () => {
  // Medido no calendário real (14/10/2026): as séries de daycare do escritório não têm cor nem
  // etiqueta (colorId/eventLabelId vazios) e os cães entram como daycare — é esse o padrão do app.
  // Anular esse padrão para filhos derrubava 40 dias da lista ("unrecognized color").
  const result = plan([{ ...child, eventLabelId: null, colorId: null }]);
  expect(result.filter((r) => r.kind === 'review')).toEqual([]);
  expect(result).toContainEqual(expect.objectContaining({ kind: 'create', eventId: child.id,
    parsed: expect.objectContaining({ serviceType: 'daycare' }) }));
});

it.each([null, '6'])('master sem cor resolvível (%s) não empresta serviço', (colorId) => {
  const result = plan([{ ...master, colorId }, child]);
  expect(result.filter((r) => r.eventId === child.id)).toEqual([
    expect.objectContaining({ kind: 'review', reason: 'unrecognized color' }),
  ]);
});

it('evento independente sem nenhuma cor mantém daycare padrão', () => {
  expect(plan([{ ...child, recurringEventId: null, eventLabelId: null }])).toEqual([
    expect.objectContaining({ kind: 'create', parsed: expect.objectContaining({ serviceType: 'daycare' }) }),
  ]);
});

it.each([false, true])('azul próprio resolvível (etiqueta=%s) vence verde do master', (label) => {
  const result = plan([master, { ...child, colorId: label ? null : '7', eventLabelId: label ? 'blue' : null }], [],
    [{ id: 'blue', name: 'Peacock', backgroundColor: '#039be5' }]);
  expect(result.filter((r) => r.kind === 'review')).toEqual([]);
  expect(result).toContainEqual(expect.objectContaining({ kind: 'create', eventId: child.id,
    parsed: expect.objectContaining({ serviceType: 'daycare' }) }));
});

it('herda a resolução da etiqueta do master quando disponível', () => {
  const result = plan([{ ...master, colorId: null, eventLabelId: 'green' }, child], [],
    [{ id: 'green', name: 'Basil', backgroundColor: '#0b8043' }]);
  expect(result).toContainEqual(expect.objectContaining({ kind: 'create', eventId: child.id,
    parsed: expect.objectContaining({ serviceType: 'boarding', movementDay: true,
      color: expect.objectContaining({ source: 'label', labelId: 'green' }) }) }));
});
