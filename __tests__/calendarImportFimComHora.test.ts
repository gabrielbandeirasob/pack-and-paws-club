/**
 * Fim do evento: dia inteiro (fim EXCLUSIVO) x evento COM HORA (fim INCLUSIVO).
 *
 * DEFEITO DE PRODUÇÃO (24/09/2026, build 53, calendário "bot venda", org do cliente): o gestor tocou
 * "Sync now" e a tela mostrou "1 item(s) from Google could not be saved". O evento do escritório tinha
 * HORA (25/09, 1:00-2:00pm) e o app recuava um dia em cima de um fim que já era INCLUSIVO:
 *
 *   end.dateTime = 25/09T14:00  ->  endDate = 25/09 - 1 = 24/09  (com start_date = 25/09)
 *   -> `check (end_date >= start_date)` (migração 202609090002, linha 19) recusa o insert INTEIRO.
 *
 * Rastro em produção: nenhuma reserva, 1 cliente "dog pietro" e 2 cães "dog pietro" (dois toques no
 * Sync, porque `createDog` não procurava antes de criar). O "-1 dia" está certo para evento de DIA
 * INTEIRO (o `end.date` do Google é exclusivo: dia seguinte), e errado para evento com hora.
 *
 * Vetores cobertos aqui: com hora no mesmo dia, com hora multi-dia, com hora terminando 00:00, dia
 * inteiro de um dia, dia inteiro multi-dia, série RRULE semanal — e, em cima de todos, a GARANTIA
 * DURA `end_date >= start_date`.
 */
import { parseEvent } from '@/features/integrations/google/calendarApi';
import {
  describeImportFailure,
  motivoDaFalha,
  parseBookingEvent,
  planCalendarImport,
  type DogForImport,
} from '@/features/integrations/google/importPlan';
import type { RemoteEvent } from '@/features/integrations/google/calendarSync';

const HOJE = '2026-09-24';
const JANELA = { from: HOJE, to: '2027-03-23' };

/** Cor azul (Peacock) = daycare: é a cor que estes eventos levam. */
const AZUL = '7';

const PIETRO: DogForImport = { id: 'dog-pietro', name: 'dog pietro', clientName: 'dog pietro' };

/** Evento COM HORA, no formato CRU da API do Google (`dateTime` com fuso; fim INCLUSIVO). */
function comHora(id: string, summary: string, inicio: string, fim: string, recurrence?: string[]): RemoteEvent {
  return parseEvent({ id, summary, colorId: AZUL, start: { dateTime: inicio }, end: { dateTime: fim }, recurrence });
}

/** Evento de DIA INTEIRO, no formato cru da API (`end.date` é o primeiro dia FORA do evento). */
function diaInteiro(id: string, summary: string, inicio: string, fimExclusivo: string, recurrence?: string[]): RemoteEvent {
  return parseEvent({ id, summary, colorId: AZUL, start: { date: inicio }, end: { date: fimExclusivo }, recurrence });
}

type Caso = { nome: string; evento: RemoteEvent; inicio: string; fim: string; weekdays?: number[] };

const CASOS: Caso[] = [
  {
    nome: 'evento COM HORA no mesmo dia (25/09 13:00-14:00) — o caso do "dog pietro"',
    evento: comHora('ev-pietro', 'dog pietro', '2026-09-25T13:00:00-07:00', '2026-09-25T14:00:00-07:00'),
    inicio: '2026-09-25',
    fim: '2026-09-25',
  },
  {
    nome: 'evento COM HORA multi-dia (25/09 10:00 -> 27/09 12:00)',
    evento: comHora('ev-multi', 'Boarding · Bella', '2026-09-25T10:00:00-07:00', '2026-09-27T12:00:00-07:00'),
    inicio: '2026-09-25',
    fim: '2026-09-27',
  },
  {
    nome: 'evento COM HORA terminando 00:00 (25/09 22:00 -> 26/09 00:00): o dia 26 não é do cão',
    evento: comHora('ev-meia-noite', 'Boarding · Luna', '2026-09-25T22:00:00-07:00', '2026-09-26T00:00:00-07:00'),
    inicio: '2026-09-25',
    fim: '2026-09-25',
  },
  {
    nome: 'evento de DIA INTEIRO de um dia (25/09, end.date = 26/09)',
    evento: diaInteiro('ev-dia', 'Kona', '2026-09-25', '2026-09-26'),
    inicio: '2026-09-25',
    fim: '2026-09-25',
  },
  {
    nome: 'evento de DIA INTEIRO multi-dia (25/09 a 27/09, end.date = 28/09)',
    evento: diaInteiro('ev-dia-multi', 'Boarding · Mowgli', '2026-09-25', '2026-09-28'),
    inicio: '2026-09-25',
    fim: '2026-09-27',
  },
  {
    nome: 'série RRULE semanal (Mo,We até 31/10) — o fim vem do UNTIL, não do end',
    evento: comHora(
      'ev-serie',
      'Daycare · Filó (Raphael)',
      '2026-09-28T09:00:00-07:00',
      '2026-09-28T17:00:00-07:00',
      ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261031'],
    ),
    inicio: '2026-09-28',
    fim: '2026-10-31',
    weekdays: [1, 3],
  },
];

