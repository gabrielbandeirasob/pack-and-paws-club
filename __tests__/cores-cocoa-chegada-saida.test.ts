/**
 * CONTRATO DE CORES — o LADO da hospedagem no COCOA (marrom).
 *
 * O dono ditou em 28/09/2026 (áudio): *"se for o drop-off e for cor cocoa você pode botar ele na lista
 * do daycare do dia"*; *"no dia da saída, se for cocoa, ainda assim o cachorro vai para o daycare,
 * mesmo que ele seja entregue depois do horário de funcionamento na saída"*; e *"na chegada não tem
 * como ele ter chegado antes do daycare"* — ou seja, o dia de CHEGADA com Cocoa é **boarding** (o cão
 * veio para ficar), o dia de SAÍDA com Cocoa e o cão de daycare entregue tarde são **daycare**.
 *
 * O lado é lido da própria sequência do calendário: se a hospedagem (verde/Basil) cobre o dia
 * SEGUINTE ao Cocoa, aquele Cocoa é chegada. Nos dois casos o cão NÃO pede van — quem busca/entrega
 * fora do horário é o administrador, de carro.
 */
import { buildDay, transportPool, vanPool, type ReservationRecord } from '@/features/calendar/dayMath';
import { HEX_COCOA, type EventLabel } from '@/features/calendar/googleColors';
import type { RemoteEvent } from '@/features/integrations/google/calendarSync';
import { coberturaDaHospedagem, planCalendarImport } from '@/features/integrations/google/importPlan';

const labels: EventLabel[] = [
  { id: 'lab-cocoa', name: 'Cocoa', backgroundColor: HEX_COCOA },
  { id: 'lab-basil', name: 'Basil', backgroundColor: '#0b8043' },
  { id: 'lab-peacock', name: 'Peacock', backgroundColor: '#039be5' },
];

const dogs = [{ id: 'kona', name: 'Kona', clientName: 'Sarah' }];
const window = { from: '2026-10-01', to: '2026-10-10' };

const evento = (extra: Partial<RemoteEvent>): RemoteEvent =>
  ({ id: 'e', summary: 'Kona', startDate: '2026-10-01', endDate: '2026-10-01', ...extra }) as RemoteEvent;

const cocoa = (dia: string, id = 'ev-cocoa') => evento({ id, eventLabelId: 'lab-cocoa', startDate: dia, endDate: dia });
const estadia = (de: string, ate: string, id = 'ev-estadia') => evento({ id, eventLabelId: 'lab-basil', startDate: de, endDate: ate });

/** O que o plano decidiu para um evento, por id. */
const decisao = (events: RemoteEvent[], eventId: string) => {
  const plano = planCalendarImport(events, dogs, [], window, { labels });
  return plano.find((item) => item.eventId === eventId) as { kind: string; parsed: { serviceType: string; transportRequired: boolean; startDate: string } } | undefined;
};

describe('COCOA no dia de CHEGADA da hospedagem = boarding', () => {
  // Chegada fora do horário em 01/10 e a estadia (verde/Basil) de 02 a 04/10.
  const events = [cocoa('2026-10-01'), estadia('2026-10-02', '2026-10-04')];

  it('a hospedagem cobre o dia seguinte ao Cocoa — é chegada', () => {
    // O fim do evento no Google é EXCLUSIVO: `2026-10-02..2026-10-04` são os dias 02 e 03.
    expect([...coberturaDaHospedagem(events, labels).get('kona')!].sort()).toEqual(['2026-10-02', '2026-10-03']);
  });

  it('o dia da chegada entra como BOARDING e NUNCA pede van', () => {
    expect(decisao(events, 'ev-cocoa')).toMatchObject({
      kind: 'create',
      parsed: { serviceType: 'boarding', transportRequired: false },
    });
  });

  it('o dia do meio (Basil) também não pede van — o cão já está no hotel', () => {
    expect(decisao(events, 'ev-estadia')).toMatchObject({ kind: 'create', parsed: { serviceType: 'boarding', transportRequired: false } });
  });

  it('no dia do dia: o cão aparece em boarding e NÃO entra na fila de transporte', () => {
    const reserva: ReservationRecord = {
      id: 'res-chegada',
      dog: { id: 'kona', dogName: 'Kona', clientName: 'Sarah' },
      status: 'confirmed',
      serviceType: 'boarding',
      startDate: '2026-10-01',
      endDate: '2026-10-01',
      transportRequired: false,
    };
    const dia = buildDay('2026-10-01', [reserva], []);
    expect(dia.boarding.map((item) => item.dogName)).toEqual(['Kona']);
    expect(dia.daycare).toEqual([]);
    expect(transportPool(dia)).toEqual([]);
    expect(vanPool(dia)).toEqual([]);
  });
});

describe('COCOA no dia de SAÍDA e em dia de daycare = daycare', () => {
  it('saída fora do horário (a estadia ficou para trás) conta como DAYCARE', () => {
    const events = [estadia('2026-10-02', '2026-10-04'), cocoa('2026-10-05', 'ev-saida')];
    expect(decisao(events, 'ev-saida')).toMatchObject({
      kind: 'create',
      parsed: { serviceType: 'daycare', transportRequired: false },
    });
  });

  it('cão de daycare entregue depois do horário (sem hospedagem) conta como DAYCARE', () => {
    expect(decisao([cocoa('2026-10-01', 'ev-daycare')], 'ev-daycare')).toMatchObject({
      kind: 'create',
      parsed: { serviceType: 'daycare', transportRequired: false },
    });
  });

  it('hospedagem que começa no DIA SEGUINTE não faz o Cocoa virar boarding por engano (buraco de um dia)', () => {
    const events = [cocoa('2026-10-01', 'ev-antes'), estadia('2026-10-03', '2026-10-05')];
    expect(decisao(events, 'ev-antes')).toMatchObject({
      kind: 'create',
      parsed: { serviceType: 'daycare', transportRequired: false },
    });
  });
});
