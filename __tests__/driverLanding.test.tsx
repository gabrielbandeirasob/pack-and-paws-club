import React from 'react';
import { Text } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';

/**
 * Bug real (visto na versao web em 11/09/2026): depois do login como MOTORISTA, o app
 * abria o painel do GERENTE (com "Add from Contacts" e "New reservation") — telas que
 * nao sao dele, com dados que a RLS dele nem devolve.
 *
 * Correcao: papel driver e redirecionado para "/(tabs)/driver" e o painel nao renderiza.
 */
jest.mock('expo-router', () => ({
  useRouter: () => ({
    replace: (route: string) => (globalThis as any).__replace(route),
    push: () => undefined,
  }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    // executa no mount, como o expo-router faz quando a tela ganha foco
    // eslint-disable-next-line react-hooks/rules-of-hooks
    (require('react') as typeof React).useEffect(() => {
      const cleanup = callback();
      return typeof cleanup === 'function' ? cleanup : undefined;
    }, []);
  },
}));

jest.mock('@/features/auth/useOrganizationRole', () => ({
  useOrganizationRole: () => (globalThis as any).__roleState,
}));

jest.mock('@/features/dashboard/ManagerDashboard', () => ({
  ManagerDashboard: () => {
    const { Text: RNText } = require('react-native');
    return <RNText>MANAGER DASHBOARD</RNText>;
  },
}));

jest.mock('@/lib/supabase', () => {
  const result = { data: [], error: null };
  const chain: any = new Proxy(
    {},
    { get: (_target, prop) => (prop === 'then' ? (resolve: any) => Promise.resolve(result).then(resolve) : () => chain) },
  );
  return {
    supabase: {
      from: () => chain,
      channel: () => chain,
      removeChannel: () => undefined,
      auth: { getUser: async () => ({ data: { user: null } }) },
    },
  };
});

// eslint-disable-next-line import/first
import HomeScreen from '@/app/(tabs)/index';

const replaceMock = jest.fn();

describe('abertura do app por papel', () => {
  beforeEach(() => {
    replaceMock.mockClear();
    (globalThis as any).__replace = replaceMock;
    (globalThis as any).__roleState = { role: 'driver', isLoading: false };
  });

  it('motorista vai para "Today\'s Route" e NAO ve o painel do gerente', async () => {
    const screen = await render(<HomeScreen />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/(tabs)/driver'));
    expect(screen.queryByText('MANAGER DASHBOARD')).toBeNull();
  });

  it('gerente fica no painel, sem redirecionar', async () => {
    (globalThis as any).__roleState = { role: 'manager', isLoading: false };
    const screen = await render(<HomeScreen />);
    expect(replaceMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('MANAGER DASHBOARD')).toBeTruthy());
  });

  it('enquanto o papel carrega, mostra carregando e nao decide nada', async () => {
    (globalThis as any).__roleState = { role: null, isLoading: true };
    const screen = await render(<HomeScreen />);
    expect(replaceMock).not.toHaveBeenCalled();
    expect(screen.queryByText('MANAGER DASHBOARD')).toBeNull();
  });
});
