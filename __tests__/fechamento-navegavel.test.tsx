import { fireEvent, render } from '@testing-library/react-native';
import { DriverRouteView } from '@/features/driver/DriverRouteView';
import { fechamentoDaRota } from '@/features/driver/routeClosing';
import type { OrganizationLocation } from '@/features/organization/locations';

/**
 * O FECHAMENTO NÃO É SÓ UM AVISO (cliente, 02/10/2026): *"o aplicativo apenas informa que termina no
 * yard, mas na realidade não mudou nada"*. O cartão do yard/van passou a ter o botão Navigate — o
 * motorista é LEVADO ao destino (mesmo caminho da navegação das paradas). Sem o handler, o cartão
 * continua apenas informativo (e sem coordenadas nunca inventa destino).
 */
const van: OrganizationLocation = {
  id: 'van-1', name: 'Van 1', kind: 'van', addressLine1: '3111 La Selva', city: 'San Mateo',
  latitude: 37.5427669, longitude: -122.2849451, radiusMeters: 300, isDefault: true,
};
const yard: OrganizationLocation = {
  id: 'yard-1', name: 'Yard', kind: 'yard', addressLine1: '1089 Memorex Drive', city: 'Santa Clara',
  latitude: 37.362643, longitude: -122.9527423, radiusMeters: 300, isDefault: false,
};

describe('fechamento navegável', () => {
  it('o cartão do fechamento LEVA ao destino (tem botão Navigate)', async () => {
    const onNavigateClosing = jest.fn();
    const closing = fechamentoDaRota({ buscaTerminou: true, entregaTerminou: true, yard, van });
    const tela = await render(
      <DriverRouteView stops={[]} onAction={jest.fn()} closing={closing} onNavigateClosing={onNavigateClosing} />,
    );
    expect(tela.getByText('Back to the van')).toBeTruthy();
    await fireEvent.press(tela.getByTestId('navigate-closing'));
    expect(onNavigateClosing).toHaveBeenCalledTimes(1);
  });

  it('sem handler (e sem coordenadas), o cartão continua só informativo', async () => {
    const closing = fechamentoDaRota({ buscaTerminou: true, entregaTerminou: true, yard, van });
    const tela = await render(<DriverRouteView stops={[]} onAction={jest.fn()} closing={closing} />);
    expect(tela.queryByTestId('navigate-closing')).toBeNull();
  });
});
