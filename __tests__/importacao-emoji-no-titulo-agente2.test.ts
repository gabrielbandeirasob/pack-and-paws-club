/**
 * EMOJI COLADO NO NOME — achado da simulação do print do cliente (06/10/2026).
 *
 * A barra das 2PM é `Scarlet 🏠` (o escritório escreve o emoji de casa junto do nome). O app lia o nome
 * como `"Scarlet 🏠"`, não casava com o cadastro da `Scarlet` e o dia de chegada/saída dela caía na lista
 * de pendências **"não cadastrado"** — medido no fixture, com o código de produção.
 *
 * Decisão do dono no mesmo dia: *"o emoji tem um significado para o cliente"* — ou seja, NÃO é lixo: o
 * significado continua vindo da cor e das reservas do dia (o `🏠` = o cão não vai ser entregue na casa, e
 * quem cuida disso é a reserva de hospedagem do dia, que já tira o cão da entrega). O que o emoji NÃO pode
 * é virar parte do NOME. Limpa-se só a PONTA: o miolo fica intacto para não destruir separador de nome.
 */
import {
  dogNamesFromTitle,
  parseBookingEvents,
  planCalendarImport,
  type DogForImport,
  type ImportOutcome,
} from '@/features/integrations/google/importPlan';
import type { RemoteEvent } from '@/features/integrations/google/eventMarkers';

const JANELA = { from: '2026-10-06', to: '2026-12-31' };
const AZUL = '7'; // Peacock -> day care
const AVOCADO = '5'; // Banana -> hospedagem no dia de chegada/saída (anda de van)

const CAES: DogForImport[] = [
  { id: 'dog-scarlet', name: 'Scarlet', clientName: 'Brian' },
  { id: 'dog-honeybea', name: 'Honey Bea', clientName: 'Sam wald' },
  { id: 'dog-mowgli', name: 'Mowgli', clientName: 'Leigh Ann' },
  { id: 'dog-kona', name: 'Kona', clientName: 'Leigh Ann' },
];

const evento = (parcial: Partial<RemoteEvent> & { id: string }): RemoteEvent => ({
  summary: '',
  startDate: '2026-10-06',
  endDate: '2026-10-07',
  appKey: null,
  colorId: AZUL,
  recurrence: null,
  ...parcial,
});

describe('emoji colado no nome do título', () => {
  it('lê o NOME sem o emoji (o caso do print: Scarlet 🏠)', () => {
    expect(dogNamesFromTitle('Scarlet 🏠')).toEqual(['Scarlet']);
    expect(dogNamesFromTitle('Honey bea 🏠')).toEqual(['Honey bea']);
    expect(dogNamesFromTitle('🐶 Bella')).toEqual(['Bella']);
  });

  it('vale também no título de dois cães', () => {
    expect(dogNamesFromTitle('Mowgli 🐶/Kona')).toEqual(['Mowgli', 'Kona']);
    expect(dogNamesFromTitle('Mowgli/Kona 🏠')).toEqual(['Mowgli', 'Kona']);
  });

  it('não estraga nome legítimo (espaço, ponto, hífen, acento)', () => {
    expect(dogNamesFromTitle('Honey Bea')).toEqual(['Honey Bea']);
    expect(dogNamesFromTitle('Levi M')).toEqual(['Levi M']);
    expect(dogNamesFromTitle('Tarot rose')).toEqual(['Tarot rose']);
    expect(dogNamesFromTitle('Penélope')).toEqual(['Penélope']);
    expect(dogNamesFromTitle('Kona — Leigh Ann')).toEqual(['Kona']);
    expect(dogNamesFromTitle('Skylar/Milo (Daycare)')).toEqual(['Skylar', 'Milo']);
    expect(dogNamesFromTitle('Silvye/Agnes')).toEqual(['Silvye', 'Agnes']);
  });

  it('o evento com emoji vira a reserva do cão CERTO (não vai para "não cadastrado")', () => {
    const eventos = [
      evento({ id: 'evt-1am', summary: 'Scarlet' }),
      evento({ id: 'evt-2pm', summary: 'Scarlet 🏠', colorId: AVOCADO }),
    ];
    const plano = planCalendarImport(eventos, CAES, [], JANELA);
    const criadas = plano.filter((o): o is Extract<ImportOutcome, { kind: 'create' }> => o.kind === 'create');

    expect(criadas).toHaveLength(2);
    expect(criadas.map((o) => o.dogId)).toEqual(['dog-scarlet', 'dog-scarlet']);
    expect(criadas.map((o) => o.parsed.serviceType).sort()).toEqual(['boarding', 'daycare']);
    expect(plano.filter((o) => o.kind === 'review')).toHaveLength(0);
  });

  it('o emoji do marcador do dia (BOARDING 🐶) continua não virando cão', () => {
    const lidos = parseBookingEvents(evento({ id: 'evt-marcador', summary: 'BOARDING 🐶' }), []);
    expect(lidos).toHaveLength(0);
  });
});
