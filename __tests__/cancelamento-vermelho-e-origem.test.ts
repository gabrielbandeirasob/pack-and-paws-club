/**
 * VERMELHO TEM DE TIRAR O CÃO DO DIA — e a reserva nova precisa nascer com a ORIGEM da agenda.
 *
 * Queixa do dono em 08/10/2026: *"Eu marquei de vermelho para cancelar e continuo ativo no
 * calendário"*. Medido no banco do cliente: o Mowgli tinha **três** reservas no mesmo dia (duplicatas
 * de importações antigas); o evento vermelho estava ligado a uma delas **já cancelada** e a função
 * antiga parava ali, deixando outra linha confirmada segurando o cão no dia. Defeito irmão: quando a
 * agenda não podia ser identificada (`calendarIdDaOrigem` sem escopo de calendário), a reserva nova
 * nascia sem `google_calendar_id` e ficava protegida contra cancelamento automático para sempre.
 *
 * Vetores: (1) o vermelho cancela o vínculo E as outras linhas confirmadas daquele cão no dia;
 * (2) série ativa no dia vira `skip`; (3) linha já cancelada não protege o resto; (4) sem nada
 * agendado não se inventa decisão; (5) a origem sai da chamada própria de calendário e, quando ela
 * falha, do ORGANIZADOR dos eventos lidos.
 */
import { planCalendarImport, type BookingForImport, type DogForImport, type ImportOutcome } from '@/features/integrations/google/importPlan';
import { runCalendarImport, type ImportPorts } from '@/features/integrations/google/importService';
import type { CalendarFetch } from '@/features/integrations/google/calendarApi';
import type { RemoteEvent } from '@/features/integrations/google/eventMarkers';

const JANELA = { from: '2026-10-08', to: '2027-04-07' };
const DIA = '2026-10-08';
const VERMELHO = '11';

const MOWGLI: DogForImport = { id: 'dog-mowgli', name: 'Mowgli', clientName: 'Nina' };

function evento(extra: Partial<RemoteEvent> = {}): RemoteEvent {
  return { id: 'ev-vermelho', summary: 'Mowgli', startDate: DIA, endDate: DIA, appKey: null, colorId: VERMELHO, ...extra };
}

function reserva(extra: Partial<BookingForImport> & { id: string }): BookingForImport {
  const base: BookingForImport = {
    id: extra.id,
    kind: 'reservation',
    dogId: 'dog-mowgli',
    googleEventId: null,
    source: 'google',
    serviceType: 'daycare',
    startDate: DIA,
    endDate: DIA,
    weekdays: null,
    skipDates: null,
    status: 'confirmed',
  } as BookingForImport;
  return { ...base, ...extra } as BookingForImport;
}

function serie(extra: Partial<BookingForImport> & { id: string }): BookingForImport {
  return { ...reserva({ id: extra.id }), kind: 'recurring', endDate: null, weekdays: [4], status: 'active', ...extra } as BookingForImport;
}

const cancelados = (outcomes: ImportOutcome[]) =>
  outcomes.filter((o): o is Extract<ImportOutcome, { kind: 'cancel' }> => o.kind === 'cancel').map((o) => o.bookingId);
const pulados = (outcomes: ImportOutcome[]) =>
  outcomes.filter((o): o is Extract<ImportOutcome, { kind: 'skip' }> => o.kind === 'skip').map((o) => o.scheduleId);

describe('evento VERMELHO tira o cão do dia por completo (caso real de 08/10/2026)', () => {
  it('o vínculo JÁ CANCELADO não segura a linha duplicada confirmada (o defeito do Mowgli)', () => {
    const plano = planCalendarImport(
      [evento()],
      [MOWGLI],
      [
        reserva({ id: 'r-vinculo-cancelado', googleEventId: 'ev-vermelho', status: 'cancelled' }),
        reserva({ id: 'r-duplicada-confirmada', googleEventId: null }),
      ],
      JANELA,
    );

    expect(cancelados(plano)).toEqual(['r-duplicada-confirmada']);
    expect(plano.some((o) => o.kind === 'review')).toBe(false);
  });

  it('duplicatas confirmadas + o vínculo confirmado: TODAS saem (uma vez cada)', () => {
    const plano = planCalendarImport(
      [evento()],
      [MOWGLI],
      [
        reserva({ id: 'r-ligada', googleEventId: 'ev-vermelho' }),
        reserva({ id: 'r-duplicada-1', googleEventId: null }),
        reserva({ id: 'r-duplicada-2', googleEventId: 'outro-evento' }),
      ],
      JANELA,
    );

    expect(cancelados(plano).sort()).toEqual(['r-duplicada-1', 'r-duplicada-2', 'r-ligada']);
  });

  it('série ativa que cai no dia vira PULO (não desativa a escala) e a reserva avulsa é cancelada', () => {
    const plano = planCalendarImport(
      [evento()],
      [MOWGLI],
      [reserva({ id: 'r-avulsa' }), serie({ id: 's-fixa' })],
      JANELA,
    );

    expect(cancelados(plano)).toEqual(['r-avulsa']);
    expect(pulados(plano)).toEqual(['s-fixa']);
  });

  it('série que já tem o dia pulado não gera pulo repetido', () => {
    const plano = planCalendarImport([evento()], [MOWGLI], [serie({ id: 's-fixa', skipDates: [DIA] })], JANELA);

    expect(plano).toEqual([]);
  });

  it('cão sem nada agendado naquele dia: nenhuma decisão inventada', () => {
    expect(planCalendarImport([evento()], [MOWGLI], [], JANELA)).toEqual([]);
  });

  it('cão fora do cadastro continua indo para a revisão ("unknown dog")', () => {
    const plano = planCalendarImport([evento({ id: 'ev-rex', summary: 'Rex' })], [MOWGLI], [], JANELA);

    expect(plano).toEqual([expect.objectContaining({ kind: 'review', reason: 'unknown dog', title: 'Rex' })]);
  });

  it('reserva de OUTRO dia fica intocada (só o dia do evento é cancelado)', () => {
    const plano = planCalendarImport(
      [evento()],
      [MOWGLI],
      [reserva({ id: 'r-de-outro-dia', startDate: '2026-10-09', endDate: '2026-10-09' })],
      JANELA,
    );

    expect(plano).toEqual([]);
  });

  it('reserva criada DENTRO do app no mesmo dia também é cancelada (regra do dono, 28/09)', () => {
    const plano = planCalendarImport([evento()], [MOWGLI], [reserva({ id: 'r-do-app', source: 'app' })], JANELA);

    expect(cancelados(plano)).toEqual(['r-do-app']);
  });
});

