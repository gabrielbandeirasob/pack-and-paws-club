/**
 * Reprodução do dono em 07/10/2026: Teddy vinculado + Billy solto, ambos da Amy.
 * Antes: apagar cancelava 1; mover criava outro Billy; tirar Billy não fazia nada.
 * Exercita plano, executor, portas e nova fotografia nos dois caminhos, sem banco real.
 */
import { planCalendarImport, type BookingForImport } from '@/features/integrations/google/importPlan';
import { runCalendarImport } from '@/features/integrations/google/importService';
import { supabaseImportPorts } from '@/features/integrations/google/importPorts';
import { montarCasosDaImportacao, type ReservaParaImportar } from '@/features/integrations/google/importSnapshot';
import type { RemoteEvent } from '@/features/integrations/google/eventMarkers';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const servidor = require('../supabase/functions/_shared/importacao/importService') as { runCalendarImport: typeof runCalendarImport };
const planoServidor = require('../supabase/functions/_shared/importacao/importPlan') as { planCalendarImport: typeof planCalendarImport };
const portasServidor = require('../supabase/functions/_shared/importacao/importPorts') as { supabaseImportPorts: typeof supabaseImportPorts };
const dogs = ['Teddy', 'Billy'].map((name) => ({ id: name, name, clientId: 'amy', clientName: 'Amy' }));
const window = { from: '2026-10-07', to: '2026-11-30' };
const evento: RemoteEvent = { id: 'eve-1', summary: 'Teddy/Billy', colorId: '7', startDate: window.from, endDate: '2026-10-08' };

