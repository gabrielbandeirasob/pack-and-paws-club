/**
 * O VERMELHO NUM DIA DE UMA BARRA CANCELA **AQUELA DATA**, NÃO A RESERVA (14/10/2026).
 *
 * Queixa do escritório (relatório da sincronização, item 2): o escritório pinta UM dia de vermelho e o
 * cão desaparece também dos outros dias da barra — inclusive de datas já passadas. Causa medida: o plano
 * mandava cancelar a reserva (`alvosDoCancelamento` → `cancelBooking`) e o executor gravava
 * `status = 'cancelled'` na linha inteira, que é a que cobre 12→17.
 *
 * Regra que passou a valer (migração `202610150045`): a linha continua `confirmed` e o dia cancelado mora
 * em `reservations.cancelled_days` (data[]). O dia sai do dia/Total Pack/fila (`buildDay`) e aparece como
 * cancelado no resumo da semana (`cancelledVisitsOfDay`) — e a série não tem o que restaurar, então o
 * vaivém de 15 em 15 minutos não pode voltar.
 *
 * Este arquivo prova as quatro pontas: o plano (cancel_day + a marca na barra), a idempotência da rodada
 * seguinte, o desfazer do escritório (tirar o vermelho devolve o dia) e o efeito nas telas.
 */
import { planCalendarImport, type BookingForImport, type DogForImport, type ImportOutcome } from '@/features/integrations/google/importPlan';
import type { RemoteEvent } from '@/features/integrations/google/eventMarkers';
import { buildDay, type ReservationRecord } from '@/features/calendar/dayMath';
import { cancelledVisitsOfDay } from '@/features/dashboard/cancelledDays';

const AGENDA = 'packandpawsclub@gmail.com';
const JANELA = { from: '2026-10-12', to: '2026-10-31' };

const BARRA = 'ev-barra-charlie'; // barra de daycare do escritório (segunda a sábado)
const VERMELHO = 'ev-vermelho-dia'; // o dia pintado de Tomato

const CAES: DogForImport[] = [{ id: 'dog-charlie', name: 'Charlie', clientId: 'cl-leigh', clientName: 'Leigh Ann' }];

/** A barra: 12 → 17/10 (o `end` do Google é EXCLUSIVO — por isso 18). */
const barra = (extra: Partial<RemoteEvent> = {}): RemoteEvent => ({
  id: BARRA,
  summary: 'Charlie',
  startDate: '2026-10-12',
  endDate: '2026-10-18',
  appKey: null,
  colorId: null, // sem cor = daycare
  eventLabelId: null,
  recurrence: null,
  ...extra,
});

/** O vermelho do escritório num ÚNICO dia da barra (15/10). */
const vermelhoDoDia = (extra: Partial<RemoteEvent> = {}): RemoteEvent => ({
  id: VERMELHO,
  summary: 'Charlie',
  startDate: '2026-10-15',
  endDate: '2026-10-16',
  appKey: null,
  colorId: '11', // Tomato
  eventLabelId: null,
  recurrence: null,
  ...extra,
});

/** A linha como ela está no banco depois da rodada que marcou o dia. */
const linhaDaBarra = (cancelledDays: string[] = []): BookingForImport => ({
  id: 'r-charlie',
  kind: 'reservation',
  dogId: 'dog-charlie',
  googleEventId: BARRA,
  googleCalendarId: AGENDA,
  source: 'google',
  serviceType: 'daycare',
  startDate: '2026-10-12',
  endDate: '2026-10-17',
  status: 'confirmed',
  cancelledDays,
});

const planejar = (eventos: RemoteEvent[], linhas: BookingForImport[]): ImportOutcome[] =>
  planCalendarImport(eventos, CAES, linhas, JANELA, { calendarId: AGENDA });

const registros = (plano: ImportOutcome[]): ReservationRecord[] =>
  plano
    .filter((item): item is Extract<ImportOutcome, { kind: 'create' | 'update' }> => item.kind === 'create' || item.kind === 'update')
    .map((item, indice) => ({
      id: `r-${indice}`,
      dog: { id: item.dogId, dogName: 'Charlie', clientName: 'Leigh Ann' },
      // `serviceType` do plano pode vir nulo (cor de serviço ausente) — a barra deste caso é daycare.
      serviceType: item.parsed.serviceType === 'boarding' ? 'boarding' : 'daycare',
      startDate: item.parsed.startDate,
      endDate: item.parsed.endDate,
      transportRequired: true,
      status: 'confirmed',
      cancelledDays: item.parsed.cancelledDays ?? [],
    }));

