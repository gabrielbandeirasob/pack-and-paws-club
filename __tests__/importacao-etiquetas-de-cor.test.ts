/**
 * IMPORTAÇÃO POR ETIQUETA DE COR (bug 56, 25/09/2026) — o caminho REAL, como o app faz:
 * recurso cru da API do Google -> `parseEvent` -> `planCalendarImport`, com as etiquetas do calendário.
 *
 * O defeito de produção (build 55): o escritório pintou o evento do cão `zara` com o tom "Cobalto"
 * (#4A86E8) — paleta NOVA do Google. A chamada não levava `eventLabelVersion=1`, então a API devolvia
 * o evento **sem `colorId`** e o parser (corretamente) não chutava serviço: o agendamento do cão
 * cadastrado caía em "cor não reconhecida" e não virava reserva. O evento `pietro`, pintado com a
 * paleta ANTIGA, entrou normalmente no mesmo Sync — a cor nova era a única coisa que falhava.
 *
 * Vetores (o que o dono decidiu em 24/09 e continua valendo com etiqueta):
 *  - etiqueta VERDE -> boarding;
 *  - etiqueta AZUL (o "Cobalto" do cliente) -> daycare;
 *  - etiqueta VERMELHA -> cancela a reserva daquele dia;
 *  - etiqueta de tom NÃO mapeado (amarelo) -> "cor não reconhecida", sem chute;
 *  - evento sem etiqueta E sem `colorId` -> "cor não reconhecida";
 *  - paleta ANTIGA (`colorId`) continua funcionando como fallback;
 *  - a pendência carrega o que foi LIDO (nome da etiqueta + hex) para o suporte.
 */
import { parseEvent } from '@/features/integrations/google/calendarApi';
import { planCalendarImport, type BookingForImport, type DogForImport, type ImportOutcome } from '@/features/integrations/google/importPlan';
import type { EventLabel } from '@/features/calendar/googleColors';

const HOJE = '2026-09-25';
const JANELA = { from: HOJE, to: '2027-03-24' };

const COBALTO = '#4A86E8'; // azul — o tom do print do cliente
const SAGE = '#33b679'; // verde
const TOMATO = '#e67c73'; // vermelho
const BANANA = '#ffd666'; // amarelo (não mapeado)

/** Etiquetas do calendário do escritório, como a API devolve. */
const ETIQUETAS: EventLabel[] = [
  { id: 'lab-cobalto', name: 'Cobalto', backgroundColor: COBALTO },
  { id: 'lab-sage', name: 'Verde', backgroundColor: SAGE },
  { id: 'lab-tomato', name: 'Vermelho', backgroundColor: TOMATO },
  { id: 'lab-banana', name: 'Amarelo', backgroundColor: BANANA },
];

const ZARA: DogForImport = { id: 'dog-zara', name: 'Zara', clientName: 'Zara kot' };

/** Evento como a API devolve quando a chamada leva `eventLabelVersion=1` (dia inteiro). */
function recurso(eventNo: number, summary: string, extra: Record<string, unknown> = {}) {
  return {
    id: `ev-${eventNo}`,
    summary,
    start: { date: '2026-09-26' },
    end: { date: '2026-09-27' },
    ...extra,
  };
}

function plano(recursos: ReturnType<typeof recurso>[], dogs: DogForImport[] = [ZARA], reservas: BookingForImport[] = [], etiquetas: EventLabel[] = ETIQUETAS) {
  const eventos = recursos.map((item) => parseEvent(item as never));
  return planCalendarImport(eventos, dogs, reservas, JANELA, { labels: etiquetas });
}

function soUm<T extends ImportOutcome['kind']>(saida: ImportOutcome[], kind: T) {
  const itens = saida.filter((item) => item.kind === kind);
  expect(itens).toHaveLength(1);
  return itens[0] as Extract<ImportOutcome, { kind: T }>;
}