describe('fim do evento com hora x dia inteiro (bug de produção 24/09/2026)', () => {
  it.each(CASOS)('$nome -> $inicio a $fim', ({ evento, inicio, fim, weekdays }) => {
    const lido = parseBookingEvent(evento);

    expect(lido).not.toBeNull();
    expect(lido).toMatchObject({ startDate: inicio, endDate: fim });
    if (weekdays) expect(lido?.weekdays).toEqual(weekdays);
    // GARANTIA DURA, em todo vetor: o banco recusa `end_date < start_date`.
    expect(lido!.endDate >= lido!.startDate).toBe(true);
  });

  it('o evento com hora do print vira reserva de UM dia (25/09 a 25/09), ligada ao evento', () => {
    const plano = planCalendarImport(
      [comHora('ev-pietro', 'dog pietro', '2026-09-25T13:00:00-07:00', '2026-09-25T14:00:00-07:00')],
      [PIETRO],
      [],
      JANELA,
    );

    expect(plano).toHaveLength(1);
    const item = plano[0];
    expect(item).toMatchObject({ kind: 'create', eventId: 'ev-pietro', dogId: 'dog-pietro', parsed: { startDate: '2026-09-25', endDate: '2026-09-25' } });
  });

  it('nenhum item do plano sai com end_date anterior ao start_date', () => {
    const plano = planCalendarImport(
      CASOS.map((caso) => caso.evento),
      [PIETRO],
      [],
      JANELA,
    );

    expect(plano.length).toBeGreaterThan(0);
    for (const item of plano) {
      // 'skip' (dia de série pulado pelo evento vermelho), 'extraDay' (dia extra ligado à escala),
      // 'review' e 'cancel' não carregam `parsed` para comparar data de reserva.
      if (item.kind !== 'create' && item.kind !== 'update') continue;
      expect(item.parsed.endDate >= item.parsed.startDate).toBe(true);
    }
  });
});

describe('garantia dura do parser: end_date nunca antes de start_date', () => {
  it('evento sem fim nenhum não vira data anterior ao começo', () => {
    const semFim: RemoteEvent = { id: 'ev-sem-fim', summary: 'Bella', startDate: '2026-09-25', endDate: '', appKey: null, recurrence: null };

    expect(parseBookingEvent(semFim)).toMatchObject({ startDate: '2026-09-25', endDate: '2026-09-25' });
  });

  it('evento torto (fim antes do começo) não passa do parser', () => {
    const torto: RemoteEvent = { id: 'ev-torto', summary: 'Bella', startDate: '2026-09-25', endDate: '2026-09-20', appKey: null, recurrence: null };

    expect(parseBookingEvent(torto)).toMatchObject({ startDate: '2026-09-25', endDate: '2026-09-25' });
  });

  it('série com UNTIL anterior ao começo também é travada', () => {
    const serieVelha: RemoteEvent = {
      id: 'ev-serie-velha',
      summary: 'Daycare · Bella',
      startDate: '2026-09-25',
      endDate: '2026-09-26',
      appKey: null,
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20260901'],
    };

    expect(parseBookingEvent(serieVelha)).toMatchObject({ startDate: '2026-09-25', endDate: '2026-09-25' });
  });

  it('evento de hora única e minuto zero no MESMO dia (degenerado) continua >= começo', () => {
    const zero: RemoteEvent = comHora('ev-zero', 'Kona', '2026-09-25T00:00:00-07:00', '2026-09-25T00:00:00-07:00');

    expect(parseBookingEvent(zero)).toMatchObject({ startDate: '2026-09-25', endDate: '2026-09-25' });
  });
});

describe('motivo da falha na tela (o gestor não sabia o que havia acontecido)', () => {
  it('mostra a contagem E o motivo da PRIMEIRA falha', () => {
    const texto = describeImportFailure([
      { eventId: 'ev-1', error: 'new row for relation "reservations" violates check constraint "reservations_check"' },
      { eventId: 'ev-2', error: 'outra coisa qualquer' },
    ]);

    expect(texto).toBe('2 item(s) from Google could not be saved. First: end_date before start_date');
  });

  it('sem falha não escreve nada (a tela não ganha linha de erro vazia)', () => {
    expect(describeImportFailure([])).toBe('');
  });

  it('motivo desconhecido aparece cru (e cortado), em vez de sumir', () => {
    expect(motivoDaFalha('RLS negou')).toBe('RLS negou');
    expect(motivoDaFalha('x'.repeat(200))).toHaveLength(140);
    expect(motivoDaFalha('  ')).toBe('');
  });
});
