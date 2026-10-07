/** Reversão do dono em 07/10/2026: executor e portas reais, banco em memória. */
import { runCalendarImport } from '@/features/integrations/google/importService';
import { supabaseImportPorts } from '@/features/integrations/google/importPorts';
import { montarCasosDaImportacao, type ReservaParaImportar } from '@/features/integrations/google/importSnapshot';
import type { RemoteEvent } from '@/features/integrations/google/eventMarkers';

const servidor = require('../supabase/functions/_shared/importacao/importService') as { runCalendarImport: typeof runCalendarImport };
const portasServidor = require('../supabase/functions/_shared/importacao/importPorts') as { supabaseImportPorts: typeof supabaseImportPorts };
const dogs = ['Teddy', 'Billy'].map((name) => ({ id: name, name, clientId: 'amy', clientName: 'Amy' }));
const window = { from: '2026-10-07', to: '2026-11-30' };
const evento: RemoteEvent = { id: 'eve-1', summary: 'Teddy/Billy', colorId: '7', startDate: window.from, endDate: '2026-10-08' };

function banco(legado: boolean) {
  const linhas: (ReservaParaImportar & { transport_required?: boolean })[] = dogs.map(({ id }, indice) => ({
    id: `res-${id}`, dog_id: id, service_type: 'daycare', start_date: window.from, end_date: window.from,
    google_event_id: legado && indice === 1 ? null : evento.id,
    google_calendar_id: legado && indice === 1 ? null : 'agenda-A', source: 'google', status: 'confirmed',
  }));
  const cliente = { from: () => ({
    insert: async (valores: ReservaParaImportar) => {
      if (linhas.some((linha) => linha.google_event_id === valores.google_event_id && linha.dog_id === valores.dog_id)) {
        return { error: { code: '23505', message: 'reservations_google_event_unico' } };
      }
      linhas.push({ ...valores, id: `nova-${linhas.length}`, status: 'confirmed' });
      return { error: null };
    },
    update: (valores: Partial<ReservaParaImportar>) => ({ eq: async (_: string, id: string) => {
      const linha = linhas.find((item) => item.id === id)!;
      const nova = { ...linha, ...valores };
      if (nova.google_event_id && linhas.some((outra) => outra.id !== id && outra.google_event_id === nova.google_event_id && outra.dog_id === nova.dog_id)) {
        return { error: { code: '23505', message: 'reservations_google_event_unico' } };
      }
      Object.assign(linha, valores);
      return { error: null };
    } }),
  }) };
  return { linhas, cliente };
}


for (const [caminho, executar, portas] of [
  ['app', runCalendarImport, supabaseImportPorts],
  ['servidor', servidor.runCalendarImport, portasServidor.supabaseImportPorts],
] as const) {
  describe(`agenda governa o status: ${caminho}`, () => {
    for (const quantidade of [1, 2]) {
      describe(`${quantidade} cão(s) da mesma casa`, () => {
        function preparar() {
          const { linhas, cliente } = banco(false);
          linhas.splice(quantidade);
          const caes = dogs.slice(0, quantidade);
          const event = { ...evento, summary: caes.map((dog) => dog.name).join('/') };
          let events = [event];
          const doFetch = jest.fn(async (_url: string, init?: { method?: string }) => {
            // Qualquer tentativa de escrita falha, inclusive em rodadas sem mudança.
            expect(init?.method ?? 'GET').toBe('GET');
            return { ok: true, status: 200, json: async () => ({ items: events.map((item) => ({
              id: item.id, summary: item.summary, colorId: item.colorId,
              start: { date: item.startDate }, end: { date: item.endDate },
            })) }) };
          });
          const dbPorts = portas(cliente as never, 'org');
          const writes = {
            ...dbPorts,
            createBooking: jest.fn(dbPorts.createBooking),
            updateBooking: jest.fn(dbPorts.updateBooking),
            cancelBooking: jest.fn(dbPorts.cancelBooking),
          };
          const sync = (novos = events) => {
            events = novos;
            return executar({
              accessToken: 'teste', calendarId: 'agenda-A', dogs: caes,
              reservations: montarCasosDaImportacao(linhas), window,
              range: { timeMin: '2026-10-07T00:00:00Z', timeMax: '2026-12-01T00:00:00Z' },
              ports: writes, doFetch,
            });
          };
          const unchanged = async () => {
            for (const spy of [writes.createBooking, writes.updateBooking, writes.cancelBooking]) spy.mockClear();
            expect(await sync()).toEqual({ created: 0, already: 0, updated: 0, cancelled: 0, extraDays: 0, review: [], failures: [] });
            for (const spy of [writes.createBooking, writes.updateBooking, writes.cancelBooking]) expect(spy).not.toHaveBeenCalled();
          };
          const status = (value: string) => {
            expect(linhas.map((row) => [row.id, row.dog_id, row.status, row.google_event_id]))
              .toEqual(caes.map((dog) => [`res-${dog.id}`, dog.id, value, event.id]));
          };
          return { linhas, event, sync, unchanged, status, doFetch };
        }

        it('cancelamento local é restaurado na mesma linha e a segunda rodada não escreve', async () => {
          const h = preparar();
          h.linhas.forEach((row) => { row.status = 'cancelled'; });
          expect(await h.sync()).toMatchObject({ updated: quantidade, created: 0, failures: [] });
          h.status('confirmed');
          await h.unchanged();
          h.status('confirmed');
        });

        it('restaurar preserva escolhas locais de transporte/daycare sem regravar a cada Sync', async () => {
          const h = preparar();
          h.linhas.forEach((row) => {
            row.status = 'cancelled';
            row.goes_to_daycare = false;
            row.transport_required = false;
          });
          expect(await h.sync()).toMatchObject({ updated: quantidade, created: 0, failures: [] });
          h.status('confirmed');
          expect(h.linhas.every((row) => row.goes_to_daycare === false && row.transport_required === false)).toBe(true);
          await h.unchanged();
        });

        it.each(['11', '4'])('vermelho %s cancela duas vezes sem reabrir; azul restaura sem duplicar', async (colorId) => {
          const h = preparar();
          expect(await h.sync([{ ...h.event, colorId }])).toMatchObject({ cancelled: quantidade, updated: 0, created: 0, failures: [] });
          h.status('cancelled');
          await h.unchanged();
          h.status('cancelled');
          expect(await h.sync([h.event])).toMatchObject({ updated: quantidade, created: 0, cancelled: 0, failures: [] });
          h.status('confirmed');
          await h.unchanged();
        });

        it('evento apagado cancela e a rodada seguinte não restaura nem escreve', async () => {
          const h = preparar();
          expect(await h.sync([])).toMatchObject({ cancelled: quantidade, updated: 0, created: 0, failures: [] });
          h.status('cancelled');
          await h.unchanged();
          h.status('cancelled');
        });

        it('importação só chama GET no Google durante cancelamento e restauração', async () => {
          const h = preparar();
          await h.sync([{ ...h.event, colorId: '11' }]);
          await h.sync([h.event]);
          await h.unchanged();
          expect(h.doFetch).toHaveBeenCalledTimes(3);
          for (const [, init] of h.doFetch.mock.calls) expect(init?.method ?? 'GET').toBe('GET');
        });
      });
    }
  });
}
