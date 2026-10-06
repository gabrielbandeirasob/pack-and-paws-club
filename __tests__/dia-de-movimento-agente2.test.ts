/**
 * DIA DE MOVIMENTO da hospedagem na reserva — decisão do dono (06/10/2026), a partir da simulação do
 * print do calendário do CLIENTE daquele dia.
 *
 * O que o print mostrou: a Scarlet aparece duas vezes no mesmo dia — barra AZUL (day care) e barra
 * AVOCADO com o emoji de casa (chegada/saída da hospedagem). Palavra do dono: *"a Scarlet vai poder
 * entrar no pickup do day care normalmente e ela não vai poder entrar no drop off, pois vai virar
 * boarding"*.
 *
 * O problema que estes vetores travam: o `transport_required` do dia de CHEGADA (avocado) e o do dia de
 * HOTEL (verde) são IGUAIS (no dia de hotel o app restaura a van quando o calendário não marca
 * chegada/saída), então o Dispatch tratava os dois como "já está na van" — e o cão que está na casa, com
 * o motorista tendo de buscá-lo, ficava FORA da fila de pickup.
 *
 * Regra que passou a valer (migração `202610060041`, coluna `movement_day`):
 *  - dia de CHEGADA/SAÍDA (avocado/amarelo) = `movementDay: true` → parada normal da rota (pickup) e
 *    NUNCA entrega;
 *  - dia de HOTEL (verde) e reserva antiga sem a marca = comportamento de sempre ("já está na van").
 */
import {
  parseBookingEvents,
  planCalendarImport,
  type DogForImport,
  type ImportOutcome,
} from '@/features/integrations/google/importPlan';
import type { RemoteEvent } from '@/features/integrations/google/eventMarkers';
import { buildDay, dogsJaNaVan, transportPoolForPhase, vanPool, type ReservationRecord } from '@/features/calendar/dayMath';

const JANELA = { from: '2026-10-06', to: '2026-12-31' };
const AZUL = '7'; // Peacock -> day care
const AVOCADO = '5'; // Banana -> hospedagem no dia de CHEGADA/SAÍDA (o "avocado" do escritório)
const VERDE = '2'; // Sage -> dia de HOTEL da hospedagem

const CAES: DogForImport[] = [
  { id: 'dog-scarlet', name: 'Scarlet', clientName: 'Brian' },
  { id: 'dog-levim', name: 'Levi M', clientName: 'Alissia Miller' },
];

const evento = (parcial: Partial<RemoteEvent> & { id: string }): RemoteEvent => ({
  summary: 'Scarlet',
  startDate: '2026-10-06',
  endDate: '2026-10-07',
  appKey: null,
  colorId: AVOCADO,
  recurrence: null,
  ...parcial,
});

const reserva = (id: string, tipo: 'daycare' | 'boarding', extra: Partial<ReservationRecord> = {}): ReservationRecord => ({
  id,
  status: 'confirmed',
  serviceType: tipo,
  startDate: '2026-10-06',
  endDate: '2026-10-06',
  transportRequired: true,
  goesToDaycare: true,
  dog: { id: 'dog-scarlet', dogName: 'Scarlet', clientName: 'Brian' },
  ...extra,
});

const nomes = (lista: { dogName: string }[]) => lista.map((d) => d.dogName);

describe('o que a COR diz sobre o dia (leitura do evento)', () => {
  it('avocado/amarelo = dia de CHEGADA/SAÍDA: marca o dia de movimento', () => {
    const [lido] = parseBookingEvents(evento({ id: 'e1' }), []);
    expect(lido).toMatchObject({ serviceType: 'boarding', transportRequired: true, movementDay: true });
  });

  it('verde (dia de hotel) NÃO é dia de movimento', () => {
    const [lido] = parseBookingEvents(evento({ id: 'e1', colorId: VERDE }), []);
    expect(lido).toMatchObject({ serviceType: 'boarding', movementDay: false });
  });

  it('day care não é dia de movimento', () => {
    const [lido] = parseBookingEvents(evento({ id: 'e1', colorId: AZUL }), []);
    expect(lido).toMatchObject({ serviceType: 'daycare', movementDay: false });
  });

  it('a GUARDA do dia de hotel continua: sem chegada/saída marcada, a van volta — mas a marca do dia de movimento NÃO', () => {
    const plano = planCalendarImport([evento({ id: 'e1', colorId: VERDE })], CAES, [], JANELA);
    const criada = plano.find((o): o is Extract<ImportOutcome, { kind: 'create' }> => o.kind === 'create');
    expect(criada?.parsed).toMatchObject({ transportRequired: true, movementDay: false });
  });
});

describe('o que o DIA faz com a marca (Dispatch)', () => {
  it('dia de CHEGADA (avocado): entra na fila de pickup e NÃO entra na entrega', () => {
    const dia = buildDay('2026-10-06', [reserva('r1', 'daycare'), reserva('r2', 'boarding', { movementDay: true })], [], []);
    expect(dogsJaNaVan(dia).has('dog-scarlet')).toBe(false);
    expect(nomes(transportPoolForPhase(dia, 'pickup'))).toEqual(['Scarlet']);
    expect(nomes(transportPoolForPhase(dia, 'dropoff'))).toEqual([]);
    expect(nomes(vanPool(dia))).toEqual([]);
  });

  it('dia de HOTEL (verde): continua "já está na van" e fora da rota', () => {
    const dia = buildDay('2026-10-06', [reserva('r1', 'daycare'), reserva('r2', 'boarding', { movementDay: false })], [], []);
    expect(dogsJaNaVan(dia).has('dog-scarlet')).toBe(true);
    expect(nomes(transportPoolForPhase(dia, 'pickup'))).toEqual([]);
    expect(nomes(transportPoolForPhase(dia, 'dropoff'))).toEqual([]);
    expect(nomes(vanPool(dia))).toEqual(['Scarlet']);
  });

  it('reserva antiga (sem a marca) segue o comportamento de sempre', () => {
    const dia = buildDay('2026-10-06', [reserva('r2', 'boarding')], [], []);
    expect(dogsJaNaVan(dia).has('dog-scarlet')).toBe(true);
    expect(nomes(vanPool(dia))).toEqual(['Scarlet']);
  });

  it('o cão de chegada aparece UMA vez na fila, mesmo com day care + hospedagem no mesmo dia', () => {
    const dia = buildDay('2026-10-06', [reserva('r1', 'daycare'), reserva('r2', 'boarding', { movementDay: true })], [], []);
    expect(transportPoolForPhase(dia, 'pickup')).toHaveLength(1);
  });

  it('dia de HOTEL de OUTRO cão não é afetado pela marca do vizinho', () => {
    const dia = buildDay(
      '2026-10-06',
      [
        reserva('r1', 'boarding', { movementDay: true }),
        reserva('r2', 'boarding', { dog: { id: 'dog-levim', dogName: 'Levi M', clientName: 'Alissia Miller' } }),
      ],
      [],
      [],
    );
    expect(nomes(transportPoolForPhase(dia, 'pickup'))).toEqual(['Scarlet']);
    expect(nomes(vanPool(dia))).toEqual(['Levi M']);
  });
});
