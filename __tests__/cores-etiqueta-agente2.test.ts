/**
 * VETORES INDEPENDENTES DO AGENTE DE TESTES (agente2) — BUG 56: cor pelo RÓTULO (paleta nova do Google).
 *
 * Causa-raiz do bug em produção (24/09/2026): o Google trocou as cores de evento por "labels"
 * (24 padrão + até 200 personalizadas). `eventLabelId` já faz parte da leitura do recurso Event;
 * `eventLabelVersion=1` é exigido somente ao ESCREVER uma etiqueta. O caso `zara` falhava porque o
 * app não carregava `eventLabelId` nem as etiquetas do calendário para interpretar "Cobalto".
 *
 * Aqui eu fixo: (1) o TOM de cada cor conhecida -> serviço; (2) o caminho do plano com etiqueta;
 * (3) o fallback da paleta antiga (`colorId`); (4) o que NÃO pode virar serviço.
 */
import { meaningOfLabelColor, hueOfHex } from '@/features/calendar/googleColors';
import { planCalendarImport, type BookingForImport, type DogForImport, type ImportOutcome } from '@/features/integrations/google/importPlan';
import type { RemoteEvent } from '@/features/integrations/google/calendarSync';

const JANELA = { from: '2026-09-24', to: '2027-03-23' };
const DIA = '2026-09-26';

const AZUL_NOVO = { id: 'lbl-cobalto', name: 'Cobalto', backgroundColor: '#4a86e8' };
const VERDE = { id: 'lbl-verde', name: 'Verde', backgroundColor: '#33b679' };
const VERMELHO = { id: 'lbl-vermelho', name: 'Vermelho', backgroundColor: '#e67c73' };
const AMARELO = { id: 'lbl-banana', name: 'Amarelo', backgroundColor: '#fbd75b' };

const ZARA: DogForImport = { id: 'dog-zara', name: 'Zara', clientName: 'Zara kot' };

function evento(id: string, summary: string, extra: Partial<RemoteEvent> = {}): RemoteEvent {
  return { id, summary, startDate: DIA, endDate: DIA, appKey: null, ...extra } as RemoteEvent;
}

describe('TOM da cor -> servico (o caso real: azul Cobalto = daycare)', () => {
  const casos: Array<[string, string, string | null]> = [
    ['#33b679', 'Sage (verde)', 'boarding'],
    ['#0b8043', 'Basil (verde)', 'boarding'],
    ['#039be5', 'Peacock (azul)', 'daycare'],
    ['#4986e7', 'Blueberry (azul)', 'daycare'],
    ['#4a86e8', 'Cobalto (azul NOVO, o da zara)', 'daycare'],
    ['#a4bdfc', 'Lavanda', 'daycare'],
    ['#dbadff', 'Uva (roxo)', 'daycare'],
    ['#e67c73', 'Tomate (vermelho)', 'cancel'],
    ['#fbd75b', 'Banana (amarelo)', null],
    ['#ff7537', 'Tangerina (laranja)', null],
    ['#e1e1e1', 'Grafite (cinza)', null],
    ['', 'vazio', null],
    ['#zzzzzz', 'hex invalido', null],
  ];
  for (const [hex, nome, esperado] of casos) {
    it(`${nome} (${hex || 'vazio'}) -> ${esperado ?? 'nada'}`, () => {
      const lido = meaningOfLabelColor(hex);
      const obtido = lido === null ? null : lido.kind === 'cancel' ? 'cancel' : lido.serviceType;
      expect(obtido).toBe(esperado);
    });
  }

  it('o tom do Cobalto fica na faixa do azul (e nao no roxo nem no verde)', () => {
    const tom = hueOfHex('#4a86e8');
    expect(tom).not.toBeNull();
    expect(tom! >= 170 && tom! < 265).toBe(true);
  });
});