function banco(legado: boolean) {
  const linhas: ReservaParaImportar[] = dogs.map(({ id }, indice) => ({
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

for (const [caminho, executar, portas, planejar] of [
  ['app', runCalendarImport, supabaseImportPorts, planCalendarImport],
  ['servidor', servidor.runCalendarImport, portasServidor.supabaseImportPorts, planoServidor.planCalendarImport],
] as const) {
  describe(caminho, () => {
    for (const legado of [true, false]) {
      describe(legado ? 'Teddy vinculado / Billy legado' : 'ambos vinculados', () => {
        function preparar() {
          const { linhas, cliente } = banco(legado);
          const sincronizar = (events: RemoteEvent[], calendarId = 'agenda-A', caes = dogs) => executar({
            accessToken: 'teste', calendarId, dogs: caes, reservations: montarCasosDaImportacao(linhas), window,
            range: { timeMin: `${window.from}T00:00:00Z`, timeMax: '2026-12-01T00:00:00Z' },
            ports: portas(cliente as never, 'org'),
            doFetch: async () => ({ ok: true, status: 200, json: async () => ({ items: events.map((item) => ({
              id: item.id, summary: item.summary, colorId: item.colorId,
              start: { date: item.startDate }, end: { date: item.endDate },
            })) }) }),
          });
          return { linhas, sincronizar };
        }

        it('apagar cancela as DUAS reservas existentes', async () => {
          const { linhas, sincronizar } = preparar();
          expect(await sincronizar([])).toMatchObject({ cancelled: 2, created: 0, failures: [], review: [] });
          expect(linhas.map((linha) => [linha.id, linha.status])).toEqual([['res-Teddy', 'cancelled'], ['res-Billy', 'cancelled']]);
        });

        it('mover atualiza as DUAS, sem linha nova nem reserva no dia antigo', async () => {
          const { linhas, sincronizar } = preparar();
          const movido = { ...evento, startDate: '2026-10-09', endDate: '2026-10-10' };
          expect(await sincronizar([movido])).toMatchObject({ updated: 2, created: 0, cancelled: 0, failures: [], review: [] });
          expect(linhas.map((linha) => [linha.id, linha.dog_id, linha.start_date, linha.google_event_id, linha.google_calendar_id]))
            .toEqual(dogs.map(({ id }) => [`res-${id}`, id, '2026-10-09', 'eve-1', 'agenda-A']));
          expect(await sincronizar([movido])).toMatchObject({ updated: 0, created: 0, cancelled: 0, failures: [], review: [] });
        });

        it.each(['Teddy', 'Billy'])('tirar o outro nome mantém só %s, sem trocar dog_id', async (summary) => {
          const { linhas, sincronizar } = preparar();
          expect(await sincronizar([{ ...evento, summary }])).toMatchObject({ cancelled: 1, created: 0, failures: [], review: [] });
          expect(linhas.filter((linha) => linha.status === 'confirmed').map((linha) => linha.dog_id)).toEqual([summary]);
          expect(linhas.map((linha) => [linha.id, linha.dog_id])).toEqual([['res-Teddy', 'Teddy'], ['res-Billy', 'Billy']]);
        });

        it('vermelho continua cancelando os DOIS', async () => {
          const { linhas, sincronizar } = preparar();
          expect(await sincronizar([{ ...evento, colorId: '11' }])).toMatchObject({ cancelled: 2, created: 0, failures: [], review: [] });
          expect(linhas.every((linha) => linha.status === 'cancelled')).toBe(true);
        });

        it('troca da cor continua mudando o serviço dos DOIS', async () => {
          const { linhas, sincronizar } = preparar();
          expect(await sincronizar([{ ...evento, colorId: '2' }])).toMatchObject({ updated: 2, created: 0, failures: [], review: [] });
          expect(linhas.map((linha) => linha.service_type)).toEqual(['boarding', 'boarding']);
        });

        it('Teddy/Zeus leva Zeus para not registered mesmo com vínculo', async () => {
          const { linhas, sincronizar } = preparar();
          const resumo = await sincronizar([{ ...evento, summary: 'Teddy/Zeus' }]);
          expect(resumo).toMatchObject({ created: 0, cancelled: 1, failures: [] });
          expect(resumo.review).toMatchObject([{ reason: 'unknown dog', parsed: { dogName: 'Zeus' } }]);
          expect(linhas.filter((linha) => linha.status === 'confirmed').map((linha) => linha.dog_id)).toEqual(['Teddy']);
        });

        it('sem mudança repara só o vínculo legado e depois é idempotente, inclusive com ordem invertida', async () => {
          const { linhas, sincronizar } = preparar();
          expect(await sincronizar([evento])).toMatchObject({ updated: legado ? 1 : 0, created: 0, cancelled: 0, failures: [], review: [] });
          expect(linhas.every((linha) => linha.google_event_id === 'eve-1')).toBe(true);
          expect(await sincronizar([{ ...evento, summary: 'Billy/Teddy' }])).toMatchObject({ updated: 0, created: 0, cancelled: 0, failures: [], review: [] });
        });

        it('trocar de agenda não cancela nenhum dos dois', async () => {
          const { linhas, sincronizar } = preparar();
          expect(await sincronizar([], 'agenda-B')).toMatchObject({ cancelled: 0, created: 0, failures: [] });
          expect(linhas.every((linha) => linha.status === 'confirmed')).toBe(true);
        });
      });
    }

    it('UM nome desconhecido com UMA reserva protege o cão renomeado', () => {
      const reservas = montarCasosDaImportacao(banco(false).linhas.slice(0, 1));
      const plano = planejar([{ ...evento, summary: 'Teddy', startDate: '2026-10-09', endDate: '2026-10-10' }],
        [{ ...dogs[0], name: 'Novo nome' }], reservas, window, { calendarId: 'agenda-A' });
      expect(plano).toMatchObject([{ kind: 'update', bookingId: 'res-Teddy', dogId: 'Teddy', parsed: { startDate: '2026-10-09' } }]);
      expect(plano).toHaveLength(1);
    });

    it('nome antigo continua protegido depois de remover e cancelar o segundo cão', () => {
      const reservas = montarCasosDaImportacao(banco(false).linhas);
      reservas[1].status = 'cancelled';
      const plano = planejar([{ ...evento, summary: 'Teddy', startDate: '2026-10-09', endDate: '2026-10-10' }],
        [{ ...dogs[0], name: 'Novo nome' }, dogs[1]], reservas, window, { calendarId: 'agenda-A' });
      expect(plano).toHaveLength(1);
      expect(plano).toMatchObject([{ kind: 'update', bookingId: 'res-Teddy', dogId: 'Teddy' }]);
    });

    it('Zeus desconhecido não reutiliza o único vínculo de Teddy num título com DOIS nomes', () => {
      const reservas = montarCasosDaImportacao(banco(false).linhas.slice(0, 1));
      expect(planejar([{ ...evento, summary: 'Teddy/Zeus' }], dogs, reservas, window, { calendarId: 'agenda-A' }))
        .toMatchObject([{ kind: 'review', reason: 'unknown dog', parsed: { dogName: 'Zeus' } }]);
    });

    it('não cancela nome removido quando a identidade da agenda não pôde ser resolvida', () => {
      const reservas = montarCasosDaImportacao(banco(false).linhas).map((item) => ({ ...item, googleCalendarId: null }));
      expect(planejar([{ ...evento, summary: 'Teddy' }], dogs, reservas, window, { calendarId: null })).toEqual([]);
    });

    it('dois vínculos de série mantêm a identidade e retirar Billy desativa só a série dele', () => {
      const reservas = montarCasosDaImportacao(banco(false).linhas).map((item) => ({
        ...item, kind: 'recurring' as const, status: 'active', weekdays: [3], endDate: null,
      }));
      const serie = { ...evento, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=WE'] };
      expect(planejar([serie], dogs, reservas, window, { calendarId: 'agenda-A' })).toEqual([]);
      expect(planejar([{ ...serie, summary: 'Teddy' }], dogs, reservas, window, { calendarId: 'agenda-A' }))
        .toEqual([{ kind: 'cancel', eventId: evento.id, bookingKind: 'recurring', bookingId: 'res-Billy' }]);
    });

    it('importação nova grava DOIS vínculos e repetição não duplica', async () => {
      const { linhas, cliente } = banco(false);
      linhas.length = 0;
      const parsed = require('@/features/integrations/google/importPlan').parseBookingEvent(evento);
      const porta = portas(cliente as never, 'org');
      for (const dogId of ['Teddy', 'Billy']) {
        expect(await porta.createBooking({ calendarId: 'agenda-A', eventId: evento.id, dogId, kind: 'reservation', parsed })).toBe('created');
        expect(await porta.createBooking({ calendarId: 'agenda-A', eventId: evento.id, dogId, kind: 'reservation', parsed })).toBe('already');
      }
      expect(linhas).toHaveLength(2);
      expect(planejar([evento], dogs, montarCasosDaImportacao(linhas), window, { calendarId: 'agenda-A' })).toEqual([]);
    });

    it.each(['app', 'outra casa', 'origem desconhecida', 'eventos concorrentes'])('reparo legado não adivinha: %s', (caso) => {
      const reservas: BookingForImport[] = montarCasosDaImportacao(banco(true).linhas);
      const caes = dogs.map((cao) => ({ ...cao }));
      if (caso === 'app') reservas[1].source = 'app';
      if (caso === 'outra casa') caes[1].clientId = 'outra-amy';
      if (caso === 'origem desconhecida') reservas[0].googleCalendarId = null;
      if (caso === 'eventos concorrentes') reservas.push({ ...reservas[0], id: 'outra', googleEventId: 'outro-evento' });
      expect(planejar([], caes, reservas, window, { calendarId: 'agenda-A' }).some((item) => item.kind === 'cancel' && item.bookingId === 'res-Billy')).toBe(false);
    });
  });
}

it('migration troca os DOIS índices para evento+cão sem mexer no agrupamento de paradas', () => {
  const sql = readFileSync(join(__dirname, '../supabase/migrations/202610070102_vinculo_google_por_cao.sql'), 'utf8');
  for (const tabela of ['reservations', 'recurring_schedules']) {
    expect(sql).toContain(`drop index if exists public.${tabela}_google_event_unico`);
    expect(sql).toContain(`on public.${tabela} (organization_id, google_event_id, dog_id)`);
  }
  expect(sql).not.toMatch(/(?:alter|update|delete from)\s+(?:public\.)?route_stops/i);
});
