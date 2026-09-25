/**
 * VETORES DO AGENTE2 — Waze como terceira opção de navegação (pedido do dono, 25/09/2026:
 * "pode adicionar Waze tbm").
 *
 * Regra: o motorista escolhe entre Google Maps, Apple Maps e Waze. Com coordenadas o link leva
 * direto para a navegação (turn-by-turn); só com endereço, leva para a busca.
 */
import { wazeUrl, navigationOptions } from '@/features/maps/links';
import { NAV_APPS, labelFor, navigationUrlFor, parseNavApp } from '@/features/maps/navigation';

describe('Waze na navegação', () => {
  it('link com coordenadas vai direto para a navegação', () => {
    const url = wazeUrl({ latitude: -16.679, longitude: -49.258 });
    expect(url).toContain('waze.com/ul');
    expect(url).toContain('ll=-16.679,-49.258');
    expect(url).toContain('navigate=yes');
  });

  it('sem coordenadas usa o endereço (busca)', () => {
    const url = wazeUrl({ address: 'Rua 9, 1200 - Setor Oeste' });
    expect(url).toContain('q=Rua%209%2C%201200%20-%20Setor%20Oeste');
    expect(url).not.toContain('ll=');
  });

  it('aparece no seletor de app com o rótulo Waze', () => {
    const opcoes = navigationOptions({ latitude: -16.679, longitude: -49.258 });
    expect(opcoes.map((o) => o.id)).toEqual(['google', 'apple', 'waze']);
    expect(opcoes.find((o) => o.id === 'waze')?.label).toBe('Waze');
  });

  it('o motorista pode escolher e o app lembra (parse do storage)', () => {
    expect(NAV_APPS).toContain('waze');
    expect(labelFor('waze')).toBe('Waze');
    expect(navigationUrlFor('waze', { latitude: 1, longitude: 2 })).toContain('waze.com/ul');
    expect(parseNavApp('waze')).toBe('waze');
    expect(parseNavApp('bing')).toBeNull();
  });
});
