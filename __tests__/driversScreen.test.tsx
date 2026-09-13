/**
 * Tela dos motoristas.
 *
 * 1. o ✕ precisa fechar MESMO com o teclado aberto.
 *    No iPhone, com um campo focado, o primeiro toque em um botao pode ser consumido para dispensar
 *    o teclado — o usuario toca no ✕ e "nada acontece" (bug relatado). O handler agora dispensa o
 *    teclado antes de fechar; este teste garante que (a) fecha e (b) o teclado e dispensado.
 * 2. remover motorista: pergunta antes, apaga o VINCULO (organization_members) e os tokens de push.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, Keyboard } from 'react-native';

const membros = [
  { user_id: 'u-1', status: 'active', profiles: { full_name: 'Sam Costa' } },
];

const mockRemovals: { table: string; user?: string }[] = [];
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

jest.mock('@/lib/supabase', () => {
  function builder(table: string) {
    let papel = '';
    const b: Record<string, unknown> & { _user?: string; _deleted?: boolean } = {};
    b.select = () => b;
    b.eq = (campo: string, valor: string) => {
      if (campo === 'role') papel = valor;
      if (campo === 'user_id') b._user = valor;
      return b;
    };
    for (const metodo of ['order', 'limit', 'update', 'gte', 'lt']) {
      b[metodo] = () => b;
    }
    b.delete = () => {
      b._deleted = true;
      return b;
    };
    b.then = (resolve: (v: unknown) => unknown) => {
      if (b._deleted) mockRemovals.push({ table, user: b._user });
      let resultado: unknown = { data: null, error: null, count: 0 };
      if (table === 'organization_members') {
        // a tela faz duas consultas: primeiro o vinculo de gestor (para achar a organizacao),
        // depois os membros com papel de motorista. O papel vem no .eq('role', ...).
        resultado = papel === 'manager' ? { data: [{ organization_id: 'org-1' }], error: null } : { data: membros, error: null };
      } else if (table === 'routes') {
        resultado = { data: null, error: null, count: 2 };
      }
      return Promise.resolve(resultado).then(resolve);
    };
    return b;
  }
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'u-0' } } }) },
      from: (tabela: string) => builder(tabela),
    },
  };
});

import DriversScreen from '@/app/drivers';

describe('tela dos motoristas', () => {
  beforeEach(() => { mockRemovals.length = 0; });

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

  it('remover motorista: avisa antes, apaga o vinculo e os tokens de push', async () => {
    const alertas: { title?: string; message?: string; buttons?: { text?: string; onPress?: () => void }[] }[] = [];
    const alerta = jest.spyOn(Alert, 'alert').mockImplementation((title?: string, message?: string, buttons?: unknown) => {
      alertas.push({ title, message, buttons: buttons as { text?: string; onPress?: () => void }[] });
    });

    const tela = await render(<DriversScreen />);
    fireEvent.press(tela.getByLabelText('Edit Sam Costa'));
    await waitFor(() => expect(tela.getByText('Edit driver')).toBeTruthy());

    // O impacto e carregado em segundo plano; o botao abre o alerta com o aviso certo.
    await waitFor(() => expect(tela.getByLabelText('Remove driver')).toBeTruthy());
    fireEvent.press(tela.getByLabelText('Remove driver'));

    const aviso = alertas[alertas.length - 1];
    expect(aviso.title).toBe('Remove Sam Costa from the team?');
    expect(aviso.message).toContain('2 routes from today on');

    const confirmar = aviso.buttons?.find((b) => b.text === 'Remove anyway');
    expect(confirmar).toBeTruthy();
    confirmar?.onPress?.();

    await waitFor(() => expect(mockRemovals.some((r) => r.table === 'organization_members' && r.user === 'u-1')).toBe(true));
    await waitFor(() => expect(mockRemovals.some((r) => r.table === 'device_tokens' && r.user === 'u-1')).toBe(true));
    alerta.mockRestore();
  });
});
