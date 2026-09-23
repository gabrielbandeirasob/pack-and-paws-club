/**
 * Ligação manual de um evento do Google a um cão (quando o título não casou sozinho).
 *
 * Regra travada aqui: se JÁ existe a mesma reserva no app, o certo é LIGAR o evento a ela — não
 * criar uma segunda reserva igual na agenda.
 */
import { escolhaDaRevisao } from '@/features/integrations/google/importPorts';
import type { BookingForImport, ParsedBooking } from '@/features/integrations/google/importPlan';

const parsed: ParsedBooking = {
  serviceType: 'boarding',
  dogName: 'Luna',
  clientName: null,
  startDate: '2026-10-05',
  endDate: '2026-10-08',
  weekdays: [],
  skipDates: [],
  openEnded: false,
};

const existente: BookingForImport = {
  id: 'r-existente',
  kind: 'reservation',
  dogId: 'dog-luna',
  googleEventId: null,
  source: 'app',
  serviceType: 'boarding',
  startDate: '2026-10-05',
  endDate: '2026-10-08',
  weekdays: [],
  skipDates: [],
  status: 'confirmed',
};

describe('escolhaDaRevisao', () => {
  it('liga o evento à reserva que já existe (nada de duplicar)', () => {
    expect(escolhaDaRevisao({ parsed, dogId: 'dog-luna', bookings: [existente] })).toEqual({ kind: 'reservation', id: 'r-existente' });
  });

  it('cria quando não existe nada igual', () => {
    expect(escolhaDaRevisao({ parsed, dogId: 'dog-luna', bookings: [] })).toEqual({ criar: true });
  });

  it('reserva parecida mas de outro cão não serve de ligação', () => {
    expect(escolhaDaRevisao({ parsed, dogId: 'dog-outro', bookings: [existente] })).toEqual({ criar: true });
  });

  it('data diferente não é a mesma reserva', () => {
    const outra = { ...existente, startDate: '2026-10-12', endDate: '2026-10-15' };
    expect(escolhaDaRevisao({ parsed, dogId: 'dog-luna', bookings: [outra] })).toEqual({ criar: true });
  });

  it('série recorrente casa por dias da semana', () => {
    const serieDoGoogle: ParsedBooking = { ...parsed, weekdays: [1, 3], openEnded: true };
    const serieExistente: BookingForImport = {
      ...existente,
      id: 'serie-1',
      kind: 'recurring',
      weekdays: [3, 1],
      status: 'active',
    };
    expect(escolhaDaRevisao({ parsed: serieDoGoogle, dogId: 'dog-luna', bookings: [serieExistente] })).toEqual({ kind: 'recurring', id: 'serie-1' });
  });
});
