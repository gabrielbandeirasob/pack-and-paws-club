/**
 * DIA CANCELADO NA SEMANA (pedido do dono, 13/10/2026): *"quero que quando esteja vermelho do Google
 * calendário cancele como já fazia antes mas agora apareça no weekly summary que foi cancelado"*.
 *
 * O vermelho cancela de duas formas — reserva avulsa vira `cancelled`, escala fixa ganha uma pausa de
 * UM dia com o `reason` do Google — e o resumo semanal precisa reconhecer as duas, sem confundir a
 * pausa que o GESTOR marcou no app (folga/ausência) com cancelamento.
 *
 * Este arquivo prova:
 *  1. as regras puras (`cancelledDays.cancelledVisitsOfDay`) contra a MESMA cobertura de dia do
 *     `buildDay` — daycare (avulso OU barra de vários dias) em todos os dias que cobre, boarding em
 *     todos os dias do período, escala nos dias dela e no dia extra (roxo);
 *  2. o que a tela PEDE ao banco (`loadWeek`): reservas confirmadas **e canceladas**, e o `reason` da
 *     exceção — sem isso não há como saber que o dia foi cancelado.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { cancelledVisitsOfDay } from '@/features/dashboard/cancelledDays';
import { loadWeek } from '@/features/dashboard/dayService';
import type { RecurringExceptionRecord, RecurringScheduleRecord, ReservationRecord } from '@/features/calendar/dayMath';

/* ------------------------------------- dados de teste ------------------------------------- */

const SEGUNDA = '2026-10-12';
const TERCA = '2026-10-13';
const QUARTA = '2026-10-14';

function reserva(over: Partial<ReservationRecord> & { id: string }, dogId = 'mowgli', dogName = 'Mowgli'): ReservationRecord {
  return {
    dog: { id: dogId, dogName, clientName: 'Leigh Ann' },
    serviceType: 'daycare',
    startDate: SEGUNDA,
    endDate: SEGUNDA,
    transportRequired: true,
    status: 'confirmed',
    ...over,
  };
}

function escala(over: Partial<RecurringScheduleRecord> = {}): RecurringScheduleRecord {
  return {
    id: 'escala-mowgli',
    dog: { id: 'mowgli', dogName: 'Mowgli', clientName: 'Leigh Ann' },
    weekdays: [1, 3], // segunda e quarta
    startDate: '2026-09-01',
    endDate: null,
    active: true,
    transportRequired: true,
    ...over,
  };
}

function pausa(over: Partial<RecurringExceptionRecord> = {}): RecurringExceptionRecord {
  return {
    id: 'pausa-1',
    scheduleId: 'escala-mowgli',
    action: 'skip',
    startDate: SEGUNDA,
    endDate: SEGUNDA,
    reason: 'Cancelled in Google Calendar',
    ...over,
  };
}

/* ---------------------------------- regras puras (cancelado) ---------------------------------- */

