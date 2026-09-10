import { isClosedRoute, routeStatusStyle, stopSummaryLabel, summarizeStops } from '@/features/dispatch/history';

describe('histórico de rotas', () => {
  it('resume as paradas por situação', () => {
    const summary = summarizeStops([
      { status: 'completed' },
      { status: 'completed' },
      { status: 'skipped' },
      { status: 'pending' },
      { status: 'picked_up' },
    ]);
    expect(summary).toEqual({ total: 5, done: 2, skipped: 1, pending: 1, inProgress: 1 });
    expect(stopSummaryLabel(summary)).toBe('2/5 stops · 1 skipped · 1 pending · 1 in progress');
  });

  it('não mostra sufixo quando tudo foi concluído', () => {
    expect(stopSummaryLabel(summarizeStops([{ status: 'completed' }, { status: 'completed' }]))).toBe('2/2 stops');
  });

  it('rotula o status da rota (draft é o padrão do banco)', () => {
    expect(routeStatusStyle('completed')).toEqual({ label: 'Completed', tone: 'green' });
    expect(routeStatusStyle('published')).toEqual({ label: 'Published', tone: 'gold' });
    expect(routeStatusStyle('cancelled')).toEqual({ label: 'Cancelled', tone: 'red' });
    expect(routeStatusStyle('qualquer')).toEqual({ label: 'Draft', tone: 'muted' });
  });

  it('sabe o que é rota fechada', () => {
    expect(isClosedRoute('completed')).toBe(true);
    expect(isClosedRoute('cancelled')).toBe(true);
    expect(isClosedRoute('published')).toBe(false);
    expect(isClosedRoute('draft')).toBe(false);
  });
});
