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
    expect(miniatura.props.source).toEqual({ uri: FOTO });
    // A miniatura é o botão: o rótulo diz que dá para ver maior.
    expect(tela.getByLabelText('Photo of Bob — tap to see it bigger')).toBeTruthy();
  });

  it('tocar na miniatura abre a foto GRANDE com o nome do cão', async () => {
    const tela = await painel(parada({ dogPhotoUrl: FOTO }));

    expect(tela.queryByLabelText('Bigger photo of Bob — tap to close')).toBeNull();

    fireEvent.press(tela.getByLabelText('Photo of Bob — tap to see it bigger'));

    await waitFor(() => expect(tela.getByLabelText('Bigger photo of Bob — tap to close')).toBeTruthy());
    expect(tela.getByText('Bob · Maria')).toBeTruthy();
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
    expect(tela.getByText('Maria · Bob')).toBeTruthy();
    expect(tela.getByText('123 Main St · San Francisco')).toBeTruthy();
    expect(tela.getByText(/min away/)).toBeTruthy();
  });
});
