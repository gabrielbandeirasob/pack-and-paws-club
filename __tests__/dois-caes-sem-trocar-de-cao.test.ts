/**
 * VETORES DO DEFEITO "O CÃO TROCA A CADA SINCRONIZAÇÃO" (medido no banco real em 28/09/2026).
 *
 * Evento do escritório com DOIS cães (`Sylvie/Agnes`) e uma reserva já vinculada: os dois cães achavam
 * essa MESMA reserva e cada um pedia `update` nela, então o `dog_id` **alternava entre Sylvie e Agnes a
 * cada rodada de 15 min** (toda sincronização devolvia "4 atualizados", sempre em eventos de dois cães)
 * e o dia ficava com 7 cães em vez de 8 — o relato do cliente: *"hoje tem oito cachorros, mas ele lê só
 * sete em algum momento, como ele fica atualizando aí"* e *"ele publicou só a Kona… voltava os dois"*.
 *
 * O certo: o vínculo do evento pertence a UM cão; o outro cão usa a reserva DELE (mesmo dia/serviço) ou
 * cria a dele — sem o vínculo, porque o índice do banco é único por evento.
 */
import { planCalendarImport, type BookingForImport } from '@/features/integrations/google/importPlan';
import { supabaseImportPorts } from '@/features/integrations/google/importPorts';
import { runCalendarImport } from '@/features/integrations/google/importService';
import type { RemoteEvent } from '@/features/integrations/google/calendarSync';

const DIA = '2026-09-28';
const window = { from: DIA, to: '2026-09-30' };
const dogs = [
  { id: 'sylvie', name: 'Sylvie', clientName: 'Jez' },
  { id: 'agnes', name: 'Agnes', clientName: 'Jez' },
];
// Um dia só: o fim do evento no Google é EXCLUSIVO (`2026-09-29` = só o dia 28).
const evento: RemoteEvent = { id: 'ev-dois', summary: 'Sylvie/Agnes', startDate: DIA, endDate: '2026-09-29', colorId: '7' };

const vinculada: BookingForImport = {
  id: 'res-sylvie',
  kind: 'reservation',
  dogId: 'sylvie',
  googleEventId: evento.id,
  source: 'google',
  serviceType: 'daycare',
  startDate: DIA,
  endDate: DIA,
  weekdays: [],
  status: 'confirmed',
};

type Linha = {
  id?: string;
  dog_id: string;
  google_event_id?: string;
  organization_id: string;
  service_type: string;
  start_date: string;
  end_date: string;
  transport_required: boolean;
};

/** Banco falso que reproduz o índice único por organização/evento (`reservations_google_event_unico`). */
function banco() {
  const linhas: Linha[] = [];
  const ports = supabaseImportPorts(
    {
      from: () => ({
        insert: async (linha: Linha) => {
          if (
            linha.google_event_id &&
            linhas.some((salva) => salva.organization_id === linha.organization_id && salva.google_event_id === linha.google_event_id)
          ) {
            return { error: { code: '23505', message: 'duplicate key value violates unique constraint "reservations_google_event_unico"' } };
          }
          linhas.push(linha);
          return { error: null };
        },
        // O MESMO índice vale no update: reescrever o vínculo de outra linha estoura 23505 (foi o que
        // o relógio fazia a cada 15 min — "1 falhas" no evento Sylvie/Agnes, 28/09/2026).
        update: (linha: Partial<Linha>) => ({
          eq: async (coluna: keyof Linha, valor: string) => {
            const alvo = linhas.find((salva) => salva[coluna] === valor);
            if (!alvo) return { error: null };
            if (
              linha.google_event_id &&
              linha.google_event_id !== alvo.google_event_id &&
              linhas.some((salva) => salva !== alvo && salva.google_event_id === linha.google_event_id)
            ) {
              return { error: { code: '23505', message: 'duplicate key value violates unique constraint "reservations_google_event_unico"' } };
            }
            Object.assign(alvo, linha);
            return { error: null };
          },
        }),
      }),
    } as never,
    'org-jez',
  );
  return { linhas, ports };
}

it('com a reserva vinculada à Sylvie, o plano cria a do Agnes e NÃO mexe na da Sylvie', () => {
  const plano = planCalendarImport([evento], dogs, [vinculada], window);
  expect(plano).toMatchObject([{ kind: 'create', dogId: 'agnes', parsed: { serviceType: 'daycare' } }]);
  expect(plano.some((item) => item.kind === 'update')).toBe(false);
});

