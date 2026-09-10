import { labelFor, NAV_APPS, navigationUrlFor, parseNavApp } from '@/features/maps/navigation';
import { regionForPoints } from '@/features/maps/region';

describe('navegação (Google/Apple)', () => {
  it('monta a URL certa para cada app, com coordenadas', () => {
    const target = { latitude: 37.7749, longitude: -122.4194 };
    expect(navigationUrlFor('google', target)).toContain('google.com/maps/dir/?api=1&destination=37.7749,-122.4194');
    expect(navigationUrlFor('apple', target)).toContain('maps.apple.com/?daddr=37.7749,-122.4194');
  });

  it('cai no endereço quando não há coordenadas', () => {
    const target = { address: 'Ferry Building, SF' };
    expect(navigationUrlFor('google', target)).toContain('destination=Ferry%20Building%2C%20SF');
    expect(navigationUrlFor('apple', target)).toContain('q=Ferry%20Building%2C%20SF');
  });

  it('rotula os apps e mantém a ordem de exibição', () => {
    expect(NAV_APPS.map(labelFor)).toEqual(['Google Maps', 'Apple Maps']);
  });

  it('normaliza a preferência guardada (lixo → perguntar de novo)', () => {
    expect(parseNavApp('google')).toBe('google');
    expect(parseNavApp('apple')).toBe('apple');
    expect(parseNavApp('waze')).toBeNull();
    expect(parseNavApp(null)).toBeNull();
    expect(parseNavApp(undefined)).toBeNull();
  });
});

describe('região do mapa', () => {
  it('enquadra todas as paradas com folga', () => {
    const region = regionForPoints([
      { latitude: 37.77, longitude: -122.42 },
      { latitude: 37.79, longitude: -122.40 },
    ]);
    expect(region).not.toBeNull();
    expect(region!.latitude).toBeCloseTo(37.78, 5);
    expect(region!.longitude).toBeCloseTo(-122.41, 5);
    expect(region!.latitudeDelta).toBeGreaterThan(0.02);
  });

  it('aplica um delta mínimo (paradas no mesmo quarteirão)', () => {
    const region = regionForPoints([{ latitude: 37.7749, longitude: -122.4194 }]);
    expect(region!.latitudeDelta).toBeGreaterThanOrEqual(0.01);
    expect(region!.longitudeDelta).toBeGreaterThanOrEqual(0.01);
  });

  it('devolve null quando não há coordenadas válidas', () => {
    expect(regionForPoints([])).toBeNull();
    expect(regionForPoints([{ latitude: Number.NaN, longitude: -122 }])).toBeNull();
  });
});
