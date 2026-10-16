/**
 * TELA DE ATUALIZAÇÃO OBRIGATÓRIA (dono, 16/10/2026: "o app só funciona com a versão mais recente").
 *
 * A tela precisa ENSINAR o caminho: o OTA do app está desligado (`EXUpdatesEnabled = False` no IPA),
 * então quem atualiza é o TestFlight — dizer só "atualize" não resolve para quem está no escritório.
 *
 * Fica separado do teste do gancho de propósito: `render` aqui é assíncrono e a combinação de várias
 * telas na mesma suíte deixa `act()` sobreposto, derrubando os testes seguintes.
 */
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { AtualizacaoObrigatoria } from '@/features/release/AtualizacaoObrigatoria';

const mockSignOut = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { signOut: () => mockSignOut() }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }) },
}));

jest.mock('react-native-safe-area-context', () => {
  const m = require('react-native-safe-area-context/jest/mock');
  return { ...m.default, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

describe('tela de atualização obrigatória', () => {
  beforeEach(() => mockSignOut.mockClear());

  it('diz a build do aparelho, a exigida e o passo do TestFlight (não é só "atualize")', async () => {
    const tela = await render(
      <AtualizacaoObrigatoria buildAtual={164} buildMinima={166} conferindo={false} onRechecar={() => undefined} />,
    );
    expect(tela.getByText(/Update the app to continue/)).toBeTruthy();
    expect(tela.getByText(/on build 164/)).toBeTruthy();
    expect(tela.getByText(/needs build 166 or newer/)).toBeTruthy();
    expect(tela.getByText(/Open TestFlight on this phone/)).toBeTruthy();
    expect(tela.getByText(/Pull the list down and tap Update/)).toBeTruthy();
    expect(tela.getByText(/turn Automatic Updates on/)).toBeTruthy();
  });

  it('"Check again" reconsulta e "Sign out" dá saída para quem não vai atualizar agora', async () => {
    const rechecar = jest.fn();
    const tela = await render(
      <AtualizacaoObrigatoria buildAtual={164} buildMinima={166} conferindo={false} onRechecar={rechecar} />,
    );
    fireEvent.press(tela.getByText('Check again'));
    expect(rechecar).toHaveBeenCalledTimes(1);
    fireEvent.press(tela.getByText('Sign out'));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('enquanto reconfere, o botão mostra o giro em vez do texto', async () => {
    const tela = await render(
      <AtualizacaoObrigatoria buildAtual={164} buildMinima={166} conferindo onRechecar={() => undefined} />,
    );
    expect(tela.queryByText('Check again')).toBeNull();
  });
});