it('na rodada seguinte, com as DUAS reservas no app, o plano devolve vazio (fim da troca de cão)', () => {
  const doAgnes: BookingForImport = { ...vinculada, id: 'res-agnes', dogId: 'agnes', googleEventId: null };
  expect(planCalendarImport([evento], dogs, [vinculada, doAgnes], window)).toEqual([]);
});

it('a segunda reserva nasce SEM o vínculo do evento e a rodada seguinte não atualiza nada', async () => {
  const { linhas, ports } = banco();
  const criar = jest.spyOn(ports, 'createBooking');
  const entrada = {
    accessToken: 'teste',
    window,
    range: { timeMin: `${DIA}T00:00:00Z`, timeMax: '2026-09-30T00:00:00Z' },
    dogs,
    reservations: [vinculada],
    ports,
    doFetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [{ id: evento.id, summary: evento.summary, start: { date: evento.startDate }, end: { date: evento.endDate }, colorId: '7' }],
      }),
    }),
  };

  const resumo = await runCalendarImport(entrada);
  expect(criar.mock.calls.map(([chamada]) => [chamada.dogId, chamada.semVinculo])).toEqual([['agnes', true]]);
  expect(linhas).toHaveLength(1);
  expect(linhas[0]).toMatchObject({ dog_id: 'agnes' });
  expect(linhas[0]).not.toHaveProperty('google_event_id');
  expect(resumo).toMatchObject({ created: 1, updated: 0, already: 0, failures: [], review: [] });

  // Segunda rodada com o app já no estado certo: nada para criar, nada para atualizar (era aqui que o
  // cão trocava de identidade em toda sincronização).
  const segunda = { ...entrada, reservations: [...([vinculada] as BookingForImport[]), { ...vinculada, id: 'res-agnes', dogId: 'agnes', googleEventId: null } as BookingForImport] };
  const resumo2 = await runCalendarImport(segunda);
  expect(resumo2).toMatchObject({ created: 0, updated: 0, already: 0, failures: [], review: [] });
  expect(linhas).toHaveLength(1);
});

it('segundo cão com reserva própria (sem vínculo) é ATUALIZADO sem reescrever o vínculo', async () => {
  // Caso real do relógio (28/09/2026): o evento é de UM dia, a Agnes segura o vínculo e a Sylvie tem a
  // reserva dela sem vínculo. O plano atualizava a linha da Sylvie gravando o vínculo do evento nela —
  // o banco recusava (índice único) e a rodada registrava "1 falhas" a cada 15 minutos.
  const doAgnes: BookingForImport = { ...vinculada, id: 'res-agnes', dogId: 'agnes', googleEventId: null };
  const plano = planCalendarImport([evento], dogs, [vinculada, doAgnes], window);
  // Nada a fazer: a linha da Agnes casa com o evento (vínculo) e a da Sylvie já está igual.
  expect(plano).toEqual([]);

  // Agora com a linha da Sylvie DESATUALIZADA (serviço diferente): o plano manda atualizar SEM o vínculo.
  const desatualizada: BookingForImport = { ...doAgnes, serviceType: 'boarding' };
  // A linha da Sylvie casa com o evento (é ela que segura o vínculo); a da Agnes está desatualizada.
  const comUpdate = planCalendarImport([evento], dogs, [vinculada, desatualizada], window);
  expect(comUpdate).toMatchObject([
    { kind: 'update', bookingId: 'res-agnes', dogId: 'agnes', semVinculo: true },
  ]);
  expect(comUpdate.every((item) => item.kind !== 'update' || item.semVinculo === true)).toBe(true);
  const item = comUpdate[0];
  if (item.kind !== 'update') throw new Error('Esperava um update');

  const { linhas, ports } = banco();
  linhas.push(
    { id: 'res-sylvie', dog_id: 'sylvie', google_event_id: evento.id, organization_id: 'org-jez', service_type: 'daycare', start_date: DIA, end_date: DIA, transport_required: true },
    { id: 'res-agnes', dog_id: 'agnes', organization_id: 'org-jez', service_type: 'daycare', start_date: DIA, end_date: DIA, transport_required: true },
  );
  await ports.updateBooking({
    bookingId: 'res-agnes',
    kind: 'reservation',
    eventId: evento.id,
    dogId: 'agnes',
    parsed: { ...item.parsed, serviceType: 'daycare' },
    semVinculo: true,
  });
  expect(linhas[1]).toMatchObject({ dog_id: 'agnes', service_type: 'daycare' });
  expect(linhas[1]).not.toHaveProperty('google_event_id');
});
