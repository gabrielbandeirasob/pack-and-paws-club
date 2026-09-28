/**
 * VETORES DO AGENTE2 — rótulo do status da rota no quadro do Dispatch (28/09/2026).
 *
 * Achado na varredura: o quadro mostrava "✓ Done" no cão e, na mesma linha, "· Draft" para uma rota
 * CONCLUÍDA — o código só tratava `published`. O gestor lia como rascunho o que já tinha sido feito.
 */
import { rotuloDeStatus } from '@/features/dispatch/routeStatusLabel';

it('rota concluida NAO e chamada de rascunho', () => {
  expect(rotuloDeStatus('completed')).toBe(' · Completed');
});

it('cada status tem o seu rotulo', () => {
  expect(rotuloDeStatus('draft')).toBe(' · Draft');
  expect(rotuloDeStatus('published')).toBe(' · Published');
  expect(rotuloDeStatus('cancelled')).toBe(' · Cancelled');
});

it('sem rota nao escreve nada', () => {
  expect(rotuloDeStatus(null)).toBe('');
  expect(rotuloDeStatus(undefined)).toBe('');
});

it('status desconhecido (banco mexido por fora) cai em Draft em vez de vazio', () => {
  expect(rotuloDeStatus('qualquer' as never)).toBe(' · Draft');
});
