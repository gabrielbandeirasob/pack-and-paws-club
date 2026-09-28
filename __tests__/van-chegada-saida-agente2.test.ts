/**
 * CHEGADA / HOTEL / SAÍDA na van — pedido do escritório (áudios de 27/09/2026):
 *
 *   "é verde claro, que a cor aqui no calendário chama avocado, indica chegada e saída (…) os dias
 *    seguintes vai estar verde escuro, que é a cor que chama Basil" / "Muito provavelmente na chegada
 *    (…) ele aparece para fazer o pick up como se fosse um dog de daycare, então o motorista vai ter o
 *    dog lá para buscar" / "E na saída também, se for durante o horário, ele vai sair na lista de drop
 *    off do motorista."
 *
 * O que estes vetores travam:
 *  - AMARELO/verde-claro (avocado) = dia de CHEGADA ou SAÍDA → com van (pick up na chegada, drop off na
 *    saída);
 *  - VERDE (Basil/Sage) = dia de hotel → SEM van;
 *  - a guarda: o dia de hotel só perde a van quando aquele cão tem chegada/saída (amarelo) marcada na
 *    janela — calendário que ainda não usa a convenção continua como sempre foi;
 *  - day care (azul) continua com van, sempre;
 *  - na paleta antiga, o amarelo é o `colorId` 5 (Banana) → também é dia de chegada/saída.
 */
import { movimentaOCao, readEventColor, tomDeMovimento } from '@/features/calendar/googleColors';
import { supabaseImportPorts } from '@/features/integrations/google/importPorts';
import { planCalendarImport, type BookingForImport, type DogForImport, type ParsedBooking } from '@/features/integrations/google/importPlan';
import type { RemoteEvent } from '@/features/integrations/google/calendarSync';

const JANELA = { from: '2026-09-01', to: '2026-12-31' };

const AVOCADO = { id: 'lab-avocado', name: 'Avocado', backgroundColor: '#C0CA33' };
const BASIL = { id: 'lab-basil', name: 'Basil', backgroundColor: '#0B8043' };
const SAGE = { id: 'lab-sage', name: 'Sage', backgroundColor: '#33B679' };
const PEACOCK = { id: 'lab-peacock', name: 'Peacock', backgroundColor: '#039BE5' };
const AMARELO_LEGADO = '5'; // Banana, paleta antiga
const VERDE_LEGADO = '2'; // Sage, paleta antiga

const CAES: DogForImport[] = [
  { id: 'dog-levi', name: 'Levi M', clientName: 'Leigh Ann' },
  { id: 'dog-chutney', name: 'Chutney', clientName: 'Tori' },
];

function evento(parcial: Partial<RemoteEvent> & { id: string }): RemoteEvent {
  return {
    summary: 'Levi M',
    startDate: '2026-09-25',
    endDate: '2026-09-26',
    appKey: null,
    colorId: null,
    recurrence: null,
    ...parcial,
  };
}

describe('a cor diz se o cão anda nesse dia', () => {
  it.each([['Avocado', '#C0CA33'], ['Banana', '#F6BF26'], ['Citron', '#E4C441']] as const)(
    '%s (amarelo/verde-claro) = dia de chegada/saída',
    (_nome, hex) => {
      expect(tomDeMovimento(hex)).toBe(true);
    },
  );

  it.each([['Basil', '#0B8043'], ['Sage', '#33B679'], ['Pistachio', '#7CB342']] as const)(
    '%s (verde) = dia de hotel',
    (_nome, hex) => {
      expect(tomDeMovimento(hex)).toBe(false);
    },
  );

  it('day care não responde essa pergunta (null) — o cão sempre anda', () => {
    const lido = readEventColor({ eventLabelId: PEACOCK.id }, [PEACOCK]);
    expect(movimentaOCao(lido)).toBeNull();
  });

  it('na paleta antiga, o amarelo (colorId 5) também é dia de chegada/saída', () => {
    expect(movimentaOCao(readEventColor({ colorId: AMARELO_LEGADO }))).toBe(true);
    expect(movimentaOCao(readEventColor({ colorId: VERDE_LEGADO }))).toBe(false);
  });
});

