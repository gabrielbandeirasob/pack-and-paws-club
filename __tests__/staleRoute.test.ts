/**
 * Reconhecer a escrita concorrente e explicar para o gestor sem assustar.
 * O banco manda `stale_route` (P0001) quando a rota mudou em outro aparelho.
 */
import {
  STALE_ROUTE_MESSAGE,
  STALE_ROUTE_TITLE,
  expectedVersion,
  isStaleRouteError,
  routeErrorMessage,
} from '@/features/dispatch/staleRoute';

describe('isStaleRouteError', () => {
  it('reconhece o erro do banco em todas as formas que ele chega', () => {
    expect(isStaleRouteError({ message: 'stale_route' })).toBe(true);
    expect(isStaleRouteError({ code: 'P0001', message: 'stale_route', details: null })).toBe(true);
    expect(isStaleRouteError('stale_route')).toBe(true);
    expect(isStaleRouteError(new Error('stale_route'))).toBe(true);
  });

  it('nao confunde outros erros com concorrencia', () => {
    expect(isStaleRouteError({ message: 'forbidden' })).toBe(false);
    expect(isStaleRouteError({ message: 'route not found' })).toBe(false);
    expect(isStaleRouteError(new Error('network request failed'))).toBe(false);
    expect(isStaleRouteError(null)).toBe(false);
    expect(isStaleRouteError(undefined)).toBe(false);
  });
});

describe('routeErrorMessage', () => {
  it('troca o codigo do banco por uma frase que o gestor entende', () => {
    expect(routeErrorMessage({ message: 'stale_route' })).toBe(STALE_ROUTE_MESSAGE);
    expect(STALE_ROUTE_MESSAGE).toContain('Reload');
    expect(STALE_ROUTE_TITLE).toBe('Route changed on another device');
  });

  it('mantem a mensagem original nos outros erros', () => {
    expect(routeErrorMessage({ message: 'forbidden' })).toBe('forbidden');
    expect(routeErrorMessage(new Error('sem rede'))).toBe('sem rede');
  });

  it('nunca devolve texto vazio', () => {
    expect(routeErrorMessage(null)).toBe('Unable to save.');
    expect(routeErrorMessage('   ')).toBe('Unable to save.');
  });
});

describe('expectedVersion', () => {
  it('devolve a versao que o aparelho leu', () => {
    expect(expectedVersion({ rota1: 7 }, 'rota1')).toBe(7);
  });

  it('devolve null quando nao conhece a rota (escrita sem trava, app antigo)', () => {
    expect(expectedVersion({}, 'rota9')).toBeNull();
    expect(expectedVersion({ rota1: Number.NaN }, 'rota1')).toBeNull();
  });

  it('aceita versao 0 sem confundir com ausente', () => {
    expect(expectedVersion({ rota1: 0 }, 'rota1')).toBe(0);
  });
});
