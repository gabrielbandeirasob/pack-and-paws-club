/**
 * VETORES INDEPENDENTES DO AGENTE DE TESTES (agente2) — evento ROXO no Google = "alteração de cliente
 * de dia fixo / cliente fora de ordem, para não ficar serviço solto" (pedido do Gabriel, 24/09/2026).
 *
 * O que eu estou provando aqui (requisito, não implementação):
 *  1. ROXO num cão COM escala ativa -> o dia entra na ESCALA como dia extra (`extraDay`), não como
 *     reserva avulsa;
 *  2. ROXO num cão SEM escala ativa -> vai para a lista de revisão (o app não inventa escala);
 *  3. ROXO sobre um evento que já tinha virado reserva solta -> a reserva é cancelada junto
 *     (`looseBookingId`), senão o mesmo serviço apareceria duas vezes no dia;
 *  4. A AGENDA (`buildDay`) mostra o dia extra ligado à escala, e NÃO duplica o cão quando o dia já é
 *     um dia normal da escala.
 */
import { planCalendarImport, type BookingForImport, type DogForImport } from '@/features/integrations/google/importPlan';
import type { RemoteEvent } from '@/features/integrations/google/calendarSync';
import { buildDay, type RecurringExceptionRecord, type RecurringScheduleRecord } from '@/features/calendar/dayMath';

/** 2026-10-06 é TERÇA (dia 2) — de propósito FORA dos dias da escala (seg/qua/sex) do teste. */
const TERCA = '2026-10-06';
/** 2026-10-05 é SEGUNDA (dia 1) — dia NORMAL da escala. */
const SEGUNDA = '2026-10-05';
const JANELA = { from: '2026-09-25', to: '2027-03-01' };

const PIETRO: DogForImport = { id: 'dog-pietro', name: 'Pietro', clientName: 'Carlos' };
const ESCALA: BookingForImport = {
  id: 'esc-pietro',
  kind: 'recurring',
  dogId: 'dog-pietro',
  googleEventId: 'g-escala',
  source: 'app',
  serviceType: 'daycare',
  startDate: '2026-09-01',
  endDate: null,
  weekdays: [1, 3, 5],
  skipDates: [],
  status: 'active',
};
const LABEL_UVA = { id: 'lbl-uva', name: 'Uva', backgroundColor: '#dbadff' };

function evento(id: string, summary: string, extra: Partial<RemoteEvent> = {}): RemoteEvent {
  return { id, summary, startDate: TERCA, endDate: TERCA, appKey: null, ...extra } as RemoteEvent;
}

describe('ROXO = dia extra/alterado na escala (nao vira reserva solta)', () => {
  it('cao COM escala ativa: o dia entra na ESCALA (extraDay), nao cria reserva', () => {
    const plano = planCalendarImport([evento('e-roxo', 'Pietro', { eventLabelId: 'lbl-uva' })], [PIETRO], [ESCALA], JANELA, {
      labels: [LABEL_UVA],
    });

    expect(plano).toHaveLength(1);
    const item = plano[0];
    expect(item.kind).toBe('extraDay');
    if (item.kind !== 'extraDay') return;
    expect(item.scheduleId).toBe('esc-pietro');
    expect(item.date).toBe(TERCA);
    expect(item.dogId).toBe('dog-pietro');
    expect(item.looseBookingId).toBeNull();
  });

  it('cao SEM escala ativa: vai para a revisao (nao inventa escala)', () => {
    const plano = planCalendarImport([evento('e-roxo', 'Pietro', { eventLabelId: 'lbl-uva' })], [PIETRO], [], JANELA, {
      labels: [LABEL_UVA],
    });

    expect(plano).toHaveLength(1);
    expect(plano[0].kind).toBe('review');
    if (plano[0].kind !== 'review') return;
    expect(plano[0].reason).toBe('purple without schedule');
  });

  it('ROXO sobre evento que ja tinha virado reserva solta: cancela a reserva junto', () => {
    const solta: BookingForImport = {
      id: 'res-solta',
      kind: 'reservation',
      dogId: 'dog-pietro',
      googleEventId: 'e-roxo',
      source: 'google',
      serviceType: 'daycare',
      startDate: TERCA,
      endDate: TERCA,
      weekdays: null,
      skipDates: null,
      status: 'confirmed',
    };

    const plano = planCalendarImport([evento('e-roxo', 'Pietro', { eventLabelId: 'lbl-uva' })], [PIETRO], [ESCALA, solta], JANELA, {
      labels: [LABEL_UVA],
    });

    const item = plano.find((linha) => linha.kind === 'extraDay');
    expect(item).toBeDefined();
    if (!item || item.kind !== 'extraDay') return;
    expect(item.scheduleId).toBe('esc-pietro');
    expect(item.looseBookingId).toBe('res-solta');
  });

  it('cao nao cadastrado com ROXO continua sendo pendencia de cadastro (nao cria nada)', () => {
    const plano = planCalendarImport([evento('e-roxo', 'Zara', { eventLabelId: 'lbl-uva' })], [PIETRO], [ESCALA], JANELA, {
      labels: [LABEL_UVA],
    });

    expect(plano[0].kind).toBe('review');
    if (plano[0].kind !== 'review') return;
    expect(plano[0].reason).toBe('unknown dog');
  });
});

describe('AGENDA: o dia extra aparece ligado a escala, sem duplicar', () => {
  const escala: RecurringScheduleRecord = {
    id: 'esc-pietro',
    dog: { id: 'dog-pietro', dogName: 'Pietro', clientName: 'Carlos' },
    weekdays: [1, 3, 5],
    startDate: '2026-09-01',
    endDate: null,
    active: true,
    transportRequired: true,
  };
  const excecaoExtra = (dia: string): RecurringExceptionRecord => ({
    id: `exc-${dia}`,
    scheduleId: 'esc-pietro',
    action: 'extra',
    startDate: dia,
    endDate: dia,
  });

  it('num dia FORA dos weekdays, o dia extra poe o cao na agenda (ligado a escala)', () => {
    const dia = buildDay(TERCA, [], [escala], [excecaoExtra(TERCA)]);
    expect(dia.daycare).toHaveLength(1);
    expect(dia.daycare[0].recurringScheduleId).toBe('esc-pietro');
    expect(dia.daycare[0].dogName).toBe('Pietro');
  });

  it('num dia que JA e da escala, o dia extra NAO duplica o cao', () => {
    const dia = buildDay(SEGUNDA, [], [escala], [excecaoExtra(SEGUNDA)]);
    expect(dia.daycare).toHaveLength(1);
  });

  it('sem excecao extra, o dia fora dos weekdays fica vazio (nada inventado)', () => {
    const dia = buildDay(TERCA, [], [escala], []);
    expect(dia.daycare).toHaveLength(0);
  });
});
