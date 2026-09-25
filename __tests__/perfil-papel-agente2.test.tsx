/**
 * VETORES DO AGENTE2 — o PERFIL tem de mostrar o papel REAL da conta.
 *
 * Achado da revisão das contas (25/09/2026): `app/(tabs)/profile.tsx` escrevia "DRIVER" na mão (linha do
 * cabeçalho e linha do selo), então o GESTOR via "PACK & PAWS CLUB · DRIVER" no próprio perfil. Prova de
 * tela: impressão do perfil logado como `e2e.manager@packpawsclub.test` com o selo "DRIVER".
 *
 * O teste fixa o REQUISITO, não a implementação: quem manda é o papel do vínculo ativo
 * (`organization_members.role`), e enquanto ele não chegou a tela não afirma papel nenhum.
 */
import { render, waitFor } from '@testing-library/react-native';

const conta = { role: null as string | null };

jest.mock('@/features/auth/useOrganizationRole', () => ({
  useOrganizationRole: () => ({ role: conta.role, isLoading: false }),
}));

jest.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'u-1', email: 'e2e.manager@packpawsclub.test' } } }),
}));

jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { full_name: 'Alex Rivera' }, error: null }),
        }),
      }),
    }),
  },
}));

import PerfilDaConta from '../app/(tabs)/profile';

it('perfil do GESTOR mostra Manager e NUNCA Driver', async () => {
  conta.role = 'manager';
  const tela = await render(<PerfilDaConta />);
  await waitFor(() => expect(tela.getByText('Alex Rivera')).toBeTruthy());

  expect(tela.getByText('Manager')).toBeTruthy();
  expect(tela.getByText('PACK & PAWS CLUB · MANAGER')).toBeTruthy();
  expect(tela.queryByText('Driver')).toBeNull();
  expect(tela.queryByText('PACK & PAWS CLUB · DRIVER')).toBeNull();
});

it('perfil do MOTORISTA mostra Driver', async () => {
  conta.role = 'driver';
  const tela = await render(<PerfilDaConta />);
  await waitFor(() => expect(tela.getByText('Alex Rivera')).toBeTruthy());

  expect(tela.getByText('Driver')).toBeTruthy();
  expect(tela.getByText('PACK & PAWS CLUB · DRIVER')).toBeTruthy();
  expect(tela.queryByText('Manager')).toBeNull();
});

it('enquanto o papel nao chegou, o perfil nao afirma papel nenhum', async () => {
  conta.role = null;
  const tela = await render(<PerfilDaConta />);
  await waitFor(() => expect(tela.getByText('Alex Rivera')).toBeTruthy());

  expect(tela.getByText('Account')).toBeTruthy();
  expect(tela.queryByText('Driver')).toBeNull();
  expect(tela.queryByText('Manager')).toBeNull();
});
