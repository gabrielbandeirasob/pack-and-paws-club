/**
 * MESMO CÃO DUAS VEZES NO MESMO DIA — achado da simulação do calendário do cliente (print de 06/10/2026).
 *
 * O print do escritório daquele dia tem **`Sammy` em duas barras** (3:30AM e 9AM, as duas azuis) e
 * `Penny` também duas vezes. A regra do dono é *"o mesmo cão, mesmo serviço, mesmo dia aparece UMA vez"*,
 * mas a importação só comparava com o que JÁ ESTAVA GRAVADO (`gemea`) e o banco não tem índice único para
 * (cão, serviço, dia) — só para `google_event_id`. Medido no fixture com o código de produção: a rodada
 * devolvia **2 `create`** para o Sammy; o dia no app mostrava o cão uma vez (o `buildDay` deduplica) e o
 * banco ficava com DUAS linhas iguais — invisível para quem opera.
 *
 * O que estes vetores travam:
 *  - dois eventos iguais (mesmo cão, mesmo serviço, mesmo dia) na MESMA rodada = **1 reserva + 1
 *    pendência `duplicate`** (o primeiro evento por ordem de id cria; o gestor decide sobre o resto);
 *  - dois CÃES no mesmo evento continuam sendo duas reservas (não é duplicata);
 *  - o MESMO cão com SERVIÇOS diferentes no mesmo dia continua sendo duas reservas (é o contrato do
 *    cliente: day care de dia + chegada/saída de hospedagem no mesmo dia = dois blocos na agenda);
 *  - o mesmo cão em DIAS diferentes continua sendo duas reservas;
 *  - evento repetido contra uma reserva que já está no banco segue como antes (pendência `duplicate`).
 */
import {
  kindOf,
  parseBookingEvents,
  planCalendarImport,
  type BookingForImport,
  type DogForImport,
  type ImportOutcome,
} from '@/features/integrations/google/importPlan';
import type { RemoteEvent } from '@/features/integrations/google/eventMarkers';

const JANELA = { from: '2026-10-06', to: '2026-12-31' };
const AZUL = '7'; // Peacock -> day care
const AMARELO = '5'; // Banana -> hospedagem no dia de chegada/saída (anda de van)
const VERDE = '2'; // Sage -> hospedagem (dia no hotel)

function evento(parcial: Partial<RemoteEvent> & { id: string }): RemoteEvent {
  return { summary: '', startDate: '2026-10-06', endDate: '2026-10-07', appKey: null, colorId: AZUL, recurrence: null, ...parcial };
}

const CAES: DogForImport[] = [
  { id: 'dog-sammy', name: 'Sammy', clientName: 'Chuck' },
  { id: 'dog-scarlet', name: 'Scarlet', clientName: 'Brian' },
  { id: 'dog-skylar', name: 'Skylar', clientName: 'Suma Ramadas' },
  { id: 'dog-milo', name: 'Milo', clientName: 'Suma Ramadas' },
];

const conta = (plano: ImportOutcome[], kind: ImportOutcome['kind']) => plano.filter((o) => o.kind === kind).length;
const revisoes = (plano: ImportOutcome[]) =>
  plano.filter((o): o is Extract<ImportOutcome, { kind: 'review' }> => o.kind === 'review');

