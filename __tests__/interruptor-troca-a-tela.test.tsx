import React from 'react';
import { Pressable, Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockConta = { role: 'manager' };
const mockSetView = jest.fn();
const mockReplace = jest.fn();
const mockMontouAbas = jest.fn();
const mockNavegacao = {
  rota: '/(tabs)',
  ouvintes: new Set<() => void>(),
};

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'u1', email: 'alex@example.test' } } }),
}));
jest.mock('@/features/auth/useOrganizationRole', () => {
  const real = jest.requireActual('@/features/auth/useOrganizationRole');
  return {
    useOrganizationRole: () => {
      const estado = real.useOrganizationRole();
      return {
        ...estado,
        setView: (view: string) => { mockSetView(view); estado.setView(view); },
      };
    },
  };
});
jest.mock('@/features/driver/locationService', () => ({
  getCurrentDriverLocation: async () => null,
  startLocationSharing: async () => ({ stop: () => undefined }),
}));
jest.mock('@/lib/supabase', () => {
  const cadeia = (tabela: string) => {
    const dados = tabela === 'organization_members'
      ? [{ role: mockConta.role, organization_id: 'org1', user_id: 'u1', profiles: { full_name: 'Alex' } }]
      : tabela === 'profiles' ? [{ full_name: 'Alex' }] : [];
    const builder: any = new Proxy({}, {
      get: (_, campo) => {
        if (campo === 'then') return (resolve: any) => Promise.resolve({ data: dados, error: null }).then(resolve);
        if (campo === 'maybeSingle') return async () => ({ data: dados[0] ?? null, error: null });
        return () => builder;
      },
    });
    return builder;
  };
  return { supabase: {
    from: cadeia,
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'alex@example.test', user_metadata: { full_name: 'Alex' } } } }) },
    channel: () => cadeia('channel'),
    removeChannel: jest.fn(),
  } };
});
jest.mock('expo-router', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  const router = {
    replace: (rota: string) => {
      mockReplace(rota);
      mockNavegacao.rota = rota;
      mockNavegacao.ouvintes.forEach((ouvinte) => ouvinte());
    },
    push: jest.fn(),
  };
  const Tabs = ({ children }: any) => {
    React.useEffect(() => { mockMontouAbas(); }, []);
    const rota = React.useSyncExternalStore(
      (ouvinte: () => void) => {
        mockNavegacao.ouvintes.add(ouvinte);
        return () => mockNavegacao.ouvintes.delete(ouvinte);
      },
      () => mockNavegacao.rota,
    );
    const Tela = rota === '/(tabs)/driver'
      ? require('@/app/(tabs)/driver').default
      : require('@/app/(tabs)/index').default;
    return <View><View testID="abas">{children}</View><Tela /></View>;
  };
  Tabs.Screen = ({ name, options }: any) => options.href === null ? null : <Text testID={`aba-${name}`}>{options.title}</Text>;
  return {
    Tabs, router, useRouter: () => router,
    useFocusEffect: (callback: () => void) => React.useEffect(callback, [callback]),
  };
});

import TabLayout from '@/app/(tabs)/_layout';
import HomeScreen from '@/app/(tabs)/index';
import { useOrganizationRole } from '@/features/auth/useOrganizationRole';
import { esquecerVisaoAtiva, lerVisaoAtiva, salvarVisaoAtiva } from '@/features/auth/activeRoleStore';
import * as SecureStore from 'expo-secure-store';

beforeEach(() => {
  jest.clearAllMocks();
  esquecerVisaoAtiva();
  mockConta.role = 'manager';
  mockNavegacao.rota = '/(tabs)';
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
});

it('Home liga; rota desliga: troca cabeçalhos, abas e destino sem remontar as abas', async () => {
  const tela = await render(<TabLayout />);
  const interruptor = await tela.findByLabelText('Drive today');
  expect(tela.getByText(/Good .*Alex/)).toBeTruthy();
  expect(tela.getByTestId('aba-index')).toBeTruthy();
  expect(tela.queryByTestId('aba-driver')).toBeNull();
  await fireEvent(interruptor, 'valueChange', true);
  expect(mockSetView).toHaveBeenLastCalledWith('driver');
  expect(mockReplace).toHaveBeenCalledWith('/(tabs)/driver');
  await tela.findByTestId('driver-scroll');
  await tela.findByText('No published route today');
  for (const aba of ['driver', 'schedule', 'assigned', 'profile']) expect(tela.getByTestId(`aba-${aba}`)).toBeTruthy();
  expect(tela.queryByTestId('aba-index')).toBeNull();
  expect(tela.getByLabelText('Drive today').props.value).toBe(true);
  // O interruptor passou a ser UMA linha (dono, 27/09/2026: "tomando muito espaço"): no lugar do par de
  // frases de ajuda ficou a legenda de duas palavras — o comportamento é o mesmo.
  expect(tela.getByText('driver view')).toBeTruthy();
  expect(mockReplace).not.toHaveBeenCalledWith('/(tabs)');

  await fireEvent(tela.getByLabelText('Drive today'), 'valueChange', false);
  expect(mockSetView).toHaveBeenLastCalledWith('manager');
  expect(mockReplace).toHaveBeenLastCalledWith('/(tabs)');
  await tela.findByText(/Good .*Alex/);
  for (const aba of ['index', 'calendar', 'dispatch', 'clients', 'more']) expect(tela.getByTestId(`aba-${aba}`)).toBeTruthy();
  expect(tela.queryByTestId('aba-driver')).toBeNull();
  expect(tela.getByLabelText('Drive today').props.value).toBe(false);
  expect(mockMontouAbas).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(SecureStore.setItemAsync).toHaveBeenLastCalledWith('packpaws.visaoAtiva.v1', 'manager'));
});

