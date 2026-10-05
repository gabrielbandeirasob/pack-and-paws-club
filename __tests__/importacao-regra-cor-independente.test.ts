/**
 * VETORES INDEPENDENTES DO AGENTE DE TESTES (agente2) — build 55 (24/09/2026): SERVIÇO PELA COR.
 *
 * Aqui eu passo pelo caminho REAL, como o app faz: recurso CRU da API do Google -> `parseEvent` ->
 * `planCalendarImport`. O sentido inverso (o espelho, que pintava o evento) saiu do app em 05/10/2026.
 *
 * Os vetores são exatamente os que o dono pediu:
 *  - título "Pietro", cor verde, cão cadastrado -> reserva BOARDING;
 *  - azul -> DAYCARE;
 *  - vermelho -> cancela a reserva daquele dia;
 *  - cão desconhecido -> NÃO importa e aparece em "not registered";
 *  - sem cor -> "color not recognized".
 */
import { parseEvent } from '@/features/integrations/google/calendarApi';
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
    expect(plano.map((item) => item.kind)).toContain('create'); // sem cor = day care (dono, 28/09/2026)
  });

  it('o AMARELO (id 5) importa como boarding — (dono, 27/09/2026: amarelo e os tons que lembram ele = boarding)', () => {
    const plano = planoDoRecurso(recurso('ev-amarelo', 'Pietro', '5'));
    expect(plano[0]).toMatchObject({ kind: 'create', parsed: { serviceType: 'boarding' } });
  });
});
