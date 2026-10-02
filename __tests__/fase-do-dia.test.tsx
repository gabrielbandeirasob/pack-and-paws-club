import { fireEvent, render } from '@testing-library/react-native';
import { DriverRouteView, type DriverStop } from '@/features/driver/DriverRouteView';
import { paradaDaFaseConcluida, paradaEntregavel, podeIniciarDropoff } from '@/features/driver/dayPhase';

/**
 * FASE DO DIA (pick-up × drop-off) — cliente, áudios de 02/10/2026:
 *   *"agora eu cliquei que cheguei, peguei o cachorro... olha como está a rota de drop off, está
 *   aparecendo como se eu já tivesse feito todos"*
 *   *"Tem que ter uma mudança clara de rota, de pickup e drop-off. Ele NÃO tem que fazer essa mudança
 *   automática... Aí ele está cobrando que eu peguei esse cachorro na rota de pickup."*
 * Decisão do dono: a virada é um BOTÃO DO MOTORISTA.
 */
const parada = (over: Partial<DriverStop> = {}): DriverStop => ({
  id: 's1',
  dogName: 'Lucky',
  clientName: 'Ana',
  sequence: 1,
  dropoffSequence: 1,
  status: 'completed',
  address: null,
  city: null,
  instructions: null,
  ...over,
});

describe('fase do dia', () => {
  it('só oferece a virada quando a busca acabou e ainda falta entrega', () => {
    expect(podeIniciarDropoff([parada({ status: 'pending' })])).toBe(false);
    expect(podeIniciarDropoff([parada({ status: 'arrived' })])).toBe(false);
    expect(podeIniciarDropoff([parada({ status: 'completed' })])).toBe(true);
    expect(
      podeIniciarDropoff([parada({ status: 'completed', deliveredAt: '2026-10-02T20:00:00.000Z' })]),
    ).toBe(false);
  });

  it('na ENTREGA o pick-up NÃO conta como "feito" — só a entrega fecha', () => {
    const pego = parada({ status: 'completed' });
    expect(paradaDaFaseConcluida(pego, 'pickup')).toBe(true);
    expect(paradaDaFaseConcluida(pego, 'dropoff')).toBe(false);
    expect(paradaDaFaseConcluida({ ...pego, deliveredAt: '2026-10-02T20:00:00.000Z' }, 'dropoff')).toBe(true);
  });

  it('cão posto DIRETO na entrega é entregável sem passar pela busca', () => {
    const extra = parada({ status: 'pending' });
    expect(paradaEntregavel(extra, 'pickup')).toBe(false);
    expect(paradaEntregavel(extra, 'dropoff')).toBe(true);
  });

  it('a tela só oferece "Start drop-offs" quando a busca acabou — e a virada é do motorista', async () => {
    const onStartDropoffs = jest.fn();
    const tela = await render(
      <DriverRouteView stops={[parada({ status: 'completed' })]} onAction={jest.fn()} onStartDropoffs={onStartDropoffs} />,
    );
    expect(tela.getByText('PICK-UPS')).toBeTruthy();
    await fireEvent.press(tela.getByTestId('start-dropoffs'));
    expect(onStartDropoffs).toHaveBeenCalledTimes(1);
  });

  it('na fase de ENTREGA a lista não oferece a busca e mostra "Delivered"', async () => {
    const tela = await render(
      <DriverRouteView stops={[parada({ status: 'completed' })]} onAction={jest.fn()} fase="dropoff" />,
    );
    expect(tela.getByText('DROP-OFFS')).toBeTruthy();
    expect(tela.queryByText('I arrived')).toBeNull();
    expect(tela.queryByText('Next')).toBeNull();
    expect(tela.getByLabelText('Delivered Lucky')).toBeTruthy();
  });
});
