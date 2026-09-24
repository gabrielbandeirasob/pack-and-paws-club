/**
 * VETORES INDEPENDENTES DO AGENTE DE TESTES (agente2) — bug de produção de 24/09/2026.
 *
 * O defeito: evento COM HORA do Google manda `end.dateTime` INCLUSIVO; o parser recuava 1 dia em todo
 * caso e a reserva nascia com `end_date` ANTERIOR ao `start_date`, o que o banco recusa
 * (`check (end_date >= start_date)`, migration 202609090002) -> "1 item(s) from Google could not be
 * saved" na tela, sem nenhum cadastro.
 *
 * Aqui eu passo pelo caminho REAL (recurso cru do Google -> parseEvent -> parseBookingEvent) e afirmo
 * duas coisas em TODOS os formatos: (1) o fim do evento com hora do print vira reserva de UM dia;
 * (2) `endDate` nunca é anterior ao `startDate` — a invariante que o banco cobra.
 */
import { parseEvent } from '@/features/integrations/google/calendarApi';
import { parseBookingEvent } from '@/features/integrations/google/importPlan';

function ler(evento: Record<string, unknown>) {
  const remoto = parseEvent(evento as never);
  const lido = parseBookingEvent(remoto);
  if (!lido) throw new Error(`nao consegui ler o evento: ${JSON.stringify(evento)}`);
  return { remoto, lido };
}

describe('evento do Google -> reserva: o fim NUNCA antes do inicio (vetores do agente2)', () => {
  it('COM HORA no mesmo dia (o caso do print: 25/09 13h-14h) termina no MESMO dia', () => {
    const { lido } = ler({
      id: 'ev-hora',
      summary: 'dog pietro',
      start: { dateTime: '2026-09-25T13:00:00-07:00' },
      end: { dateTime: '2026-09-25T14:00:00-07:00' },
    });
    expect(lido.startDate).toBe('2026-09-25');
    expect(lido.endDate).toBe('2026-09-25');
  });

  it('COM HORA virando a noite (22h -> 00h do dia seguinte) fica no dia em que comeca a ocupar', () => {
    const { lido } = ler({
      id: 'ev-meia-noite',
      summary: 'Pietro',
      start: { dateTime: '2026-09-25T22:00:00-07:00' },
      end: { dateTime: '2026-09-26T00:00:00-07:00' },
    });
    expect(lido.startDate).toBe('2026-09-25');
    expect(lido.endDate).toBe('2026-09-25');
  });

  it('COM HORA multi-dia (25/09 10h -> 27/09 12h) termina no ULTIMO dia', () => {
    const { lido } = ler({
      id: 'ev-multidia',
      summary: 'Pietro (hospedagem)',
      start: { dateTime: '2026-09-25T10:00:00-07:00' },
      end: { dateTime: '2026-09-27T12:00:00-07:00' },
    });
    expect(lido.startDate).toBe('2026-09-25');
    expect(lido.endDate).toBe('2026-09-27');
  });

  it('DIA INTEIRO de um dia (Google manda o fim EXCLUSIVO: 25/09 -> 26/09) fica num dia só', () => {
    const { lido } = ler({
      id: 'ev-dia',
      summary: 'Pietro',
      start: { date: '2026-09-25' },
      end: { date: '2026-09-26' },
    });
    expect(lido.startDate).toBe('2026-09-25');
    expect(lido.endDate).toBe('2026-09-25');
  });

  it('DIA INTEIRO multi-dia (25/09 -> 28/09) termina no dia anterior ao fim exclusivo', () => {
    const { lido } = ler({
      id: 'ev-dia-multi',
      summary: 'Pietro',
      start: { date: '2026-09-25' },
      end: { date: '2026-09-28' },
    });
    expect(lido.startDate).toBe('2026-09-25');
    expect(lido.endDate).toBe('2026-09-27');
  });

  it('série semanal (RRULE) comeca e termina em ordem', () => {
    const { lido } = ler({
      id: 'ev-serie',
      summary: 'Daycare · Pietro',
      start: { date: '2026-09-25' },
      end: { date: '2026-09-26' },
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=FR;UNTIL=20261030T000000Z'],
    });
    expect(lido.startDate).toBe('2026-09-25');
    expect(lido.endDate && lido.endDate >= lido.startDate).toBe(true);
  });

  it('INVARIANTE: nenhum formato acima sai com o fim antes do comeco', () => {
    const formatos = [
      { id: 'a', summary: 'Pietro', start: { dateTime: '2026-09-25T13:00:00Z' }, end: { dateTime: '2026-09-25T14:00:00Z' } },
      { id: 'b', summary: 'Pietro', start: { date: '2026-09-25' }, end: { date: '2026-09-26' } },
      { id: 'c', summary: 'Pietro', start: { dateTime: '2026-09-25T10:00:00Z' }, end: { dateTime: '2026-09-27T12:00:00Z' } },
      { id: 'd', summary: 'Pietro', start: { date: '2026-09-25' }, end: { date: '2026-09-28' } },
      { id: 'e', summary: 'Pietro', start: { dateTime: '2026-09-25T22:00:00Z' }, end: { dateTime: '2026-09-26T00:00:00Z' } },
      { id: 'f', summary: 'Pietro', start: { date: '2026-09-25' }, end: { date: '2026-09-25' } },
    ];
    for (const formato of formatos) {
      const remoto = parseEvent(formato as never);
      const lido = parseBookingEvent(remoto);
      if (!lido) continue;
      if (lido.endDate !== null) {
        expect(lido.endDate >= lido.startDate).toBe(true);
      }
    }
  });
});
