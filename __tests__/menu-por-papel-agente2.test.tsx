/**
 * VETORES DO AGENTE2 — o menu "More" tem de respeitar o PAPEL.
 *
 * Achado da revisão das contas (25/09/2026), na tela real logada como motorista: o menu mostrava "Team —
 * Invite drivers and managers, and remove whoever left" para o MOTORISTA. A tela não fazia nada (o RLS
 * barra), mas convidar o motorista a gerenciar a equipe confunde e não é assunto dele.
 *
 * Junto entra a melhoria 1 (Atividade): entrada de auditoria SÓ para o gestor.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const conta = { role: null as string | null };
const empurrados: string[] = [];

jest.mock('@/features/auth/useOrganizationRole', () => ({
  useOrganizationRole: () => ({ role: conta.role, isLoading: false }),
}));

jest.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'u-1', email: 'quem@packpawsclub.test' } } }),
}));

jest.mock('expo-router', () => ({
  router: { push: (destino: string) => empurrados.push(destino), back: jest.fn(), replace: jest.fn() },
}));

jest.mock('expo-constants', () => ({ expoConfig: { version: '1.0.0', ios: { buildNumber: '60' } } }));

jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { signOut: jest.fn() } },
}));

import MenuMore from '../app/(tabs)/more';

it('MOTORISTA nao ve Team nem Activity no menu', async () => {
  conta.role = 'driver';
  empurrados.length = 0;
  const tela = await render(<MenuMore />);

  await waitFor(() => expect(tela.getByText('Route history')).toBeTruthy());
  expect(tela.queryByText('Team')).toBeNull();
  expect(tela.queryByText('Activity')).toBeNull();
  // e continua com o que é dele
  expect(tela.getByText('Change password')).toBeTruthy();
  expect(tela.getByText('Sign out')).toBeTruthy();
});

it('GESTOR ve Team e Activity, e o toque em Activity abre a auditoria', async () => {
  conta.role = 'manager';
  empurrados.length = 0;
  const tela = await render(<MenuMore />);

  await waitFor(() => expect(tela.getByText('Team')).toBeTruthy());
  expect(tela.getByText('Activity')).toBeTruthy();

  fireEvent.press(tela.getByLabelText('Activity'));
  expect(empurrados).toContain('/activity');
});