describe('o vermelho de UM dia cancela só aquele dia (migração 202610150045)', () => {
  it('dia vermelho dentro da barra → cancel_day (a linha NÃO é cancelada)', () => {
    const plano = planejar([barra(), vermelhoDoDia()], [linhaDaBarra()]);

    expect(plano.filter((item) => item.kind === 'cancel_day')).toEqual([
      { kind: 'cancel_day', eventId: VERMELHO, bookingKind: 'reservation', bookingId: 'r-charlie', date: '2026-10-15' },
    ]);
    expect(plano.filter((item) => item.kind === 'cancel')).toEqual([]);
    // A própria barra sai da rodada com a marca do dia — quem grava é o executor (`cancelled_days`).
    const barraAtualizada = plano.find((item) => item.kind === 'update');
    expect(barraAtualizada).toMatchObject({ kind: 'update', bookingId: 'r-charlie', parsed: { cancelledDays: ['2026-10-15'] } });
  });

  it('barra criada do zero já nasce com o dia cancelado (não espera a rodada seguinte)', () => {
    const plano = planejar([barra(), vermelhoDoDia()], []);
    const criada = plano.find((item) => item.kind === 'create');

    expect(criada).toMatchObject({ kind: 'create', dogId: 'dog-charlie', parsed: { cancelledDays: ['2026-10-15'] } });
    expect(plano.filter((item) => item.kind === 'cancel_day')).toEqual([]);
  });

  it('rodada seguinte é IDEMPOTENTE: nem cancel_day, nem update (o vaivém não volta)', () => {
    const linhas = [linhaDaBarra(['2026-10-15'])];

    expect(planejar([barra(), vermelhoDoDia()], linhas)).toEqual([]);
    expect(planejar([barra(), vermelhoDoDia()], linhas)).toEqual([]);
  });

  it('tirando o vermelho, o dia volta (a marca é limpa na rodada seguinte)', () => {
    const plano = planejar([barra()], [linhaDaBarra(['2026-10-15'])]);

    expect(plano).toEqual([
      expect.objectContaining({ kind: 'update', bookingId: 'r-charlie', parsed: expect.objectContaining({ cancelledDays: [] }) }),
    ]);
    // E a rodada depois da limpeza não repete o trabalho.
    expect(planejar([barra()], [linhaDaBarra([])])).toEqual([]);
  });
});

describe('o dia cancelado na tela (buildDay + resumo da semana)', () => {
  const linha: ReservationRecord = {
    id: 'r-charlie',
    dog: { id: 'dog-charlie', dogName: 'Charlie', clientName: 'Leigh Ann' },
    serviceType: 'daycare',
    startDate: '2026-10-12',
    endDate: '2026-10-17',
    transportRequired: true,
    status: 'confirmed',
    cancelledDays: ['2026-10-15'],
  };

  it('o cão sai do dia cancelado e continua nos outros dias da barra', () => {
    expect(buildDay('2026-10-14', [linha], []).daycare.map((item) => item.dogName)).toEqual(['Charlie']);
    expect(buildDay('2026-10-15', [linha], []).daycare).toEqual([]);
    expect(buildDay('2026-10-16', [linha], []).daycare.map((item) => item.dogName)).toEqual(['Charlie']);
  });

  it('o dia cancelado aparece como cancelado no resumo da semana (não some sem explicação)', () => {
    expect(cancelledVisitsOfDay('2026-10-15', [linha], [], [], true)).toEqual([
      { dogId: 'dog-charlie', dogName: 'Charlie', clientName: 'Leigh Ann', serviceType: 'daycare', reason: 'Cancelled in Google Calendar' },
    ]);
    expect(cancelledVisitsOfDay('2026-10-14', [linha], [], [], true)).toEqual([]);
  });

  it('linha cancelada por inteiro (evento apagado) continua cancelada — a marca não a "desmarca"', () => {
    const cancelada: ReservationRecord = { ...linha, status: 'cancelled', cancelledDays: [] };
    expect(buildDay('2026-10-14', [cancelada], []).daycare).toEqual([]);
    expect(cancelledVisitsOfDay('2026-10-14', [cancelada], [], [])).toHaveLength(1);
  });

  it('duas linhas do mesmo cão no dia: se QUALQUER uma marca o dia, o cão não aparece (não depende da ordem)', () => {
    const semMarca: ReservationRecord = { ...linha, id: 'r-outra', cancelledDays: [] };
    const marcada: ReservationRecord = { ...linha, id: 'r-marcada' };
    expect(buildDay('2026-10-15', [semMarca, marcada], []).daycare).toEqual([]);
    expect(buildDay('2026-10-15', [marcada, semMarca], []).daycare).toEqual([]);
  });
});

/* --------------------------------------------------------------------------------------------- */
/* O caminho do PLANO até as TELAS: `create`/`update` do plano é o que a tela vai ler.             */
/* --------------------------------------------------------------------------------------------- */

describe('plano → telas (o dia cancelado viaja junto com a reserva)', () => {
  it('a linha que o plano grava tira o cão do dia 15 e o mantém nos outros', () => {
    const linhas = registros(planejar([barra(), vermelhoDoDia()], []));

    expect(linhas).toHaveLength(1);
    expect(buildDay('2026-10-15', linhas, []).daycare).toEqual([]);
    expect(buildDay('2026-10-13', linhas, []).daycare.map((item) => item.dogName)).toEqual(['Charlie']);
    expect(cancelledVisitsOfDay('2026-10-15', linhas, [], [])).toHaveLength(1);
  });
});
