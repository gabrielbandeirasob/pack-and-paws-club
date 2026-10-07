/** Regressão de 07/10/2026: trocar a agenda cancelou Enso, Oreo e Rani às 12:50 UTC. */
import { runCalendarImport } from '@/features/integrations/google/importService';
import { supabaseImportPorts } from '@/features/integrations/google/importPorts';
import { montarCasosDaImportacao, type ReservaParaImportar } from '@/features/integrations/google/importSnapshot';
import { planCalendarImport, parseBookingEvent, type BookingForImport } from '@/features/integrations/google/importPlan';

// Executa também os módulos gerados que o robô usa com o app fechado (sem rede nem banco real).
const servidor = require('../supabase/functions/_shared/importacao/importService') as { runCalendarImport: typeof runCalendarImport };
const portasServidor = require('../supabase/functions/_shared/importacao/importPorts') as { supabaseImportPorts: typeof supabaseImportPorts };
const janela = { from: '2026-10-07', to: '2027-04-05' };
const caes = ['Enso', 'Oreo', 'Rani'].map((name) => ({ id: name, name, clientName: 'Cliente' }));
const eventos = caes.map(({ name }, i) => ({
  id: `evento-${name}`, summary: name, colorId: i === 0 ? '2' : '7',
  start: { date: '2026-10-07' }, end: { date: '2026-10-08' },
}));

function banco() {
  const linhas: ReservaParaImportar[] = [];
  const cliente = {
    from: () => ({
      insert: (valores: object) => {
        linhas.push({ id: `r${linhas.length}`, status: 'confirmed', ...valores } as ReservaParaImportar);
        return { error: null };
      },
      update: (valores: object) => ({
        eq: async (coluna: string, id: string) => {
          expect(coluna).toBe('id');
          Object.assign(linhas.find((linha) => linha.id === id)!, valores);
          return { error: null };
        },
      }),
    }),
  };
  return { linhas, cliente };
}

it.each([
  ['app', runCalendarImport, supabaseImportPorts],
  ['servidor', servidor.runCalendarImport, portasServidor.supabaseImportPorts],
] as const)('%s: importa A, troca para B repetidamente e só cancela exclusão em A', async (_, executar, portas) => {
  const { linhas, cliente } = banco();
  const sincronizar = (calendarId: string, items: typeof eventos) => executar({
    accessToken: 'token-falso', calendarId, dogs: caes,
    reservations: montarCasosDaImportacao(linhas), window: janela,
    range: { timeMin: '2026-10-07T00:00:00Z', timeMax: '2027-04-06T00:00:00Z' },
    doFetch: async (url) => {
      expect(url).toContain(`/calendars/${calendarId}/events`);
      return { ok: true, status: 200, json: async () => ({ items }) };
    },
    ports: portas(cliente as never, 'org'),
  });
  expect(await sincronizar('A', eventos)).toMatchObject({ created: 3, cancelled: 0, failures: [] });
  expect(linhas.map((linha) => linha.google_calendar_id)).toEqual(['A', 'A', 'A']);
  for (let rodada = 0; rodada < 2; rodada++) {
    expect(await sincronizar('B', [])).toMatchObject({ cancelled: 0, failures: [] });
    expect(linhas.map((linha) => linha.status)).toEqual(['confirmed', 'confirmed', 'confirmed']);
  }
  // Em A, só Oreo foi apagado. Enso e Rani continuam presentes e confirmados.
  expect(await sincronizar('A', eventos.filter((evento) => evento.summary !== 'Oreo')))
    .toMatchObject({ cancelled: 1, failures: [] });
  expect(linhas.find((linha) => linha.dog_id === 'Oreo')?.status).toBe('cancelled');
  expect(linhas.filter((linha) => linha.status === 'confirmed').map((linha) => linha.dog_id).sort()).toEqual(['Enso', 'Rani']);
});

