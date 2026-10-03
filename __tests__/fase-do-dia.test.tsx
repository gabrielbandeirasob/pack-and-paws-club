import { fireEvent, render, within } from '@testing-library/react-native';
import { DriverRouteView, type DriverStop } from '@/features/driver/DriverRouteView';
import { etapaDoDia, faseEfetiva, paradaDaFaseConcluida, paradaEntregavel, podeIniciarDropoff } from '@/features/driver/dayPhase';
import { fechamentoDaRota } from '@/features/driver/routeClosing';

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

/**
 * A SEQUÊNCIA DO DIA (dono, 03/10/2026, verbatim): *"driver vai pra van, dá clock in, começa a etapa de
 * pick up dos cachorros, depois de pegar todos os cachorros é pra ir pro yard, depois do yard começa o
 * drop off, e após deixar todos os cachorros o driver volta pra onde pegou a van e dá clock off."*
 *
 * O BUG REAL (03/10/2026): a fase fica gravada no aparelho (`pnp:driver:phase:<rota>:<user>`) e a tela a
 * restaurava SEM conferir o dia. Com 'dropoff' guardado de um teste anterior, o motorista abriu o app JÁ
 * na ENTREGA e os cães da BUSCA (todos `pending`) apareceram como entregáveis. `faseEfetiva` corrige isto:
 * NUNCA se entrega antes de buscar — a única exceção é a perna de busca VAZIA (cão posto direto na entrega).
 */
describe('faseEfetiva — a fase guardada NÃO vale quando ainda há cão para buscar', () => {
  it('recusa "dropoff" guardado enquanto a busca tem cão sem buscar', () => {
    expect(faseEfetiva('dropoff', [parada({ status: 'pending' })])).toBe('pickup');
    expect(faseEfetiva('dropoff', [parada({ status: 'arrived' })])).toBe('pickup');
    expect(faseEfetiva('dropoff', [parada({ status: 'pending' }), parada({ id: 's2', status: 'completed' })])).toBe('pickup');
  });

  it('aceita "dropoff" quando a busca terminou', () => {
    expect(faseEfetiva('dropoff', [parada({ status: 'completed' })])).toBe('dropoff');
    expect(faseEfetiva('dropoff', [parada({ status: 'skipped' })])).toBe('dropoff');
  });

  it('aceita "dropoff" com a perna de busca VAZIA (cão posto direto na entrega)', () => {
    expect(faseEfetiva('dropoff', [])).toBe('dropoff');
  });

  it('nunca promove a busca a entrega sozinha', () => {
    expect(faseEfetiva('pickup', [parada({ status: 'completed' })])).toBe('pickup');
    expect(faseEfetiva('pickup', [])).toBe('pickup');
  });
});

describe('etapaDoDia — pickups → to_yard → dropoffs → to_van', () => {
  it('fase pickup com cão para buscar é "pickups"', () => {
    expect(etapaDoDia({
      fase: 'pickup',
      paradasDaBusca: [parada({ status: 'pending' })],
      paradasDaEntrega: [parada({ status: 'pending' })],
    })).toBe('pickups');
  });

  it('fase pickup com as buscas terminadas é "to_yard" — NUNCA "dropoffs"', () => {
    const etapa = etapaDoDia({
      fase: 'pickup',
      paradasDaBusca: [parada({ status: 'completed' })],
      paradasDaEntrega: [parada({ status: 'completed' })],
    });
    expect(etapa).toBe('to_yard');
    expect(etapa).not.toBe('dropoffs');
  });

  it('fase dropoff com cão para entregar é "dropoffs"', () => {
    expect(etapaDoDia({
      fase: 'dropoff',
      paradasDaBusca: [parada({ status: 'completed' })],
      paradasDaEntrega: [parada({ status: 'completed' })],
    })).toBe('dropoffs');
  });

  it('fase dropoff com a entrega terminada é "to_van" — aí é o clock off', () => {
    expect(etapaDoDia({
      fase: 'dropoff',
      paradasDaBusca: [parada({ status: 'completed' })],
      paradasDaEntrega: [parada({ status: 'completed', deliveredAt: '2026-10-03T21:00:00.000Z' })],
    })).toBe('to_van');
  });
});

describe('tela — a etapa "to_yard" vira o cartão do yard na etapa do momento', () => {
  const yard = {
    id: 'yard-1', name: 'Yard', kind: 'yard' as const, addressLine1: '1 Yard', city: 'San Mateo',
    latitude: 37.36, longitude: -122.95, radiusMeters: 300, isDefault: false,
  };

  it('mostra a virada RE-ROTULADA (mesmo testID) dentro do cartão do yard, com Navigate', async () => {
    const onStartDropoffs = jest.fn();
    const closing = fechamentoDaRota({ buscaTerminou: true, entregaTerminou: false, yard, van: null });
    const tela = await render(
      <DriverRouteView
        stops={[parada({ status: 'completed' })]}
        onAction={jest.fn()}
        fase="pickup"
        etapa="to_yard"
        closing={closing}
        onNavigateClosing={jest.fn()}
        onStartDropoffs={onStartDropoffs}
      />,
    );
    // O cartão do yard é a etapa do momento e o destino continua navegável.
    const cartaoDoYard = within(tela.getByTestId('route-closing'));
    expect(cartaoDoYard.getByText('Back to the yard')).toBeTruthy();
    expect(cartaoDoYard.getByTestId('navigate-closing')).toBeTruthy();
    // A única ação dourada é a virada, agora com o rótulo que deixa a ORDEM clara — e o testID antigo.
    expect(tela.getByText("I'm at the yard — start drop-offs")).toBeTruthy();
    await fireEvent.press(tela.getByTestId('start-dropoffs'));
    expect(onStartDropoffs).toHaveBeenCalledTimes(1);
    // Continua sendo a perna de BUSCA: o cabeçalho não vira DROP-OFFS.
    expect(tela.getByText('PICK-UPS')).toBeTruthy();
    expect(tela.queryByText('DROP-OFFS')).toBeNull();
  });

  it('NÃO oferece entrega antes da busca terminar', async () => {
    const tela = await render(
      <DriverRouteView stops={[parada({ status: 'pending' })]} onAction={jest.fn()} fase="pickup" etapa="to_yard" />,
    );
    expect(tela.queryByLabelText('Delivered Lucky')).toBeNull();
    expect(tela.queryByText('Delivered')).toBeNull();
    // A busca segue sendo a ação da parada (nada de entregar cão que ainda não foi pego).
    expect(tela.getByText('I arrived')).toBeTruthy();
  });
});
