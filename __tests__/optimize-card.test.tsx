/**
 * CARTÃO DO OPTIMIZE ROUTE (pedido do dono, 05/10/2026).
 *
 * Vetores do que o gestor lê e toca:
 *  - a ESTRUTURA da perna (pick-up = Van → paradas → Yard; entrega = Yard → paradas → Van);
 *  - botão desabilitado com menos de 2 paradas elegíveis + o motivo escrito;
 *  - "Optimizing Route…" com rodinha e sem toque repetido enquanto roda;
 *  - depois: "Route Optimized ✓" com tempo e distância ganhos;
 *  - "Undo" para restaurar a ordem anterior;
 *  - erro (ex.: parada sem coordenada) DITO no cartão, com o nome de quem precisa ser corrigido.
 */
import { fireEvent, render } from '@testing-library/react-native';

import { OptimizeRouteCard, OPTIMIZE_STATE_INITIAL, estruturaDaRota, ganhoDaOtimizacao, milhas } from '@/features/dispatch/OptimizeRouteCard';

const semAcao = () => {};

async function montar(extra: Partial<Parameters<typeof OptimizeRouteCard>[0]> = {}) {
  const props = {
    phase: 'pickup' as const,
    paradas: 7,
    vanName: 'Van 1',
    yardName: 'Yard',
    state: OPTIMIZE_STATE_INITIAL,
    onOptimize: semAcao,
    onUndo: semAcao,
    ...extra,
  };
  return render(<OptimizeRouteCard {...props} />);
}

describe('OptimizeRouteCard — o que o gestor lê', () => {
  it('mostra a estrutura do PICK-UP: Van → paradas → Yard', async () => {
    const tela = await montar();
    expect(tela.getByText('Optimize Route')).toBeTruthy();
    expect(tela.getByTestId('optimize-structure').props.children).toBe('Van 1 → 7 pickups → Yard');
    expect(tela.getByTestId('optimize-button')).toBeTruthy();
  });

  it('mostra a estrutura da ENTREGA ao contrário: Yard → paradas → Van', async () => {
    const tela = await montar({ phase: 'dropoff', paradas: 7 });
    expect(tela.getByTestId('optimize-structure').props.children).toBe('Yard → 7 drop-offs → Van 1');
  });

  it('usa singular com uma parada', async () => {
    expect(estruturaDaRota('pickup', 1, 'Van 1', 'Yard')).toBe('Van 1 → 1 pickup → Yard');
    expect(estruturaDaRota('dropoff', 1, 'Van 1', 'Yard')).toBe('Yard → 1 drop-off → Van 1');
  });

  it('com menos de 2 paradas elegíveis o botão fica DESABILITADO e o motivo aparece', async () => {
    const tela = await montar({ paradas: 1 });
    expect(tela.getByTestId('optimize-button').props.accessibilityState?.disabled).toBe(true);
    expect(tela.getByText(/At least 2 stops/)).toBeTruthy();
  });

  it('sem parada nenhuma explica que o dia já está fechado', async () => {
    const tela = await montar({ paradas: 0 });
    expect(tela.getByText(/already done or skipped/)).toBeTruthy();
  });

  it('enquanto roda: "Optimizing Route…", rodinha e toque bloqueado', async () => {
    const tela = await montar({ state: { busy: true, result: null, error: null, canUndo: false } });
    expect(tela.getByText('Optimizing Route…')).toBeTruthy();
    expect(tela.getByTestId('optimize-spinner')).toBeTruthy();
    expect(tela.getByTestId('optimize-button').props.accessibilityState?.disabled).toBe(true);
  });

  it('depois: "Route Optimized ✓" com tempo e distância ganhos, e o Undo disponível', async () => {
    const onUndo = jest.fn();
    const tela = await montar({
      state: { busy: false, error: null, canUndo: true, result: { minutesBefore: 71, minutesAfter: 53, kmBefore: 20.1, kmAfter: 13.4 } },
      onUndo,
    });
    expect(tela.getByText('Route Optimized ✓')).toBeTruthy();
    expect(tela.getByTestId('optimize-result').props.children).toBe('18 min faster · 4.2 mi saved');
    fireEvent.press(tela.getByTestId('optimize-undo'));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('erro (parada sem coordenada) é DITO no cartão, com quem precisa ser corrigido', async () => {
    const tela = await montar({
      state: { ...OPTIMIZE_STATE_INITIAL, error: 'Missing coordinates for: Luna, Max. Add an address to these clients first.' },
    });
    expect(tela.getByText(/Luna, Max/)).toBeTruthy();
  });

  it('não promete ganho que não existe (nem quando a rota fica pior)', async () => {
    expect(ganhoDaOtimizacao({ minutesBefore: 40, minutesAfter: 40, kmBefore: 10, kmAfter: 10 })).toBeNull();
    // Janela/horário marcado pode deixar a ordem mais LONGA — o cartão diz a verdade em vez de comemorar.
    expect(ganhoDaOtimizacao({ minutesBefore: 40, minutesAfter: 44, kmBefore: 10, kmAfter: 10 })).toBe('4 min slower');
    expect(ganhoDaOtimizacao({ minutesBefore: 40, minutesAfter: 44, kmBefore: 10, kmAfter: 12 })).toBe('4 min slower · 1.2 mi added');
    // Sem coordenada não há distância: sai só o tempo.
    expect(ganhoDaOtimizacao({ minutesBefore: 71, minutesAfter: 53, kmBefore: null, kmAfter: null })).toBe('18 min faster');
  });

  it('converte km em milhas como o cliente lê (4.2 mi)', async () => {
    expect(milhas(6.8)).toBe('4.2 mi');
    expect(milhas(20)).toBe('12 mi');
  });
});
