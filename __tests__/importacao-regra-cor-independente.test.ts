/**
 * VETORES INDEPENDENTES DO AGENTE DE TESTES (agente2) — build 55 (24/09/2026): SERVIÇO PELA COR.
 *
 * Aqui eu passo pelo caminho REAL, como o app faz: recurso CRU da API do Google -> `parseEvent` ->
 * `planCalendarImport`; e no sentido inverso, `eventFor` (espelho) -> corpo do evento enviado.
 *
 * Os vetores são exatamente os que o dono pediu:
 *  - título "Pietro", cor verde, cão cadastrado -> reserva BOARDING;
 *  - azul -> DAYCARE;
 *  - vermelho -> cancela a reserva daquele dia;
 *  - cão desconhecido -> NÃO importa e aparece em "not registered";
 *  - sem cor -> "color not recognized";
 *  - o espelho manda `colorId` e o que ele manda volta lendo o serviço certo (ida e volta).
 */
import { parseEvent, toEventBody } from '@/features/integrations/google/calendarApi';
import { eventFor, type LocalReservation } from '@/features/integrations/google/calendarSync';
import { meaningOfColor } from '@/features/calendar/googleColors';
import { planCalendarImport, type DogForImport } from '@/features/integrations/google/importPlan';

const VERDE = '2';
const AZUL = '7';
const VERMELHO = '11';
const JANELA = { from: '2026-09-24', to: '2027-03-23' };

const PIETRO: DogForImport = { id: 'dog-pietro', name: 'Pietro', clientName: 'Carlos' };

/** Evento como a API do Google devolve (dia inteiro: `end.date` é o primeiro dia FORA do evento). */
function recurso(id: string, summary: string, colorId?: string, dia = '2026-09-25') {
  return { id, summary, colorId, start: { date: dia }, end: { date: '2026-09-26' } };
}

function planoDoRecurso(recurso_: ReturnType<typeof recurso>, dogs: DogForImport[] = [PIETRO], reservas: never[] = []) {
  return planCalendarImport([parseEvent(recurso_ as never)], dogs, reservas, JANELA);
}

describe('cor do evento -> serviço da reserva (caminho real: API -> parseEvent -> plano)', () => {
  it('"Pietro" verde com cão cadastrado cria reserva de BOARDING', () => {
    const plano = planoDoRecurso(recurso('ev-verde', 'Pietro', VERDE));

    expect(plano).toHaveLength(1);
    if (plano[0].kind !== 'create') throw new Error('esperava create');
    expect(plano[0]).toMatchObject({ dogId: 'dog-pietro' });
    expect(plano[0].parsed.serviceType).toBe('boarding');
    expect(plano[0].parsed.cancels).toBe(false);
  });

  it('o mesmo evento em AZUL cria reserva de DAYCARE', () => {
    const plano = planoDoRecurso(recurso('ev-azul', 'Pietro', AZUL));

    if (plano[0].kind !== 'create') throw new Error('esperava create');
    expect(plano[0].parsed.serviceType).toBe('daycare');
  });

  it('VERMELHO cancela a reserva daquele cão naquele dia', () => {
    const reserva = {
      id: 'res-pietro',
      kind: 'reservation' as const,
      dogId: 'dog-pietro',
      googleEventId: null,
      source: 'app' as const,
      serviceType: 'daycare' as const,
      startDate: '2026-09-25',
      endDate: '2026-09-25',
      weekdays: null,
      skipDates: null,
      status: 'confirmed',
    };
    const plano = planCalendarImport([parseEvent(recurso('ev-vermelho', 'Pietro', VERMELHO) as never)], [PIETRO], [reserva], JANELA);

    expect(plano).toEqual([{ kind: 'cancel', eventId: 'ev-vermelho', bookingKind: 'reservation', bookingId: 'res-pietro' }]);
  });

  it('cão desconhecido NÃO é importado e aparece em "not registered"', () => {
    const plano = planoDoRecurso(recurso('ev-zeus', 'Zeus', VERDE));

    expect(plano).toHaveLength(1);
    expect(plano[0]).toMatchObject({ kind: 'review', reason: 'unknown dog', title: 'Zeus' });
    expect(plano.some((item) => item.kind === 'create')).toBe(false);
  });

  it('evento SEM cor vai para "color not recognized" (o app não chuta serviço)', () => {
    const semCor = parseEvent({ id: 'ev-sem-cor', summary: 'Pietro', start: { date: '2026-09-25' }, end: { date: '2026-09-26' } });

    expect(semCor.colorId).toBeNull();
    expect(meaningOfColor(semCor.colorId)).toBeNull();
    const plano = planCalendarImport([semCor], [PIETRO], [], JANELA);
    expect(plano[0]).toMatchObject({ kind: 'review', reason: 'unrecognized color' });
  });

  it('cor fora do mapa (amarelo) também não importa', () => {
    const plano = planoDoRecurso(recurso('ev-amarelo', 'Pietro', '5'));
    expect(plano[0]).toMatchObject({ kind: 'review', reason: 'unrecognized color' });
  });
});

describe('o espelho manda a cor do serviço (app -> Google)', () => {
  const daycare: LocalReservation = { id: 'res:d1', dogName: 'Pietro', clientName: 'Carlos', serviceType: 'daycare', startDate: '2026-09-25' };
  const boarding: LocalReservation = { id: 'res:b1', dogName: 'Pietro', clientName: 'Carlos', serviceType: 'boarding', startDate: '2026-09-25' };

  it('daycare sai azul e boarding sai verde, já no CORPO enviado à API', () => {
    expect(toEventBody(eventFor(daycare)).colorId).toBe(AZUL);
    expect(toEventBody(eventFor(boarding)).colorId).toBe(VERDE);
  });

  it('ida e volta: o que o espelho manda volta lendo o serviço certo', () => {
    for (const [reserva, esperado] of [[daycare, 'daycare'], [boarding, 'boarding']] as const) {
      const corpo = toEventBody(eventFor(reserva)) as Record<string, unknown>;
      const voltou = parseEvent({ ...corpo, id: 'ev-volta' } as never);
      expect(meaningOfColor(voltou.colorId)).toEqual({ kind: 'service', serviceType: esperado });
    }
  });

  it('todo evento do espelho carrega a marca do app (a importação ignora o próprio espelho)', () => {
    const corpo = toEventBody(eventFor(daycare)) as { extendedProperties?: { private?: Record<string, string> } };
    expect(corpo.extendedProperties?.private?.packpawsMirror).toBe('v1');
    expect(corpo.extendedProperties?.private?.appKey).toBe('res:d1');
  });
});
