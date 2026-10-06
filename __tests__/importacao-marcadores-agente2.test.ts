/**
 * MARCADORES DO CALENDÁRIO não são cão nenhum (26/09/2026).
 *
 * Medido no calendário do cliente: além dos cães, o escritório mantém eventos de MARCADOR/OPERAÇÃO —
 * `Rotas`, `ROTAS FIXAS`, `Mentoria + Consulta`, o typo `BOADING` (de "boarding") e o `BOARDING 🐶` do
 * dia. Antes, todos esses caíam no cartão do Google Calendar como **"not registered in the app"**, no
 * meio dos cães que realmente faltam cadastrar — ruído que faz o gestor perder tempo.
 *
 * O que estes vetores travam:
 *  - `ehEventoDeOperacao` reconhece marcador, typo, título vazio e título sem NENHUMA letra;
 *  - NOME DE CÃO DE VERDADE nunca é classificado como marcador (Kona, Mowgli/Kona, Bella…);
 *  - no plano, marcador **não gera pendência nenhuma** (nem reserva, nem "not registered");
 *  - cão cadastrado continua entrando normalmente no meio dos marcadores.
 */
import {
  ehEventoDeOperacao,
  planCalendarImport,
  type BookingForImport,
  type DogForImport,
} from '@/features/integrations/google/importPlan';
import type { RemoteEvent } from '@/features/integrations/google/eventMarkers';

const JANELA = { from: '2026-09-01', to: '2026-12-31' };
const AZUL = '7'; // Peacock -> daycare

function evento(parcial: Partial<RemoteEvent> & { id: string }): RemoteEvent {
  return {
    summary: '',
    startDate: '2026-09-25',
    endDate: '2026-09-26',
    appKey: null,
    colorId: AZUL,
    recurrence: null,
    ...parcial,
  };
}

const CAES: DogForImport[] = [
  { id: 'dog-kona', name: 'Kona', clientName: 'Leigh Ann' },
  { id: 'dog-mowgli', name: 'Mowgli', clientName: 'Leigh Ann' },
];

function semReservas(): BookingForImport[] {
  return [];
}

describe('ehEventoDeOperacao — o que é marcador e o que é cão', () => {
  it.each([
    ['ROTAS FIXAS'],
    ['Rotas'],
    ['rotas'],
    ['Mentoria + Consulta'],
    // 06/10/2026: o print do cliente (dias 7-9/10) tinha esta barra VERMELHA — compromisso do
    // escritório, não cão — e ela caía em "não cadastrado". Pedido do dono: somar à lista.
    ['Inspeção building'],
    ['Inspeção'],
    ['Inspecao'],
    ['Inspection'],
    ['Vistoria do prédio'],
    ['BOADING'],
    ['BOARDING 🐶'],
    ['BOARDING'],
    ['Daycare'],
  ])('%s é evento de operação (não é cão)', (titulo) => {
    expect(ehEventoDeOperacao(titulo)).toBe(true);
  });

  it.each([
    [''],
    ['   '],
    ['🐶'],
    ['12'],
  ])('%s NÃO é marcador: título ilegível continua indo para a revisão do gestor', (titulo) => {
    expect(ehEventoDeOperacao(titulo)).toBe(false);
  });

  it.each([
    ['Kona'],
    ['Mowgli/Kona'],
    ['Skylar/Milo (Daycare)'],
    ['Bella (Leigh Ann)'],
    ['Daycare · Bella (Leigh Ann)'],
    ['Kona — Leigh Ann'],
    ['Honey Bea'],
    ['Tarot rose'],
  ])('%s continua sendo cão', (titulo) => {
    expect(ehEventoDeOperacao(titulo)).toBe(false);
  });
});

describe('plano de importação — marcador não vira pendência', () => {
  it('ROTAS FIXAS com cor azul não gera nada', () => {
    const plano = planCalendarImport([evento({ id: 'ev-rotas', summary: 'ROTAS FIXAS' })], CAES, semReservas(), JANELA);
    expect(plano).toEqual([]);
  });

  it('o marcador do dia ("BOARDING 🐶") some da tela, sem "not registered"', () => {
    const plano = planCalendarImport([evento({ id: 'ev-marcador', summary: 'BOARDING 🐶' })], CAES, semReservas(), JANELA);
    expect(plano).toEqual([]);
  });

  it('o typo BOADING também não polui a lista', () => {
    const plano = planCalendarImport([evento({ id: 'ev-typo', summary: 'BOADING' })], CAES, semReservas(), JANELA);
    expect(plano).toEqual([]);
  });

  it('Mentoria + Consulta não entra como cão desconhecido', () => {
    const plano = planCalendarImport([evento({ id: 'ev-mentoria', summary: 'Mentoria + Consulta' })], CAES, semReservas(), JANELA);
    expect(plano).toEqual([]);
  });

  it('no mesmo calendário, o cão cadastrado continua entrando', () => {
    const plano = planCalendarImport(
      [
        evento({ id: 'ev-rotas', summary: 'ROTAS FIXAS' }),
        evento({ id: 'ev-kona', summary: 'Kona' }),
      ],
      CAES,
      semReservas(),
      JANELA,
    );
    expect(plano).toHaveLength(1);
    expect(plano[0]).toMatchObject({ kind: 'create', eventId: 'ev-kona', dogId: 'dog-kona' });
  });

  it('título ilegível (vazio) continua aparecendo para revisão, como decidiu o dono', () => {
    const plano = planCalendarImport([evento({ id: 'ev-vazio', summary: '   ' })], CAES, semReservas(), JANELA);
    expect(plano).toHaveLength(1);
    expect(plano[0]).toMatchObject({ kind: 'review', reason: 'unreadable' });
  });

  it('cão NÃO cadastrado continua aparecendo para o gestor cadastrar', () => {
    const plano = planCalendarImport([evento({ id: 'ev-oreo', summary: 'Oreo' })], CAES, semReservas(), JANELA);
    expect(plano).toHaveLength(1);
    expect(plano[0]).toMatchObject({ kind: 'review', reason: 'unknown dog' });
  });
});
