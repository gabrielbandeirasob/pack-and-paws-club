import { fireEvent, render } from '@testing-library/react-native';
import { DriverRouteView, type DriverStop } from '@/features/driver/DriverRouteView';

const stops: DriverStop[] = [
  { id: 'stop-1', sequence: 1, status: 'pending', clientName: 'Maria', dogName: 'Bob', address: '123 Main St', city: 'Goiania', instructions: 'Call box 185. Key inside lockbox.' },
  { id: 'stop-2', sequence: 2, status: 'pending', clientName: 'John', dogName: 'Luna', address: 'Oak Avenue 45', city: 'Goiania', instructions: null },
];

describe('DriverRouteView', () => {
  it('lists ordered stops with client, dog, address and instructions', async () => {
    const screen = await render(<DriverRouteView stops={stops} onAction={jest.fn()} />);
    expect(screen.getByText('1. Maria · Bob')).toBeTruthy();
    expect(screen.getByText('123 Main St · Goiania')).toBeTruthy();
    expect(screen.getByText('Call box 185. Key inside lockbox.')).toBeTruthy();
    expect(screen.getByText('2. John · Luna')).toBeTruthy();
  });

  it('fires stop actions for the right stop', async () => {
    const onAction = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<DriverRouteView stops={stops} onAction={onAction} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Mark arrived stop-1' }));
    expect(onAction).toHaveBeenCalledWith('stop-1', 'arrived');
    await fireEvent.press(screen.getByRole('button', { name: 'Navigate to Bob' }));
    expect(onAction).toHaveBeenCalledWith('stop-1', 'navigate');
  });

  it('reveals the completed state after pickup', async () => {
    const progressed: DriverStop[] = [{ ...stops[0], status: 'picked_up' }];
    const screen = await render(<DriverRouteView stops={progressed} onAction={jest.fn()} />);
    expect(screen.getByText('Dog picked up')).toBeTruthy();
  });

  it('mostra a foto do cao do cadastro na parada (e nada quando o cao nao tem foto)', async () => {
    // A foto do cadastro e o que confirma na porta que e o cachorro certo. Sem foto, nao
    // pode aparecer imagem quebrada.
    const comFoto: DriverStop[] = [
      { ...stops[0], dogPhotoUrl: 'https://bhuexxjcrjdhkmsvagdw.supabase.co/storage/v1/object/public/dog-photos/org-1/dog-1/bob.jpg' },
    ];
    const comImagem = await render(<DriverRouteView stops={comFoto} onAction={jest.fn()} />);
    expect(comImagem.getByLabelText('Photo of Bob')).toBeTruthy();

    const semImagem = await render(<DriverRouteView stops={[stops[1]]} onAction={jest.fn()} />);
    expect(semImagem.queryByLabelText('Photo of Luna')).toBeNull();
  });

  it('numera as paradas pela posicao, mesmo se o banco trouxer sequence 0', async () => {
    // Visto no teste na web: a tela mostrava "0. Maria Silva" porque o sequence vinha 0
    // (o painel do Dispatch numerava 1, 2 — a tela do motorista usava o campo cru).
    const zerados: DriverStop[] = [
      { ...stops[0], sequence: 0 },
      { ...stops[1], sequence: 0 },
    ];
    const screen = await render(<DriverRouteView stops={zerados} onAction={jest.fn()} />);
    expect(screen.getByText('1. Maria · Bob')).toBeTruthy();
    expect(screen.getByText('2. John · Luna')).toBeTruthy();
    expect(screen.queryByText('0. Maria · Bob')).toBeNull();
  });

  it('parada concluida continua navegavel: o cartao e o botao levam ao mapa', async () => {
    // Relato do dono (12/09/2026): "rota apareceu mas ao clicar nao direciona a aplicativo algum".
    // Causa: com a parada em Completed/Skipped, TODOS os botoes ficavam atras de `!done` - inclusive
    // o Navigate - entao nao havia como abrir o mapa justamente quando o motorista quer reconferir.
    const onAction = jest.fn().mockResolvedValue(undefined);
    const feita: DriverStop[] = [{ ...stops[0], status: 'completed' }];
    const screen = await render(<DriverRouteView stops={feita} onAction={onAction} />);
    expect(screen.getByText('Completed')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Navigate to Bob' }));
    expect(onAction).toHaveBeenCalledWith('stop-1', 'navigate');

    await fireEvent.press(screen.getByRole('button', { name: 'Open navigation for Bob' }));
    expect(onAction).toHaveBeenCalledTimes(2);
  });
});