/* ------------------------------------------------------------------ origem da agenda */

const CAO: DogForImport = { id: 'dog-mowgli', name: 'Mowgli', clientName: 'Nina' };
type Registro = { calendarId?: string | null; eventId: string };

function listagem(itens: unknown[]) {
  return { ok: true, status: 200, json: async () => ({ items: itens }) };
}

function portas(registro: Registro[]): ImportPorts {
  return {
    createBooking: async (entrada) => {
      registro.push({ calendarId: entrada.calendarId, eventId: entrada.eventId });
      return 'created';
    },
    updateBooking: async () => undefined,
    cancelBooking: async () => undefined,
    skipRecurringDay: async () => undefined,
    addScheduleExtraDay: async () => undefined,
  } as ImportPorts;
}

async function importar(doFetch: CalendarFetch, registro: Registro[]) {
  return runCalendarImport({
    accessToken: 'tok',
    range: { timeMin: '2026-10-08T00:00:00Z', timeMax: '2027-04-07T00:00:00Z' },
    window: JANELA,
    dogs: [CAO],
    reservations: [],
    doFetch,
    ports: portas(registro),
  });
}

describe('origem da agenda na reserva nova (linha não pode nascer presa)', () => {
  const dia = (id: string, data: string, email?: string) => ({
    id,
    summary: 'Mowgli',
    start: { date: data },
    end: { date: data },
    colorId: '7',
    ...(email ? { organizer: { email } } : {}),
  });

  it('a chamada própria manda: o `id` do calendário é o que vai para a reserva', async () => {
    const registro: Registro[] = [];
    const doFetch = (async (url: string) => {
      if (url.endsWith('/calendars/primary')) return { ok: true, status: 200, json: async () => ({ id: 'dono@exemplo.com' }) };
      return listagem([dia('ev-1', '2026-10-09', 'outro@x.com')]);
    }) as CalendarFetch;

    await importar(doFetch, registro);
    expect(registro).toEqual([{ calendarId: 'dono@exemplo.com', eventId: 'ev-1' }]);
  });

  it('sem a chamada própria (403 por falta de escopo), o ORGANIZADOR dos eventos é a origem', async () => {
    const registro: Registro[] = [];
    const doFetch = (async (url: string) => {
      if (url.endsWith('/calendars/primary')) return { ok: false, status: 403, json: async () => ({}) };
      return listagem([dia('ev-1', '2026-10-09', 'dono@exemplo.com'), dia('ev-2', '2026-10-10', 'dono@exemplo.com')]);
    }) as CalendarFetch;

    await importar(doFetch, registro);
    expect(registro.map((item) => item.calendarId)).toEqual(['dono@exemplo.com', 'dono@exemplo.com']);
  });

  it('organizadores diferentes não são origem: a reserva sai sem agenda (linha protegida)', async () => {
    const registro: Registro[] = [];
    const doFetch = (async (url: string) => {
      if (url.endsWith('/calendars/primary')) return { ok: false, status: 403, json: async () => ({}) };
      return listagem([dia('ev-1', '2026-10-09', 'um@x.com'), dia('ev-2', '2026-10-10', 'outro@x.com')]);
    }) as CalendarFetch;

    await importar(doFetch, registro);
    expect(registro.map((item) => item.calendarId)).toEqual([null, null]);
  });

  it('sem organizador legível, nada muda: segue sem agenda (comportamento antigo)', async () => {
    const registro: Registro[] = [];
    const doFetch = (async (url: string) => {
      if (url.endsWith('/calendars/primary')) return { ok: false, status: 403, json: async () => ({}) };
      return listagem([dia('ev-1', '2026-10-09')]);
    }) as CalendarFetch;

    await importar(doFetch, registro);
    expect(registro.map((item) => item.calendarId)).toEqual([null]);
  });
});
