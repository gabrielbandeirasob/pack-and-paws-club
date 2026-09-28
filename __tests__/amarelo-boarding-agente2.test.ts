/**
 * AMARELO = BOARDING (dono, 27/09/2026) — e o vermelho continua cancelando.
 *
 * Resposta literal do dono às duas perguntas do levantamento da paleta:
 *   1. "a cor amarela e os tons que lembram ela é boarding";
 *   2. "vermelho é cancelamento mesmo".
 *
 * O que estes vetores travam, com as cores REAIS do calendário do cliente:
 *  - amarelo da grade nova do Google (Banana 44°, Citron 48°, Mango 37°, Avocado 64°) = boarding;
 *  - amarelo da paleta ANTIGA (colorId 5, Banana) = boarding;
 *  - laranja e marrom seguem FORA (ficam em "cor não reconhecida", o app não chuta): Tangerine 14°,
 *    Pumpkin 27°, Cocoa 16° (marrom) e Birch 31° (bege);
 *  - vermelho continua cancelando (Tomato 0°, Flamingo 5°);
 *  - no plano real: "Scarlet" pintado de amarelo vira reserva de BOARDING; "Mowgli/Kona" em vermelho
 *    cancela os DOIS cães (uma decisão por cão, no mesmo evento).
 */
import { meaningOfLabelColor, meaningOfColor, labelForMovimento, labelForService, readEventColor, TOM_AMARELO } from '@/features/calendar/googleColors';
import {
  planCalendarImport,
  type BookingForImport,
  type DogForImport,
} from '@/features/integrations/google/importPlan';
import type { RemoteEvent } from '@/features/integrations/google/calendarSync';

const JANELA = { from: '2026-09-01', to: '2026-12-31' };

/** As cores do Google que o escritório usa para "amarelo", medidas por hue (a mesma conta do app). */
const AMARELOS = [
  ['Banana', '#F6BF26'],
  ['Citron', '#E4C441'],
  ['Mango', '#F09300'],
  ['Avocado', '#C0CA33'],
] as const;

describe('amarelo (e tons amarelos) = boarding', () => {
  it.each(AMARELOS)('%s (%s) vira boarding', (_nome, hex) => {
    expect(meaningOfLabelColor(hex)).toEqual({ kind: 'service', serviceType: 'boarding' });
  });

  it('a faixa do amarelo é 35°–70° e encosta no verde sem sobrepor', () => {
    expect(TOM_AMARELO).toEqual({ de: 35, ate: 70 });
  });

  it('a paleta ANTIGA também: colorId 5 (Banana, amarelo) = boarding', () => {
    expect(meaningOfColor('5')).toEqual({ kind: 'service', serviceType: 'boarding' });
  });

  it('o espelho separa as duas cores: VERDE na estadia, AMARELA no dia de chegada/saída (dono, 28/09/2026)', () => {
    const labels = [
      { id: '10', name: 'Banana', backgroundColor: '#F6BF26' },
      { id: '13', name: 'Sage', backgroundColor: '#33B679' },
    ];
    expect(labelForService(labels, 'boarding')?.name).toBe('Sage');
    expect(labelForMovimento(labels)?.name).toBe('Banana');
  });

  it('laranja e bege continuam SEM significado; o MARROM (Cocoa) virou fora de horário em 28/09/2026', () => {
    for (const [nome, hex] of [['Tangerine', '#F4511E'], ['Pumpkin', '#EF6C00'], ['Birch', '#A79B8E']] as const) {
      expect([nome, meaningOfLabelColor(hex)]).toEqual([nome, null]);
    }
    expect(meaningOfLabelColor('#795548')).toEqual({ kind: 'out_of_hours' });
  });
});

describe('vermelho continua cancelamento (confirmado pelo dono)', () => {
  it.each([['Tomato', '#D50000'], ['Flamingo', '#E67C73']] as const)('%s (%s) cancela', (_nome, hex) => {
    expect(meaningOfLabelColor(hex)).toEqual({ kind: 'cancel' });
  });

  it('o tom do amarelo NÃO cancela e o do vermelho NÃO vira boarding', () => {
    expect(meaningOfLabelColor('#F6BF26')?.kind).toBe('service');
    expect(meaningOfLabelColor('#D50000')?.kind).toBe('cancel');
  });
});

describe('no plano real do calendário', () => {
  const CAES: DogForImport[] = [
    { id: 'dog-scarlet', name: 'Scarlet', clientName: 'Tori' },
    { id: 'dog-mowgli', name: 'Mowgli', clientName: 'Leigh Ann' },
    { id: 'dog-kona', name: 'Kona', clientName: 'Leigh Ann' },
  ];
  const AMARELO = { id: 'lab-banana', name: 'Banana', backgroundColor: '#F6BF26' };
  const VERMELHO = { id: 'lab-tomato', name: 'Tomato', backgroundColor: '#D50000' };

  function evento(parcial: Partial<RemoteEvent> & { id: string }): RemoteEvent {
    return {
      summary: '',
      startDate: '2026-09-25',
      endDate: '2026-09-26',
      appKey: null,
      colorId: null,
      recurrence: null,
      ...parcial,
    };
  }

  const RESERVAS: BookingForImport[] = [
    {
      id: 'res-mowgli', kind: 'reservation', dogId: 'dog-mowgli', googleEventId: null, source: 'app',
      serviceType: 'daycare', startDate: '2026-09-25', endDate: '2026-09-25', status: 'confirmed',
    },
    {
      id: 'res-kona', kind: 'reservation', dogId: 'dog-kona', googleEventId: null, source: 'app',
      serviceType: 'daycare', startDate: '2026-09-25', endDate: '2026-09-25', status: 'confirmed',
    },
  ];

  it('"Scarlet (Daycare)" pintado de AMARELO entra como reserva de BOARDING', () => {
    const plano = planCalendarImport([evento({ id: 'ev-scarlet', summary: 'Scarlet (Daycare)', eventLabelId: AMARELO.id })],
      CAES, [], JANELA, { labels: [AMARELO] });
    expect(plano[0]).toMatchObject({ kind: 'create', dogId: 'dog-scarlet', parsed: { serviceType: 'boarding' } });
  });

  it('"Mowgli/Kona" em VERMELHO cancela os DOIS cães do mesmo evento', () => {
    const plano = planCalendarImport([evento({ id: 'ev-vermelho', summary: 'Mowgli/Kona', eventLabelId: VERMELHO.id })],
      CAES, RESERVAS, JANELA, { labels: [VERMELHO] });
    expect(plano).toHaveLength(2);
    expect(plano.map((item) => item.kind)).toEqual(['cancel', 'cancel']);
    expect(plano.map((item) => (item.kind === 'cancel' ? item.bookingId : null)).sort()).toEqual(['res-kona', 'res-mowgli']);
  });

  it('a leitura da etiqueta amarela mostra que a ETIQUETA mandou', () => {
    const lido = readEventColor({ eventLabelId: AMARELO.id, colorId: '5' }, [AMARELO]);
    expect(lido.source).toBe('label');
    expect(lido.meaning).toEqual({ kind: 'service', serviceType: 'boarding' });
  });
});
