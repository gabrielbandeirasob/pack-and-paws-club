import { buildDay, transportPool, vanPool, type ReservationRecord } from '@/features/calendar/dayMath';
import { HEX_COCOA } from '@/features/calendar/googleColors';
import { eventFor, eventsEqual, planCalendarSync, type LocalReservation, type RemoteEvent } from '@/features/integrations/google/calendarSync';
import { planCalendarImport } from '@/features/integrations/google/importPlan';
import { supabaseImportPorts } from '@/features/integrations/google/importPorts';
import { runCalendarImport } from '@/features/integrations/google/importService';

const DIA = '2026-09-28';
const window = { from: DIA, to: '2026-09-30' };
const dogs = [
  { id: 'sylvie', name: 'Sylvie', clientName: 'Jez' },
  { id: 'agnes', name: 'Agnes', clientName: 'Jez' },
];
const evento: RemoteEvent = { id: 'evento-real', summary: 'Sylvie/Agnes', startDate: DIA, endDate: '2026-09-29' };

type Linha = {
  dog_id: string;
  google_event_id?: string;
  organization_id: string;
  service_type: 'daycare' | 'boarding';
  start_date: string;
  end_date: string;
  transport_required: boolean;
};

// Exercita as portas reais; o banco falso reproduz o índice único por organização/evento.
function banco() {
  const linhas: Linha[] = [];
  const ports = supabaseImportPorts({
    from: (tabela: string) => ({
      insert: async (linha: Linha) => {
        expect(tabela).toBe('reservations');
        if (linha.google_event_id && linhas.some((salva) => salva.organization_id === linha.organization_id && salva.google_event_id === linha.google_event_id)) {
          return { error: { code: '23505', message: 'duplicate key value violates unique constraint "reservations_google_event_unico"' } };
        }
        linhas.push(linha);
        return { error: null };
      },
    }),
  } as never, 'org-jez');
  return { linhas, ports };
}

it('renomeia Daycare · Sylvie (Jez) para Sylvie no próximo Sync e depois fica idempotente', () => {
  const reserva: LocalReservation = { id: 'res-sylvie', dogName: 'Sylvie', clientName: 'Jez', serviceType: 'daycare', startDate: DIA };
  const desejado = eventFor(reserva);
  const remoto: RemoteEvent = { ...evento, appKey: reserva.id, summary: 'Daycare · Sylvie (Jez)', colorId: desejado.colorId };
  expect(desejado.summary).toBe('Sylvie');
  expect(eventsEqual(desejado, remoto)).toBe(false);
  expect(planCalendarSync([reserva], [remoto])).toEqual([
    { type: 'update', reservationId: reserva.id, eventId: remoto.id, event: desejado },
  ]);
  expect(planCalendarSync([reserva], [{ ...remoto, summary: 'Sylvie' }])).toEqual([]);
});

it('Sylvie/Agnes da mesma casa cria as duas reservas; só Sylvie recebe google_event_id', async () => {
  expect(planCalendarImport([evento], dogs, [], window)).toMatchObject([
    { kind: 'create', dogId: 'sylvie', parsed: { dogName: 'Sylvie', serviceType: 'daycare' } },
    { kind: 'create', dogId: 'agnes', parsed: { dogName: 'Agnes', serviceType: 'daycare' } },
  ]);
  const { linhas, ports } = banco();
  const criar = jest.spyOn(ports, 'createBooking');
  const resumo = await runCalendarImport({
    accessToken: 'teste', window, range: { timeMin: `${DIA}T00:00:00Z`, timeMax: '2026-09-30T00:00:00Z' },
    dogs, reservations: [], ports,
    doFetch: async () => ({ ok: true, status: 200, json: async () => ({ items: [
      { id: evento.id, summary: evento.summary, start: { date: evento.startDate }, end: { date: evento.endDate } },
    ] }) }),
  });
  expect(criar.mock.calls.map(([entrada]) => [entrada.dogId, entrada.semVinculo])).toEqual([
    ['sylvie', false], ['agnes', true],
  ]);
  expect(linhas).toHaveLength(2);
  expect(linhas[0]).toMatchObject({ dog_id: 'sylvie', google_event_id: evento.id });
  expect(linhas[1]).toMatchObject({ dog_id: 'agnes' });
  expect(linhas[1]).not.toHaveProperty('google_event_id');
  expect(resumo).toMatchObject({ created: 2, already: 0, failures: [], review: [] });
});

it('Cocoa sozinho conta no dia, persiste sem transporte e fica fora das listas do Dispatch', async () => {
  const labels = [{ id: 'cocoa', name: 'Cocoa', backgroundColor: HEX_COCOA }];
  const plano = planCalendarImport([{ ...evento, summary: 'Sylvie', eventLabelId: 'cocoa' }], dogs, [], window, { labels });
  expect(plano).toHaveLength(1);
  const item = plano[0];
  expect(item).toMatchObject({ kind: 'create', parsed: { serviceType: 'daycare', transportRequired: false } });
  if (item.kind !== 'create') throw new Error('Esperava criação');
  const { linhas, ports } = banco();
  await ports.createBooking({ eventId: item.eventId, dogId: item.dogId, kind: 'reservation', parsed: item.parsed });
  expect(linhas[0].transport_required).toBe(false);
  const reservas: ReservationRecord[] = linhas.map((linha) => ({
    id: 'res-sylvie', dog: { id: linha.dog_id, dogName: 'Sylvie', clientName: 'Jez' },
    serviceType: linha.service_type, startDate: linha.start_date, endDate: linha.end_date,
    transportRequired: linha.transport_required,
  }));
  const dia = buildDay(DIA, reservas, []);
  expect(dia.daycare.map((cao) => cao.dogId)).toEqual(['sylvie']);
  expect(dia.daycare.length + dia.boarding.length).toBe(1);
  expect(transportPool(dia)).toEqual([]);
  expect(vanPool(dia)).toEqual([]);
});
