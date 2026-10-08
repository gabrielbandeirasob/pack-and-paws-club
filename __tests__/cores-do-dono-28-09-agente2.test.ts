/**
 * VETORES DO AGENTE2 — o lote de áudios do dono de 28/09/2026 mudou o contrato de cores. Ele ditou:
 *  - "as cores de Daycare é a cor chamada default do Google calendário ou Peacock";
 *  - "Boarding são três cores: Avocado (chegada e saída), Basil (estadia) e Cocoa";
 *  - "Cocoa é toda vez que o pick-up ou drop-off for depois do nosso dia de trabalho (depois das cinco):
 *    nenhum dos drivers vai fazer, quem vai fazer é o administrador — nem entra na lista de dispatch";
 *  - "se for o drop-off e for cor cocoa você pode botar ele na lista do daycare do dia... o administrador
 *    pode ir no Total Pack e remover ele do dia";
 *  - o roxo dele é Amethyst e o cancelamento é Tomato.
 */
import { HEX_COCOA, meaningOfLabelColor, readEventColor, serviceTypeOfMeaning, movimentaOCao } from '@/features/calendar/googleColors';
import { parseBookingEvent } from '@/features/integrations/google/importPlan';

const evento = (extra: Record<string, unknown>) =>
  ({ id: 'e1', summary: 'Kona', startDate: '2026-09-28', endDate: '2026-09-28', ...extra }) as never;

describe('COCOA = fora do horário de funcionamento', () => {
  it('a etiqueta Cocoa (marrom) é reconhecida pelo hex, mesmo com o tom parecido com laranja/bege', () => {
    expect(meaningOfLabelColor(HEX_COCOA)).toEqual({ kind: 'out_of_hours' });
    expect(meaningOfLabelColor('#795548')).toEqual({ kind: 'out_of_hours' });
  });

  it('cocoa conta como dia de DAY CARE (entra na lista do dia)', () => {
    expect(serviceTypeOfMeaning({ kind: 'out_of_hours' })).toBe('daycare');
  });

  it('cocoa NÃO pede van — não entra na lista de dispatch', () => {
    const cor = readEventColor({ eventLabelId: 'lab-cocoa' }, [{ id: 'lab-cocoa', name: 'Cocoa', backgroundColor: HEX_COCOA }]);
    expect(movimentaOCao(cor)).toBe(false);
    const lido = parseBookingEvent(evento({ eventLabelId: 'lab-cocoa' }), [{ id: 'lab-cocoa', name: 'Cocoa', backgroundColor: HEX_COCOA }]);
    expect(lido?.serviceType).toBe('daycare');
    expect(lido?.transportRequired).toBe(false);
  });

  it('laranja (Tangerine) e bege (Birch) continuam NÃO reconhecidos — o dono não falou deles', () => {
    expect(meaningOfLabelColor('#f4511e')).toBeNull();
    expect(meaningOfLabelColor('#a79b8e')).toBeNull();
  });
});

describe('evento SEM COR = day care (a cor "default" do Google)', () => {
  it('sem etiqueta e sem colorId vira day care, e pede van', () => {
    const lido = parseBookingEvent(evento({}));
    expect(lido?.serviceType).toBe('daycare');
    expect(lido?.transportRequired).toBe(true);
  });

  it('cor pintada e desconhecida continua na lista de revisão (o escritório pintou de propósito)', () => {
    // O CINZA saiu desta lista em 08/10/2026 (virou daycare): quem continua desconhecido é o rosa/vinho.
    const lido = readEventColor({ eventLabelId: 'lab-rosa' }, [{ id: 'lab-rosa', name: 'Rosa', backgroundColor: '#ad1457' }]);
    expect(lido.meaning).toBeNull();
  });
});
