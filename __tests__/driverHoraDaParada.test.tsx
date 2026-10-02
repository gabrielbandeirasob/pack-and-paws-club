import { render } from '@testing-library/react-native';

import { DriverRouteView, type DriverStop } from '@/features/driver/DriverRouteView';

/**
 * A HORA NA TELA DO MOTORISTA — pedido do cliente em áudio (01/10/2026): "podia aparecer qual
 * cachorro já foi e que hora". Os marcos são carimbados no servidor (migration 024) e agora aparecem
 * embaixo de cada parada, com a MESMA frase que o gestor lê na lista da rota.
 */
const emLocal = (hora: number, minuto: number) => new Date(2026, 9, 1, hora, minuto).toISOString();

const parada = (extra: Partial<DriverStop>): DriverStop => ({
  id: 'stop-1',
  sequence: 1,
  status: 'pending',
  clientName: 'Andrea',
  dogName: 'Oreo',
  address: '329 Middlefield Rd',
  city: 'Palo Alto',
  instructions: null,
  ...extra,
});

describe('DriverRouteView — hora de cada parada', () => {
  it('parada concluída mostra chegada e conclusão', async () => {
    const tela = await render(
      <DriverRouteView
        stops={[parada({ status: 'completed', arrivedAt: emLocal(8, 12), completedAt: emLocal(8, 18) })]}
        onAction={jest.fn()}
      />,
    );
    expect(tela.getByText('arrived 8:12 AM · done 8:18 AM')).toBeTruthy();
  });

  it('parada pendente mostra a previsão (janela/hora exigida)', async () => {
    const tela = await render(
      <DriverRouteView stops={[parada({ status: 'pending', exactTime: '08:30:00' })]} onAction={jest.fn()} />,
    );
    expect(tela.getByText('Must arrive by 8:30 AM')).toBeTruthy();
  });

  it('parada com problema mostra a hora do problema', async () => {
    const tela = await render(
      <DriverRouteView
        stops={[parada({ status: 'skipped', arrivedAt: emLocal(8, 0), skippedAt: emLocal(8, 14) })]}
        onAction={jest.fn()}
      />,
    );
    expect(tela.getByText('Problem · 8:14 AM')).toBeTruthy();
  });
});
