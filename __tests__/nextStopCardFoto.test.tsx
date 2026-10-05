/**
 * FOTO DO CÃO NO PAINEL "NEXT STOP" — pedido do dono, 02/10/2026:
 * "nessa parte do driver apareça a foto do cachorro e que ao clicar nela ela fique maior".
 *
 * O QUE ESTES TESTES TRAVAM:
 *  - com foto no cadastro, a miniatura aparece e é tocável (é o que confirma o cão certo na porta);
 *  - tocar abre a foto GRANDE (tela cheia) com o nome do cão, e tocar de novo fecha;
 *  - sem foto no cadastro, nada aparece (nem imagem quebrada) e o cartão continua igual;
 *  - o resto do cartão (nome, endereço, ETA) segue na tela — a foto não empurra informação para fora.
 *
 * Antes da correção o painel NÃO mostrava foto nenhuma: os dois primeiros casos falhavam.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { NextStopCard, nextActionForStatus } from '@/features/driver/NextStopCard';
import type { DriverStop } from '@/features/driver/DriverRouteView';
import { dogPhotoThumbnailUrl } from '@/features/dogs/dogPhoto';

const FOTO = 'https://exemplo.supabase.co/storage/v1/object/public/dog-photos/org/bob.jpg';

function parada(over: Partial<DriverStop> = {}): DriverStop {
  return {
    id: 'stop-1',
    sequence: 1,
    status: 'pending',
    clientName: 'Maria',
    dogName: 'Bob',
    address: '123 Main St',
    city: 'San Francisco',
    instructions: null,
    etaMinutes: 12,
    ...over,
  };
}

async function painel(stop: DriverStop) {
  return render(
    <NextStopCard
      stop={stop}
      nextAction={nextActionForStatus(stop.status, stop.deliveredAt)}
      onNavigate={jest.fn()}
      onAction={jest.fn()}
      onNotifyOwner={undefined}
    />,
  );
}

describe('NEXT STOP — foto do cão', () => {
  it('com foto no cadastro: mostra a miniatura e ela é tocável', async () => {
    const tela = await painel(parada({ dogPhotoUrl: FOTO }));

    const miniatura = tela.getByLabelText('Photo of Bob');
    expect(miniatura).toBeTruthy();
    // A MINIATURA do painel (64 pt) vem da transformação do Storage — NÃO é a foto original de
    // ~207 KB (auditoria de desempenho, 02/10/2026). O painel baixa ~12 KB no lugar da imagem cheia.
    expect(miniatura.props.source).toEqual({ uri: dogPhotoThumbnailUrl(FOTO) });
    expect(miniatura.props.source.uri).toContain('/storage/v1/render/image/public/');
    // A miniatura é o botão: o rótulo diz que dá para ver maior.
    expect(tela.getByLabelText('Photo of Bob — tap to see it bigger')).toBeTruthy();
  });

  it('a foto GRANDE do modal continua na URL original (é onde "ver maior" faz sentido)', async () => {
    const tela = await painel(parada({ dogPhotoUrl: FOTO }));

    fireEvent.press(tela.getByLabelText('Photo of Bob — tap to see it bigger'));
    await waitFor(() => expect(tela.getByLabelText('Bigger photo of Bob — tap to close')).toBeTruthy());

    const grande = tela.getByTestId('next-stop-photo-full');
    expect(grande.props.source).toEqual({ uri: FOTO });
  });

  it('tocar na miniatura abre a foto GRANDE com o nome do cão', async () => {
    const tela = await painel(parada({ dogPhotoUrl: FOTO }));

    expect(tela.queryByLabelText('Bigger photo of Bob — tap to close')).toBeNull();

    fireEvent.press(tela.getByLabelText('Photo of Bob — tap to see it bigger'));

    await waitFor(() => expect(tela.getByLabelText('Bigger photo of Bob — tap to close')).toBeTruthy());
    // A legenda da foto grande é só o nome do cão (o título do cartão, atrás, também mostra "Bob").
    expect(tela.getByTestId('next-stop-photo-caption')).toBeTruthy();
    expect(tela.getAllByText('Bob').length).toBeGreaterThanOrEqual(2);
    expect(tela.getByText('Tap anywhere to close')).toBeTruthy();
  });

  it('tocar na foto grande fecha', async () => {
    const tela = await painel(parada({ dogPhotoUrl: FOTO }));

    fireEvent.press(tela.getByLabelText('Photo of Bob — tap to see it bigger'));
    await waitFor(() => expect(tela.getByLabelText('Bigger photo of Bob — tap to close')).toBeTruthy());

    fireEvent.press(tela.getByLabelText('Bigger photo of Bob — tap to close'));
    await waitFor(() => expect(tela.queryByLabelText('Bigger photo of Bob — tap to close')).toBeNull());
  });

  it('sem foto no cadastro: nenhuma imagem aparece e o cartão continua inteiro', async () => {
    const tela = await painel(parada({ dogPhotoUrl: null }));

    expect(tela.queryByLabelText('Photo of Bob')).toBeNull();
    expect(tela.queryByLabelText('Photo of Bob — tap to see it bigger')).toBeNull();
    // O resto do cartão não pode ter sido empurrado para fora.
    expect(tela.getByText('Bob')).toBeTruthy();
    expect(tela.getByText('123 Main St · San Francisco')).toBeTruthy();
    expect(tela.getByText(/min away/)).toBeTruthy();
  });
});

it('redesign mantém uma ação dominante e promove chegada depois de navegar', async () => {
  const navegar = jest.fn();
  const agir = jest.fn();
  const tela = await render(<NextStopCard stop={parada()} nextAction="arrived" onNavigate={navegar} onAction={agir} />);
  expect(tela.getByTestId('stop-primary').props.accessibilityLabel).toBe('Next stop: navigate to Bob');
  await fireEvent.press(tela.getByTestId('stop-primary'));
  expect(navegar).toHaveBeenCalledTimes(1);
  expect(tela.getByTestId('stop-primary').props.accessibilityLabel).toBe('Next stop: I arrived for Bob');
  expect(agir).not.toHaveBeenCalled();
});

it('redesign conclusão explícita mantém o handler obrigatório', async () => {
  const agir = jest.fn();
  const tela = await render(<NextStopCard stop={parada({ status: 'arrived' })} nextAction="finish" onNavigate={jest.fn()} onAction={agir} />);
  expect(tela.getByText('Complete pickup')).toBeTruthy();
  await fireEvent.press(tela.getByTestId('stop-primary'));
  expect(agir).toHaveBeenCalledWith('stop-1', 'finish');
});

it('redesign entrega exige toque explícito e mantém saída de problema', async () => {
  const agir = jest.fn();
  const tela = await render(<NextStopCard stop={parada({ status: 'completed' })} nextAction="deliver" onNavigate={jest.fn()} onAction={agir} />);
  expect(agir).not.toHaveBeenCalled();
  expect(tela.getByText('Complete drop-off')).toBeTruthy();
  expect(tela.getByText('Report issue')).toBeTruthy();
  await fireEvent.press(tela.getByTestId('stop-primary'));
  expect(agir).toHaveBeenCalledWith('stop-1', 'deliver');
});