const herdada: BookingForImport = {
  id: 'r-antiga', dogId: 'Enso', kind: 'reservation', googleEventId: 'antigo',
  source: 'google', serviceType: 'boarding', startDate: janela.from, endDate: janela.from, status: 'confirmed',
};
it.each([undefined, null])('origem legada %s não é atribuída à agenda nova nem cancelada', (googleCalendarId) => {
  const reservas = [{ ...herdada, googleCalendarId }];
  for (const calendarId of ['A', 'B', 'B']) {
    expect(planCalendarImport([], caes, reservas, janela, { calendarId })).toEqual([]);
  }
});

it('mesmo id em outra agenda não atualiza a reserva herdada', () => {
  const evento = { id: 'antigo', summary: 'Rani', startDate: janela.from, endDate: '2026-10-09', colorId: '7', appKey: null };
  const plano = planCalendarImport([evento], caes, [{ ...herdada, googleCalendarId: 'A' }], janela, { calendarId: 'B' });
  expect(plano.map((item) => item.kind)).toEqual(['create']);
});

it('atualizar legado não inventa origem; primary sem identidade também fica desconhecido', async () => {
  const { cliente, linhas } = banco();
  const parsed = parseBookingEvent({ id: 'antigo', summary: 'Enso', startDate: janela.from, endDate: '2026-10-08', colorId: '2', appKey: null })!;
  const portas = supabaseImportPorts(cliente as never, 'org');
  await portas.createBooking({ eventId: 'antigo', dogId: 'Enso', kind: 'reservation', parsed });
  expect(linhas[0].google_calendar_id).toBeNull();
  await supabaseImportPorts(cliente as never, 'org').updateBooking({
    bookingId: linhas[0].id, eventId: 'antigo', dogId: 'Enso', kind: 'reservation', parsed,
  });
  expect(linhas[0].google_calendar_id).toBeNull();
});

it('a fotografia carrega a origem tanto da reserva quanto da série', () => {
  const base = { id: 'r', dog_id: 'd', start_date: janela.from, end_date: janela.from, google_event_id: 'e', google_calendar_id: 'A', source: 'google' };
  const resultado = montarCasosDaImportacao([{ ...base, status: 'confirmed', service_type: 'daycare' }], [{ ...base, weekdays: [3] }]);
  expect(resultado.map((item) => item.googleCalendarId)).toEqual(['A', 'A']);
});

// A troca pode ser de CONTA mantendo o alias "primary": só o token atual prova qual agenda é.
it.each([
  ['app', runCalendarImport, supabaseImportPorts],
  ['servidor', servidor.runCalendarImport, portasServidor.supabaseImportPorts],
] as const)('%s: primary de outra conta não se passa pelo calendário de origem', async (_, executar, portas) => {
  const { linhas, cliente } = banco();
  const sincronizar = (id: string | null, items: typeof eventos) => executar({
    accessToken: `token-${id}`, calendarId: 'primary', dogs: caes,
    reservations: montarCasosDaImportacao(linhas), window: janela,
    range: { timeMin: '2026-10-07T00:00:00Z', timeMax: '2027-04-06T00:00:00Z' },
    doFetch: async (url, init) => {
      expect(init.headers).toMatchObject({ Authorization: `Bearer token-${id}` });
      return { ok: true, status: 200, json: async () => url.endsWith('/calendars/primary') ? { id } : { items } };
    },
    ports: portas(cliente as never, 'org'),
  });
  expect(await sincronizar('conta-A', eventos)).toMatchObject({ created: 3, failures: [] });
  expect(linhas.map((linha) => linha.google_calendar_id)).toEqual(['conta-A', 'conta-A', 'conta-A']);
  expect(await sincronizar('conta-B', [])).toMatchObject({ cancelled: 0, failures: [] });
  expect(await sincronizar(null, [])).toMatchObject({ cancelled: 0, failures: [] });
  expect(await sincronizar('conta-A', [])).toMatchObject({ cancelled: 3, failures: [] });
});
