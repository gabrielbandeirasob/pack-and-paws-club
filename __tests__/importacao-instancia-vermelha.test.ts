/**
 * ⚡ VAIVÉM DE 15 EM 15 MINUTOS — a INSTÂNCIA VERMELHA de um evento recorrente (medido 13/10/2026).
 *
 * O que o calendário do CLIENTE tinha no dia 13/10 (lido pela função-espiã, não é suposição):
 *
 *   `fins2mdl7on42lclq1fs3p0j4s`                   "Jasper/Ruby"  SEM COR  recorrência  -> daycare
 *   `fins2mdl7on42lclq1fs3p0j4s_20261013T173000Z`  "Jasper/Ruby"  TOMATO   um dia só   -> cancelar
 *
 * São DOIS eventos para o MESMO dia: a série e a ocorrência que o escritório pintou de vermelho (é
 * assim que ele cancela o dia). Cada regra só disparava no estado que a outra deixava —
 * `alvosDoCancelamento` cancela linha `confirmed`, `precisaAtualizar` restaura linha `cancelled` — e a
 * reserva do dia piscava `confirmed↔cancelled` a cada rodada do robô: **57 alternâncias em 11 h nas
 * mesmas 7 linhas** (`audit_logs`), todas nos minutos `:00/:15/:30/:45`, autor o robô. No telefone do
 * escritório isso é *"apareceu e não deveria"* (Jasper/Ruby) e *"perde um / acha um cachorro"*.
 *
 * Regra que passou a valer: **o vermelho vence o dia** — a linha cancelada não é restaurada e nenhuma
 * linha nova nasce para aquele cão naquele dia. Tirando o vermelho, tudo volta ao comportamento antigo.
 */
import {
  diasCanceladosNoGoogle,
  planCalendarImport,
  type BookingForImport,
  type DogForImport,
  type ImportOutcome,
} from '@/features/integrations/google/importPlan';
import type { RemoteEvent } from '@/features/integrations/google/eventMarkers';

const AGENDA = 'packandpawsclub@gmail.com';
const JANELA = { from: '2026-10-13', to: '2027-04-11' };
const SEM_COR = null; // sem cor = daycare (o escritório não pinta os dias de day care)
const TOMATO = '11'; // vermelho = cancelar

const SERIE = 'fins2mdl7on42lclq1fs3p0j4s';
const INSTANCIA = 'fins2mdl7on42lclq1fs3p0j4s_20261013T173000Z';

const CAES: DogForImport[] = [
  { id: 'dog-jasper', name: 'Jasper', clientId: 'cl-katia', clientName: 'Katia' },
  { id: 'dog-ruby', name: 'Ruby', clientId: 'cl-katia', clientName: 'Katia' },
];

/** A série: `RRULE:FREQ=WEEKLY` sem `BYDAY` — é a forma que o cliente tem (o app guarda reserva do
 *  dia, nunca série: a organização dele tem 0 linhas em `recurring_schedules`). */
const serie = (extra: Partial<RemoteEvent> = {}): RemoteEvent => ({
  id: SERIE,
  summary: 'Jasper/Ruby',
  startDate: '2026-10-13',
  endDate: '2026-10-14',
  appKey: null,
  colorId: SEM_COR,
  eventLabelId: null,
  recurrence: ['RRULE:FREQ=WEEKLY'],
  ...extra,
});

/** A ocorrência pintada de vermelho: id da série + sufixo, sem recorrência própria. */
const instanciaVermelha = (extra: Partial<RemoteEvent> = {}): RemoteEvent => ({
  id: INSTANCIA,
  summary: 'Jasper/Ruby',
  startDate: '2026-10-13',
  endDate: '2026-10-14',
  appKey: null,
  colorId: TOMATO,
  eventLabelId: null,
  recurrence: null,
  ...extra,
});

const reserva = (dogId: string, status: string, dia = '2026-10-13'): BookingForImport => ({
  id: `r-${dogId}`,
  kind: 'reservation',
  dogId,
  googleEventId: SERIE,
  googleCalendarId: AGENDA,
  source: 'google',
  serviceType: 'daycare',
  startDate: dia,
  endDate: dia,
  status,
});