describe('cancelledVisitsOfDay — o que o vermelho do Google tira', () => {
  it('reserva avulsa cancelada: a barra de daycare cancela TODOS os dias dela (14/10/2026)', () => {
    const cancelada = reserva({ id: 'r-1', status: 'cancelled', serviceType: 'daycare', startDate: SEGUNDA, endDate: QUARTA });

    expect(cancelledVisitsOfDay(SEGUNDA, [cancelada], [], [])).toEqual([
      { dogId: 'mowgli', dogName: 'Mowgli', clientName: 'Leigh Ann', serviceType: 'daycare' },
    ]);
    // ⚠️ MUDANÇA DE 14/10/2026: a barra de daycare de vários dias cobre TODO dia dela (antes só o dia
    // de início, e o cão cancelado "sumia" dos outros dias do resumo). É a MESMA cobertura do dia que o
    // `buildDay` passou a usar — as duas contas não podem divergir.
    expect(cancelledVisitsOfDay(TERCA, [cancelada], [], [])).toHaveLength(1);
    expect(cancelledVisitsOfDay(QUARTA, [cancelada], [], [])).toHaveLength(1);
    // Fora da barra não cancela nada.
    expect(cancelledVisitsOfDay('2026-10-15', [cancelada], [], [])).toEqual([]);
  });

  it('daycare de UM dia cancelado cancela só aquele dia', () => {
    const cancelada = reserva({ id: 'r-1b', status: 'cancelled', serviceType: 'daycare' });

    expect(cancelledVisitsOfDay(SEGUNDA, [cancelada], [], [])).toHaveLength(1);
    expect(cancelledVisitsOfDay(TERCA, [cancelada], [], [])).toEqual([]);
  });

  it('hospedagem cancelada: cancelada em TODOS os dias do período, como boarding', () => {
    const cancelada = reserva({ id: 'r-2', status: 'cancelled', serviceType: 'boarding', startDate: SEGUNDA, endDate: QUARTA });

    expect(cancelledVisitsOfDay(SEGUNDA, [cancelada], [], [])[0].serviceType).toBe('boarding');
    expect(cancelledVisitsOfDay(TERCA, [cancelada], [], [])[0].serviceType).toBe('boarding');
    expect(cancelledVisitsOfDay(QUARTA, [cancelada], [], [])).toHaveLength(1);
  });

  it('reserva CONFIRMADA não é cancelamento (é cão que vem)', () => {
    expect(cancelledVisitsOfDay(SEGUNDA, [reserva({ id: 'r-3' })], [], [])).toEqual([]);
  });

  it('escala fixa: pausa do VERMELHO no dia da escala cancela aquele dia', () => {
    expect(cancelledVisitsOfDay(SEGUNDA, [], [escala()], [pausa()])).toEqual([
      { dogId: 'mowgli', dogName: 'Mowgli', clientName: 'Leigh Ann', serviceType: 'daycare' },
    ]);
    // Terça não é dia da escala (weekdays = segunda e quarta) e não tem dia extra: nada a cancelar.
    expect(cancelledVisitsOfDay(TERCA, [], [escala()], [pausa({ startDate: TERCA, endDate: TERCA })])).toEqual([]);
  });

  it('a pausa que o GESTOR marcou no app NÃO entra como cancelamento', () => {
    const folgaDoApp = pausa({ reason: 'Skipped on this date' });
    expect(cancelledVisitsOfDay(SEGUNDA, [], [escala()], [folgaDoApp])).toEqual([]);
  });

  it('escala desativada não cancela nada', () => {
    expect(cancelledVisitsOfDay(SEGUNDA, [], [escala({ active: false })], [pausa()])).toEqual([]);
  });

  it('dia EXTRA (roxo) cancelado: o dia não é da escala, mas foi marcado como dia dele', () => {
    const extra: RecurringExceptionRecord = {
      id: 'extra-1',
      scheduleId: 'escala-mowgli',
      action: 'extra',
      startDate: TERCA,
      endDate: TERCA,
      reason: 'Changed day',
    };

    expect(cancelledVisitsOfDay(TERCA, [], [escala()], [extra, pausa({ startDate: TERCA, endDate: TERCA })])).toHaveLength(1);
  });

  it('o mesmo cão sai uma vez só (reserva cancelada manda no serviço)', () => {
    const cancelada = reserva({ id: 'r-4', status: 'cancelled', serviceType: 'boarding' });

    expect(cancelledVisitsOfDay(SEGUNDA, [cancelada], [escala()], [pausa()])).toEqual([
      { dogId: 'mowgli', dogName: 'Mowgli', clientName: 'Leigh Ann', serviceType: 'boarding' },
    ]);
  });

  it('pausa de OUTRA escala não cancela este cão', () => {
    expect(cancelledVisitsOfDay(SEGUNDA, [], [escala()], [pausa({ scheduleId: 'escala-de-outro' })])).toEqual([]);
  });
});

/* --------------------------------- o que a tela pede ao banco --------------------------------- */

/** Cliente falso: devolve as linhas por tabela e registra cada chamada da corrente do PostgREST. */
const chamadas: Record<string, [string, ...unknown[]][]> = {};
let linhas: Record<string, unknown[]> = {};

const clienteFalso = {
  from: (tabela: string) => {
    const consulta: Record<string, unknown> = {};
    for (const metodo of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'limit']) {
      consulta[metodo] = (...args: unknown[]) => {
        (chamadas[tabela] = chamadas[tabela] ?? []).push([metodo, ...args]);
        return consulta;
      };
    }
    consulta.then = (resolver: (valor: unknown) => unknown) =>
      Promise.resolve({ data: linhas[tabela] ?? [], error: null }).then(resolver);
    return consulta;
  },
} as unknown as SupabaseClient;

const linhaReserva = (over: Record<string, unknown>) => ({
  id: 'r-x',
  status: 'confirmed',
  service_type: 'daycare',
  start_date: SEGUNDA,
  end_date: SEGUNDA,
  transport_required: true,
  goes_to_daycare: true,
  movement_day: false,
  dog: { id: 'mowgli', name: 'Mowgli', client: { name: 'Leigh Ann' } },
  ...over,
});

