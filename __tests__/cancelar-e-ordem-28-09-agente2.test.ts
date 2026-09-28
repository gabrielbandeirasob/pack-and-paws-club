/**
 * VETORES DO AGENTE2 — áudios do dono de 28/09/2026 (dois): cancelamento e ordem da estadia.
 *
 * 1) *"Se a gente cancelar pelo app, eu não quero que você apague o evento do calendário. Eu quero que
 *    você mude a cor para vermelho (tomato)."*
 * 2) *"Sempre que você ler, por exemplo, um avocado num dia, o próximo que ler avocado vai ser saída,
 *    não vai ser chegada. E o cocoa vai ser a mesma coisa."* + *"quando você perceber que é saída, você
 *    deve sugerir que ele esteja no dia de daycare"*.
 */
import { planCalendarSync } from '@/features/integrations/google/calendarSync';
import { COLOR_OF_CANCELAMENTO, papeisDeMovimento } from '@/features/calendar/googleColors';

const reserva = (extra: Record<string, unknown> = {}) => ({
  id: 'res:1',
  dogName: 'Kona',
  clientName: 'Ana',
  serviceType: 'daycare' as const,
  startDate: '2026-09-28',
  ...extra,
});

const eventoDoApp = (appKey: string) => ({
  id: 'ev-1',
  appKey,
  summary: 'Daycare · Kona (Ana)',
  startDate: '2026-09-28',
  endDate: '2026-09-29',
  colorId: '7',
});

describe('cancelar no app PINTA de Tomato — não apaga o evento', () => {
  it('reserva cancelada com evento no calendário vira UPDATE vermelho (nada de delete)', () => {
    const acoes = planCalendarSync([reserva({ cancelled: true })], [eventoDoApp('res:1')] as never);

    expect(acoes.some((a) => a.type === 'delete')).toBe(false);
    const update = acoes.find((a) => a.type === 'update');
    if (update?.type !== 'update') throw new Error('esperava update');
    expect(update.event.colorId).toBe(COLOR_OF_CANCELAMENTO);
    expect(COLLOR_NOME_SEGURO(update.event.colorId ?? '')).toBe('Tomato');
    // a etiqueta tem de ser LIMPA: na API ela vence o colorId
    expect(update.event.eventLabelId).toBeNull();
    // o evento continua contando a história: mesmo título, mesmas datas
    expect(update.event.summary).toBe('Kona');
    expect(update.event.start.date).toBe('2026-09-28');
  });

  it('reserva cancelada que nunca foi espelhada não cria evento nenhum', () => {
    expect(planCalendarSync([reserva({ cancelled: true })], [] as never)).toEqual([]);
  });

  it('evento do app sem reserva nenhuma (reserva apagada de verdade) continua sendo removido', () => {
    const acoes = planCalendarSync([], [eventoDoApp('res:que-sumiu')] as never);
    expect(acoes).toEqual([{ type: 'delete', eventId: 'ev-1' }]);
  });
});

describe('a ordem dos dias de movimento: 1º chegada, 2º saída', () => {
  it('dois dias de avocado/cocoa: o primeiro é chegada, o segundo é saída', () => {
    expect(papeisDeMovimento(['2026-09-28', '2026-10-02'])).toEqual(['chegada', 'saida']);
  });

  it('um dia só (chegou e saiu no mesmo dia) continua sendo chegada', () => {
    expect(papeisDeMovimento(['2026-09-28'])).toEqual(['chegada']);
  });

  it('a ordem é pela DATA, não pela ordem em que a tela mandou', () => {
    expect(papeisDeMovimento(['2026-10-02', '2026-09-28'])).toEqual(['chegada', 'saida']);
  });
});

/** Só para o teste provar que o id 11 é o vermelho do escritório. */
function COLLOR_NOME_SEGURO(id: string): string {
  return { '11': 'Tomato', '4': 'Flamingo' }[id] ?? '(outro)';
}
