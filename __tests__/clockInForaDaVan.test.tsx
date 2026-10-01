import { render, fireEvent, waitFor } from '@testing-library/react-native';

import { ShiftCard } from '@/features/driver/ShiftCard';
import { motivoDoClockIn, clockInGate, type ClockInGate } from '@/features/organization/locations';
import type { ShiftState } from '@/features/driver/shift';

/**
 * CLOCK IN FORA DA VAN — a saída de emergência criada em 01/10/2026.
 *
 * Regra da operação: o clock in normal exige a van (raio, migration 034). O cliente, porém, relatou
 * o motorista SEM conseguir dar o clock in ("mesmo chegando na van") e o dia terminou sem jornada
 * nenhuma registrada. O que ficou: o caminho normal continua exigindo a van, e o cartão passa a
 * oferecer o registro COMO EXCEÇÃO, com a distância gravada no motivo — o gestor vê a exceção no
 * relatório de horas em vez de não ver jornada.
 */

const VAN = { id: 'van-1', name: 'Van — Palo Alto', kind: 'van' as const, addressLine1: '3111 La selva', city: 'San Mateo', latitude: 37.4419, longitude: -122.143, radiusMeters: 300, isDefault: true };

/** ~3,2 km ao norte da van: fora do raio de 300 m. */
const LONGE = { latitude: 37.471, longitude: -122.143 };

const fora: ClockInGate = clockInGate({ location: VAN, position: LONGE });

describe('motivoDoClockIn (texto que vai para o banco)', () => {
  it('fora do raio grava o motivo do motorista COM a distância e a van', () => {
    const texto = motivoDoClockIn('Cheguei na van e o app não abriu', fora, VAN.name);
    expect(texto).toContain('Cheguei na van e o app não abriu');
    expect(texto).toContain('started outside the van "Van — Palo Alto"');
    expect(texto).toMatch(/\(3,2 km\)/);
  });

  it('dentro do raio o motivo fica exatamente como o motorista escreveu', () => {
    const dentro = clockInGate({ location: VAN, position: { latitude: 37.4421, longitude: -122.143 } });
    expect(motivoDoClockIn('Journey started at the van', dentro, VAN.name)).toBe('Journey started at the van');
  });

  it('sem posição (não travou) também não mexe no motivo', () => {
    const semPosicao = clockInGate({ location: VAN, position: null });
    expect(motivoDoClockIn('Sem sinal', semPosicao, VAN.name)).toBe('Sem sinal');
  });
});

const estadoJornada: ShiftState = { kind: 'none', source: 'route', manualOpen: false, minutes: 0, startedAt: null, endedAt: null };

describe('cartão da jornada — saída de exceção', () => {
  it('sem recusa não existe botão de exceção', async () => {
    const tela = await render(
      <ShiftCard state={estadoJornada} onClockIn={jest.fn()} onClockOut={jest.fn()} onClockInAnyway={jest.fn()} />,
    );
    expect(tela.queryByLabelText('Clock in anyway')).toBeNull();
  });

  it('depois da recusa: o botão aparece e o registro sai com o motivo digitado', async () => {
    const qualquer = jest.fn();
    const tela = await render(
      <ShiftCard
        state={estadoJornada}
        error={fora.message}
        foraDaVan={{ distanceKm: fora.distanceKm ?? 0, vanName: VAN.name }}
        onClockIn={jest.fn()}
        onClockOut={jest.fn()}
        onClockInAnyway={qualquer}
      />,
    );

    await fireEvent.press(tela.getByLabelText('Clock in anyway'));
    expect(tela.getByText('Clock in outside the van')).toBeTruthy();
    await fireEvent.changeText(tela.getByLabelText('Reason for the manual record'), 'Cheguei na van e não abriu');
    await fireEvent.press(tela.getByLabelText('Save manual record'));
    await waitFor(() => expect(qualquer).toHaveBeenCalledWith('Cheguei na van e não abriu'));
  });

  it('o motivo continua obrigatório (menos de 3 letras não grava)', async () => {
    const qualquer = jest.fn();
    const tela = await render(
      <ShiftCard
        state={estadoJornada}
        foraDaVan={{ distanceKm: 3.2, vanName: VAN.name }}
        onClockIn={jest.fn()}
        onClockOut={jest.fn()}
        onClockInAnyway={qualquer}
      />,
    );
    await fireEvent.press(tela.getByLabelText('Clock in anyway'));
    await fireEvent.changeText(tela.getByLabelText('Reason for the manual record'), 'ok');
    await fireEvent.press(tela.getByLabelText('Save manual record'));
    expect(qualquer).not.toHaveBeenCalled();
  });
});
