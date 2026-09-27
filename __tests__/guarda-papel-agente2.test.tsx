/**
 * TRAVA DE PAPEL (print do dono, 27/09/2026): *"quando clica no driver View ele não faz a troca"*.
 *
 * O print mostrava o app do GESTOR na tela "Today's Route" com "No published route today" e a barra de
 * abas do gestor **sem nenhuma aba acesa** — estado em que nada leva a tela de volta. A causa é a ROTA
 * aberta não conferir com o PAPEL (troca de conta no mesmo aparelho, ou cair na rota por link).
 *
 * O que estes vetores travam: cada tela só libera o papel dela; quem está no papel errado é DEVOLVIDO
 * para o app dele (`/(tabs)/driver` para motorista, `/(tabs)` para gestor) — e nunca vê o conteúdo.
 */
import { render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

const conta = { role: null as string | null };
const trocas: string[] = [];

jest.mock('@/features/auth/useOrganizationRole', () => ({
  useOrganizationRole: () => ({ role: conta.role, isLoading: false }),
}));

jest.mock('expo-router', () => ({
  router: { replace: (destino: string) => trocas.push(destino), push: jest.fn(), back: jest.fn() },
}));

import { rotaDoPapel, useRoleGuard } from '@/features/auth/useRoleGuard';

function Sonda({ esperado }: { esperado: 'manager' | 'driver' }) {
  const { liberado } = useRoleGuard(esperado);
  return <Text>{liberado ? 'liberado' : 'bloqueado'}</Text>;
}

describe('rotaDoPapel', () => {
  it('leva cada papel para o app dele', () => {
    expect(rotaDoPapel('driver')).toBe('/(tabs)/driver');
    expect(rotaDoPapel('manager')).toBe('/(tabs)');
  });
});

describe('trava de papel', () => {
  it('motorista na tela do motorista: liberado e SEM troca', async () => {
    conta.role = 'driver';
    trocas.length = 0;
    const tela = await render(<Sonda esperado="driver" />);
    expect(tela.getByText('liberado')).toBeTruthy();
    expect(trocas).toEqual([]);
  });

  it('GESTOR na tela do motorista: bloqueia e manda para o painel (o caso do print)', async () => {
    conta.role = 'manager';
    trocas.length = 0;
    const tela = await render(<Sonda esperado="driver" />);
    expect(tela.getByText('bloqueado')).toBeTruthy();
    await waitFor(() => expect(trocas).toEqual(['/(tabs)']));
  });

  it('motorista numa tela do gestor: bloqueia e manda para a rota', async () => {
    conta.role = 'driver';
    trocas.length = 0;
    await render(<Sonda esperado="manager" />);
    await waitFor(() => expect(trocas).toEqual(['/(tabs)/driver']));
  });

  it('papel ainda carregando: bloqueado e sem troca (não pisca a tela errada)', async () => {
    conta.role = null;
    trocas.length = 0;
    const tela = await render(<Sonda esperado="driver" />);
    expect(tela.getByText('bloqueado')).toBeTruthy();
    expect(trocas).toEqual([]);
  });
});
