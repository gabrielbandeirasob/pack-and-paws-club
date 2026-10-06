/**
 * "ao mudar uma parada do driver pelo painel a rota no driver não atualiza automaticamente" (dono,
 * 05/10/2026). A causa raiz do evento de DELETE está no banco (migração 202610050100); aqui se trava o
 * OUTRO caso: o app em SEGUNDO PLANO perde o canal de tempo real, então ao voltar para a frente a tela
 * tem de reler — e só na VOLTA, não em qualquer mexida de estado (bateria do motorista).
 */
import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { deveReler, useRelendoAoVoltarParaFrente } from '@/features/driver/useVoltaParaFrente';

describe('deveReler (decisão pura)', () => {
  it('relê quando o app VOLTA para a frente', () => {
    expect(deveReler('background', 'active')).toBe(true);
    expect(deveReler('inactive', 'active')).toBe(true);
  });

  it('não relê em qualquer outra mudança de estado', () => {
    expect(deveReler('active', 'active')).toBe(false);
    expect(deveReler('active', 'background')).toBe(false);
    expect(deveReler('active', 'inactive')).toBe(false);
    expect(deveReler('background', 'inactive')).toBe(false);
  });
});

describe('useRelendoAoVoltarParaFrente (ligado ao aparelho)', () => {
  const ouvintes: Array<(estado: string) => void> = [];
  const remover = jest.fn();

  const irPara = async (estado: string) => {
    await act(async () => {
      ouvintes.forEach((ouvinte) => ouvinte(estado));
    });
  };

  beforeEach(() => {
    ouvintes.length = 0;
    remover.mockClear();
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_tipo: string, handler: (estado: string) => void) => {
      ouvintes.push(handler);
      return { remove: remover };
    }) as never);
    (AppState as unknown as { currentState: string }).currentState = 'active';
  });

  afterEach(() => jest.restoreAllMocks());

  it('queda para segundo plano e volta dispara a releitura UMA vez', async () => {
    const reler = jest.fn();
    await renderHook(() => useRelendoAoVoltarParaFrente(reler));

    await irPara('background');
    expect(reler).not.toHaveBeenCalled();

    await irPara('active');
    expect(reler).toHaveBeenCalledTimes(1);
  });

  it('seguir na frente (active -> active) NÃO recarrega', async () => {
    const reler = jest.fn();
    await renderHook(() => useRelendoAoVoltarParaFrente(reler));

    await irPara('active');
    await irPara('active');
    expect(reler).not.toHaveBeenCalled();
  });

  it('sair da tela tira o ouvinte do aparelho', async () => {
    const reler = jest.fn();
    const { unmount } = await renderHook(() => useRelendoAoVoltarParaFrente(reler));
    await act(async () => { unmount(); });
    expect(remover).toHaveBeenCalled();
  });
});
