import { fireEvent, render } from '@testing-library/react-native';

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
    expect(tela.getByText(/On the clock since/)).toBeTruthy();
    expect(tela.getByText('Worked out from your route stops — nothing to press.')).toBeTruthy();
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