describe('o mesmo cão duas vezes no mesmo dia (print do cliente, 06/10/2026)', () => {
  it('duas barras azuis do Sammy no mesmo dia = UMA reserva + pendência "duplicate"', () => {
    const eventos = [
      evento({ id: 'evt-sammy-0330', summary: 'Sammy' }), // 3:30AM
      evento({ id: 'evt-sammy-0900', summary: 'Sammy' }), // 9AM
    ];
    const plano = planCalendarImport(eventos, CAES, [], JANELA);

    expect(conta(plano, 'create')).toBe(1);
    // o que cria é o evento de MENOR id (a leitura é determinística: ordena por id)
    expect(plano.find((o) => o.kind === 'create')).toMatchObject({ eventId: 'evt-sammy-0330', dogId: 'dog-sammy' });
    const pend = revisoes(plano);
    expect(pend).toHaveLength(1);
    expect(pend[0]).toMatchObject({ eventId: 'evt-sammy-0900', reason: 'duplicate', title: 'Sammy' });
  });

  it('DOIS cães no mesmo evento continuam sendo DUAS reservas (não é duplicata)', () => {
    const plano = planCalendarImport([evento({ id: 'evt-casa', summary: 'Skylar/Milo' })], CAES, [], JANELA);
    expect(conta(plano, 'create')).toBe(2);
    expect(revisoes(plano)).toHaveLength(0);
  });

  it('o MESMO cão com SERVIÇOS diferentes no mesmo dia continua sendo duas reservas', () => {
    // Scarlet azul (day care) + Scarlet amarelo (chegada/saída da hospedagem) = dois blocos na agenda.
    const plano = planCalendarImport(
      [evento({ id: 'evt-scarlet-dia', summary: 'Scarlet' }), evento({ id: 'evt-scarlet-casa', summary: 'Scarlet', colorId: AMARELO })],
      CAES,
      [],
      JANELA,
    );
    expect(conta(plano, 'create')).toBe(2);
    expect(revisoes(plano)).toHaveLength(0);
    const servicos = plano.filter((o) => o.kind === 'create').map((o) => (o.kind === 'create' ? o.parsed.serviceType : null));
    expect(servicos.sort()).toEqual(['boarding', 'daycare']);
  });

  it('o mesmo cão em DIAS diferentes continua sendo duas reservas', () => {
    const plano = planCalendarImport(
      [
        evento({ id: 'evt-terca', summary: 'Sammy' }),
        evento({ id: 'evt-quarta', summary: 'Sammy', startDate: '2026-10-07', endDate: '2026-10-08' }),
      ],
      CAES,
      [],
      JANELA,
    );
    expect(conta(plano, 'create')).toBe(2);
    expect(revisoes(plano)).toHaveLength(0);
  });

  it('evento repetido contra uma reserva que JÁ está no banco segue pendência (comportamento antigo)', () => {
    const jaExiste: BookingForImport[] = [
      {
        id: 'res-1',
        kind: 'reservation',
        dogId: 'dog-sammy',
        serviceType: 'daycare',
        startDate: '2026-10-06',
        endDate: '2026-10-06',
        status: 'confirmed',
        source: 'google',
        googleEventId: 'evt-outro',
      },
    ];
    const plano = planCalendarImport([evento({ id: 'evt-sammy-0330', summary: 'Sammy' })], CAES, jaExiste, JANELA);
    expect(conta(plano, 'create')).toBe(0);
    expect(revisoes(plano)[0]).toMatchObject({ reason: 'duplicate' });
  });

  it('duas SÉRIES idênticas do mesmo cão (mesmos dias) = UMA + pendência', () => {
    const serie = ['RRULE:FREQ=WEEKLY;BYDAY=TU'];
    const plano = planCalendarImport(
      [
        evento({ id: 'evt-serie-a', summary: 'Sammy', recurrence: serie }),
        evento({ id: 'evt-serie-b', summary: 'Sammy', recurrence: serie }),
      ],
      CAES,
      [],
      JANELA,
    );
    expect(conta(plano, 'create')).toBe(1);
    expect(revisoes(plano)[0]).toMatchObject({ reason: 'duplicate' });
    // a chave da série é pelos DIAS da semana, não pela data do evento
    expect(kindOf(parseBookingEvents(evento({ id: 'x', summary: 'Sammy', recurrence: serie }), [])[0])).toBe('recurring');
  });

  it('cães de casas diferentes no mesmo dia seguem como duas reservas', () => {
    const plano = planCalendarImport(
      [evento({ id: 'evt-a', summary: 'Sammy' }), evento({ id: 'evt-b', summary: 'Scarlet' })],
      CAES,
      [],
      JANELA,
    );
    expect(conta(plano, 'create')).toBe(2);
    expect(revisoes(plano)).toHaveLength(0);
  });

  it('cão do MESMO dia repetido em serviços de hospedagem (verde + verde) também não duplica', () => {
    const plano = planCalendarImport(
      [evento({ id: 'evt-hotel-a', summary: 'Scarlet', colorId: VERDE }), evento({ id: 'evt-hotel-b', summary: 'Scarlet', colorId: VERDE })],
      CAES,
      [],
      JANELA,
    );
    expect(conta(plano, 'create')).toBe(1);
    expect(revisoes(plano)[0]).toMatchObject({ reason: 'duplicate' });
  });
});
