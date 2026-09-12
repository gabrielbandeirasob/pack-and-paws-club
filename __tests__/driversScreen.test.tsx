/**
 * Tela dos motoristas: o ✕ precisa fechar MESMO com o teclado aberto.
 *
 * No iPhone, com um campo focado, o primeiro toque em um botao pode ser consumido para dispensar
 * o teclado — o usuario toca no ✕ e "nada acontece" (bug relatado). O handler agora dispensa o
 * teclado antes de fechar; este teste garante que (a) fecha e (b) o teclado e dispensado.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Keyboard } from 'react-native';

const membros = [
  { user_id: 'u-1', status: 'active', profiles: { full_name: 'Sam Costa' } },
];

let foco: (() => void) | null = null;

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useFocusEffect: (cb: () => void) => {
    foco = cb;
    const { useEffect } = require('react');
    useEffect(cb, []);
  },
}));

jest.mock('@/features/drivers/DriverInviteForm', () => ({
  DriverInviteForm: () => null,
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'u-0' } } }) },
    from: () => {
      // a tela faz duas consultas: primeiro o vinculo de gestor (para achar a organizacao),
      // depois os membros com papel de motorista. O papel vem no .eq('role', ...).
      let papel = '';
      const resultado = () =>
        papel === 'manager'
          ? { data: [{ organization_id: 'org-1' }], error: null }
          : { data: membros, error: null };
      const construtor: Record<string, unknown> = {};
      construtor.select = () => construtor;
      construtor.eq = (campo: string, valor: string) => {
        if (campo === 'role') papel = valor;
        return construtor;
      };
      for (const metodo of ['order', 'limit', 'update']) {
        construtor[metodo] = () => construtor;
      }
      construtor.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resultado()).then(resolve);
      return construtor;
    },
  },
}));

import DriversScreen from '@/app/drivers';

describe('tela dos motoristas', () => {
  it('lista os motoristas da organizacao', async () => {
    const tela = await render(<DriversScreen />);
    expect(tela.getByText('Sam Costa')).toBeTruthy();
  });

  it('o ✕ do modal de edicao fecha E dispensa o teclado', async () => {
    const dispensar = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
    const tela = await render(<DriversScreen />);

    fireEvent.press(tela.getByLabelText('Edit Sam Costa'));
    await waitFor(() => expect(tela.getByText('Edit driver')).toBeTruthy());

    fireEvent.press(tela.getByLabelText('Close'));

    await waitFor(() => expect(tela.queryByText('Edit driver')).toBeNull());
    expect(dispensar).toHaveBeenCalled();
    dispensar.mockRestore();
  });
});
