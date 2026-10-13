/**
 * PENDÊNCIA DA IMPORTAÇÃO SE IDENTIFICA POR (EVENTO + CÃO) — queixa do escritório em 13/10/2026:
 * *"continua pedindo pra salvar toda vez"*.
 *
 * O evento `Silvye/Agnes` traz DOIS nomes e cada um vira uma pendência PRÓPRIA, com o MESMO `eventId`
 * (a lista `review` nasce uma vez por cão lido). O cartão filtrava a lista só pelo evento:
 * `itens.filter((item) => item.eventId !== escolhendo.eventId)` — salvar o primeiro cão apagava as DUAS
 * linhas da tela e o segundo **ficava sem reserva nenhuma**; na rodada seguinte a pendência voltava.
 * O vídeo que o dono mandou naquele dia mostra exatamente isso (escolher o cão e voltar a pedir).
 */
import { planCalendarImport, type ImportOutcome } from '@/features/integrations/google/importPlan';
import type { RemoteEvent } from '@/features/integrations/google/eventMarkers';
import { mesmaPendencia, type ImportReviewItem } from '@/features/integrations/google/importService';

const evento = (summary: string, id = 'e1'): RemoteEvent => ({
  id,
  summary,
  startDate: '2026-10-13',
  endDate: '2026-10-14',
  appKey: null,
  colorId: null, // sem cor = daycare
  eventLabelId: null,
  recurrence: null,
});

const revisao = (eventId: string, dogName: string): ImportReviewItem =>
  ({ eventId, title: summary(dogName), date: '2026-10-13', reason: 'unknown dog', parsed: { dogName } } as ImportReviewItem);

const summary = (dogName: string): string => `Silvye/${dogName}`;

describe('a mesma pendência é (evento + cão), não só o evento', () => {
  it('um evento com dois nomes desconhecidos gera DUAS pendências com o MESMO eventId', () => {
    const plano: ImportOutcome[] = planCalendarImport(
      [evento('Silvye/Agnes')],
      [],
      [],
      { from: '2026-10-13', to: '2027-04-11' },
      { calendarId: 'packandpawsclub@gmail.com' },
    );
    const pendencias = plano.filter((item) => item.kind === 'review');
    expect(pendencias).toHaveLength(2);
    expect(new Set(pendencias.map((item) => (item as { eventId: string }).eventId)).size).toBe(1);
  });

  it('salvar um cão tira SÓ a pendência dele (a do irmão fica na tela)', () => {
    const lista = [revisao('e1', 'Silvye'), revisao('e1', 'Agnes'), revisao('e2', 'Zoe')];
    const escolhido = lista[1];
    expect(lista.filter((item) => !mesmaPendencia(item, escolhido)).map((item) => item.parsed.dogName))
      .toEqual(['Silvye', 'Zoe']);
  });

  it('mesma pendência compara o nome sem depender de caixa/acento', () => {
    expect(mesmaPendencia(revisao('e1', 'Agnes'), revisao('e1', 'agnes'))).toBe(true);
    expect(mesmaPendencia(revisao('e1', 'Agnes'), revisao('e2', 'Agnes'))).toBe(false);
    expect(mesmaPendencia(revisao('e1', 'Agnes'), revisao('e1', 'Zoe'))).toBe(false);
  });
});