const planejar = (eventos: RemoteEvent[], linhas: BookingForImport[]): ImportOutcome[] =>
  planCalendarImport(eventos, CAES, linhas, JANELA, { calendarId: AGENDA });

const ids = (lista: ImportOutcome[], tipo: ImportOutcome['kind']): string[] =>
  lista.filter((item) => item.kind === tipo).map((item) => (item as { bookingId?: string }).bookingId ?? '').sort();

const nomeDe = (nome: string, dia: string): string => `${nome}|${dia}`.toLowerCase();

describe('o vermelho da INSTÂNCIA vence o dia (fim do vaivém)', () => {
  it('a instância vermelha marca SÓ o dia dela, no nome do cão', () => {
    const cancelados = diasCanceladosNoGoogle([serie(), instanciaVermelha()], [], JANELA);
    expect(cancelados.has(nomeDe('Jasper', '2026-10-13'))).toBe(true);
    expect(cancelados.has(nomeDe('Ruby', '2026-10-13'))).toBe(true);
    expect(cancelados.has(nomeDe('Jasper', '2026-10-14'))).toBe(false);
    expect(cancelados.has(nomeDe('Jasper', '2026-10-20'))).toBe(false);
  });

  it('com a linha confirmada, a instância pede o cancelamento (metade de sempre)', () => {
    const plano = planejar([serie(), instanciaVermelha()], [reserva('dog-jasper', 'confirmed'), reserva('dog-ruby', 'confirmed')]);
    expect(ids(plano, 'cancel')).toEqual(['r-dog-jasper', 'r-dog-ruby']);
    expect(plano.filter((item) => item.kind === 'update')).toHaveLength(0);
  });

  it('com a linha já cancelada, NADA acontece — era aqui que a série ressuscitava o cão', () => {
    const plano = planejar([serie(), instanciaVermelha()], [reserva('dog-jasper', 'cancelled'), reserva('dog-ruby', 'cancelled')]);
    expect(plano.filter((item) => item.kind === 'update')).toHaveLength(0);
    expect(plano.filter((item) => item.kind === 'cancel')).toHaveLength(0);
    expect(plano.filter((item) => item.kind === 'create')).toHaveLength(0);
  });

  it('duas rodadas seguidas devolvem o MESMO plano (idempotente)', () => {
    const linhas = [reserva('dog-jasper', 'cancelled'), reserva('dog-ruby', 'cancelled')];
    const primeira = planejar([serie(), instanciaVermelha()], linhas);
    const segunda = planejar([serie(), instanciaVermelha()], linhas);
    expect(segunda).toEqual(primeira);
  });

  it('dia cancelado no calendário não nasce no app', () => {
    // Sem linha nenhuma para a Ruby: a série criaria o dia dela — o vermelho impede.
    const plano = planejar([serie(), instanciaVermelha()], [reserva('dog-jasper', 'cancelled')]);
    expect(plano.filter((item) => item.kind === 'create')).toHaveLength(0);
  });

  it('tirando o vermelho, o dia volta (o escritório desfaz o cancelamento no Google)', () => {
    const plano = planejar([serie()], [reserva('dog-jasper', 'cancelled'), reserva('dog-ruby', 'cancelled')]);
    expect(ids(plano, 'update')).toEqual(['r-dog-jasper', 'r-dog-ruby']);
  });

  it('vermelho avulso (evento que não é de série) continua cancelando como antes', () => {
    const AVULSO = 'evento-avulso-vermelho';
    const avulso: RemoteEvent = {
      id: AVULSO,
      summary: 'Jasper',
      startDate: '2026-10-13',
      endDate: '2026-10-14',
      appKey: null,
      colorId: TOMATO,
      eventLabelId: null,
      recurrence: null,
    };
    const plano = planejar([avulso], [{ ...reserva('dog-jasper', 'confirmed'), googleEventId: AVULSO }]);
    expect(ids(plano, 'cancel')).toEqual(['r-dog-jasper']);
  });
});
