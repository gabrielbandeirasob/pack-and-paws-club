/**
 * VETORES DO AGENTE2 — o lote de áudios do dono de 28/09/2026 mudou o contrato de cores. Ele ditou:
 *  - "as cores de Daycare é a cor chamada default do Google calendário ou Peacock";
 *  - "Boarding são três cores: Avocado (chegada e saída), Basil (estadia) e Cocoa";
 *  - "Cocoa é toda vez que o pick-up ou drop-off for depois do nosso dia de trabalho (depois das cinco):
 *    nenhum dos drivers vai fazer, quem vai fazer é o administrador — nem entra na lista de dispatch";
 *  - "se for o drop-off e for cor cocoa você pode botar ele na lista do daycare do dia... o administrador
 *    pode ir no Total Pack e remover ele do dia";
 *  - "você vai usar as mesmas cores pro aplicativo" (o que o app ESCREVE no calendário);
 *  - o roxo dele é Amethyst e o cancelamento é Tomato.
 */
import { HEX_COCOA, meaningOfLabelColor, readEventColor, serviceTypeOfMeaning, movimentaOCao } from '@/features/calendar/googleColors';
import { buildGoogleEvent } from '@/features/calendar/googleEvents';
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
    const lido = readEventColor({ eventLabelId: 'lab-cinza' }, [{ id: 'lab-cinza', name: 'Graphite', backgroundColor: '#808080' }]);
    expect(lido.meaning).toBeNull();
  });
});

describe('o app ESCREVE as cores do escritório', () => {
  const labels = [
    { id: 'lab-peacock', name: 'Peacock', backgroundColor: '#039be5' },
    { id: 'lab-basil', name: 'Basil', backgroundColor: '#0b8043' },
    { id: 'lab-avocado', name: 'Avocado', backgroundColor: '#c0ca33' },
  ];

  it('day care sai Peacock (azul, id 7)', () => {
    const e = buildGoogleEvent({ dogName: 'Kona', clientName: 'Ana', serviceType: 'daycare', startDate: '2026-09-28' }, { labels });
    expect(e.colorId).toBe('7');
    expect(e.eventLabelId).toBe('lab-peacock');
  });

  it('estadia de vários dias sai Basil (verde escuro, id 10)', () => {
    const e = buildGoogleEvent({ dogName: 'Kona', clientName: 'Ana', serviceType: 'boarding', startDate: '2026-09-28', endDate: '2026-10-02' }, { labels });
    expect(e.colorId).toBe('10');
    expect(e.eventLabelId).toBe('lab-basil');
  });

  it('hospedagem de UM dia (chegada e saída) sai amarelo/Avocado — é dia de movimento', () => {
    const e = buildGoogleEvent({ dogName: 'Kona', clientName: 'Ana', serviceType: 'boarding', startDate: '2026-09-28', endDate: '2026-09-28' }, { labels });
    expect(e.colorId).toBe('5');
    expect(e.eventLabelId).toBe('lab-avocado');
  });

  it('sem etiquetas no calendário o app não quebra: manda só o colorId', () => {
    const e = buildGoogleEvent({ dogName: 'Kona', clientName: 'Ana', serviceType: 'boarding', startDate: '2026-09-28', endDate: '2026-10-02' }, { labels: [] });
    expect(e.colorId).toBe('10');
    expect(e.eventLabelId).toBeUndefined();
  });
});
