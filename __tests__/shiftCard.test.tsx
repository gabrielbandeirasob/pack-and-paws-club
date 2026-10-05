import { fireEvent, render, within } from '@testing-library/react-native';

import { ShiftCard } from '@/features/driver/ShiftCard';
import { shiftState } from '@/features/driver/shift';

/**
 * Cartão da jornada do motorista (clock in / clock out) — pedido do cliente (16/09/2026).
 *
 * O que estes testes travam:
 *  - dia normal: a jornada aparece DEDUZIDA da rota e o motorista não precisa apertar nada;
 *  - sem jornada nenhuma: aparece o botão "Clock in";
 *  - clock in/out manual exige motivo (é exceção) e o motivo é o que vai para o banco;
 *  - sem sinal o motorista é avisado de que o registro está guardado no aparelho.
 */

const PARADAS = [
  { id: 's1', sequence: 1, status: 'arrived', arrivedAt: '2026-09-23T11:10:00.000Z', pickedUpAt: null, completedAt: null, skippedAt: null },
  { id: 's2', sequence: 2, status: 'pending', arrivedAt: null, pickedUpAt: null, completedAt: null, skippedAt: null },
];

const journey = shiftState(PARADAS, []);

async function montar(overrides: Partial<React.ComponentProps<typeof ShiftCard>> = {}) {
  const onClockIn = jest.fn();
  const onClockOut = jest.fn();
  // @testing-library/react-native v14: render é assíncrono.
  const tela = await render(
    <ShiftCard state={journey} pendingCount={0} busy={false} error={null} onClockIn={onClockIn} onClockOut={onClockOut} {...overrides} />,
  );
  return { tela, onClockIn, onClockOut };
}

describe('ShiftCard (jornada do motorista)', () => {
  it('mostra a jornada deduzida da rota e explica que não precisa apertar nada', async () => {
    const { tela } = await montar();
    expect(tela.getByText(/Clocked in/)).toBeTruthy();
    await fireEvent.press(tela.getByLabelText('Journey details'));
    expect(tela.getByText('Worked out from your route stops — nothing to press.')).toBeTruthy();
  });

  it('offers van navigation beside Clock in outside the radius without recording a journey', async () => {
    const onNavigateVan = jest.fn();
    const { tela, onClockIn, onClockOut } = await montar({
      state: shiftState([], []),
      gateHint: 'Clock in opens at the van — you are 3.2 km away (radius of 300 m).',
      foraDaVan: { distanceKm: 3.2, vanName: 'Assigned van' },
      navigation: { kind: 'van', onPress: onNavigateVan },
    });
    const card = within(tela.getByTestId('cartao-jornada'));
    expect(card.getByLabelText('Clock in')).toBeTruthy();
    await fireEvent.press(card.getByRole('button', { name: 'Navigate to van' }));
    expect(onNavigateVan).toHaveBeenCalledTimes(1);
    expect(onClockIn).not.toHaveBeenCalled();
    expect(onClockOut).not.toHaveBeenCalled();
    expect(tela.queryByLabelText('Reason for the manual record')).toBeNull();
  });

  it('sem jornada ainda, oferece o clock in', async () => {
    const { onClockIn, tela } = await montar({ state: shiftState([{ ...PARADAS[1] }], []) });
    await fireEvent.press(tela.getByLabelText('Clock in'));
    await fireEvent.changeText(tela.getByLabelText('Reason for the manual record'), 'Started before the first stop');
    await fireEvent.press(tela.getByLabelText('Save manual record'));
    expect(onClockIn).toHaveBeenCalledWith('Started before the first stop');
  });

  it('não deixa registrar sem motivo (é registro de exceção)', async () => {
    const { onClockIn, tela } = await montar({ state: shiftState([], []) });
    await fireEvent.press(tela.getByLabelText('Clock in'));
    // O botão de salvar fica desabilitado sem motivo: registro manual é exceção e o motivo é o que
    // o gestor lê depois.
    await fireEvent.press(tela.getByLabelText('Save manual record'));
    expect(onClockIn).not.toHaveBeenCalled();
  });

  it('fecha a jornada deduzida com o motivo do clock out', async () => {
    const { onClockOut, tela } = await montar();
    await fireEvent.press(tela.getByLabelText('Clock out'));
    await fireEvent.changeText(tela.getByLabelText('Reason for the manual record'), 'Van broke down');
    await fireEvent.press(tela.getByLabelText('Save manual record'));
    expect(onClockOut).toHaveBeenCalledWith('Van broke down');
  });

  it('avisa quantos registros estão esperando subir quando está sem sinal', async () => {
    const { tela } = await montar({ pendingCount: 2 });
    expect(tela.getByText('2 to sync')).toBeTruthy();
  });

  it('mostra o erro que o servidor devolveu', async () => {
    const { tela } = await montar({ error: 'You already have a journey open.' });
    expect(tela.getByText('You already have a journey open.')).toBeTruthy();
  });
});

/**
 * O TECLADO NÃO COBRE O CAMPO DO CLOCK IN MANUAL (reclamação do dono, 01/10/2026: *"quando vai colocar
 * clock in manual o teclado ocupa a tela e não consigo [ver] o que estou digitando"*).
 *
 * A folha abre colada no rodapé dentro de um Modal, e o teclado subia por cima do campo do motivo. A
 * prova estrutural: a folha vive dentro de um KeyboardAvoidingView (com comportamento por plataforma) e
 * de um ScrollView que rola com o teclado aberto.
 */
describe('clock in manual — teclado não esconde o campo', () => {
  it('a folha sobe com o teclado e rola se não couber', async () => {
    // Sem jornada ainda: o botão é o "Clock in", que abre a folha do registro manual.
    const { tela } = await montar({ state: shiftState([], []) });
    await fireEvent.press(tela.getByLabelText('Clock in'));
    expect(tela.getByText('Clock in manually')).toBeTruthy();

    // A folha (campo + botões) vive DENTRO da área que sobe com o teclado, e essa área rola quando o
    // conteúdo não cabe (tela pequena / fonte grande do sistema).
    const evitando = tela.getByTestId('manual-clock-avoiding');
    expect(within(evitando).getByLabelText('Reason for the manual record')).toBeTruthy();
    expect(within(evitando).getByTestId('manual-clock-rolagem')).toBeTruthy();
  });
});