describe('etiqueta de cor -> serviço da reserva (paleta NOVA do Google)', () => {
  it('AZUL ("Cobalto", o caso do cão zara) com cão cadastrado vira reserva de DAYCARE', () => {
    const saida = plano([recurso(1, 'Zara', { eventLabelId: 'lab-cobalto' })]);
    const criada = soUm(saida, 'create');

    expect(criada.dogId).toBe('dog-zara');
    expect(criada.parsed.serviceType).toBe('daycare');
    // Sem `colorId` (a paleta nova não manda um): era EXATAMENTE isso que fazia o evento cair em
    // "cor não reconhecida" antes desta correção.
    expect(criada.parsed.color).toMatchObject({ source: 'label', labelName: 'Cobalto', backgroundColor: COBALTO, colorId: null });
  });

  it('etiqueta VERDE com cão cadastrado vira reserva de BOARDING', () => {
    const saida = plano([recurso(2, 'Zara', { eventLabelId: 'lab-sage' })]);
    expect(soUm(saida, 'create').parsed.serviceType).toBe('boarding');
  });

  it('etiqueta VERMELHA cancela a reserva daquele cão naquele dia', () => {
    const reserva: BookingForImport = {
      id: 'res-zara',
      kind: 'reservation',
      dogId: 'dog-zara',
      googleEventId: 'ev-3',
      source: 'google',
      serviceType: 'daycare',
      startDate: '2026-09-26',
      endDate: '2026-09-26',
      weekdays: null,
      status: 'confirmed',
    };
    const saida = plano([recurso(3, 'Zara', { eventLabelId: 'lab-tomato' })], [ZARA], [reserva]);
    expect(soUm(saida, 'cancel').bookingId).toBe('res-zara');
  });

  it('etiqueta de tom NÃO mapeado (amarelo) não chuta serviço e volta para a lista, com o que foi lido', () => {
    const saida = plano([recurso(4, 'Zara', { eventLabelId: 'lab-banana' })]);
    const pendencia = soUm(saida, 'review');

    expect(pendencia.reason).toBe('unrecognized color');
    expect(pendencia.parsed.serviceType).toBeNull();
    expect(pendencia.parsed.color).toMatchObject({ labelName: 'Amarelo', backgroundColor: BANANA });
  });

  it('evento SEM etiqueta e SEM colorId (o "sem cor" de sempre) também vai para a lista', () => {
    const saida = plano([recurso(5, 'Zara')]);
    const pendencia = soUm(saida, 'review');

    expect(pendencia.reason).toBe('unrecognized color');
    expect(pendencia.parsed.color).toMatchObject({ source: 'none', labelId: null, colorId: null });
  });

  it('a paleta ANTIGA (`colorId`) continua valendo como fallback para evento sem etiqueta', () => {
    expect(soUm(plano([recurso(6, 'Zara', { colorId: '2' })]), 'create').parsed.serviceType).toBe('boarding');
    // O evento `pietro` da produção: verde da paleta velha, importado como boarding no mesmo Sync.
    expect(soUm(plano([recurso(7, 'Zara', { colorId: '7' })]), 'create').parsed.serviceType).toBe('daycare');
  });

  it('sem a lista de etiquetas (não deu para ler), o evento da paleta nova fica pendente em vez de errar', () => {
    const saida = plano([recurso(8, 'Zara', { eventLabelId: 'lab-cobalto' })], [ZARA], [], []);
    const pendencia = soUm(saida, 'review');
    expect(pendencia.reason).toBe('unrecognized color');
    // A tela mostra a etiqueta que o evento carrega, mesmo sem o hex: dá para o suporte agir.
    expect(pendencia.parsed.color.labelId).toBe('lab-cobalto');
  });

  it('etiqueta MANDA sobre o `colorId` quando os dois vêm no evento', () => {
    // Um evento pintado na paleta nova não manda `colorId`; se mandar (cliente antigo na tela
    // compartilhada), a etiqueta — o que o escritório escolheu — é quem decide.
    const saida = plano([recurso(9, 'Zara', { eventLabelId: 'lab-cobalto', colorId: '2' })]);
    expect(soUm(saida, 'create').parsed.serviceType).toBe('daycare');
  });

  it('cão fora do cadastro continua pendência (a cor nova não afrouxa a regra do cadastro)', () => {
    const saida = plano([recurso(10, 'Rex', { eventLabelId: 'lab-cobalto' })], [ZARA]);
    const pendencia = soUm(saida, 'review');
    expect(pendencia.reason).toBe('unknown dog');
    expect(pendencia.parsed.serviceType).toBe('daycare'); // a cor foi lida: o botão "Choose dog" aparece
  });
});
