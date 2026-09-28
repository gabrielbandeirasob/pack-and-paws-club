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
  useOrganizationRole: () => ({ role: conta.role, view: conta.role, isLoading: false }),
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


/**
 * BUG DO DONO (28/09/2026): "na aba More a página não movimenta".
 * Medido no app real: em tela pequena (375x600) o conteúdo parava no "Change password" — "Help & support",
 * a caixa da conta, "Sign out" e a versão ficavam INALCANÇÁVEIS, e rolar 800px não movia nada (prints
 * idênticos). Causa: a lista era um `<View>` sem rolagem. Estes vetores travam o conserto.
 */
it('a lista do More ROLA e o que ficava escondido esta dentro da area que rola', async () => {
  conta.role = 'manager';
  const tela = await render(<MenuMore />);
  await waitFor(() => expect(tela.getByText('Sign out')).toBeTruthy());

  const area = tela.getByTestId('more-scroll');
  expect(area).toBeTruthy();

  const estaDentro = (no: { parent: unknown }) => {
    let p: unknown = no.parent;
    while (p) {
      if (p === area) return true;
      p = (p as { parent: unknown }).parent;
    }
    return false;
  };
  // o que estava inalcançável tem de morar DENTRO do que rola
  expect(estaDentro(tela.getByText('Sign out'))).toBe(true);
  expect(estaDentro(tela.getByText('Help & support'))).toBe(true);
  expect(estaDentro(tela.getByText(/version 1\.0\.0/))).toBe(true);
  // e continua sem esconder o que é do motorista
  conta.role = 'driver';
});
