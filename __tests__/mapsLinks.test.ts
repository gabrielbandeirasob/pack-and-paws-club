import { appleMapsUrl, googleMapsUrl, navigationOptions } from '@/features/maps/links';

describe('links de navegacao', () => {
  it('usa coordenadas quando existem (Google)', () => {
    expect(googleMapsUrl({ latitude: 37.7749, longitude: -122.4194 })).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=37.7749,-122.4194&travelmode=driving',
    );
  });

  it('usa o endereco codificado quando nao ha coordenadas (Google)', () => {
    expect(googleMapsUrl({ address: '123 Main St, San Francisco, CA' })).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=123%20Main%20St%2C%20San%20Francisco%2C%20CA&travelmode=driving',
    );
  });

  it('monta o Apple Maps com daddr quando ha coordenadas e com q quando so ha endereco', () => {
    expect(appleMapsUrl({ latitude: 37.7749, longitude: -122.4194 })).toBe(
      'https://maps.apple.com/?daddr=37.7749,-122.4194&dirflg=d',
    );
    expect(appleMapsUrl({ address: ' 500 Howard St  ' })).toBe('https://maps.apple.com/?q=500%20Howard%20St');
  });

  it('ignora coordenadas parciais (cai no endereco)', () => {
    const url = googleMapsUrl({ latitude: 37.77, longitude: null, address: 'Ferry Building' });
    expect(url).toContain('destination=Ferry%20Building');
  });

  it('devolve Google antes do Apple', () => {
    const ids = navigationOptions({ address: 'A' }).map((option) => option.id);
    expect(ids).toEqual(['google', 'apple']);
  });
});
