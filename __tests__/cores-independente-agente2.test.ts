/**
 * VETORES INDEPENDENTES DO AGENTE DE TESTES (agente2) — regra de COR do build 55.
 *
 * Escritos por mim, do pedido literal do Gabriel (24/09/2026):
 *  - o titulo do evento traz SO o nome do cao;
 *  - o app SO importa cao JA cadastrado;
 *  - o SERVICO vem da COR: verde = boarding, azul = daycare, vermelho = cancelamento.
 *
 * Eu nao reaproveito os casos do autor da mudanca: aqui eu fixo o comportamento que o dono descreveu
 * (incluindo os tons que ele NAO citou) para que uma regressao futura quebre ESTE arquivo.
 */
import { planCalendarImport, type BookingForImport, type DogForImport, type ImportOutcome } from '@/features/integrations/google/importPlan';
import type { RemoteEvent } from '@/features/integrations/google/calendarSync';

const HOJE = '2026-09-24';
const JANELA = { from: HOJE, to: '2027-03-23' };
const DIA = '2026-09-30';

const PIETRO: DogForImport = { id: 'dog-pietro', name: 'Pietro', clientName: 'Carlos' };

function evento(id: string, summary: string, colorId: string | null, extra: Partial<RemoteEvent> = {}): RemoteEvent {
  return { id, summary, startDate: DIA, endDate: DIA, appKey: null, colorId, ...extra } as RemoteEvent;
}

function reservaDoPietro(over: Partial<BookingForImport> = {}): BookingForImport {
  return {
    id: 'res-pietro',
    kind: 'reservation',
    dogId: 'dog-pietro',
    googleEventId: 'ev-pietro',
    source: 'google',
    serviceType: 'daycare',
    startDate: DIA,
    endDate: DIA,
    weekdays: null,
    status: 'confirmed',
    ...over,
  } as BookingForImport;
}

function plano(events: RemoteEvent[], dogs: DogForImport[], reservas: BookingForImport[] = []): ImportOutcome[] {
  return planCalendarImport(events, dogs, reservas, JANELA);
}

describe('cor do evento define o servico (vetores do agente2)', () => {
  it('VERDE (Sage, id 2) com cao cadastrado vira reserva de BOARDING', () => {
    const saida = plano([evento('e1', 'Pietro', '2')], [PIETRO]);
    const item = saida.find((x) => x.kind === 'create');
    expect(item?.kind).toBe('create');
    if (item?.kind !== 'create') throw new Error('esperava create');
    expect(item.dogId).toBe('dog-pietro');
    expect(item.parsed.serviceType).toBe('boarding');
  });

  it('VERDE escuro (Basil, id 10) tambem e boarding', () => {
    const saida = plano([evento('e2', 'Pietro', '10')], [PIETRO]);
    const item = saida.find((x) => x.kind === 'create');
    if (item?.kind !== 'create') throw new Error('esperava create');
    expect(item.parsed.serviceType).toBe('boarding');
  });

  it('AZUL (Peacock 7 e Blueberry 9) vira DAYCARE', () => {
    for (const cor of ['7', '9']) {
      const saida = plano([evento(`e-${cor}`, 'Pietro', cor)], [PIETRO]);
      const item = saida.find((x) => x.kind === 'create');
      if (item?.kind !== 'create') throw new Error(`esperava create para a cor ${cor}`);
      expect(`${cor}: ${item.parsed.serviceType}`).toBe(`${cor}: daycare`);
    }
  });

  it('AMARELO (Banana, id 5) NAO vira daycare — nao chuta servico', () => {
    const saida = plano([evento('e5', 'Pietro', '5')], [PIETRO]);
    expect(saida.some((x) => x.kind === 'create' || x.kind === 'update')).toBe(false);
    expect(saida[0]?.kind).toBe('review');
  });

  it('VERMELHO (id 11) CANCELA a reserva do dia daquele cao', () => {
    const saida = plano([evento('ev-pietro', 'Pietro', '11')], [PIETRO], [reservaDoPietro()]);
    const item = saida.find((x) => x.kind === 'cancel');
    expect(item?.kind).toBe('cancel');
    if (item?.kind !== 'cancel') throw new Error('esperava cancel');
    expect(item.bookingId).toBe('res-pietro');
  });

  it('CAO NAO CADASTRADO nao importa e cai na lista (motivo unknown dog)', () => {
    const saida = plano([evento('e6', 'Bella', '2')], [PIETRO]);
    expect(saida.some((x) => x.kind === 'create' || x.kind === 'update')).toBe(false);
    const item = saida[0];
    expect(item?.kind).toBe('review');
    if (item?.kind !== 'review') throw new Error('esperava review');
    expect(item.reason).toBe('unknown dog');
    expect(item.title).toBe('Bella');
  });

  it('SEM COR nao importa e cai na lista (motivo unrecognized color)', () => {
    const saida = plano([evento('e7', 'Pietro', null)], [PIETRO]);
    expect(saida.some((x) => x.kind === 'create' || x.kind === 'update')).toBe(false);
    const item = saida[0];
    if (item?.kind !== 'review') throw new Error('esperava review');
    expect(item.reason).toBe('unrecognized color');
  });

  it('nome que existe em DOIS caes vai para a lista com motivo (nao escolhe no chute)', () => {
    const gemeos: DogForImport[] = [
      { id: 'd1', name: 'Bella', clientName: 'Ana' },
      { id: 'd2', name: 'Bella', clientName: 'Bruno' },
    ];
    const saida = plano([evento('e8', 'Bella', '7')], gemeos);
    expect(saida.some((x) => x.kind === 'create')).toBe(false);
    const item = saida[0];
    if (item?.kind !== 'review') throw new Error('esperava review');
    expect(item.reason).toBe('ambiguous dog');
  });

  it('INVARIANTE: nenhum desfecho aponta para cao que nao estava no cadastro', () => {
    const eventos = [
      evento('a', 'Pietro', '2'),
      evento('b', 'Pietro', '7'),
      evento('c', 'Desconhecido', '2'),
      evento('d', 'Pietro', '5'),
      evento('e', 'Pietro', null),
    ];
    const saida = plano(eventos, [PIETRO]);
    const idsDeCao = saida
      .filter((x): x is Extract<ImportOutcome, { kind: 'create' | 'update' }> => x.kind === 'create' || x.kind === 'update')
      .map((x) => x.dogId);
    expect(idsDeCao.every((id) => id === PIETRO.id)).toBe(true);
  });
});