describe('plano com etiqueta (paleta nova)', () => {
  it('evento "zara" com etiqueta azul Cobalto + cao cadastrado -> reserva DAYCARE', () => {
    const plano = planCalendarImport([evento('ev-zara', 'zara', { eventLabelId: AZUL_NOVO.id })], [ZARA], [], JANELA, {
      labels: [AZUL_NOVO],
    });
    const item = plano.find((x) => x.kind === 'create');
    if (item?.kind !== 'create') throw new Error('esperava create');
    expect(item.dogId).toBe('dog-zara');
    expect(item.parsed.serviceType).toBe('daycare');
  });

  it('etiqueta verde -> boarding', () => {
    const plano = planCalendarImport([evento('ev-verde', 'Zara', { eventLabelId: VERDE.id })], [ZARA], [], JANELA, {
      labels: [VERDE],
    });
    const item = plano.find((x) => x.kind === 'create');
    if (item?.kind !== 'create') throw new Error('esperava create');
    expect(item.parsed.serviceType).toBe('boarding');
  });

  it('etiqueta vermelha + reserva ligada -> CANCELA a reserva do dia', () => {
    const reserva = {
      id: 'res-zara',
      kind: 'reservation',
      dogId: 'dog-zara',
      googleEventId: 'ev-zara',
      source: 'google',
      serviceType: 'daycare',
      startDate: DIA,
      endDate: DIA,
      weekdays: null,
      status: 'confirmed',
    } as BookingForImport;
    const plano = planCalendarImport([evento('ev-zara', 'zara', { eventLabelId: VERMELHO.id })], [ZARA], [reserva], JANELA, {
      labels: [VERMELHO],
    });
    const item = plano.find((x) => x.kind === 'cancel');
    expect(item?.kind).toBe('cancel');
  });

  it('etiqueta amarela NAO vira servico (vai para a lista)', () => {
    const plano = planCalendarImport([evento('ev-amarelo', 'zara', { eventLabelId: AMARELO.id })], [ZARA], [], JANELA, {
      labels: [AMARELO],
    });
    expect(plano.some((x) => x.kind === 'create' || x.kind === 'update')).toBe(false);
    const item = plano[0];
    if (item?.kind !== 'review') throw new Error('esperava review');
    expect(item.reason).toBe('unrecognized color');
  });
});

describe('fallback da paleta ANTIGA (colorId) e limite do parser', () => {
  it('sem etiqueta, colorId 2 (verde velho) -> boarding', () => {
    const plano = planCalendarImport([evento('ev-old', 'Zara', { colorId: '2' })], [ZARA], [], JANELA, { labels: [] });
    const item = plano.find((x) => x.kind === 'create');
    if (item?.kind !== 'create') throw new Error('esperava create');
    expect(item.parsed.serviceType).toBe('boarding');
  });

  it('sem etiqueta e sem colorId -> lista "cor nao reconhecida"', () => {
    const plano = planCalendarImport([evento('ev-sem-cor', 'Zara')], [ZARA], [], JANELA, { labels: [] });
    const item = plano[0];
    if (item?.kind !== 'review') throw new Error('esperava review');
    expect(item.reason).toBe('unrecognized color');
  });

  it('INVARIANTE: nenhum desfecho aponta para cao fora do cadastro', () => {
    const plano = planCalendarImport(
      [
        evento('a', 'Zara', { eventLabelId: AZUL_NOVO.id }),
        evento('b', 'Desconhecido', { eventLabelId: AZUL_NOVO.id }),
        evento('c', 'Zara'),
      ],
      [ZARA],
      [],
      JANELA,
      { labels: [AZUL_NOVO] },
    );
    const ids = plano
      .filter((x): x is Extract<ImportOutcome, { kind: 'create' | 'update' }> => x.kind === 'create' || x.kind === 'update')
      .map((x) => x.dogId);
    expect(ids.every((id) => id === 'dog-zara')).toBe(true);
  });
});