it('gestor com escolha salva abre a rota e permanece nela', async () => {
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('driver');
  const tela = await render(<TabLayout />);
  await tela.findByText('No published route today');
  expect(tela.getByLabelText('Drive today').props.value).toBe(true);
  expect(tela.queryByTestId('aba-index')).toBeNull();
  expect(mockReplace).not.toHaveBeenCalledWith('/(tabs)');
});

it('Home não mostra interruptor nem painel para motorista', async () => {
  mockConta.role = 'driver';
  const tela = await render(<HomeScreen />);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)/driver'));
  expect(tela.queryByLabelText('Drive today')).toBeNull();
  expect(tela.queryByText(/Good .*Alex/)).toBeNull();
});

it('motorista não vê interruptor na rota e setView(manager) não altera visão nem grava', async () => {
  mockConta.role = 'driver';
  function Sonda() {
    const { view, setView, isLoading } = useOrganizationRole();
    return <Pressable accessibilityLabel="Forçar gestor" disabled={isLoading} onPress={() => setView('manager')}><Text testID="visao">{view}</Text></Pressable>;
  }
  const tela = await render(<><TabLayout /><Sonda /></>);
  await tela.findByText('No published route today');
  expect(tela.queryByLabelText('Drive today')).toBeNull();
  await fireEvent.press(tela.getByLabelText('Forçar gestor'));
  expect(tela.getByTestId('visao').props.children).toBe('driver');
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});

it('leitura lenta do cofre não desfaz uma escolha nova', async () => {
  let concluir!: (valor: string) => void;
  (SecureStore.getItemAsync as jest.Mock).mockReturnValue(new Promise<string>((resolve) => { concluir = resolve; }));
  const leitura = lerVisaoAtiva();
  await salvarVisaoAtiva('driver');
  await act(async () => { concluir('manager'); await leitura; });
  const tela = await render(<TabLayout />);
  await tela.findByText('No published route today');
  expect(tela.getByLabelText('Drive today').props.value).toBe(true);
});

it('More oferece o mesmo switch nativo e abre a rota ao ligar', async () => {
  const MoreScreen = require('@/app/(tabs)/more').default;
  const tela = await render(<MoreScreen />);
  const interruptor = await tela.findByLabelText('Drive today');
  expect(tela.getByRole('switch')).toBe(interruptor);
  expect(interruptor.props.onTintColor).toBe('#203522');
  expect(interruptor.props.tintColor).toBe('#D1D1D6');
  expect(interruptor.props.thumbTintColor).toBe('#FFFFFF');
  expect(tela.queryByText('Driver view')).toBeNull();
  await fireEvent(interruptor, 'valueChange', true);
  expect(mockSetView).toHaveBeenCalledWith('driver');
  expect(mockReplace).toHaveBeenCalledWith('/(tabs)/driver');
  await waitFor(() => expect(tela.queryByText('Team')).toBeNull());
});

it('perfil do gestor dirigindo usa cabeçalho de motorista e permite voltar', async () => {
  await salvarVisaoAtiva('driver');
  const ProfileScreen = require('@/app/(tabs)/profile').default;
  const tela = await render(<ProfileScreen />);
  await tela.findByText('PACK & PAWS CLUB · DRIVER');
  expect(tela.getByText('Manager')).toBeTruthy();
  await fireEvent(tela.getByLabelText('Drive today'), 'valueChange', false);
  expect(mockReplace).toHaveBeenLastCalledWith('/(tabs)');
  await tela.findByText('PACK & PAWS CLUB · MANAGER');
});

it('gestor que chega direto à rota sem ligar o switch volta para a Home', async () => {
  mockNavegacao.rota = '/(tabs)/driver';
  const tela = await render(<TabLayout />);
  await tela.findByText(/Good .*Alex/);
  expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
  expect(tela.getByLabelText('Drive today').props.value).toBe(false);
  expect(tela.queryByTestId('aba-driver')).toBeNull();
});

it('falha no cofre não impede a troca imediata e a volta para o painel', async () => {
  (SecureStore.getItemAsync as jest.Mock).mockRejectedValue(new Error('sem cofre'));
  (SecureStore.setItemAsync as jest.Mock).mockRejectedValue(new Error('sem cofre'));
  const tela = await render(<TabLayout />);
  await fireEvent(await tela.findByLabelText('Drive today'), 'valueChange', true);
  await tela.findByText('No published route today');
  await fireEvent(tela.getByLabelText('Drive today'), 'valueChange', false);
  await tela.findByText(/Good .*Alex/);
  expect(tela.getByTestId('aba-index')).toBeTruthy();
  expect(tela.getByLabelText('Drive today').props.value).toBe(false);
});