describe('plano: quem entra na van', () => {
  function plano(eventos: RemoteEvent[], reservas: BookingForImport[] = []) {
    return planCalendarImport(eventos, CAES, reservas, JANELA, { labels: [AVOCADO, BASIL, SAGE, PEACOCK] });
  }

  const chegada = evento({ id: 'ev-chegada', summary: 'Levi M', eventLabelId: AVOCADO.id, startDate: '2026-09-25', endDate: '2026-09-26' });
  const hotel = evento({ id: 'ev-hotel', summary: 'Levi M', eventLabelId: BASIL.id, startDate: '2026-09-26', endDate: '2026-09-27' });
  const saida = evento({ id: 'ev-saida', summary: 'Levi M', eventLabelId: AVOCADO.id, startDate: '2026-09-28', endDate: '2026-09-29' });

  it('chegada (amarelo) entra COM van — o motorista busca o cão', () => {
    const [item] = plano([chegada]);
    expect(item).toMatchObject({ kind: 'create', parsed: { serviceType: 'boarding', transportRequired: true } });
  });

  it('dia de hotel (verde) do MESMO cão, que tem chegada na janela, entra SEM van', () => {
    const saida = plano([chegada, hotel]).find((item) => item.kind === 'create' && item.eventId === 'ev-hotel');
    expect(saida).toMatchObject({ kind: 'create', parsed: { serviceType: 'boarding', transportRequired: false } });
  });

  it('a chegada continua com van mesmo com o dia de hotel no meio', () => {
    const criar = plano([chegada, hotel]).filter((item) => item.kind === 'create');
    expect(criar.map((item) => (item.kind === 'create' ? item.parsed.transportRequired : null))).toEqual([true, false]);
  });

  it('GUARDA: verde sozinho (cão sem chegada/saída marcada) continua entrando na van', () => {
    const [item] = plano([hotel]);
    expect(item).toMatchObject({ kind: 'create', parsed: { transportRequired: true } });
  });

  it('a saída também é dia de van (drop off)', () => {
    const criar = plano([chegada, hotel, saida]).filter((item) => item.kind === 'create');
    expect(criar.map((item) => (item.kind === 'create' ? item.parsed.transportRequired : null))).toEqual([true, false, true]);
  });

  it('o day care (azul) nunca perde a van', () => {
    const dc = evento({ id: 'ev-dc', summary: 'Chutney', eventLabelId: PEACOCK.id });
    const [item] = plano([dc]);
    expect(item).toMatchObject({ kind: 'create', parsed: { serviceType: 'daycare', transportRequired: true } });
  });
});

/** O `transport_required` que sai no banco é o do plano — não o `true` cravado de antes. */
describe('portas do banco: o dia de hotel é gravado sem transporte', () => {
  function clienteFalso(linhas: Record<string, unknown>[]) {
    return {
      from: (tabela: string) => ({
        insert: (linha: Record<string, unknown> | Record<string, unknown>[]) => {
          for (const registro of Array.isArray(linha) ? linha : [linha]) linhas.push({ tabela, ...registro });
          return { error: null, select: () => ({ single: async () => ({ data: { id: 'criado-1' }, error: null }) }) };
        },
        delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
      }),
    } as never;
  }

  function lido(transportRequired: boolean): ParsedBooking {
    return {
      serviceType: 'boarding',
      goesToDaycare: true,
      color: { source: 'label', labelId: BASIL.id, labelName: 'Basil', backgroundColor: BASIL.backgroundColor, colorId: null, meaning: { kind: 'service', serviceType: 'boarding' } },
      cancels: false,
      transportRequired,
      dogName: 'Levi M',
      startDate: '2026-09-26',
      endDate: '2026-09-26',
      weekdays: [],
      skipDates: [],
      openEnded: false,
    };
  }

  it('dia de hotel entra com transport_required false', async () => {
    const linhas: Record<string, unknown>[] = [];
    const ports = supabaseImportPorts(clienteFalso(linhas), 'org-1');
    await ports.createBooking({ eventId: 'ev-hotel', dogId: 'dog-levi', kind: 'reservation', parsed: lido(false) });
    expect(linhas[0]).toMatchObject({ tabela: 'reservations', service_type: 'boarding', transport_required: false });
  });

  it('dia de chegada/saída entra com transport_required true', async () => {
    const linhas: Record<string, unknown>[] = [];
    const ports = supabaseImportPorts(clienteFalso(linhas), 'org-1');
    await ports.createBooking({ eventId: 'ev-chegada', dogId: 'dog-levi', kind: 'reservation', parsed: lido(true) });
    expect(linhas[0]).toMatchObject({ tabela: 'reservations', transport_required: true });
  });

  it('parsed antigo (sem o campo) continua entrando com transporte — nada quebra', async () => {
    const linhas: Record<string, unknown>[] = [];
    const ports = supabaseImportPorts(clienteFalso(linhas), 'org-1');
    const semCampo = { ...lido(true) };
    delete (semCampo as { transportRequired?: boolean }).transportRequired;
    await ports.createBooking({ eventId: 'ev-antigo', dogId: 'dog-levi', kind: 'reservation', parsed: semCampo });
    expect(linhas[0]).toMatchObject({ tabela: 'reservations', transport_required: true });
  });
});