beforeEach(() => {
  for (const chave of Object.keys(chamadas)) delete chamadas[chave];
  linhas = {};
});

describe('loadWeek — a semana com os cancelados', () => {
  it('pede as reservas CONFIRMADAS e CANCELADAS (antes só as confirmadas)', async () => {
    linhas = { reservations: [], recurring_schedules: [], recurring_exceptions: [] };
    await loadWeek(clienteFalso, 'org-1', [SEGUNDA, TERCA]);

    expect(chamadas.reservations).toEqual(expect.arrayContaining([['in', 'status', ['confirmed', 'cancelled']]]));
    // O filtro antigo (`eq status confirmed`) escondia o dia cancelado — não pode voltar.
    expect(chamadas.reservations.some(([metodo, ...args]) => metodo === 'eq' && args[0] === 'status')).toBe(false);
    // A janela da semana continua a mesma: reservas que CRUZAM o período.
    expect(chamadas.reservations).toEqual(expect.arrayContaining([['lte', 'start_date', TERCA], ['gte', 'end_date', SEGUNDA]]));
  });

  it('pede o `reason` da exceção (é ele que diz que a pausa veio do vermelho)', async () => {
    linhas = { reservations: [], recurring_schedules: [], recurring_exceptions: [] };
    await loadWeek(clienteFalso, 'org-1', [SEGUNDA]);

    const selecao = chamadas.recurring_exceptions.find(([metodo]) => metodo === 'select');
    expect(String(selecao?.[1])).toContain('reason');
  });

  it('a cancelada sai da lista do dia e entra na lista de cancelados', async () => {
    linhas = {
      reservations: [
        linhaReserva({ id: 'r-cancelada', status: 'cancelled', service_type: 'daycare' }),
        linhaReserva({
          id: 'r-confirmada',
          dog: { id: 'luna', name: 'Luna', client: { name: 'Ana' } },
        }),
      ],
      recurring_schedules: [],
      recurring_exceptions: [],
    };

    const semana = await loadWeek(clienteFalso, 'org-1', [SEGUNDA, TERCA]);

    expect(semana.dogsByDay[SEGUNDA].map((cao) => cao.dogName)).toEqual(['Luna']);
    expect(semana.cancelledByDay[SEGUNDA]).toEqual([
      { dogId: 'mowgli', dogName: 'Mowgli', clientName: 'Leigh Ann', serviceType: 'daycare' },
    ]);
    expect(semana.cancelledByDay[TERCA]).toEqual([]);
  });

  it('a pausa do vermelho na escala chega como dia cancelado (com o dog da escala)', async () => {
    linhas = {
      reservations: [],
      recurring_schedules: [
        {
          id: 'escala-mowgli',
          weekdays: [1],
          start_date: '2026-09-01',
          end_date: null,
          active: true,
          transport_required: true,
          dog: { id: 'mowgli', name: 'Mowgli', client: { name: 'Leigh Ann' } },
        },
      ],
      recurring_exceptions: [
        { id: 'pausa-1', recurring_schedule_id: 'escala-mowgli', action: 'skip', start_date: SEGUNDA, end_date: SEGUNDA, reason: 'Cancelled in Google Calendar' },
        { id: 'folga-1', recurring_schedule_id: 'escala-mowgli', action: 'skip', start_date: TERCA, end_date: TERCA, reason: 'Skipped on this date' },
      ],
    };

    const semana = await loadWeek(clienteFalso, 'org-1', [SEGUNDA, TERCA]);

    expect(semana.cancelledByDay[SEGUNDA].map((cao) => cao.dogName)).toEqual(['Mowgli']);
    // Folga marcada no app não é cancelamento.
    expect(semana.cancelledByDay[TERCA]).toEqual([]);
    // E a escala continua fora do dia nas duas datas (pausa é pausa).
    expect(semana.dogsByDay[SEGUNDA]).toEqual([]);
  });

  it('semana sem nada devolve listas vazias', async () => {
    linhas = { reservations: [], recurring_schedules: [], recurring_exceptions: [] };
    const semana = await loadWeek(clienteFalso, 'org-1', [SEGUNDA, TERCA]);

    expect(semana.dogsByDay).toEqual({ [SEGUNDA]: [], [TERCA]: [] });
    expect(semana.cancelledByDay).toEqual({ [SEGUNDA]: [], [TERCA]: [] });
  });
});
