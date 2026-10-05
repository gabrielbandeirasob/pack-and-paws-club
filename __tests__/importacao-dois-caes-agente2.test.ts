/**
 * CASA COM DOIS CÃES — pedido da operação (26/09/2026, áudio de 41 s):
 *
 *   "o aplicativo tem que ler o calendário e quando tiver dois cachorros (…) ele põe o nome de um
 *    cachorro, barra o nome de outro cachorro, então ele tem que identificar que são os dois
 *    cachorros (…) como eles vão estar na mesma casa, é só uma parada (…) e vai ter dia que só um
 *    deles vai — então o calendário vai estar só o nome do cachorro que vai."
 *
 * O que estes vetores travam:
 *  - `Cão A/Cão B` (barra colada OU com espaços) = DOIS cães; `·` continua sendo separador de CAMPO
 *    da convenção do app ("Daycare · Bella (Leigh Ann)" é UM cão);
 *  - cada cão vira a SUA decisão: dois cães cadastrados = duas reservas no mesmo dia;
 *  - um cadastrado e outro não = uma reserva + uma pendência "not registered" do outro;
 *  - título com um nome só continua gerando UMA reserva (o dia em que só um deles vai);
 *  - o mesmo cão repetido ("Kona/Kona") não duplica.
 */
import {
  dogNameFromTitle,
  dogNamesFromTitle,
  parseBookingEvents,
  planCalendarImport,
  type BookingForImport,
  type DogForImport,
} from '@/features/integrations/google/importPlan';
import type { RemoteEvent } from '@/features/integrations/google/eventMarkers';

const JANELA = { from: '2026-09-01', to: '2026-12-31' };
const AZUL = '7'; // Peacock -> daycare

function evento(parcial: Partial<RemoteEvent> & { id: string }): RemoteEvent {
  return { summary: '', startDate: '2026-09-25', endDate: '2026-09-26', appKey: null, colorId: AZUL, recurrence: null, ...parcial };
}

/** Os dois cães da MESMA casa (Leigh Ann) + um de outra casa. */
const CAES: DogForImport[] = [
  { id: 'dog-mowgli', name: 'Mowgli', clientName: 'Leigh Ann' },
  { id: 'dog-kona', name: 'Kona', clientName: 'Leigh Ann' },
  { id: 'dog-skylar', name: 'Skylar', clientName: 'Tori' },
  { id: 'dog-milo', name: 'Milo', clientName: 'Tori' },
];

function semReservas(): BookingForImport[] {
  return [];
}

describe('título com dois cães ("A/B")', () => {
  it('lê os DOIS nomes com a barra colada (o formato que o escritório usa)', () => {
    expect(dogNamesFromTitle('Mowgli/Kona')).toEqual(['Mowgli', 'Kona']);
    expect(dogNamesFromTitle('Skylar/Milo (Daycare)')).toEqual(['Skylar', 'Milo']);
    expect(dogNamesFromTitle('Mowgli / Kona')).toEqual(['Mowgli', 'Kona']);
  });

  it('não confunde o separador de CAMPO do app (·) com a barra', () => {
    expect(dogNamesFromTitle('Daycare · Bella (Leigh Ann)')).toEqual(['Bella']);
    expect(dogNamesFromTitle('Daycare - Enso (Akmal)')).toEqual(['Enso']);
    expect(dogNamesFromTitle('Kona — Leigh Ann')).toEqual(['Kona']);
  });

  it('um nome só continua sendo um cão', () => {
    expect(dogNamesFromTitle('Mowgli')).toEqual(['Mowgli']);
    expect(dogNamesFromTitle('Honey Bea')).toEqual(['Honey Bea']);
    expect(dogNamesFromTitle('ROTAS FIXAS')).toEqual(['ROTAS FIXAS']);
    expect(dogNameFromTitle('Bella (Leigh Ann)')).toBe('Bella');
  });

  it('o mesmo cão duas vezes não vira dois', () => {
    expect(dogNamesFromTitle('Kona/Kona')).toEqual(['Kona']);
  });

  it('traduz o evento em UM agendamento por cão', () => {
    const lidos = parseBookingEvents(evento({ id: 'ev-1', summary: 'Mowgli/Kona' }));
    expect(lidos.map((item) => item.dogName)).toEqual(['Mowgli', 'Kona']);
    expect(lidos.every((item) => item.serviceType === 'daycare')).toBe(true);
  });
});

describe('plano da importação com dois cães', () => {
  it('cria UMA reserva para CADA cão (mesmo dia, mesma casa)', () => {
    const plano = planCalendarImport([evento({ id: 'ev-1', summary: 'Mowgli/Kona' })], CAES, semReservas(), JANELA);
    const criados = plano.filter((item) => item.kind === 'create');
    expect(criados).toHaveLength(2);
    expect(criados.map((item) => item.dogId).sort()).toEqual(['dog-kona', 'dog-mowgli']);
    expect(criados.every((item) => item.parsed.startDate === '2026-09-25')).toBe(true);
    expect(criados.every((item) => item.parsed.serviceType === 'daycare')).toBe(true);
  });

  it('um cão cadastrado e o outro não: uma reserva e uma pendência do que falta cadastrar', () => {
    const caes = CAES.filter((cao) => cao.id !== 'dog-milo');
    const plano = planCalendarImport([evento({ id: 'ev-2', summary: 'Skylar/Milo (Daycare)' })], caes, semReservas(), JANELA);
    expect(plano.filter((item) => item.kind === 'create').map((item) => item.dogId)).toEqual(['dog-skylar']);
    const pendencias = plano.filter((item) => item.kind === 'review');
    expect(pendencias).toHaveLength(1);
    expect(pendencias[0].parsed?.dogName).toBe('Milo');
    expect(pendencias[0].reason).toBe('unknown dog');
  });

  it('no dia em que só um vai, o título traz um nome e nasce UMA reserva', () => {
    const plano = planCalendarImport([evento({ id: 'ev-3', summary: 'Kona' })], CAES, semReservas(), JANELA);
    const criados = plano.filter((item) => item.kind === 'create');
    expect(criados).toHaveLength(1);
    expect(criados[0].dogId).toBe('dog-kona');
  });
});
